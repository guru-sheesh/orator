import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { JournalEntry } from '../data/db'
import { entryText, searchEntries, useAllEntries } from '../data/journal'
import { Card, cx, iconButtonClass, Label } from '../components/ui'
import { dateKeysBetween, endOfMonth, formatLongDate, formatMonthYear, fromDateKey, startOfMonth, toDateKey } from '../lib/date'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function JournalHistory() {
  const [params, setParams] = useSearchParams()
  const entries = useAllEntries()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const monthParam = params.get('month')
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? fromDateKey(`${monthParam}-01`) : startOfMonth(new Date())
  const isCurrentMonth = toDateKey(month).slice(0, 7) === toDateKey().slice(0, 7)

  const hits = useMemo(() => (entries ? searchEntries(entries, deferredQuery) : []), [entries, deferredQuery])
  const searching = deferredQuery.trim().length > 0

  function stepMonth(dir: -1 | 1) {
    const next = new Date(month.getFullYear(), month.getMonth() + dir, 1)
    const p = new URLSearchParams(params)
    const key = toDateKey(next).slice(0, 7)
    if (key === toDateKey().slice(0, 7)) p.delete('month')
    else p.set('month', key)
    setParams(p, { replace: true })
  }

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/journal" aria-label="Back to today's entry" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="text-headline font-semibold">Journal history</h1>
      </header>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="journal-search" className="text-sm font-medium text-muted">
          Search entries
        </label>
        <div className="relative">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle" />
          <input
            id="journal-search"
            name="q"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            // Only when arriving from the search icon, so the keyboard isn't forced open otherwise.
            autoFocus={params.get('search') === '1'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. inverter, client, presentation…"
            className="h-12 w-full rounded-sm border border-border-strong bg-raised pr-3.5 pl-10 placeholder:text-subtle"
          />
        </div>
      </div>

      {searching ? (
        <section aria-label="Search results" className="flex flex-col gap-2">
          <p aria-live="polite" className="text-caption text-subtle">
            {hits.length === 0 ? '' : `${hits.length} ${hits.length === 1 ? 'entry' : 'entries'}`}
          </p>
          {hits.length === 0 ? (
            <Card>
              <p>No entries contain “{deferredQuery.trim()}”.</p>
              <p className="text-sm text-muted">Try a shorter word or a different spelling. Search looks through every prompt answer and free write.</p>
            </Card>
          ) : (
            hits.map(({ entry, snippet }) => (
              <EntryLink key={entry.date} entry={entry}>
                <span className="text-muted">{snippet[0]}</span>
                <mark className="rounded-[3px] bg-primary-soft px-0.5 text-text">{snippet[1]}</mark>
                <span className="text-muted">{snippet[2]}</span>
              </EntryLink>
            ))
          )}
        </section>
      ) : (
        entries && (
          <>
            <Card>
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month" className={iconButtonClass}>
                  <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <p className="font-semibold" aria-live="polite">
                  {formatMonthYear(month)}
                </p>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  aria-label="Next month"
                  disabled={isCurrentMonth}
                  className={cx(iconButtonClass, 'disabled:invisible')}
                >
                  <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
              <MonthCalendar month={month} entries={entries} />
            </Card>

            <MonthList month={month} entries={entries} />
          </>
        )
      )}
    </>
  )
}

function MonthCalendar({ month, entries }: { month: Date; entries: JournalEntry[] }) {
  const today = toDateKey()
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const days = dateKeysBetween(month, endOfMonth(month))
  const lead = (month.getDay() + 6) % 7

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="pb-1 text-xs font-medium text-subtle">
            {d}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad-${i}`} aria-hidden="true" />
        ))}
        {days.map((key) => {
          const entry = byDate.get(key)
          const date = fromDateKey(key)
          const state = entry ? (entry.completed ? 'complete' : 'draft') : 'none'
          const cell = cx(
            'grid aspect-square place-items-center rounded-sm text-xs font-medium tabular-nums',
            state === 'complete' && 'bg-success font-semibold text-bg',
            state === 'draft' && 'bg-raised text-muted ring-1 ring-inset ring-border-strong',
            state === 'none' && 'bg-raised text-subtle',
            key === today && 'outline-2 outline-offset-1 outline-primary',
          )
          const label = `${formatLongDate(date)}: ${state === 'complete' ? 'entry complete' : state === 'draft' ? 'draft' : 'no entry'}`
          return (
            <li key={key}>
              {key > today ? (
                <span className={cx(cell, 'opacity-60')} aria-label={`${formatLongDate(date)}: upcoming`}>
                  {date.getDate()}
                </span>
              ) : (
                <Link to={key === today ? '/journal' : `/journal?date=${key}`} aria-label={label} className={cx(cell, 'hover:ring-2 hover:ring-primary')}>
                  {date.getDate()}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-subtle">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-success" aria-hidden="true" />
          Complete
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-raised ring-1 ring-inset ring-border-strong" aria-hidden="true" />
          Draft
        </li>
        <li>Tap a day to read or edit it.</li>
      </ul>
    </div>
  )
}

function MonthList({ month, entries }: { month: Date; entries: JournalEntry[] }) {
  const prefix = toDateKey(month).slice(0, 7)
  const inMonth = entries.filter((e) => e.date.startsWith(prefix))

  return (
    <section aria-labelledby="month-entries" className="flex flex-col gap-2">
      <Label id="month-entries">
        {inMonth.length} {inMonth.length === 1 ? 'entry' : 'entries'} in {formatMonthYear(month)}
      </Label>
      {inMonth.length === 0 ? (
        <p className="text-sm text-muted">No entries this month.</p>
      ) : (
        inMonth.map((entry) => (
          <EntryLink key={entry.date} entry={entry}>
            <span className="line-clamp-2 text-muted">{entryText(entry).replace(/\s+/g, ' ')}</span>
          </EntryLink>
        ))
      )}
    </section>
  )
}

function EntryLink({ entry, children }: { entry: JournalEntry; children: ReactNode }) {
  const isToday = entry.date === toDateKey()
  return (
    <Link
      to={isToday ? '/journal' : `/journal?date=${entry.date}`}
      className="flex flex-col gap-1 rounded-lg bg-surface px-5 py-4 hover:bg-raised light:border light:border-border"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="font-medium">{formatLongDate(fromDateKey(entry.date))}</span>
        <span className={cx('text-caption', entry.completed ? 'text-success' : 'text-subtle')}>{entry.completed ? 'Complete' : 'Draft'}</span>
      </span>
      <span className="min-w-0 text-sm break-words">{children}</span>
    </Link>
  )
}
