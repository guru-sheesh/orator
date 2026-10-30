import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SpeechAttempt } from './db'
import { addDays, startOfWeek, toDateKey, fromDateKey } from '../lib/date'
import { dimensions } from '../lib/compare'
import type { TechniqueTag } from '../lib/analysisTypes'

/** Long-term articulation trends (CLAUDE.md §12, §16): dimensions over time, never one score. */

export interface WeekPoint {
  weekStart: string
  answers: number
  /** Fillers per minute of speaking: fairer than per answer, as answers vary in length. */
  fillersPerMin: number | null
  hesitationsPerAnswer: number | null
  restartsPerAnswer: number | null
  /** Share of answers with the main point stated first or early. */
  mainPointEarly: number | null
  /** Mean sentence-pace variation (%); lower is steadier. */
  paceVariation: number | null
}

export interface Trends {
  weeks: WeekPoint[]
  totalAnswers: number
  recurring: { tag: TechniqueTag; count: number; share: number } | null
  topFillers: { text: string; count: number }[]
  retries: { pairs: number; fillersImproved: number; hesitationsImproved: number; mainPointImproved: number }
}

const WEEKS = 8
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)

function analysed(a: SpeechAttempt) {
  return a.analysisStatus === 'done' && !!a.analysis && !!a.metrics
}

export async function computeTrends(now = new Date()): Promise<Trends> {
  const firstWeek = addDays(startOfWeek(now), -7 * (WEEKS - 1))
  const all = (await db.speechAttempts.where('date').aboveOrEqual(toDateKey(firstWeek)).toArray()).filter(analysed)
  // Trend lines use first attempts only, so retries (which should be better) don't flatter the trend.
  const firsts = all.filter((a) => a.attemptNumber === 1)

  const weeks: WeekPoint[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = addDays(firstWeek, i * 7)
    const from = toDateKey(start)
    const to = toDateKey(addDays(start, 6))
    const inWeek = firsts.filter((a) => a.date >= from && a.date <= to)
    const dims = inWeek.map(dimensions)
    const minutes = inWeek.reduce((s, a) => s + a.metrics!.durationSec / 60, 0)
    const fillers = dims.reduce((s, d) => s + d.fillers, 0)
    return {
      weekStart: from,
      answers: inWeek.length,
      fillersPerMin: inWeek.length && minutes > 0 ? round1(fillers / minutes) : null,
      hesitationsPerAnswer: round1(mean(dims.map((d) => d.hesitations))),
      restartsPerAnswer: round1(mean(dims.map((d) => d.restarts))),
      mainPointEarly: inWeek.length ? Math.round((dims.filter((d) => d.mainPoint === 'first' || d.mainPoint === 'early').length / inWeek.length) * 100) : null,
      paceVariation: round1(mean(dims.map((d) => d.paceVariation).filter((v): v is number => v !== null))),
    }
  })

  // Recurring weakness: the technique most often recommended over the last two weeks.
  const recentFrom = toDateKey(addDays(now, -14))
  const recent = firsts.filter((a) => a.date >= recentFrom)
  const tagCounts = new Map<TechniqueTag, number>()
  for (const a of recent) for (const t of Array.isArray(a.analysis!.techniqueTags) ? a.analysis!.techniqueTags : []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  const [topTag] = [...tagCounts].sort((x, y) => y[1] - x[1])
  const recurring = topTag && recent.length >= 3 && topTag[1] >= 2 ? { tag: topTag[0], count: topTag[1], share: Math.round((topTag[1] / recent.length) * 100) } : null

  // The user's own habitual fillers (§5A: learned from speaking history).
  const fillerCounts = new Map<string, number>()
  for (const a of all) for (const f of a.analysis!.fillers ?? []) fillerCounts.set(f.text.toLowerCase(), (fillerCounts.get(f.text.toLowerCase()) ?? 0) + 1)
  const topFillers = [...fillerCounts].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([text, count]) => ({ text, count }))

  // Retry improvement: first vs latest analysed attempt at each prompt.
  const groups = new Map<string, SpeechAttempt[]>()
  for (const a of all) {
    const key = `${a.sessionId}|${a.task}|${a.promptId}|${a.stage ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  const retries = { pairs: 0, fillersImproved: 0, hesitationsImproved: 0, mainPointImproved: 0 }
  const rank = { first: 3, early: 2, late: 1, missing: 0 } as const
  for (const g of groups.values()) {
    if (g.length < 2) continue
    g.sort((x, y) => x.attemptNumber - y.attemptNumber)
    const a = dimensions(g[0])
    const b = dimensions(g.at(-1)!)
    retries.pairs++
    if (b.fillers < a.fillers) retries.fillersImproved++
    if (b.hesitations < a.hesitations) retries.hesitationsImproved++
    if (rank[b.mainPoint] > rank[a.mainPoint]) retries.mainPointImproved++
  }

  return { weeks, totalAnswers: firsts.length, recurring, topFillers, retries }
}

export function useTrends() {
  return useLiveQuery(() => computeTrends())
}

/** Plain-language names and one practice tip per technique, for the focus card. */
export const TECHNIQUE_FOCUS: Record<TechniqueTag, { label: string; tip: string }> = {
  'direct-opening': { label: 'Getting to the point early', tip: 'Say your main point in the first sentence, then explain it.' },
  'deliberate-pausing': { label: 'Pausing instead of filling', tip: 'When you need a moment, stop silently. A pause sounds more controlled than “um”.' },
  'strategic-emphasis': { label: 'Emphasising key words', tip: 'Pick the one word in each sentence that matters most and lean on it.' },
  'parallel-structure': { label: 'Balanced sentence patterns', tip: 'When listing ideas, give each the same shape: “It saves time, it cuts costs, it reduces risk.”' },
  'controlled-repetition': { label: 'Repeating on purpose, not by accident', tip: 'Repeat a key phrase deliberately; drop the accidental repeats.' },
  'argument-development': { label: 'Developing an argument', tip: 'After each claim, give a reason and an example before moving on.' },
  signposting: { label: 'Signposting your structure', tip: 'Tell the listener where you are: “First… Second… Finally…”' },
  'short-declaratives': { label: 'Short, clear sentences', tip: 'One idea per sentence. Stop at the full stop.' },
  'strong-conclusion': { label: 'Finishing strongly', tip: 'End by restating your main point in one sentence, then stop.' },
  'pace-control': { label: 'Controlling your pace', tip: 'Slow down for the important sentence; don’t rush the ending.' },
  storytelling: { label: 'Using a concrete example', tip: 'Support your point with one specific example or short story.' },
  'explaining-complex-ideas': { label: 'Explaining step by step', tip: 'Explain in order: what it is, how it works, why it matters.' },
  'concise-wording': { label: 'Saying it in fewer words', tip: 'Cut warm-up phrases like “what I’m basically trying to say is”.' },
  'talking-around-a-word': { label: 'Talking around a missing word', tip: 'If a word won’t come, describe it (“becoming worse”) and keep going.' },
}

export function weekLabel(weekStart: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(fromDateKey(weekStart))
}


/** One-line history for the coach: habitual fillers and the recurring weakness. */
export async function speakerHistory(): Promise<string | undefined> {
  const t = await computeTrends()
  const parts = [
    t.topFillers.length ? `habitual fillers: ${t.topFillers.map((f) => `"${f.text}" (${f.count})`).join(', ')}` : '',
    t.recurring ? `recurring weakness over the last two weeks: ${(TECHNIQUE_FOCUS[t.recurring.tag]?.label ?? t.recurring.tag).toLowerCase()} (${t.recurring.share}% of answers)` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('; ') : undefined
}