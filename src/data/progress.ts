import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type DateKey } from './db'
import { dateKeysBetween, toDateKey } from '../lib/date'

export interface DayProgress {
  date: DateKey
  articulation: boolean
  articulationMinutes: number
  journal: boolean
  readingPages: number
  reading: boolean
  /** Targets met that day, 0–3. */
  met: number
}

export interface PeriodProgress {
  days: DayProgress[]
  /** Days in the period up to and including today (future days don't count against you). */
  elapsedDays: number
  articulationDays: number
  articulationMinutes: number
  journalDays: number
  readingPages: number
  readingTarget: number
  booksCompleted: number
}

/**
 * Per-day and total progress for an inclusive date range. Reading targets use
 * the current daily target; past days are not re-scored if it changes.
 */
export function usePeriodProgress(start: Date, end: Date): PeriodProgress | undefined {
  const from = toDateKey(start)
  const to = toDateKey(end)

  return useLiveQuery(async () => {
    const [settings, statuses, entries, sessions, books] = await Promise.all([
      db.settings.get('user'),
      db.dailyStatus.where('date').between(from, to, true, true).toArray(),
      db.journal.where('date').between(from, to, true, true).toArray(),
      db.readingSessions.where('date').between(from, to, true, true).toArray(),
      db.books.where('completedOn').between(from, to, true, true).count(),
    ])
    const pagesTarget = (settings ?? DEFAULT_SETTINGS).targets.readingPages

    const statusByDate = new Map(statuses.map((s) => [s.date, s]))
    const journalDone = new Set(entries.filter((e) => e.completed).map((e) => e.date))
    const pagesByDate = new Map<DateKey, number>()
    for (const s of sessions) pagesByDate.set(s.date, (pagesByDate.get(s.date) ?? 0) + s.pagesRead)

    const today = toDateKey()
    const days = dateKeysBetween(start, end).map((date): DayProgress => {
      const status = statusByDate.get(date)
      const articulation = status?.articulationCompleted ?? false
      const journal = journalDone.has(date)
      const readingPages = pagesByDate.get(date) ?? 0
      const reading = readingPages >= pagesTarget
      return {
        date,
        articulation,
        articulationMinutes: status?.articulationMinutes ?? 0,
        journal,
        readingPages,
        reading,
        met: Number(articulation) + Number(journal) + Number(reading),
      }
    })

    const elapsedDays = days.filter((d) => d.date <= today).length
    return {
      days,
      elapsedDays,
      articulationDays: days.filter((d) => d.articulation).length,
      articulationMinutes: days.reduce((sum, d) => sum + d.articulationMinutes, 0),
      journalDays: days.filter((d) => d.journal).length,
      readingPages: days.reduce((sum, d) => sum + d.readingPages, 0),
      readingTarget: pagesTarget * elapsedDays,
      booksCompleted: books,
    }
  }, [from, to])
}
