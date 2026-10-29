import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Book, type DateKey, type ReadingSession } from './db'
import { toDateKey } from '../lib/date'

const recency = (b: Book) => b.lastReadOn ?? b.startedOn

export function useBooks() {
  return useLiveQuery(async () => {
    const books = await db.books.toArray()
    const reading = books.filter((b) => !b.completedOn).sort((a, b) => recency(b).localeCompare(recency(a)) || (b.id ?? 0) - (a.id ?? 0))
    const finished = books.filter((b) => b.completedOn).sort((a, b) => b.completedOn!.localeCompare(a.completedOn!))
    return { reading, finished, current: reading[0] as Book | undefined }
  })
}

/** `undefined` while loading, `null` when no book has this id. */
export function useBook(id: number | undefined): Book | null | undefined {
  return useLiveQuery(async () => (id === undefined || Number.isNaN(id) ? null : ((await db.books.get(id)) ?? null)), [id])
}

export function useSessionsOn(date: DateKey) {
  return useLiveQuery(() => db.readingSessions.where('date').equals(date).reverse().sortBy('id'), [date])
}

export type BookInput = Pick<Book, 'title' | 'author' | 'totalPages' | 'currentPage' | 'coverDataUrl' | 'startedOn'>

export async function addBook(input: BookInput) {
  await db.books.add({ ...input })
}

export async function updateBook(id: number, patch: Partial<Book>) {
  await db.books.update(id, patch)
}

export async function setBookCompleted(id: number, completed: boolean) {
  await db.books.update(id, { completedOn: completed ? toDateKey() : undefined })
}

/** Removes the book and its reading sessions. */
export async function deleteBook(id: number) {
  await db.transaction('rw', db.books, db.readingSessions, async () => {
    await db.readingSessions.where('bookId').equals(id).delete()
    await db.books.delete(id)
  })
}

export type LogResult = { ok: true; pages: number; finished: boolean } | { ok: false; error: string }

export function validateLog(book: Book, startPage: number, endPage: number): string | null {
  if (!Number.isInteger(startPage) || startPage < 0) return 'Enter the page you started on.'
  if (!Number.isInteger(endPage)) return 'Enter the page you stopped on.'
  if (endPage <= startPage) return 'The end page must be after the start page.'
  if (book.totalPages && endPage > book.totalPages) return `This book has ${book.totalPages} pages. Check the end page, or edit the book’s page count.`
  return null
}

/** Records a session and moves the book's bookmark forward. */
export async function logSession(book: Book, date: DateKey, startPage: number, endPage: number, note?: string): Promise<LogResult> {
  const error = validateLog(book, startPage, endPage)
  if (error) return { ok: false, error }
  const pages = endPage - startPage

  await db.transaction('rw', db.books, db.readingSessions, async () => {
    const session: ReadingSession = { bookId: book.id!, date, startPage, endPage, pagesRead: pages }
    if (note?.trim()) session.note = note.trim()
    await db.readingSessions.add(session)
    const latest = book.lastReadOn && book.lastReadOn > date ? book.lastReadOn : date
    await db.books.update(book.id!, { currentPage: Math.max(book.currentPage, endPage), lastReadOn: latest })
  })
  return { ok: true, pages, finished: !!book.totalPages && endPage >= book.totalPages }
}

/** Deletes a mistaken session; steps the bookmark back if this session set it. */
export async function deleteSession(session: ReadingSession) {
  await db.transaction('rw', db.books, db.readingSessions, async () => {
    await db.readingSessions.delete(session.id!)
    const book = await db.books.get(session.bookId)
    if (book && book.currentPage === session.endPage) await db.books.update(book.id!, { currentPage: session.startPage })
  })
}

/** Shrinks a chosen photo to a small JPEG data URL so covers stay light in IndexedDB and backups. */
export async function resizeCover(file: File, width = 240): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, width / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.8)
}
