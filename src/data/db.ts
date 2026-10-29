import Dexie, { type EntityTable } from 'dexie'

/** Local calendar date, `YYYY-MM-DD`. All daily records key on this. */
export type DateKey = string

export interface Settings {
  id: 'user'
  name: string
  targets: { articulationMinutes: number; readingPages: number; journalEntries: number }
  keepRecordings: boolean
  /** Epoch ms of the last JSON export; drives the weekly backup reminder. */
  lastExportAt?: number
}

export interface DailyStatus {
  date: DateKey
  articulationMinutes: number
  articulationCompleted: boolean
}

export interface JournalEntry {
  date: DateKey
  mode: 'prompted' | 'free'
  prompted: Record<string, string>
  freeWrite: string
  completed: boolean
  updatedAt: number
}

export interface Book {
  id?: number
  title: string
  author: string
  totalPages?: number
  currentPage: number
  coverDataUrl?: string
  startedOn: DateKey
  completedOn?: DateKey
  /** Date of the latest logged session; picks the current book when several are in progress. */
  lastReadOn?: DateKey
}

export interface ReadingSession {
  id?: number
  bookId: number
  date: DateKey
  startPage: number
  endPage: number
  pagesRead: number
  note?: string
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'user',
  name: '',
  targets: { articulationMinutes: 30, readingPages: 10, journalEntries: 1 },
  keepRecordings: false,
}

// Speech exercise, attempt, analysis and source tables arrive with the
// articulation phases; Dexie upgrades the schema with a new version().
export const db = new Dexie('orator') as Dexie & {
  settings: EntityTable<Settings, 'id'>
  dailyStatus: EntityTable<DailyStatus, 'date'>
  journal: EntityTable<JournalEntry, 'date'>
  books: EntityTable<Book, 'id'>
  readingSessions: EntityTable<ReadingSession, 'id'>
}

db.version(1).stores({
  settings: 'id',
  dailyStatus: 'date',
  journal: 'date, updatedAt',
  books: '++id, completedOn',
  readingSessions: '++id, date, bookId',
})
