import { useLiveQuery } from 'dexie-react-hooks'
import { db, type DateKey, type JournalEntry } from './db'

/** Default daily prompts (CLAUDE.md §14). Keys are stored, so never rename them. */
export const PROMPTS = [
  { key: 'happened', text: 'What happened today?' },
  { key: 'wentWell', text: 'What went well?' },
  { key: 'better', text: 'What could I have handled better?' },
  { key: 'learned', text: 'What did I learn today?' },
  { key: 'tomorrow', text: 'What is important tomorrow?' },
] as const

export type PromptKey = (typeof PROMPTS)[number]['key']

export function emptyEntry(date: DateKey): JournalEntry {
  return { date, mode: 'prompted', prompted: {}, freeWrite: '', completed: false, updatedAt: 0 }
}

export function entryText(e: Pick<JournalEntry, 'prompted' | 'freeWrite'>): string {
  return [...PROMPTS.map((p) => e.prompted[p.key] ?? ''), e.freeWrite].join('\n').trim()
}

export function hasContent(e: Pick<JournalEntry, 'prompted' | 'freeWrite'>): boolean {
  return entryText(e).length > 0
}

/**
 * Saves the draft. An entry with no text is removed rather than stored, so
 * opening the journal and leaving doesn't count as "started".
 */
export async function saveEntry(entry: JournalEntry): Promise<void> {
  if (!hasContent(entry)) {
    await db.journal.delete(entry.date)
    return
  }
  await db.journal.put({ ...entry, updatedAt: Date.now() })
}

export function useAllEntries(): JournalEntry[] | undefined {
  return useLiveQuery(() => db.journal.orderBy('date').reverse().toArray())
}

export interface SearchHit {
  entry: JournalEntry
  /** Where the match sits, for highlighting: text before, match, text after. */
  snippet: [string, string, string]
}

/** Case-insensitive substring search across every prompt answer and free write. */
export function searchEntries(entries: JournalEntry[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const entry of entries) {
    const text = entryText(entry).replace(/\s+/g, ' ')
    const i = text.toLowerCase().indexOf(q)
    if (i === -1) continue
    const start = Math.max(0, i - 40)
    const end = Math.min(text.length, i + q.length + 60)
    hits.push({
      entry,
      snippet: [(start > 0 ? '…' : '') + text.slice(start, i), text.slice(i, i + q.length), text.slice(i + q.length, end) + (end < text.length ? '…' : '')],
    })
  }
  return hits
}
