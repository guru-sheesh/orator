import { useLiveQuery } from 'dexie-react-hooks'
import { clipIdFromPrompt } from './clips'
import { db, type SpeechAttempt } from './db'
import { loadPassages, WORDS } from './speech'
import { TECHNIQUE_TAGS, type CoachRequest, type FillerPosition, type SpeechAnalysis } from '../lib/analysisTypes'
import type { SpeechMetrics } from '../lib/metrics'
import type { TranscriptWord } from '../lib/transcribe'
import { pickTalk, requestFeedback } from './feedback'
import { localAnalysis, localFeedback } from '../lib/localAnalysis'
import { speakerHistory } from './trends'

/** Shadowing is assessed against the clip; only independent delivery gets language analysis. */
export function shouldAnalyse(a: Pick<SpeechAttempt, 'task' | 'stage'>) {
  return a.task !== 'shadowing' || a.stage === 'deliver'
}

/** "0:So 1:the <pause 1.2s hesitation> 2:main …" — indices let the model point at exact words. */
export function encodeTranscript(words: TranscriptWord[], metrics: SpeechMetrics) {
  const pauseAt = new Map(metrics.pauses.map((p) => [p.beforeWord, p]))
  const soundsAt = new Map<number, string[]>()
  metrics.unrecognisedSounds.forEach((s, n) => soundsAt.set(s.beforeWord, [...(soundsAt.get(s.beforeWord) ?? []), `<sound#${n} ${s.seconds}s>`]))
  const out: string[] = []
  for (let i = 0; i <= words.length; i++) {
    const p = pauseAt.get(i)
    if (p) out.push(`<pause ${p.seconds}s ${p.kind}>`)
    out.push(...(soundsAt.get(i) ?? []))
    if (i < words.length) out.push(`${i}:${words[i].text}${words[i].punct ?? ''}`)
  }
  return out.join(' ')
}

function describeMetrics(m: SpeechMetrics) {
  const count = (k: string) => m.pauses.filter((p) => p.kind === k).length
  return [
    `duration ${m.durationSec}s, ${m.wordCount} words, ${m.wpm ?? '?'} wpm`,
    `sentence pace ${m.sentenceWpm.join('/') || 'n/a'} wpm (variation ${m.paceVariation ?? 'n/a'}%)`,
    `rushed sentences ${m.rushedSentences.length}, fast sentence endings ${m.fastEndings.length}, boundaries without a pause ${m.rushedBoundaries}`,
    `pauses: deliberate ${count('deliberate')}, hesitation ${count('hesitation')}, word-search ${count('word-search')}, inside-phrase ${count('inside-phrase')}`,
    `unrecognised voiced sounds ${m.unrecognisedSounds.length}`,
  ].join('; ')
}

async function referenceFor(a: SpeechAttempt): Promise<string | undefined> {
  if (a.task === 'words') return WORDS.find((w) => w.id === a.promptId)?.word
  if (a.task === 'explain') return (await loadPassages()).find((p) => p.id === a.promptId)?.text
  if (a.task === 'paraphrase' || a.task === 'shadowing') {
    const clipId = clipIdFromPrompt(a.promptId)
    if (clipId) return (await db.clipTranscripts.get(clipId))?.text
    const [sourceId, segment] = a.promptId.split(':').map(Number)
    return (await db.shadowSources.get(sourceId))?.clipTranscripts?.[segment]?.text
  }
  return undefined
}

const running = new Set<number>()
const retries = new Map<number, number>()
const RETRY_DELAY_MS = 60_000
const MAX_AUTO_RETRIES = 3

const MESSAGES: Record<string, string> = {
  'not-configured': 'Analysis isn’t set up yet: the AI key is missing on the server.',
  'rate-limited': 'The AI service is busy (free-tier limit). Retrying in a minute.',
  timeout: 'The analysis took too long. Retrying in a minute.',
  offline: 'You’re offline. Analysis runs when you’re back online.',
}

/** The server's error code; Netlify's own gateway timeouts (502/504) carry none. */
export function errorCode(res: Response | null, body: { error?: string }): string {
  if (body.error) return body.error
  return res && res.status >= 500 ? 'timeout' : 'provider'
}

/** Failures that would repeat for every waiting answer, so batch retries stop at the first one. */
const BLOCKING = new Set(['not-configured', 'offline', 'rate-limited'])

/**
 * Quick on-phone review: works offline and gives feedback straight away. The
 * AI coach (when online and set up) replaces it with a fuller review.
 */
export async function applyLocalReview(attemptId: number) {
  const a = await db.speechAttempts.get(attemptId)
  if (!a?.words?.length || !a.metrics || !shouldAnalyse(a)) return
  const local = localAnalysis({ task: a.task, prompt: a.prompt, reference: await referenceFor(a), words: a.words, metrics: a.metrics })
  if (a.analysisSource === 'ai') {
    if (!a.localAnalysis) await db.speechAttempts.update(attemptId, { localAnalysis: local })
    return
  }
  const feedback = localFeedback(a.task, local, a.metrics)
  const talk = await pickTalk(local)
  await db.speechAttempts.update(attemptId, {
    analysisStatus: 'done',
    analysis: local,
    analysisSource: 'local',
    localAnalysis: local,
    analysisError: undefined,
    feedbackStatus: 'done',
    feedback: { ...feedback, talkId: talk?.id ?? null, talkReason: talk?.notice ?? '' },
    feedbackSource: 'local',
    feedbackError: undefined,
  })
}

/** The AI coach: replaces the quick review with a full one. Never removes the quick review on failure. */
export async function analyseAttempt(attemptId: number): Promise<'blocked' | void> {
  if (running.has(attemptId)) return
  running.add(attemptId)
  try {
    let a = await db.speechAttempts.get(attemptId)
    if (!a || !a.words?.length || !a.metrics || !shouldAnalyse(a)) return
    if (a.analysisSource !== 'ai' && a.analysisStatus !== 'done') {
      await applyLocalReview(attemptId)
      a = (await db.speechAttempts.get(attemptId))!
    }
    if (a.analysisSource === 'ai') {
      if (a.feedbackSource !== 'ai') return requestFeedback(attemptId)
      return
    }
    if (!navigator.onLine) {
      await db.speechAttempts.update(attemptId, { aiStatus: 'failed', aiError: MESSAGES.offline })
      return 'blocked'
    }
    await db.speechAttempts.update(attemptId, { aiStatus: 'pending', aiError: undefined })

    const request: CoachRequest = {
      task: a.task,
      prompt: a.prompt,
      reference: await referenceFor(a),
      transcript: encodeTranscript(a.words!, a.metrics!),
      metrics: describeMetrics(a.metrics!),
      history: await speakerHistory(),
    }
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : { error: 'offline' }

    if (res?.ok && body.result) {
      await db.speechAttempts.update(attemptId, { analysisStatus: 'done', analysis: sanitise(body.result, a.words!, a.metrics!), analysisSource: 'ai' })
      retries.delete(attemptId)
      void requestFeedback(attemptId)
      return
    }
    const code = errorCode(res, body)
    await db.speechAttempts.update(attemptId, {
      aiStatus: code === 'not-configured' ? 'unavailable' : 'failed',
      aiError: MESSAGES[code] ?? 'The AI coach couldn’t review this answer. You can try again.',
    })
    // Busy or slow: try again automatically a few times.
    const n = retries.get(attemptId) ?? 0
    if ((code === 'rate-limited' || code === 'timeout') && n < MAX_AUTO_RETRIES) {
      retries.set(attemptId, n + 1)
      setTimeout(() => void analyseAttempt(attemptId), RETRY_DELAY_MS * (n + 1))
    }
    if (BLOCKING.has(code)) return 'blocked'
  } catch {
    await db.speechAttempts.update(attemptId, { aiStatus: 'failed', aiError: 'The AI coach couldn’t review this answer. You can try again.' }).catch(() => {})
  } finally {
    running.delete(attemptId)
  }
}

/** Turns transcript markers the model may echo back into readable text. */
export function cleanEvidence(text: string) {
  return text
    .replace(/<pause\s+([\d.]+)s[^>]*>/g, '[$1 s pause]')
    .replace(/<sound#\d+[^>]*>/g, '(um?)')
    .replace(/\b\d+:(?=\S)/g, '')
}

/** Unambiguous fillers are always counted, whatever the model decides; "so"/"like" stay contextual. */
const PURE_FILLERS = new Set(['um', 'uh', 'er', 'erm', 'uhm', 'hmm', 'mm'])

function withPureFillers(fillers: SpeechAnalysis['fillers'], words: TranscriptWord[], metrics: SpeechMetrics): SpeechAnalysis['fillers'] {
  const have = new Set(fillers.map((f) => f.wordIndex))
  const pauseBefore = new Set(metrics.pauses.map((p) => p.beforeWord))
  const added = words.flatMap((w, i) => {
    if (have.has(i) || !PURE_FILLERS.has(w.text.toLowerCase())) return []
    const atStart = i === 0 || /[.!?]/.test(words[i - 1].punct ?? '')
    const position: FillerPosition = atStart ? 'sentence-start' : pauseBefore.has(i) || pauseBefore.has(i + 1) ? 'word-search' : 'mid-sentence'
    return [{ text: w.text, wordIndex: i, position }]
  })
  return [...fillers, ...added].sort((a, b) => a.wordIndex - b.wordIndex)
}

/** Drops anything pointing outside the transcript so the UI never highlights the wrong word. */
function sanitise(raw: SpeechAnalysis, words: TranscriptWord[], metrics: SpeechMetrics): SpeechAnalysis {
  const wordCount = words.length
  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < wordCount
  return {
    ...raw,
    fillers: withPureFillers((raw.fillers ?? []).filter((f) => ok(f.wordIndex)), words, metrics),
    strengths: raw.strengths ?? [],
    techniqueTags: (raw.techniqueTags ?? []).filter((t) => (TECHNIQUE_TAGS as readonly string[]).includes(t)),
    organisation: { mainPoint: raw.organisation?.mainPoint ?? 'missing', structure: raw.organisation?.structure ?? '', issues: raw.organisation?.issues ?? [] },
    soundFillers: raw.soundFillers ?? [],
    repetitions: (raw.repetitions ?? []).map((r) => ({ ...r, wordIndexes: (r.wordIndexes ?? []).filter(ok) })),
    restarts: (raw.restarts ?? []).filter((r) => ok(r.wordIndex)),
    sentenceIssues: (raw.sentenceIssues ?? []).filter((r) => ok(r.wordIndex)),
    grammar: (raw.grammar ?? []).filter((r) => ok(r.wordIndex)),
    conciseness: (raw.conciseness ?? []).filter((r) => ok(r.wordIndex)),
    delivery: raw.delivery ?? [],
    priority: { weakness: raw.priority?.weakness ?? '', evidence: cleanEvidence(raw.priority?.evidence ?? '') },
  }
}

/** How far back the AI coach upgrades quick reviews, so a long offline spell doesn't burn the free quota at once. */
const AI_BACKLOG = 12

export async function processPendingAnalyses() {
  // 1. Quick review for anything transcribed but not reviewed yet (works offline).
  const unreviewed = await db.speechAttempts.filter((a) => a.transcription === 'done' && shouldAnalyse(a) && !!a.words?.length && (a.analysisStatus !== 'done' || !a.analysis)).toArray()
  for (const a of unreviewed) await applyLocalReview(a.id!).catch(() => {})
  if (!navigator.onLine) return
  // 2. AI coach for the most recent answers still on the quick review.
  const upgrade = (await db.speechAttempts.filter((a) => a.transcription === 'done' && shouldAnalyse(a) && !!a.words?.length && (a.analysisSource !== 'ai' || a.feedbackSource !== 'ai')).toArray())
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, AI_BACKLOG)
  for (const a of upgrade) if ((await analyseAttempt(a.id!)) === 'blocked') return
}

export function useCoachStatus() {
  return useLiveQuery(async () => {
    try {
      const res = await fetch('/api/coach', { cache: 'no-store' })
      return res.ok ? ((await res.json()) as { provider: string; configured: boolean }) : null
    } catch {
      return null
    }
  })
}
