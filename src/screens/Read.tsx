import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Check, Library, Plus, Trash2 } from 'lucide-react'
import type { Book, ReadingSession } from '../data/db'
import { useDailySummary } from '../data/daily'
import { usePeriodProgress } from '../data/progress'
import { deleteSession, logSession, setBookCompleted, useBooks, useSessionsOn, validateLog } from '../data/reading'
import { BookCover } from '../components/BookCover'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { buttonClass, Card, cx, iconButtonClass, Label, PageHeader, ProgressBar } from '../components/ui'
import { addDays, endOfMonth, startOfMonth, startOfWeek, toDateKey } from '../lib/date'

const inputClass = 'h-12 w-full rounded-sm border border-border-strong bg-raised px-3.5 placeholder:text-subtle'

export default function Read() {
  const today = toDateKey()
  const books = useBooks()
  const summary = useDailySummary(today)
  const sessions = useSessionsOn(today)
  const now = new Date()
  const week = usePeriodProgress(startOfWeek(now), addDays(startOfWeek(now), 6))
  const month = usePeriodProgress(startOfMonth(now), endOfMonth(now))
  const [selectedId, setSelectedId] = useState<number>()
  const [finishedBook, setFinishedBook] = useState<Book | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReadingSession | null>(null)
  // Lives here, not in LogForm: the form remounts after each save to reset its fields.
  const [savedMessage, setSavedMessage] = useState('')

  if (!books || !summary) return null
  const { reading: inProgress, finished, current } = books
  const logBook = inProgress.find((b) => b.id === selectedId) ?? current
  const bookTitle = (id: number) => [...inProgress, ...finished].find((b) => b.id === id)?.title ?? 'Deleted book'
  const { pages, target, done } = summary.reading

  return (
    <>
      <PageHeader
        title="Read"
        actions={
          <>
            <Link to="/read/books" aria-label="All books" className={iconButtonClass}>
              <Library size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <Link to="/read/books/new" aria-label="Add book" className={iconButtonClass}>
              <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </>
        }
      />

      {current ? (
        <Link to={`/read/books/${current.id}`} className="block rounded-lg hover:ring-1 hover:ring-border-strong">
          <Card>
            <Label>Current book</Label>
            <div className="flex items-start gap-4">
              <BookCover book={current} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-lg leading-snug font-semibold break-words">{current.title}</p>
                {current.author && <p className="text-[15px] text-muted">{current.author}</p>}
                <p className="text-caption text-subtle tabular-nums">
                  {current.totalPages
                    ? `Page ${current.currentPage} of ${current.totalPages} · ${Math.round((current.currentPage / current.totalPages) * 100)}%`
                    : `Page ${current.currentPage}`}
                </p>
              </div>
            </div>
            {current.totalPages ? <ProgressBar value={current.currentPage} max={current.totalPages} label="Book progress" /> : null}
          </Card>
        </Link>
      ) : (
        <Card>
          <Label>Current book</Label>
          <p className="text-title font-semibold">Add the book you’re reading</p>
          <p className="text-muted">Then log the pages you read each day. The target is {target} pages.</p>
          <Link to="/read/books/new" className={buttonClass.primary}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
            Add book
          </Link>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <Label>Today</Label>
          {done && (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-success-soft px-2.5 py-1 text-caption font-medium text-success">
              <Check size={14} strokeWidth={2} aria-hidden="true" />
              Complete
            </span>
          )}
        </div>
        <p className="text-display font-semibold tabular-nums">
          {pages} <span className="text-title font-medium text-muted">/ {target} pages</span>
        </p>
        <ProgressBar value={pages} max={target} label="Pages read today" done={done} />
      </Card>

      {logBook && (
        <LogForm
          key={`${logBook.id}-${logBook.currentPage}`}
          book={logBook}
          books={inProgress}
          onSelectBook={setSelectedId}
          onSaved={(pages, finished) => {
            setSavedMessage(`Saved ${pages} ${pages === 1 ? 'page' : 'pages'}.`)
            if (finished) setFinishedBook(logBook)
          }}
        />
      )}
      <p aria-live="polite" className="-mt-1 px-1 text-sm text-muted empty:hidden">
        {savedMessage}
      </p>

      {finishedBook && (
        <Card className="bg-primary-soft">
          <p className="font-semibold">You reached the last page of {finishedBook.title}.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              onClick={async () => {
                await setBookCompleted(finishedBook.id!, true)
                setFinishedBook(null)
              }}
            >
              Mark book completed
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setFinishedBook(null)}>
              Not yet
            </button>
          </div>
        </Card>
      )}

      {sessions && sessions.length > 0 && (
        <Card className="gap-0">
          <Label className="pb-1">Logged today</Label>
          {sessions.map((s) => (
            <div key={s.id} className="flex items-start gap-3 border-t border-border py-3 first-of-type:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium tabular-nums">
                  {s.pagesRead} pages <span className="font-normal text-muted">· p. {s.startPage}–{s.endPage}</span>
                </p>
                <p className="truncate text-caption text-subtle">{bookTitle(s.bookId)}</p>
                {s.note && <p className="mt-1 text-sm break-words text-muted">“{s.note}”</p>}
              </div>
              <button type="button" onClick={() => setPendingDelete(s)} aria-label={`Delete ${s.pagesRead}-page session`} className={iconButtonClass}>
                <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
        </Card>
      )}

      {week && month && (
        <Card className="flex-row justify-between text-center">
          <Stat value={week.readingPages} label="This week" />
          <Stat value={month.readingPages} label="This month" />
          <Stat value={finished.length} label="Books done" />
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this session?"
        confirmLabel="Delete session"
        destructive
        onConfirm={async () => {
          if (pendingDelete) await deleteSession(pendingDelete)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          {pendingDelete?.pagesRead} pages (p. {pendingDelete?.startPage}–{pendingDelete?.endPage}) will be removed from today’s total.
        </p>
      </ConfirmDialog>
    </>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-title font-semibold tabular-nums">{value}</p>
      <p className="text-caption text-subtle">{label}</p>
    </div>
  )
}

function LogForm({
  book,
  books,
  onSelectBook,
  onSaved,
}: {
  book: Book
  books: Book[]
  onSelectBook: (id: number) => void
  onSaved: (pages: number, finished: boolean) => void
}) {
  const today = toDateKey()
  const [start, setStart] = useState(String(book.currentPage))
  const [end, setEnd] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const startN = Number(start)
  const endN = Number(end)
  const preview = end !== '' && endN > startN ? endN - startN : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = validateLog(book, startN, end === '' ? NaN : endN)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    const result = await logSession(book, date, startN, endN, note)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onSaved(result.pages, result.finished)
  }

  return (
    <Card>
      <Label>Log pages</Label>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        {books.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="log-book" className="text-sm font-medium text-muted">
              Book
            </label>
            <select
              id="log-book"
              name="book"
              value={book.id}
              onChange={(e) => onSelectBook(Number(e.target.value))}
              className={cx(inputClass, 'bg-raised text-text')}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-3">
          <NumberField id="log-start" label="Start page" value={start} onChange={setStart} />
          <NumberField id="log-end" label="End page" value={end} onChange={setEnd} invalid={!!error} describedBy={error ? 'log-error' : undefined} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="log-date" className="text-sm font-medium text-muted">
            Date
          </label>
          <input id="log-date" name="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value || today)} className={cx(inputClass, 'tabular-nums')} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="log-note" className="text-sm font-medium text-muted">
            One thing I learned <span className="font-normal text-subtle">(optional)</span>
          </label>
          <input id="log-note" name="note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A sentence is enough…" className={inputClass} />
        </div>
        {error && (
          <p id="log-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? 'Saving…' : preview ? `Save session · ${preview} ${preview === 1 ? 'page' : 'pages'}` : 'Save session'}
        </button>
      </form>
    </Card>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  invalid?: boolean
  describedBy?: string
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cx(inputClass, 'tabular-nums aria-invalid:border-danger')}
      />
    </div>
  )
}
