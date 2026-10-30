import { useRef, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, FileAudio, Plus } from 'lucide-react'
import { db, type ShadowSource } from '../../data/db'
import { MAX_IMPORT_SECONDS, profileAudio, splitSegments } from '../../lib/audioAnalysis'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { formatClock } from '../../components/recording'
import { buttonClass, Card, iconButtonClass, Label } from '../../components/ui'
import { NotFound } from '../Placeholder'

const RIGHTS = 'personal use, user-provided'
const MAX_BYTES = 80 * 1024 * 1024
const inputClass = 'h-12 w-full rounded-sm border border-border-strong bg-raised px-3.5 placeholder:text-subtle'

function BackHeader({ to, title, action }: { to: string; title: string; action?: ReactNode }) {
  return (
    <header className="flex min-h-12 items-center gap-2">
      <Link to={to} aria-label="Back" className={iconButtonClass}>
        <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <h1 className="flex-1 text-headline font-semibold">{title}</h1>
      {action}
    </header>
  )
}

export function LibraryList() {
  const sources = useLiveQuery(() => db.shadowSources.toArray())
  return (
    <>
      <BackHeader
        to="/speak"
        title="Shadowing audio"
        action={
          <Link to="/speak/library/new" aria-label="Import audio" className={iconButtonClass}>
            <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        }
      />
      <p className="text-sm text-muted">
        Recordings you import stay on this phone. Each one is split into one-minute clips at natural pauses, and the session gives you a new clip each day.
      </p>
      {sources?.length === 0 && (
        <Link to="/speak/library/new" className={buttonClass.primary}>
          <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
          Import your first recording
        </Link>
      )}
      {sources?.map((s) => (
        <Link key={s.id} to={`/speak/library/${s.id}`} className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3 hover:bg-raised light:border light:border-border">
          <span className="grid size-10 flex-none place-items-center rounded-md bg-raised text-muted">
            <FileAudio size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{s.title}</span>
            <span className="block truncate text-caption text-subtle">
              {[s.speaker, `${s.segments.length} clips`, formatClock(s.durationSec * 1000)].filter(Boolean).join(' · ')}
            </span>
          </span>
          <ChevronRight size={20} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />
        </Link>
      ))}
      <p className="text-caption text-subtle">Audio isn’t included in “Export all data”, so keep your original files.</p>
    </>
  )
}

type Analysed = { file: File; durationSec: number; envelope: Uint8Array; segments: ShadowSource['segments'] }

export function LibraryImport() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [analysed, setAnalysed] = useState<Analysed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) return setError('That file is over 80 MB. Trim it to the part you want to practise (30 minutes at most).')
    setBusy(true)
    try {
      const { durationSec, envelope } = await profileAudio(file)
      if (durationSec > MAX_IMPORT_SECONDS) {
        setError('That recording is longer than 30 minutes. Trim it to the part you want to practise, then import it again.')
      } else {
        setAnalysed({ file, durationSec, envelope, segments: splitSegments(envelope, durationSec) })
      }
    } catch {
      setError('This file couldn’t be read as audio. Use MP3, M4A, AAC or WAV.')
    } finally {
      setBusy(false)
    }
  }

  async function save(meta: Meta) {
    if (!analysed) return
    const { file, durationSec, envelope, segments } = analysed
    await db.transaction('rw', db.shadowSources, db.shadowAudio, async () => {
      const id = (await db.shadowSources.add({
        ...meta,
        rights: RIGHTS,
        fileName: file.name,
        mimeType: file.type || 'audio/mpeg',
        sizeBytes: file.size,
        durationSec,
        segments,
        envelope,
        createdAt: Date.now(),
      })) as number
      await db.shadowAudio.put({ sourceId: id, blob: file })
    })
    navigate('/speak/library', { replace: true })
  }

  return (
    <>
      <BackHeader to="/speak/library" title="Import audio" />
      {!analysed ? (
        <Card>
          <p className="text-muted">Choose a recording of a speaker whose delivery you want to learn from. MP3, M4A, AAC or WAV, up to 30 minutes.</p>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} className={buttonClass.primary}>
            <FileAudio size={20} strokeWidth={1.75} aria-hidden="true" />
            {busy ? 'Analysing pauses…' : 'Choose audio file'}
          </button>
          <input
            ref={input}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.wav"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card className="gap-1">
            <p className="font-medium break-words">{analysed.file.name}</p>
            <p className="text-caption text-subtle">
              {formatClock(analysed.durationSec * 1000)} · split into {analysed.segments.length} clips at natural pauses
            </p>
          </Card>
          <MetaForm initial={{ title: analysed.file.name.replace(/\.[^.]+$/, ''), speaker: '', date: '', source: '' }} submitLabel="Save to library" onSubmit={save} />
        </>
      )}
    </>
  )
}

export function LibraryEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const source = useLiveQuery(async () => (await db.shadowSources.get(Number(id))) ?? null, [id])
  const [confirm, setConfirm] = useState(false)
  if (source === undefined) return null
  if (source === null) return <NotFound />

  return (
    <>
      <BackHeader to="/speak/library" title="Edit recording" />
      <Card className="gap-1">
        <p className="font-medium break-words">{source.fileName}</p>
        <p className="text-caption text-subtle">
          {formatClock(source.durationSec * 1000)} · {source.segments.length} clips · {source.rights}
        </p>
      </Card>
      <MetaForm
        initial={{ title: source.title, speaker: source.speaker, date: source.date ?? '', source: source.source ?? '' }}
        submitLabel="Save changes"
        onSubmit={async (meta) => {
          await db.shadowSources.update(source.id!, meta)
          navigate('/speak/library')
        }}
      />
      <button type="button" onClick={() => setConfirm(true)} className="-mx-2 flex min-h-12 items-center rounded-md px-2 text-left text-danger hover:bg-raised">
        Delete recording
      </button>
      <ConfirmDialog
        open={confirm}
        title="Delete this recording?"
        confirmLabel="Delete recording"
        destructive
        onConfirm={async () => {
          await db.transaction('rw', db.shadowSources, db.shadowAudio, async () => {
            await db.shadowAudio.delete(source.id!)
            await db.shadowSources.delete(source.id!)
          })
          navigate('/speak/library', { replace: true })
        }}
        onCancel={() => setConfirm(false)}
      >
        <p>{source.title} will be removed from this phone. Your practice recordings stay.</p>
      </ConfirmDialog>
    </>
  )
}

type Meta = { title: string; speaker: string; date: string; source: string }

function MetaForm({ initial, submitLabel, onSubmit }: { initial: Meta; submitLabel: string; onSubmit: (m: Meta) => Promise<void> }) {
  const [meta, setMeta] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Meta) => (e: ChangeEvent<HTMLInputElement>) => setMeta({ ...meta, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!meta.title.trim()) {
      setError('Give the recording a title.')
      document.getElementById('meta-title')?.focus()
      return
    }
    await onSubmit({ title: meta.title.trim(), speaker: meta.speaker.trim(), date: meta.date.trim(), source: meta.source.trim() })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Card>
        <Label>Details</Label>
        <Field id="meta-title" label="Title" value={meta.title} onChange={set('title')} error={error} />
        <Field id="meta-speaker" label="Speaker" optional value={meta.speaker} onChange={set('speaker')} />
        <Field id="meta-date" label="Date given" optional value={meta.date} onChange={set('date')} placeholder="e.g. 2014 or 12 March 2019…" />
        <Field id="meta-source" label="Where it’s from" optional value={meta.source} onChange={set('source')} placeholder="e.g. TED, YouTube channel, podcast…" />
        <p className="text-caption text-subtle">Rights: {RIGHTS}. Imported audio is never uploaded.</p>
      </Card>
      <button type="submit" className={buttonClass.primary}>
        {submitLabel}
      </button>
    </form>
  )
}

function Field({
  id,
  label,
  optional,
  error,
  ...input
}: { id: string; label: string; optional?: boolean; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label} {optional && <span className="font-normal text-subtle">(optional)</span>}
      </label>
      <input
        id={id}
        name={id}
        autoComplete="off"
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass} aria-invalid:border-danger`}
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
