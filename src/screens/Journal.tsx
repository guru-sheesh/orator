import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { CalendarDays, Check, ChevronLeft, HardDrive, Search } from 'lucide-react'
import { db, type JournalEntry } from '../data/db'
import { emptyEntry, hasContent, PROMPTS, saveEntry, type PromptKey } from '../data/journal'
import { formatLongDate, fromDateKey, toDateKey } from '../lib/date'
import { buttonClass, Card, cx, iconButtonClass, Segmented } from '../components/ui'

const SAVE_DELAY_MS = 600
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: number } | { status: 'error' }

const textareaClass =
  'w-full resize-none rounded-sm border border-border-strong bg-raised px-3.5 py-3 [field-sizing:content] placeholder:text-subtle'

export default function Journal() {
  const [params] = useSearchParams()
  const today = toDateKey()
  const requested = params.get('date')
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today

  // Entries can't be written for days that haven't happened yet.
  if (date > today) return <Navigate to="/journal" replace />
  return <JournalEditor key={date} date={date} isToday={date === today} />
}

function JournalEditor({ date, isToday }: { date: string; isToday: boolean }) {
  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [save, setSave] = useState<SaveState>({ status: 'idle' })
  const latest = useRef<JournalEntry | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Load once per date; after that local state is the source of truth while typing.
  useEffect(() => {
    let cancelled = false
    db.journal.get(date).then((found) => {
      if (cancelled) return
      const loaded = found ?? emptyEntry(date)
      latest.current = loaded
      setEntry(loaded)
      if (found) setSave({ status: 'saved', at: found.updatedAt })
    })
    return () => {
      cancelled = true
    }
  }, [date])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (!latest.current) return
    try {
      await saveEntry(latest.current)
      setSave({ status: 'saved', at: Date.now() })
    } catch {
      setSave({ status: 'error' })
    }
  }, [])

  // Never lose a draft: save when the app is backgrounded, closed or navigated away from.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer.current) void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      if (timer.current) void flush()
    }
  }, [flush])

  // Build the next entry from the ref (not inside a setState updater) so an
  // immediate flush always saves exactly what was just typed.
  function update(patch: Partial<JournalEntry>, immediate = false) {
    const prev = latest.current
    if (!prev) return
    const next = { ...prev, ...patch }
    if (!hasContent(next)) next.completed = false // an emptied entry can't stay complete
    latest.current = next
    setEntry(next)
    setSave({ status: 'saving' })
    clearTimeout(timer.current)
    if (immediate) void flush()
    else timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  const setPrompt = (key: PromptKey, value: string) => update({ prompted: { ...latest.current?.prompted, [key]: value } })

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        {!isToday && (
          <Link to="/journal/history" aria-label="Back to journal history" className={iconButtonClass}>
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
        <div className="flex-1">
          <p className="text-caption text-subtle">{formatLongDate(fromDateKey(date))}</p>
          <h1 className="text-headline font-semibold">{isToday ? 'Journal' : 'Past entry'}</h1>
        </div>
        <Link to="/journal/history?search=1" aria-label="Search entries" className={iconButtonClass}>
          <Search size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link to="/journal/history" aria-label="Journal history" className={iconButtonClass}>
          <CalendarDays size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </header>

      {entry && (
        <>
          <Segmented
            label="Entry mode"
            options={[
              { value: 'prompted', label: 'Prompted' },
              { value: 'free', label: 'Free write' },
            ]}
            value={entry.mode}
            onChange={(mode) => update({ mode }, true)}
          />

          <Card>
            {entry.mode === 'prompted' ? (
              PROMPTS.map((p) => (
                <div key={p.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`prompt-${p.key}`} className="text-sm font-medium text-muted">
                    {p.text}
                  </label>
                  <textarea
                    id={`prompt-${p.key}`}
                    name={p.key}
                    autoComplete="off"
                    rows={2}
                    value={entry.prompted[p.key] ?? ''}
                    onChange={(e) => setPrompt(p.key, e.target.value)}
                    placeholder="A few lines…"
                    className={cx(textareaClass, 'min-h-[5.5rem]')}
                  />
                </div>
              ))
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="free-write" className="text-sm font-medium text-muted">
                  Write freely
                </label>
                <textarea
                  id="free-write"
                  name="freeWrite"
                  autoComplete="off"
                  rows={10}
                  value={entry.freeWrite}
                  onChange={(e) => update({ freeWrite: e.target.value })}
                  placeholder="Whatever is on your mind…"
                  className={cx(textareaClass, 'min-h-[16rem]')}
                />
              </div>
            )}
            {entry.mode === 'free' && PROMPTS.some((p) => entry.prompted[p.key]) && (
              <p className="text-caption text-subtle">Your prompted answers for this day are kept under Prompted.</p>
            )}
          </Card>

          <div className="flex items-center justify-between gap-3">
            <SaveStatus save={save} hasText={hasContent(entry)} />
            {entry.completed ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-success-soft px-3 py-2 text-sm font-medium text-success">
                <Check size={16} strokeWidth={2} aria-hidden="true" />
                Complete
              </span>
            ) : (
              <button
                type="button"
                disabled={!hasContent(entry)}
                onClick={() => update({ completed: true }, true)}
                className={buttonClass.primary}
              >
                Mark complete
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

function SaveStatus({ save, hasText }: { save: SaveState; hasText: boolean }) {
  let text = 'Saved on this device'
  if (save.status === 'saving') text = 'Saving…'
  else if (save.status === 'error') text = 'Couldn’t save. Keep this screen open and try again.'
  else if (save.status === 'saved' && hasText) text = `Saved on this device · ${timeFormat.format(save.at)}`
  else if (!hasText) text = 'Drafts save automatically'

  return (
    // Only announce failures; "Saving…" on every keystroke would drown out typing for screen readers.
    <p aria-live={save.status === 'error' ? 'polite' : 'off'} className={cx('flex items-center gap-1.5 text-caption', save.status === 'error' ? 'text-danger' : 'text-subtle')}>
      <HardDrive size={14} strokeWidth={1.75} aria-hidden="true" className="flex-none" />
      {text}
    </p>
  )
}
