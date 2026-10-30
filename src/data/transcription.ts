import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type SpeechAttempt } from './db'
import { transcribe, TranscriptionError, type TranscriptWord } from '../lib/transcribe'
import { profileAudio } from '../lib/audioAnalysis'
import { computeMetrics } from '../lib/metrics'
import { analyseAttempt, processPendingAnalyses, shouldAnalyse } from './analysis'
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
export async function transcribeAttempt(attemptId: number): Promise<void> {
  if (running.has(attemptId)) return
  running.add(attemptId)
  try {
    const [attempt, recording, settings] = await Promise.all([db.speechAttempts.get(attemptId), db.recordings.get(attemptId), db.settings.get('user')])
    if (!attempt || attempt.transcription === 'done') return
    if (!recording) {
      await db.speechAttempts.update(attemptId, { transcription: 'failed', transcriptionError: 'The audio for this attempt is no longer on this device.' })
      return
    }
    const durationSec = attempt.durationMs / 1000
    if ((await usageLeft()) < durationSec) {
      await db.speechAttempts.update(attemptId, {
        transcription: 'failed',
        transcriptionError: 'This month’s free transcription time is used up. It resets on the 1st.',
      })
      return
    }

    await db.speechAttempts.update(attemptId, { transcription: 'pending', transcriptionError: undefined })
    const result = await transcribe(recording.blob, { referenceText: await referenceFor(attempt) })
    await addUsage(result.audioSeconds)
    // Loudness envelope finds voiced sounds Azure dropped (often "um"); needs the audio, so do it before discarding it.
    const envelope = await profileAudio(recording.blob).then((p) => p.envelope).catch(() => undefined)
    const analyse = shouldAnalyse(attempt) && result.words.length > 0
    await db.speechAttempts.update(attemptId, {
      transcription: 'done',
      transcript: result.text,
      words: result.words,
      pronunciation: result.scores,
      metrics: computeMetrics(result.words, result.audioSeconds, envelope),
      analysisStatus: analyse ? 'pending' : 'skipped',
    })
    if (!(settings ?? DEFAULT_SETTINGS).keepRecordings) await db.recordings.delete(attemptId)
    if (analyse) void analyseAttempt(attemptId)
  } catch (err) {
    const message = err instanceof TranscriptionError ? err.message : 'Transcription failed. It will retry later.'
    await db.speechAttempts.update(attemptId, { transcription: 'failed', transcriptionError: message })
  } finally {
    running.delete(attemptId)
  }
}

/** Retries anything left untranscribed (offline at the time, app closed, etc.). */
export async function processPendingTranscriptions() {
  if (!navigator.onLine) return
  const waiting = await db.speechAttempts.filter((a) => (a.transcription === 'pending' || a.transcription === 'failed') && shouldTranscribe(a)).toArray()
  for (const a of waiting) {
    // Without its audio (e.g. restored from a backup) it can't be transcribed; transcribeAttempt marks it failed once.
    if (!(await db.recordings.get(a.id!)) && a.transcription === 'failed') continue
    await transcribeAttempt(a.id!)
  }
  await processPendingAnalyses()
}

/** Transcribes a shadowing clip once and caches it on the source. */
export async function ensureClipTranscript(sourceId: number, segment: number) {
  const source = await db.shadowSources.get(sourceId)
  if (!source || source.clipTranscripts?.[segment]) return source?.clipTranscripts?.[segment]
  const range = source.segments[segment]
  if ((await usageLeft()) < range.end - range.start) return undefined
  const audio = await db.shadowAudio.get(sourceId)
  if (!audio) return undefined
  const result = await transcribe(audio.blob, { range })
  await addUsage(result.audioSeconds)
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
  if ((await usageLeft()) < clip.durationSec) return undefined
  const result = await transcribe(blob)
  await addUsage(result.audioSeconds)
  const entry = { clipId: clip.id, text: result.text, words: result.words.map(({ text, start, end, punct }) => ({ text, start, end, punct })) }
  await db.clipTranscripts.put(entry)
  return entry
}