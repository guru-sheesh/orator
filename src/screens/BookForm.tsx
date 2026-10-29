import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChevronLeft, ImagePlus, X } from 'lucide-react'
import type { Book } from '../data/db'
import { addBook, deleteBook, resizeCover, setBookCompleted, updateBook, useBook } from '../data/reading'
import { BookCover } from '../components/BookCover'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { buttonClass, Card, cx, iconButtonClass } from '../components/ui'
import { toDateKey } from '../lib/date'
import { NotFound } from './Placeholder'

const inputClass = 'h-12 w-full rounded-sm border border-border-strong bg-raised px-3.5 placeholder:text-subtle aria-invalid:border-danger'

export default function BookForm() {
  const { id } = useParams()
  const isNew = id === undefined
  const bookId = isNew ? undefined : Number(id)
  const book = useBook(bookId)

  if (isNew) return <BookEditor key="new" book={null} />
  if (book === undefined) return null // loading
  if (book === null) return <NotFound />
  return <BookEditor key={id} book={book} />
}

function BookEditor({ book }: { book: Book | null }) {
  const navigate = useNavigate()
  const today = toDateKey()
  const [title, setTitle] = useState(book?.title ?? '')
  const [author, setAuthor] = useState(book?.author ?? '')
  const [totalPages, setTotalPages] = useState(book?.totalPages ? String(book.totalPages) : '')
  const [currentPage, setCurrentPage] = useState(String(book?.currentPage ?? 0))
  const [startedOn, setStartedOn] = useState(book?.startedOn ?? today)
  const [cover, setCover] = useState(book?.coverDataUrl)
  const [errors, setErrors] = useState<{ title?: string; pages?: string; cover?: string }>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const coverInput = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const total = totalPages ? Number(totalPages) : undefined
    const current = Number(currentPage || 0)
    const next: typeof errors = {}
    if (!title.trim()) next.title = 'Enter the book’s title.'
    if (total !== undefined && current > total) next.pages = `The current page can’t be past the last page (${total}).`
    setErrors(next)
    if (next.title || next.pages) {
      document.getElementById(next.title ? 'book-title' : 'book-current')?.focus()
      return
    }

    const fields = { title: title.trim(), author: author.trim(), totalPages: total, currentPage: current, coverDataUrl: cover, startedOn }
    if (book) {
      await updateBook(book.id!, fields)
      navigate(-1)
    } else {
      await addBook(fields)
      navigate('/read', { replace: true })
    }
  }

  async function pickCover(file: File | undefined) {
    if (!file) return
    try {
      setCover(await resizeCover(file))
      setErrors((e) => ({ ...e, cover: undefined }))
    } catch {
      setErrors((e) => ({ ...e, cover: 'That image couldn’t be read. Try a JPEG or PNG photo.' }))
    }
  }

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to={book ? '/read/books' : '/read'} aria-label="Back" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="text-headline font-semibold">{book ? 'Edit book' : 'Add book'}</h1>
      </header>

      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Card>
          <Field id="book-title" label="Title" error={errors.title}>
            <input
              id="book-title"
              name="title"
              autoComplete="off"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!errors.title || undefined}
              aria-describedby={errors.title ? 'book-title-error' : undefined}
              className={inputClass}
            />
          </Field>
          <Field id="book-author" label="Author" optional>
            <input id="book-author" name="author" autoComplete="off" value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} />
          </Field>
          <div className="flex gap-3">
            <Field id="book-total" label="Total pages">
              <input
                id="book-total"
                name="totalPages"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={totalPages}
                onChange={(e) => setTotalPages(e.target.value.replace(/\D/g, ''))}
                aria-describedby="book-pages-hint"
                className={cx(inputClass, 'tabular-nums')}
              />
            </Field>
            <Field id="book-current" label="Current page" error={errors.pages}>
              <input
                id="book-current"
                name="currentPage"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={currentPage}
                onChange={(e) => setCurrentPage(e.target.value.replace(/\D/g, ''))}
                aria-invalid={!!errors.pages || undefined}
                aria-describedby={errors.pages ? 'book-current-error book-pages-hint' : 'book-pages-hint'}
                className={cx(inputClass, 'tabular-nums')}
              />
            </Field>
          </div>
          <p id="book-pages-hint" className="-mt-1 text-caption text-subtle">
            Leave total pages blank if you don’t know it. Current page is your bookmark (0 if you haven’t started); pages read are counted from it.
          </p>
          <Field id="book-started" label="Date started">
            <input id="book-started" name="startedOn" type="date" max={today} value={startedOn} onChange={(e) => setStartedOn(e.target.value || today)} className={cx(inputClass, 'tabular-nums')} />
          </Field>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-muted">
              Cover <span className="font-normal text-subtle">(optional)</span>
            </p>
            <div className="flex items-center gap-3">
              <BookCover book={{ coverDataUrl: cover }} />
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => coverInput.current?.click()} className={cx(buttonClass.secondary, 'min-h-11 px-4 text-sm')}>
                  <ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />
                  {cover ? 'Change photo' : 'Add photo'}
                </button>
                {cover && (
                  <button type="button" onClick={() => setCover(undefined)} className={cx(buttonClass.ghost, 'text-sm')}>
                    <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    Remove
                  </button>
                )}
              </div>
            </div>
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void pickCover(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {errors.cover && (
              <p role="alert" className="text-sm text-danger">
                {errors.cover}
              </p>
            )}
          </div>
        </Card>

        <button type="submit" className={buttonClass.primary}>
          {book ? 'Save changes' : 'Add book'}
        </button>
      </form>

      {book && (
        <Card className="gap-1">
          <button
            type="button"
            onClick={async () => {
              await setBookCompleted(book.id!, !book.completedOn)
              navigate('/read/books')
            }}
            className="-mx-2 flex min-h-12 items-center rounded-md px-2 text-left hover:bg-raised"
          >
            {book.completedOn ? 'Move back to Reading' : 'Mark as finished'}
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="-mx-2 flex min-h-12 items-center rounded-md px-2 text-left text-danger hover:bg-raised">
            Delete book
          </button>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this book?"
        confirmLabel="Delete book"
        destructive
        onConfirm={async () => {
          await deleteBook(book!.id!)
          navigate('/read/books', { replace: true })
        }}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>{book?.title} and all of its reading sessions will be removed. Pages logged for it will no longer count toward past days.</p>
      </ConfirmDialog>
    </>
  )
}

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label} {optional && <span className="font-normal text-subtle">(optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
