import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DateKey } from './db'

/**
 * Journaling is tracked as a simple daily mark: the user journals wherever
 * they like and records that they did (user decision, 2026-10-30). Entries
 * from the earlier text journal keep counting if they were marked complete.
 */
export async function setJournaled(date: DateKey, done: boolean) {
  if (done) {
    const existing = await db.journal.get(date)
    await db.journal.put({ ...(existing ?? { date, mode: 'free', prompted: {}, freeWrite: '' }), date, completed: true, updatedAt: Date.now() })
  } else {
    await db.journal.delete(date)
  }
}

/** Dates journaled in an inclusive range. */
export function useJournaledDates(from: DateKey, to: DateKey) {
  return useLiveQuery(async () => {
    const entries = await db.journal.where('date').between(from, to, true, true).toArray()
    return new Set(entries.filter((e) => e.completed).map((e) => e.date))
  }, [from, to])
}
