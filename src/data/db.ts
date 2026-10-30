import Dexie, { type EntityTable } from 'dexie'
import type { Transcription, TranscriptWord } from '../lib/transcribe'

/** Local calendar date, `YYYY-MM-DD`. All daily records key on this. */
export type DateKey = string

export interface Settings {
  id: 'user'
  name: string
  targets: { articulationMinutes: number; readingPages: number; journalEntries: number }
  keepRecordings: boolean
  /** Epoch ms of the last JSON export; drives the weekly backup reminder. */
  lastExportAt?: number
  /** Azure audio seconds used, per calendar month (`YYYY-MM`), for the free-tier meter (§0.6). */
  azureUsage?: { month: string; seconds: number }
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

export type TaskId = 'words' | 'questions' | 'shadowing' | 'paraphrase' | 'explain' | 'impromptu'
export type TaskStatus = 'pending' | 'done' | 'skipped'

/** One day's articulation session; the plan is fixed at creation so a reload resumes the same prompts. */
export interface SpeechSession {
  id?: number
  date: DateKey
  createdAt: number
  /** Time spent on task screens while visible. Drives the articulation minutes. */
  activeMs: number
  completedAt?: number
  plan: {
    words: string[]
    questions: string[]
    impromptu: string
    passage?: string
    shadow?: { sourceId: number; segment: number }
  }
  tasks: Record<TaskId, TaskStatus>
}

export type ShadowStage = 'repeat' | 'shadow' | 'deliver'

export interface SpeechAttempt {
  id?: number
  sessionId: number
  date: DateKey
  task: TaskId
  promptId: string
  prompt: string
  stage?: ShadowStage
  attemptNumber: number
  durationMs: number
  mimeType: string
  transcription?: 'pending' | 'done' | 'failed' | 'skipped'
  transcriptionError?: string
  transcript?: string
  words?: TranscriptWord[]
  /** Azure utterance scores, for analysis only; never shown as a headline score (§0.5). */
  pronunciation?: Transcription['scores']
  createdAt: number
}

/** Audio blobs live apart from their metadata so lists never load audio. Only kept when the user opts in. */
export interface Recording {
  attemptId: number
  blob: Blob
}

export interface ShadowSegment {
  start: number
  end: number
}

/** A user-imported speech for shadowing (CLAUDE.md §0.7). Audio stays on this device. */
export interface ShadowSource {
  id?: number
  title: string
  speaker: string
  date?: string
  source?: string
  rights: string
  fileName: string
  mimeType: string
  sizeBytes: number
  durationSec: number
  segments: ShadowSegment[]
  /** Loudness envelope, 20 values per second (0-255), for the waveform and phrase splitting. */
  envelope: Uint8Array
  /** Clip transcripts by segment index, transcribed on first use and cached. Times are relative to the clip. */
  clipTranscripts?: Record<number, { text: string; words: TranscriptWord[] }>
  createdAt: number
}

export interface ShadowAudio {
  sourceId: number
  blob: Blob
}

/** Rotation bookkeeping so practice prompts don't repeat until a bank is exhausted. */
export interface ContentUsage {
  key: string
  kind: string
  count: number
  usedAt: number
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'user',
  name: '',
  targets: { articulationMinutes: 30, readingPages: 10, journalEntries: 1 },
  keepRecordings: false,
}

export const db = new Dexie('orator') as Dexie & {
  settings: EntityTable<Settings, 'id'>
  dailyStatus: EntityTable<DailyStatus, 'date'>
  journal: EntityTable<JournalEntry, 'date'>
  books: EntityTable<Book, 'id'>
  readingSessions: EntityTable<ReadingSession, 'id'>
  speechSessions: EntityTable<SpeechSession, 'id'>
  speechAttempts: EntityTable<SpeechAttempt, 'id'>
  recordings: EntityTable<Recording, 'attemptId'>
  shadowSources: EntityTable<ShadowSource, 'id'>
  shadowAudio: EntityTable<ShadowAudio, 'sourceId'>
  contentUsage: EntityTable<ContentUsage, 'key'>
}

db.version(1).stores({
  settings: 'id',
  dailyStatus: 'date',
  journal: 'date, updatedAt',
  books: '++id, completedOn',
  readingSessions: '++id, date, bookId',
})

db.version(2).stores({
  speechSessions: '++id, date',
  speechAttempts: '++id, sessionId, date, task',
  recordings: 'attemptId',
  shadowSources: '++id',
  shadowAudio: 'sourceId',
  contentUsage: 'key, kind',
})

/** Tables holding audio blobs: excluded from JSON backups (too large, and not JSON). */
export const AUDIO_TABLES = ['recordings', 'shadowAudio'] as const
