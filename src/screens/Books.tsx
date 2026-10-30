import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { Book } from '../data/db'
import { useBooks } from '../data/reading'
import { BookCover } from '../components/BookCover'
import { buttonClass, iconButtonClass, Label } from '../components/ui'
import { formatShortDate, fromDateKey } from '../lib/date'

export default function Books() {
  const books = useBooks()

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/read" aria-label="Back to Read" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-headline font-semibold">Books</h1>
        <Link to="/read/books/new" aria-label="Add book" className={iconButtonClass}>
          <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>

      {books && (
        <>
          <BookSection title="Reading" books={books.reading} empty="No books in progress." />
          <BookSection title={`Finished · ${books.finished.length}`} books={books.finished} empty="Books you finish appear here." />
          {books.reading.length === 0 && books.finished.length === 0 && (
            <Link to="/read/books/new" className={buttonClass.primary}>
              <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
              Add your first book
            </Link>
          )}
        </>
      )}
    </>
  )
}

function BookSection({ title, books, empty }: { title: string; books: Book[]; empty: string }) {
  return (
    <section className="flex flex-col gap-2">
      <Label>{title}</Label>
      {books.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        books.map((b) => (
          <Link
            key={b.id}
            to={`/read/books/${b.id}`}
            className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-raised active:bg-raised light:border light:border-border"
          >
            <BookCover book={b} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{b.title}</p>
              <p className="truncate text-caption text-subtle">
                {[
                  b.author,
                  b.completedOn
                    ? `Finished ${formatShortDate(fromDateKey(b.completedOn))}`
                    : b.totalPages
                      ? `p. ${b.currentPage} of ${b.totalPages}`
                      : `p. ${b.currentPage}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" className="flex-none text-subtle" />
          </Link>
        ))
      )}
    </section>
  )
}
