import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SpeechAttempt, type Talk } from './db'
import builtInTalks from '../content/talks.json'
import type { CoachingFeedback, FeedbackRequest, SpeechAnalysis } from '../lib/analysisTypes'
import { cleanEvidence, encodeTranscript } from './analysis'
import { loadPassages, WORDS } from './speech'
import { speakerHistory } from './trends'

export const BUILT_IN_TALKS = builtInTalks as Talk[]

export function useTalks() {
  return useLiveQuery(async () => ({ builtIn: BUILT_IN_TALKS, mine: await db.talks.toArray() }))
}

export async function findTalk(id: string | null | undefined): Promise<Talk | undefined> {
  if (!id) return undefined
  return BUILT_IN_TALKS.find((t) => t.id === id) ?? (await db.talks.get(id))
}

/** Talks whose techniques overlap the analysis' tags, best overlap first; the AI picks one or none. */
async function candidateTalks(a: SpeechAnalysis): Promise<Talk[]> {
  const all = [...BUILT_IN_TALKS, ...(await db.talks.toArray())]
  const wanted = new Set<string>(a.techniqueTags)
  return all
    .map((t) => ({ t, score: t.tags.filter((g) => wanted.has(g)).length }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 6)
    .map((x) => x.t)
}

function summarise(a: SpeechAnalysis, attempt: SpeechAttempt): string {
  const m = attempt.metrics!
  const lines = [
    `Top priority: ${a.priority.weakness} (${a.priority.evidence})`,
    `Strengths: ${a.strengths.join('; ') || 'none noted'}`,
    `Fillers (${a.fillers.length + a.soundFillers.length}): ${a.fillers.map((f) => `"${f.text}" ${f.position}`).join(', ') || 'none'}${a.soundFillers.length ? `, plus ${a.soundFillers.length} "um"-like sounds` : ''}`,
    `Pauses: ${m.pauses.map((p) => `${p.kind} ${p.seconds}s`).join(', ') || 'none'}; pace ${m.wpm ?? '?'} wpm, variation ${m.paceVariation ?? 'n/a'}%`,
    `Restarts: ${a.restarts.map((r) => r.note).join('; ') || 'none'}`,
    `Repetition: ${a.repetitions.map((r) => `${r.deliberate ? 'deliberate' : 'accidental'} "${r.text}"`).join('; ') || 'none'}`,
    `Organisation: main point ${a.organisation.mainPoint}; ${a.organisation.structure}; ${a.organisation.issues.join('; ')}`,
    a.grammar.length ? `Grammar: ${a.grammar.map((g) => `"${g.said}" -> "${g.better}"`).join('; ')}` : '',
    a.content ? `Content: missed ${a.content.missed.join('; ') || 'nothing'}; incorrect ${a.content.incorrect.join('; ') || 'nothing'}; copied ${a.content.copiedPhrases.join('; ') || 'nothing'}` : '',
    a.saidTargetWord ? 'The speaker said the target word.' : '',
  ]
  return lines.filter(Boolean).join('\n')
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

/** Second AI call: coaching in the order of CLAUDE.md §10, plus a "Watch this" pick from the talk list. */
export async function requestFeedback(attemptId: number): Promise<void> {
  if (running.has(attemptId)) return
  running.add(attemptId)
  try {
    const a = await db.speechAttempts.get(attemptId)
    if (!a?.analysis || !a.words || !a.metrics || a.feedbackStatus === 'done') return
    await db.speechAttempts.update(attemptId, { feedbackStatus: 'pending', feedbackError: undefined })
    const talks = await candidateTalks(a.analysis)
    const request: FeedbackRequest = {
      mode: 'feedback',
      task: a.task,
      prompt: a.prompt,
      reference: await referenceFor(a),
      transcript: encodeTranscript(a.words, a.metrics),
      analysis: summarise(a.analysis, a),
      talks: talks.map(({ id, title, speaker, tags, notice }) => ({ id, title, speaker, tags, notice })),
      history: await speakerHistory(),
    }
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : { error: 'offline' }
    if (res?.ok && body.result) {
      const fb = body.result as CoachingFeedback
      // Only ever recommend a talk that is really in the list.
      const talkId = fb.talkId && talks.some((t) => t.id === fb.talkId) ? fb.talkId : null
      await db.speechAttempts.update(attemptId, {
        feedbackStatus: 'done',
        feedback: { ...fb, talkId, exampleAnswer: (fb.exampleAnswer ?? '').replace(/^\s*example answer[^:]*:\s*/i, ''), wentWell: fb.wentWell ?? [], wentWrong: (fb.wentWrong ?? []).map((w) => ({ ...w, evidence: cleanEvidence(w.evidence) })), retryTargets: (fb.retryTargets ?? []).slice(0, 3) },
      })
      retries.delete(attemptId)
      return
    }
    const code: string = body.error ?? 'provider'
    const busy = code === 'rate-limited' || code === 'timeout'
    await db.speechAttempts.update(attemptId, {
      feedbackStatus: 'failed',
      feedbackError: busy ? 'The AI service is busy. Retrying in a minute.' : code === 'offline' ? 'You’re offline. Feedback arrives when you’re back online.' : 'Feedback couldn’t be generated. You can try again.',
    })
    const n = retries.get(attemptId) ?? 0
    if (busy && n < 3) {
      retries.set(attemptId, n + 1)
      setTimeout(() => void requestFeedback(attemptId), 60_000 * (n + 1))
    }
  } finally {
    running.delete(attemptId)
  }
}

export async function addTalk(talk: Omit<Talk, 'id'>) {
  await db.talks.add({ ...talk, id: `u${Date.now().toString(36)}` })
}

export async function deleteTalk(id: string) {
  await db.talks.delete(id)
}
