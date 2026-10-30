import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type ShadowStage, type SpeechSession, type TaskId, type TaskStatus } from './db'
import { toDateKey } from '../lib/date'
import { shouldTranscribe, transcribeAttempt } from './transcription'
import words from '../content/words.json'
import questions from '../content/questions.json'
import impromptu from '../content/impromptu.json'

export interface WordItem {
  id: string
  word: string
  level: number
}
export interface QuestionItem {
  id: string
  text: string
  level: number
}
export type Structure = 'point-reason-example-conclusion' | 'what-how-why-example' | 'problem-evidence-cause-action' | 'situation-impact-action-status-next'
export interface ImpromptuItem extends QuestionItem {
  type: 'description' | 'opinion' | 'explanation' | 'argument' | 'professional' | 'technical'
  structure: Structure
}
export interface Passage {
  id: string
  area: string
  title: string
  text: string
  words: number
  url: string
  retrieved: string
}

export const WORDS = words as WordItem[]
export const QUESTIONS = questions as QuestionItem[]
export const IMPROMPTU = impromptu as ImpromptuItem[]

export const STRUCTURE_STEPS: Record<Structure, string[]> = {
  'point-reason-example-conclusion': ['Point', 'Reason', 'Example', 'Conclusion'],
  'what-how-why-example': ['What', 'How', 'Why', 'Example'],
  'problem-evidence-cause-action': ['Problem', 'Evidence', 'Possible cause', 'Action'],
  'situation-impact-action-status-next': ['Situation', 'Impact', 'Action', 'Current status', 'Next step'],
}

/** Session order and target minutes (CLAUDE.md §13). */
export const TASKS: { id: TaskId; title: string; minutes: number; summary: string }[] = [
  { id: 'words', title: 'Word description', minutes: 2, summary: 'Describe 3 words without saying them' },
  { id: 'questions', title: 'Unexpected questions', minutes: 3, summary: '2 questions · 5 s to prepare' },
  { id: 'shadowing', title: 'Speech shadowing', minutes: 5, summary: 'Listen · Repeat · Shadow · Deliver' },
  { id: 'paraphrase', title: 'Paraphrase the speaker', minutes: 3, summary: 'The central message in your words' },
  { id: 'explain', title: 'Read → Hide → Explain', minutes: 6, summary: 'Read once, then explain from memory' },
  { id: 'impromptu', title: 'Impromptu speaking', minutes: 4, summary: '1 question · 10 s to prepare' },
]

/** Seconds of preparation and recording limits per task. */
export const TIMING: Record<TaskId, { prepSec: number; maxSec: number }> = {
  words: { prepSec: 0, maxSec: 45 },
  questions: { prepSec: 5, maxSec: 90 },
  shadowing: { prepSec: 0, maxSec: 120 },
  paraphrase: { prepSec: 15, maxSec: 120 },
  explain: { prepSec: 0, maxSec: 180 },
  impromptu: { prepSec: 10, maxSec: 240 },
}

const EMPTY_TASKS: Record<TaskId, TaskStatus> = {
  words: 'pending',
  questions: 'pending',
  shadowing: 'pending',
  paraphrase: 'pending',
  explain: 'pending',
  impromptu: 'pending',
}

// ---------- Passages (lazy: ~300 excerpts load only when Task 5 opens) ----------

let passagesPromise: Promise<Passage[]> | null = null
export function loadPassages(): Promise<Passage[]> {
  passagesPromise ??= fetch('/content/passages.json').then((r) => {
    if (!r.ok) throw new Error('passages unavailable')
    return r.json()
  })
  passagesPromise.catch(() => (passagesPromise = null))
  return passagesPromise
}

// ---------- Rotation ----------

/** Difficulty rises with practice: level 1 for the first 10 sessions, 2 until 25, then 3. */
async function currentLevel(): Promise<number> {
  const done = await db.speechSessions.filter((s) => s.completedAt !== undefined).count()
  return done < 10 ? 1 : done < 25 ? 2 : 3
}

/** Least-used items first (ties broken randomly), preferring the current level. */
async function pick<T extends { id: string; level?: number }>(kind: string, items: T[], n: number, level?: number): Promise<T[]> {
  const usage = new Map((await db.contentUsage.where('kind').equals(kind).toArray()).map((u) => [u.key, u]))
  const pool = level === undefined ? items : items.filter((i) => i.level === level)
  const ranked = (pool.length >= n ? pool : items)
    .map((item) => ({ item, u: usage.get(`${kind}:${item.id}`), r: Math.random() }))
    .sort((a, b) => (a.u?.count ?? 0) - (b.u?.count ?? 0) || (a.u?.usedAt ?? 0) - (b.u?.usedAt ?? 0) || a.r - b.r)
  return ranked.slice(0, n).map((x) => x.item)
}

async function markUsed(kind: string, ids: string[]) {
  const now = Date.now()
  for (const id of ids) {
    const key = `${kind}:${id}`
    const existing = await db.contentUsage.get(key)
    await db.contentUsage.put({ key, kind, count: (existing?.count ?? 0) + 1, usedAt: now })
  }
}

async function pickShadowSegment(): Promise<SpeechSession['plan']['shadow']> {
  const sources = await db.shadowSources.toArray()
  const all = sources.flatMap((s) => s.segments.map((_, i) => ({ id: `${s.id}:${i}`, sourceId: s.id!, segment: i })))
  if (!all.length) return undefined
  const [chosen] = await pick('shadow', all, 1)
  await markUsed('shadow', [chosen.id])
  return { sourceId: chosen.sourceId, segment: chosen.segment }
}

// ---------- Sessions ----------

export function useTodaySession(): SpeechSession | null | undefined {
  const today = toDateKey()
  return useLiveQuery(async () => (await db.speechSessions.where('date').equals(today).last()) ?? null, [today])
}

export function useSession(id: number | undefined) {
  return useLiveQuery(async () => (id === undefined ? null : ((await db.speechSessions.get(id)) ?? null)), [id])
}

export async function startSession(): Promise<number> {
  const level = await currentLevel()
  const [w, q, [imp], passages, shadow] = await Promise.all([
    pick('word', WORDS, 3, level),
    pick('question', QUESTIONS, 2, level),
    pick('impromptu', IMPROMPTU, 1, level),
    loadPassages().catch(() => [] as Passage[]),
    pickShadowSegment(),
  ])
  const [passage] = passages.length ? await pick('passage', passages, 1) : []

  await Promise.all([
    markUsed('word', w.map((x) => x.id)),
    markUsed('question', q.map((x) => x.id)),
    markUsed('impromptu', [imp.id]),
    passage ? markUsed('passage', [passage.id]) : null,
  ])

  return db.speechSessions.add({
    date: toDateKey(),
    createdAt: Date.now(),
    activeMs: 0,
    plan: { words: w.map((x) => x.id), questions: q.map((x) => x.id), impromptu: imp.id, passage: passage?.id, shadow },
    tasks: { ...EMPTY_TASKS },
  }) as Promise<number>
}

/** For a session created before any audio was imported. */
export async function assignShadow(sessionId: number) {
  const shadow = await pickShadowSegment()
  if (shadow) await db.speechSessions.update(sessionId, { 'plan.shadow': shadow })
  return shadow
}

/**
 * Recomputes the day's articulation status. It counts as complete when all six
 * tasks were actually done (not skipped), or when practice time reaches the target.
 */
async function refreshDailyStatus(date: string) {
  const [sessions, settings] = await Promise.all([db.speechSessions.where('date').equals(date).toArray(), db.settings.get('user')])
  const minutes = Math.floor(sessions.reduce((sum, s) => sum + s.activeMs, 0) / 60_000)
  const target = (settings ?? DEFAULT_SETTINGS).targets.articulationMinutes
  const allDone = sessions.some((s) => Object.values(s.tasks).every((t) => t === 'done'))
  await db.dailyStatus.put({ date, articulationMinutes: minutes, articulationCompleted: allDone || minutes >= target })
}

/** Adds visible time on a task screen to the session and today's articulation minutes. */
export async function addActiveTime(sessionId: number, ms: number) {
  if (ms < 1000) return
  await db.transaction('rw', db.speechSessions, db.dailyStatus, db.settings, async () => {
    const session = await db.speechSessions.get(sessionId)
    if (!session) return
    await db.speechSessions.update(sessionId, { activeMs: session.activeMs + ms })
    await refreshDailyStatus(session.date)
  })
}

/** Marks a task done or skipped; the session is finished once nothing is pending. */
export async function setTaskStatus(sessionId: number, task: TaskId, status: TaskStatus) {
  await db.transaction('rw', db.speechSessions, db.dailyStatus, db.settings, async () => {
    const session = await db.speechSessions.get(sessionId)
    if (!session) return
    const tasks = { ...session.tasks, [task]: status }
    const finished = Object.values(tasks).every((s) => s !== 'pending')
    await db.speechSessions.update(sessionId, { tasks, completedAt: finished ? (session.completedAt ?? Date.now()) : undefined })
    await refreshDailyStatus(session.date)
  })
}

export function nextPendingTask(session: SpeechSession): TaskId | undefined {
  return TASKS.find((t) => session.tasks[t.id] === 'pending')?.id
}

// ---------- Attempts ----------

export async function saveAttempt(input: {
  session: SpeechSession
  task: TaskId
  promptId: string
  prompt: string
  stage?: ShadowStage
  blob: Blob
  mimeType: string
  durationMs: number
}): Promise<number> {
  const keep = ((await db.settings.get('user')) ?? DEFAULT_SETTINGS).keepRecordings
  const transcribeIt = shouldTranscribe(input)
  const id = await db.transaction('rw', db.speechAttempts, db.recordings, async () => {
    const previous = await db.speechAttempts
      .where('sessionId')
      .equals(input.session.id!)
      .filter((a) => a.task === input.task && a.promptId === input.promptId && a.stage === input.stage)
      .count()
    const id = (await db.speechAttempts.add({
      sessionId: input.session.id!,
      date: input.session.date,
      task: input.task,
      promptId: input.promptId,
      prompt: input.prompt,
      stage: input.stage,
      attemptNumber: previous + 1,
      durationMs: Math.round(input.durationMs),
      mimeType: input.mimeType,
      transcription: transcribeIt ? 'pending' : 'skipped',
      createdAt: Date.now(),
    })) as number
    // Audio is held until transcribed, then kept only with the user's opt-in (CLAUDE.md §0.4).
    if (keep || transcribeIt) await db.recordings.put({ attemptId: id, blob: input.blob })
    return id
  })
  if (transcribeIt) void transcribeAttempt(id)
  return id
}

export function useAttempt(id: number | null | undefined) {
  return useLiveQuery(async () => (id == null ? null : ((await db.speechAttempts.get(id)) ?? null)), [id])
}

export function useAttempts(sessionId: number | undefined, task: TaskId) {
  return useLiveQuery(
    () => (sessionId === undefined ? [] : db.speechAttempts.where('sessionId').equals(sessionId).filter((a) => a.task === task).toArray()),
    [sessionId, task],
  )
}
