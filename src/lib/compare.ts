/**
 * Attempt 1 vs Attempt 2 (CLAUDE.md §12): individual dimensions, never one
 * combined score. Computed locally from saved analysis, so it costs no AI call.
 */
import type { SpeechAttempt } from '../data/db'

export type Direction = 'improved' | 'worse' | 'same'

export interface CompareRow {
  label: string
  first: string
  second: string
  direction: Direction
  change: string
}

const MAIN_POINT_RANK = { first: 3, early: 2, late: 1, missing: 0 } as const
const MAIN_POINT_TEXT = { first: 'First', early: 'Early', late: 'Late', missing: 'Missing' } as const

/** Counts a lower-is-better dimension. */
function countRow(label: string, a: number, b: number): CompareRow {
  const d = b - a
  const n = Math.abs(d)
  return {
    label,
    first: String(a),
    second: String(b),
    direction: d < 0 ? 'improved' : d > 0 ? 'worse' : 'same',
    change: d === 0 ? 'Same' : `${n} ${d < 0 ? 'fewer' : 'more'}`,
  }
}

export function dimensions(a: SpeechAttempt) {
  const an = a.analysis!
  const m = a.metrics!
  return {
    fillers: (an.fillers?.length ?? 0) + (an.soundFillers?.length ?? 0),
    restarts: an.restarts?.length ?? 0,
    hesitations: (m.pauses ?? []).filter((p) => p.kind === 'hesitation' || p.kind === 'word-search').length,
    repeated: (an.repetitions ?? []).filter((r) => !r.deliberate).length,
    grammar: an.grammar?.length ?? 0,
    sentenceIssues: an.sentenceIssues?.length ?? 0,
    paceVariation: m.paceVariation ?? null,
    wpm: m.wpm,
    mainPoint: an.organisation?.mainPoint ?? 'missing',
    missed: an.content?.missed.length ?? null,
  }
}

export function compareAttempts(firstAttempt: SpeechAttempt, secondAttempt: SpeechAttempt) {
  const a = dimensions(firstAttempt)
  const b = dimensions(secondAttempt)
  const rows: CompareRow[] = [
    countRow('Fillers', a.fillers, b.fillers),
    countRow('Restarts', a.restarts, b.restarts),
    countRow('Long hesitations', a.hesitations, b.hesitations),
    countRow('Repeated words/ideas', a.repeated, b.repeated),
    countRow('Sentence problems', a.sentenceIssues, b.sentenceIssues),
    countRow('Grammar affecting clarity', a.grammar, b.grammar),
  ]
  if (a.missed !== null && b.missed !== null) rows.push(countRow('Key ideas missed', a.missed, b.missed))

  // Pace consistency: lower variation is steadier. Ignore small wobbles.
  if (a.paceVariation !== null && b.paceVariation !== null) {
    const d = b.paceVariation - a.paceVariation
    rows.push({
      label: 'Pace consistency',
      first: `${a.wpm ?? '?'} wpm`,
      second: `${b.wpm ?? '?'} wpm`,
      direction: d <= -5 ? 'improved' : d >= 5 ? 'worse' : 'same',
      change: d <= -5 ? 'Steadier' : d >= 5 ? 'Less steady' : 'Similar',
    })
  }

  const rankA = MAIN_POINT_RANK[a.mainPoint]
  const rankB = MAIN_POINT_RANK[b.mainPoint]
  rows.push({
    label: 'Main point',
    first: MAIN_POINT_TEXT[a.mainPoint],
    second: MAIN_POINT_TEXT[b.mainPoint],
    direction: rankB > rankA ? 'improved' : rankB < rankA ? 'worse' : 'same',
    change: rankB > rankA ? 'Clearer' : rankB < rankA ? 'Later' : 'Same',
  })

  const improved = rows.filter((r) => r.direction === 'improved').map((r) => `${r.label}: ${r.change.toLowerCase()}`)
  const worse = rows.filter((r) => r.direction === 'worse').map((r) => `${r.label}: ${r.change.toLowerCase()}`)
  // Still needs work: anything that got worse, plus problems still present on the retry.
  const stillPresent = rows.filter((r) => r.direction !== 'worse' && r.label !== 'Main point' && r.label !== 'Pace consistency' && Number(r.second) > 0).map((r) => `${r.label}: ${r.second} left`)
  if (b.mainPoint === 'late' || b.mainPoint === 'missing') stillPresent.push('Main point: still not stated early')

  return {
    rows,
    improved,
    needsWork: [...worse, ...stillPresent],
    nextPriority: secondAttempt.analysis!.priority.weakness,
  }
}
