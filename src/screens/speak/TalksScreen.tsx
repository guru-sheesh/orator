import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { Talk } from '../../data/db'
import { addTalk, deleteTalk, useTalks } from '../../data/feedback'
import { TECHNIQUE_TAGS, type TechniqueTag } from '../../lib/analysisTypes'
import { buttonClass, Card, cx, iconButtonClass, Label } from '../../components/ui'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const inputClass = 'h-12 w-full rounded-sm border border-border-strong bg-raised px-3.5 placeholder:text-subtle aria-invalid:border-danger'
const tagLabel = (t: string) => t.replace(/-/g, ' ')

/** The "Watch this" list: built-in talks (link-checked) plus the user's own (CLAUDE.md §0.8a). */
export default function TalksScreen() {
  const talks = useTalks()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Talk | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/speak" aria-label="Back to Speak" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-headline font-semibold">Talks to watch</h1>
        {!adding && (
          <button ref={addButtonRef} type="button" onClick={() => setAdding(true)} aria-label="Add a talk" className={iconButtonClass}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </header>
      <p className="text-sm text-muted">Feedback recommends one of these when its techniques match what you’re working on. Only talks in this list are ever recommended.</p>

      {adding && (
        <AddTalk
          onDone={() => {
            setAdding(false)
            requestAnimationFrame(() => addButtonRef.current?.focus())
          }}
        />
      )}

      {talks && talks.mine.length > 0 && (
        <section className="flex flex-col gap-2">
          <Label>Added by you</Label>
          {talks.mine.map((t) => (
            <TalkRow key={t.id} talk={t} onDelete={() => setRemoving(t)} />
          ))}
        </section>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this talk?"
        confirmLabel="Remove talk"
        destructive
        onConfirm={async () => {
          if (removing) await deleteTalk(removing.id)
          setRemoving(null)
        }}
        onCancel={() => setRemoving(null)}
      >
        <p>{removing?.title} will no longer be recommended. You can add it again later.</p>
      </ConfirmDialog>

      {talks && (
        <section className="flex flex-col gap-2">
          <Label>Starter list · {talks.builtIn.length} talks</Label>
          {talks.builtIn.map((t) => (
            <TalkRow key={t.id} talk={t} />
          ))}
        </section>
      )}
    </>
  )
}

function TalkRow({ talk, onDelete }: { talk: Talk; onDelete?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-surface px-4 py-3 light:border light:border-border">
      <a href={talk.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
        <span className="sr-only">(opens in a new tab) </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{talk.title}</span>
          <ExternalLink size={14} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />
        </span>
        <span className="block text-caption text-subtle">{talk.speaker}</span>
        <span className="mt-1 block text-sm text-muted">{talk.notice}</span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {talk.tags.map((g) => (
            <span key={g} className="rounded-sm bg-raised px-1.5 py-0.5 text-caption text-muted">
              {tagLabel(g)}
            </span>
          ))}
        </span>
      </a>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Remove ${talk.title}`} className={iconButtonClass}>
          <Trash2 size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

function AddTalk({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [speaker, setSpeaker] = useState('')
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState('')
  const [tags, setTags] = useState<TechniqueTag[]>([])
  const [error, setError] = useState<FormError>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    let valid = false
    try {
      valid = ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
      valid = false
    }
    const problem: FormError = !title.trim()
      ? { field: 'talk-title', text: 'Enter the talk’s title.' }
      : !valid
        ? { field: 'talk-url', text: 'Enter the full link, starting with https://' }
        : !tags.length
          ? { field: 'talk-tags', text: 'Choose at least one technique it shows well.' }
          : null
    setError(problem)
    if (problem) {
      document.getElementById(problem.field)?.focus()
      return
    }
    setSaving(true)
    try {
      await addTalk({ title: title.trim(), speaker: speaker.trim(), url: url.trim(), notice: notice.trim(), tags })
      onDone()
    } catch {
      setError({ field: 'talk-title', text: 'The talk couldn’t be saved. Try again.' })
      setSaving(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Label>Add a talk</Label>
        <Field id="talk-title" label="Title" value={title} onChange={setTitle} error={error?.field === 'talk-title' ? error.text : undefined} autoFocusOnMount />
        <Field id="talk-speaker" label="Speaker" value={speaker} onChange={setSpeaker} />
        <Field id="talk-url" label="Link" value={url} onChange={setUrl} type="url" placeholder="https://…" error={error?.field === 'talk-url' ? error.text : undefined} />
        <Field id="talk-notice" label="What to notice (optional)" value={notice} onChange={setNotice} placeholder="e.g. how she pauses before each key point…" />
        <fieldset id="talk-tags" tabIndex={-1} aria-describedby={error?.field === 'talk-tags' ? 'talk-tags-error' : undefined} className="flex flex-col gap-2 outline-none">
          <legend className="pb-1.5 text-sm font-medium text-muted">Techniques it shows well</legend>
          <div className="flex flex-wrap gap-2">
            {TECHNIQUE_TAGS.map((t) => {
              const on = tags.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                  className={cx('min-h-11 rounded-pill border px-3.5 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-muted hover:text-text')}
                >
                  {tagLabel(t)}
                </button>
              )
            })}
          </div>
        </fieldset>
        {error?.field === 'talk-tags' && (
          <p id="talk-tags-error" className="text-sm text-danger">
            {error.text}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className={cx(buttonClass.primary, 'flex-1')}>
            {saving ? 'Saving…' : 'Add talk'}
          </button>
          <button type="button" onClick={onDone} className={buttonClass.secondary}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

type FormError = { field: string; text: string } | null

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  autoFocusOnMount,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  error?: string
  autoFocusOnMount?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocusOnMount) ref.current?.focus()
  }, [autoFocusOnMount])
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        name={id}
        type={type}
        autoComplete="off"
        spellCheck={type === 'url' ? false : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={inputClass}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
