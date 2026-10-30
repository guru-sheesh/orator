import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ExternalLink, Plus, Trash2 } from 'lucide-react'
import type { Talk } from '../../data/db'
import { addTalk, deleteTalk, useTalks } from '../../data/feedback'
import { TECHNIQUE_TAGS, type TechniqueTag } from '../../lib/analysisTypes'
import { buttonClass, Card, cx, iconButtonClass, Label } from '../../components/ui'

const inputClass = 'h-12 w-full rounded-sm border border-border-strong bg-raised px-3.5 placeholder:text-subtle aria-invalid:border-danger'
const tagLabel = (t: string) => t.replace(/-/g, ' ')

/** The "Watch this" list: built-in talks (link-checked) plus the user's own (CLAUDE.md §0.8a). */
export default function TalksScreen() {
  const talks = useTalks()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/speak" aria-label="Back to Speak" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-headline font-semibold">Talks to watch</h1>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} aria-label="Add a talk" className={iconButtonClass}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </header>
      <p className="text-sm text-muted">Feedback recommends one of these when its techniques match what you’re working on. Only talks in this list are ever recommended.</p>

      {adding && <AddTalk onDone={() => setAdding(false)} />}

      {talks && talks.mine.length > 0 && (
        <section className="flex flex-col gap-2">
          <Label>Added by you</Label>
          {talks.mine.map((t) => (
            <TalkRow key={t.id} talk={t} onDelete={() => void deleteTalk(t.id)} />
          ))}
        </section>
      )}
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
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{talk.title}</span>
          <ExternalLink size={14} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />
        </span>
        <span className="block text-caption text-subtle">{talk.speaker}</span>
        <span className="mt-1 block text-sm text-muted">{talk.notice}</span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {talk.tags.map((g) => (
            <span key={g} className="rounded-[6px] bg-raised px-1.5 py-0.5 text-xs text-muted">
              {tagLabel(g)}
            </span>
          ))}
        </span>
      </a>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Remove ${talk.title}`} className={iconButtonClass}>
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
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
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    let valid = false
    try {
      valid = ['http:', 'https:'].includes(new URL(url).protocol)
    } catch {
      valid = false
    }
    if (!title.trim()) return setError('Enter the talk’s title.')
    if (!valid) return setError('Enter the full link, starting with https://')
    if (!tags.length) return setError('Choose at least one technique it shows well.')
    await addTalk({ title: title.trim(), speaker: speaker.trim(), url: url.trim(), notice: notice.trim(), tags })
    onDone()
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Label>Add a talk</Label>
        <Field id="talk-title" label="Title" value={title} onChange={setTitle} />
        <Field id="talk-speaker" label="Speaker" value={speaker} onChange={setSpeaker} />
        <Field id="talk-url" label="Link" value={url} onChange={setUrl} type="url" placeholder="https://…" />
        <Field id="talk-notice" label="What to notice (optional)" value={notice} onChange={setNotice} placeholder="e.g. how she pauses before each key point…" />
        <fieldset className="flex flex-col gap-2">
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
                  className={cx('min-h-9 rounded-pill border px-3 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-muted hover:text-text')}
                >
                  {tagLabel(t)}
                </button>
              )
            })}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={cx(buttonClass.primary, 'flex-1')}>
            Add talk
          </button>
          <button type="button" onClick={onDone} className={buttonClass.secondary}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

function Field({ id, label, value, onChange, type = 'text', placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      <input id={id} name={id} type={type} autoComplete="off" spellCheck={type === 'url' ? false : undefined} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    </div>
  )
}
