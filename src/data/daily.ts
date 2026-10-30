import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type DateKey, type Settings } from './db'

export interface DailySummary {
  articulation: { minutes: number; target: number; done: boolean }
  journal: { done: boolean; started: boolean }
  reading: { pages: number; target: number; done: boolean }
  completedCount: number
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(async () => (await db.settings.get('user')) ?? DEFAULT_SETTINGS)
}

/**
 * Today's progress, derived live from the source tables so the dashboard can
 * never drift from what was actually recorded.
 */
export function useDailySummary(date: DateKey): DailySummary | undefined {
  return useLiveQuery(async () => {
    const [settings, status, entry, sessions] = await Promise.all([
      db.settings.get('user'),
      db.dailyStatus.get(date),
      db.journal.get(date),
      db.readingSessions.where('date').equals(date).toArray(),
    ])
    const targets = (settings ?? DEFAULT_SETTINGS).targets
    const minutes = status?.articulationMinutes ?? 0
    const pages = sessions.reduce((sum, s) => sum + s.pagesRead, 0)

    const articulation = { minutes, target: targets.articulationMinutes, done: status?.articulationCompleted ?? false }
    const journal = { done: entry?.completed ?? false, started: entry !== undefined }
    const reading = { pages, target: targets.readingPages, done: pages >= targets.readingPages }

    return {
      articulation,
      journal,
      reading,
      completedCount: [articulation.done, journal.done, reading.done].filter(Boolean).length,
    }
  }, [date])
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>) {
  const current = (await db.settings.get('user')) ?? DEFAULT_SETTINGS
  await db.settings.put({ ...current, ...patch })
}

export async function updateTargets(patch: Partial<Settings['targets']>) {
  const current = (await db.settings.get('user')) ?? DEFAULT_SETTINGS
  await db.settings.put({ ...current, targets: { ...current.targets, ...patch } })
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** True when there is personal data and no export in the last 7 days (CLAUDE.md §0.4). */
export function useBackupDue(): boolean {
  return (
    useLiveQuery(async () => {
      const settings = await db.settings.get('user')
      if (settings?.lastExportAt && Date.now() - settings.lastExportAt < WEEK_MS) return false
      const counts = await Promise.all([db.dailyStatus.count(), db.journal.count(), db.books.count(), db.readingSessions.count()])
      return counts.some((n) => n > 0)
    }) ?? false
  )
}
