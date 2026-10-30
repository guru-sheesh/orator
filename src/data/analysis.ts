import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SpeechAttempt } from './db'
import { loadPassages, WORDS } from './speech'
import type { CoachRequest, FillerPosition, SpeechAnalysis } from '../lib/analysisTypes'
import type { SpeechMetrics } from '../lib/metrics'
import type { TranscriptWord } from '../lib/transcribe'

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

export async function analyseAttempt(attemptId: number): Promise<void> {
  if (running.has(attemptId)) return
  running.add(attemptId)
  try {
    const a = await db.speechAttempts.get(attemptId)
    if (!a || a.analysisStatus === 'done' || !a.words?.length || !a.metrics) return
    if (!navigator.onLine) {
      await db.speechAttempts.update(attemptId, { analysisStatus: 'failed', analysisError: MESSAGES.offline })
      return
    }
    await db.speechAttempts.update(attemptId, { analysisStatus: 'pending', analysisError: undefined })

    const request: CoachRequest = {
      task: a.task,
      prompt: a.prompt,
      reference: await referenceFor(a),
      transcript: encodeTranscript(a.words, a.metrics),
      metrics: describeMetrics(a.metrics),
    }
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : { error: 'offline' }

    if (res?.ok && body.analysis) {
      await db.speechAttempts.update(attemptId, { analysisStatus: 'done', analysis: sanitise(body.analysis, a.words, a.metrics) })
      retries.delete(attemptId)
      return
    }
    const code: string = body.error ?? 'provider'
    await db.speechAttempts.update(attemptId, { analysisStatus: 'failed', analysisError: MESSAGES[code] ?? 'The analysis failed. You can try again.' })
    // Busy or slow: try again automatically a few times.
    const n = retries.get(attemptId) ?? 0
    if ((code === 'rate-limited' || code === 'timeout') && n < MAX_AUTO_RETRIES) {
      retries.set(attemptId, n + 1)
      setTimeout(() => void analyseAttempt(attemptId), RETRY_DELAY_MS * (n + 1))
    }
  } finally {
    running.delete(attemptId)
  }
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
    techniqueTags: raw.techniqueTags ?? [],
    soundFillers: raw.soundFillers ?? [],
    repetitions: (raw.repetitions ?? []).map((r) => ({ ...r, wordIndexes: (r.wordIndexes ?? []).filter(ok) })),
    restarts: (raw.restarts ?? []).filter((r) => ok(r.wordIndex)),
    sentenceIssues: (raw.sentenceIssues ?? []).filter((r) => ok(r.wordIndex)),
    grammar: (raw.grammar ?? []).filter((r) => ok(r.wordIndex)),
    conciseness: (raw.conciseness ?? []).filter((r) => ok(r.wordIndex)),
    delivery: raw.delivery ?? [],
  }
}

export async function processPendingAnalyses() {
  if (!navigator.onLine) return
  const waiting = await db.speechAttempts
    .filter((a) => a.transcription === 'done' && shouldAnalyse(a) && (a.analysisStatus === 'pending' || a.analysisStatus === 'failed' || a.analysisStatus === undefined))
    .toArray()
  for (const a of waiting) await analyseAttempt(a.id!)
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
