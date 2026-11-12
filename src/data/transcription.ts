import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type SpeechAttempt } from './db'
import { transcribe, TranscriptionError, type Transcription, type TranscriptWord } from '../lib/transcribe'
import { transcribeWithWhisper, type WhisperSize } from '../lib/whisper'
import { profileAudio } from '../lib/audioAnalysis'
import { computeMetrics } from '../lib/metrics'
import { analyseAttempt, applyLocalReview, processPendingAnalyses, shouldAnalyse } from './analysis'
import { clipIdFromPrompt, type BuiltInClip } from './clips'

/** Azure F0 includes 5 hours a month; stop a little short so a long answer can't tip it over. */
export const MONTHLY_LIMIT_SECONDS = 5 * 3600
export const SAFETY_MARGIN_SECONDS = 10 * 60

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function useAzureUsage() {
  return useLiveQuery(async () => {
    const usage = (await db.settings.get('user'))?.azureUsage
    const seconds = usage?.month === monthKey() ? usage.seconds : 0
    return { seconds, limit: MONTHLY_LIMIT_SECONDS, nearLimit: seconds >= MONTHLY_LIMIT_SECONDS - SAFETY_MARGIN_SECONDS }
  })
}

async function addUsage(seconds: number) {
  const settings = (await db.settings.get('user')) ?? DEFAULT_SETTINGS
  const month = monthKey()
  const current = settings.azureUsage?.month === month ? settings.azureUsage.seconds : 0
  await db.settings.put({ ...settings, azureUsage: { month, seconds: current + seconds } })
}

async function usageLeft() {
  const usage = (await db.settings.get('user'))?.azureUsage
  const used = usage?.month === monthKey() ? usage.seconds : 0
  return MONTHLY_LIMIT_SECONDS - SAFETY_MARGIN_SECONDS - used
}

export async function engineSettings() {
  const s = (await db.settings.get('user')) ?? DEFAULT_SETTINGS
  return { engine: s.transcriptionEngine ?? 'whisper', size: (s.whisperSize ?? 'base') as WhisperSize }
}

async function transcribeWithAzure(blob: Blob, seconds: number, opts: { referenceText?: string; range?: { start: number; end: number } }) {
  if ((await usageLeft()) < seconds)
    throw new TranscriptionError('This month’s free Azure transcription time is used up. Switch to on-phone transcription in Settings.', 'quota')
  const result = await transcribe(blob, opts)
  await addUsage(result.audioSeconds)
  return result
}

/**
 * Transcribes with the chosen engine. On-phone Whisper never falls back to
 * Azure by itself: the user chose to keep audio on the phone.
 */
export async function runTranscription(
  blob: Blob,
  seconds: number,
  opts: { referenceText?: string; range?: { start: number; end: number } } = {},
): Promise<Transcription & { wordTimes?: boolean }> {
  const { engine, size } = await engineSettings()
  if (engine === 'azure') return transcribeWithAzure(blob, seconds, opts)
  const result = await transcribeWithWhisper(blob, size, { range: opts.range })
  // A transcription can be what first downloads the model: let the offline status know.
  void import('./offline').then((m) => m.downloadModel()).catch(() => {})
  return result
}

/** Repeat-stage phrases are short drills: not worth the monthly audio budget. */
export function shouldTranscribe(attempt: Pick<SpeechAttempt, 'task' | 'stage'>) {
  return !(attempt.task === 'shadowing' && attempt.stage === 'repeat')
}

/** The clip's own transcript, used as reference text when assessing shadowing. */
async function referenceFor(attempt: SpeechAttempt): Promise<string | undefined> {
  if (attempt.task !== 'shadowing') return undefined
  const clipId = clipIdFromPrompt(attempt.promptId)
  if (clipId) return (await db.clipTranscripts.get(clipId))?.text || undefined
  const [sourceId, segment] = attempt.promptId.split(':').map(Number)
  return (await db.shadowSources.get(sourceId))?.clipTranscripts?.[segment]?.text || undefined
}

const running = new Set<number>()

/**
 * Transcribes one attempt. The audio is held in `recordings` until this
 * succeeds, then discarded unless the user keeps recordings (§0.4).
 */
export async function transcribeAttempt(attemptId: number): Promise<'blocked' | 'failed' | void> {
  if (running.has(attemptId)) return
  running.add(attemptId)
  let transcribed = false
  let keep = true
  try {
    const [attempt, recording, settings] = await Promise.all([db.speechAttempts.get(attemptId), db.recordings.get(attemptId), db.settings.get('user')])
    if (!attempt || attempt.transcription === 'done') return
    if (!recording) {
      await db.speechAttempts.update(attemptId, { transcription: 'failed', transcriptionError: 'The audio for this attempt is no longer on this device.' })
      return
    }
    const durationSec = attempt.durationMs / 1000
    await db.speechAttempts.update(attemptId, { transcription: 'pending', transcriptionError: undefined })
    const result = await runTranscription(recording.blob, durationSec, { referenceText: await referenceFor(attempt).catch(() => undefined) })
    // Loudness envelope finds voiced sounds the recogniser dropped (often "um"); needs the audio, so do it before discarding it.
    const envelope = await profileAudio(recording.blob).then((p) => p.envelope).catch(() => undefined)
    const analyse = shouldAnalyse(attempt) && result.words.length > 0
    const metrics = computeMetrics(result.words, result.audioSeconds, envelope)
    // Estimated word timing can't support pause or "um"-sound findings; keep only what's reliable.
    if (result.wordTimes === false) Object.assign(metrics, { pauses: [], unrecognisedSounds: [], rushedBoundaries: 0, fastEndings: [] })
    await db.speechAttempts.update(attemptId, {
      transcription: 'done',
      transcript: result.text,
      words: result.words,
      pronunciation: result.scores,
      metrics,
      analysisStatus: analyse ? 'pending' : 'skipped',
    })
    transcribed = analyse
    keep = (settings ?? DEFAULT_SETTINGS).keepRecordings
  } catch (err) {
    const message = err instanceof TranscriptionError ? err.message : 'Transcription failed. It will retry later.'
    await db.speechAttempts.update(attemptId, { transcription: 'failed', transcriptionError: message }).catch(() => {})
    // No connection, no key or no quota would fail the same way for every waiting answer.
    if (err instanceof TranscriptionError && (err.kind === 'offline' || err.kind === 'not-configured' || err.kind === 'quota')) return 'blocked'
    if (err instanceof TranscriptionError && err.kind === 'service') return 'failed'
    return
  } finally {
    running.delete(attemptId)
  }
  // After the transcript is safely saved: nothing below can mark it failed.
  if (!keep) await db.recordings.delete(attemptId).catch(() => {})
  if (transcribed) {
    // Instant quick review on the phone, then the AI coach when online.
    await applyLocalReview(attemptId).catch(() => {})
    if (navigator.onLine) void analyseAttempt(attemptId).catch(() => {})
  }
}

/** Retries anything left untranscribed (offline at the time, app closed, etc.). */
export async function processPendingTranscriptions() {
  // On-phone transcription works offline once the model is downloaded; Azure needs a connection.
  if (!navigator.onLine && (await engineSettings()).engine === 'azure') return
  const waiting = await db.speechAttempts.filter((a) => (a.transcription === 'pending' || a.transcription === 'failed') && shouldTranscribe(a)).toArray()
  let failures = 0
  for (const a of waiting) {
    // Without its audio (e.g. restored from a backup) it can't be transcribed; transcribeAttempt marks it failed once.
    if (!(await db.recordings.get(a.id!)) && a.transcription === 'failed') continue
    const r = await transcribeAttempt(a.id!)
    // Stop at a failure that would repeat for every attempt (offline, no key); one bad recording doesn't block the rest,
    // but two failures in a row suggest the phone itself is struggling.
    if (r === 'blocked') break
    failures = r === 'failed' ? failures + 1 : 0
    if (failures >= 2) break
  }
  await processPendingAnalyses()
}

/** Transcribes a shadowing clip once and caches it on the source. */
export async function ensureClipTranscript(sourceId: number, segment: number) {
  const source = await db.shadowSources.get(sourceId)
  if (!source || source.clipTranscripts?.[segment]) return source?.clipTranscripts?.[segment]
  const range = source.segments[segment]
  const audio = await db.shadowAudio.get(sourceId)
  if (!audio) return undefined
  const result = await runTranscription(audio.blob, range.end - range.start, { range }).catch(() => null)
  if (!result) return undefined
  const clip = { text: result.text, words: result.words.map(({ text, start, end }) => ({ text, start, end })) }
  const fresh = await db.shadowSources.get(sourceId)
  await db.shadowSources.update(sourceId, { clipTranscripts: { ...fresh?.clipTranscripts, [segment]: clip } })
  return clip
}


/**
 * A built-in clip's transcript: the ready-made one shipped with the app
 * (pre-transcribed with Whisper, tools/transcribe-clips.py), else Azure once.
 */
export async function ensureBuiltInClipTranscript(clip: BuiltInClip, blob: Blob) {
  const cached = await db.clipTranscripts.get(clip.id)
  if (cached) return cached
  const shipped = await fetch(`/audio/transcripts/${clip.id}.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<{ text: string; words: TranscriptWord[] }>) : null))
    .catch(() => null)
  if (shipped?.words?.length) {
    const entry = { clipId: clip.id, text: shipped.text, words: shipped.words }
    await db.clipTranscripts.put(entry)
    return entry
  }
  const result = await runTranscription(blob, clip.durationSec).catch(() => null)
  if (!result) return undefined
  const entry = { clipId: clip.id, text: result.text, words: result.words.map(({ text, start, end, punct }) => ({ text, start, end, punct })) }
  await db.clipTranscripts.put(entry)
  return entry
}

/** Whether the server has the Azure key and region (Settings shows it, so a missing key is visible before a recording fails). */
export function useTranscriptionStatus() {
  return useLiveQuery(async () => {
    try {
      const res = await fetch('/api/speech-token?check', { cache: 'no-store' })
      return res.ok ? ((await res.json()) as { configured: boolean; missing: string[] }) : null
    } catch {
      return null
    }
  })
}
