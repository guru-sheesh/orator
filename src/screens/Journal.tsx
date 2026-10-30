import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, NotebookPen } from 'lucide-react'
import { setJournaled, useJournaledDates } from '../data/journal'
import { Card, cx, iconButtonClass, PageHeader } from '../components/ui'
import { dateKeysBetween, endOfMonth, formatLongDate, formatMonthYear, fromDateKey, startOfMonth, toDateKey } from '../lib/date'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** One tap to record that you journaled today; tap past days to fix a missed mark. */
export default function Journal() {
  const today = toDateKey()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const from = toDateKey(month)
  const to = toDateKey(endOfMonth(month))
  const marked = useJournaledDates(from, to)
  const todayMarked = useJournaledDates(today, today)
  const isCurrentMonth = from.slice(0, 7) === today.slice(0, 7)

  // The pressed button is swapped for its opposite (mark ⇄ undo); keep keyboard/screen-reader focus on it.
  const toggleRef = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  const doneToday = !!todayMarked?.has(today)
  useEffect(() => {
    if (toggled.current) toggleRef.current?.focus()
  }, [doneToday])
  function toggleToday(next: boolean) {
    toggled.current = true
    void setJournaled(today, next)
  }

  if (!marked || !todayMarked) return null
  const done = todayMarked.has(today)
  const days = dateKeysBetween(month, endOfMonth(month))
  const elapsed = days.filter((d) => d <= today).length
  const count = days.filter((d) => marked.has(d)).length

  return (
    <>
      <PageHeader eyebrow={formatLongDate()} title="Journal" />

      <Card className="items-center gap-4 py-8 text-center">
        <span className={cx('grid size-16 place-items-center rounded-full', done ? 'bg-success-soft text-success' : 'bg-raised text-muted')}>
          {done ? <Check size={28} strokeWidth={2} aria-hidden="true" /> : <NotebookPen size={28} strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <p className="text-title font-semibold" role="status">
          {done ? 'Journaled today' : 'Have you journaled today?'}
        </p>
        {done ? (
          <button ref={toggleRef} type="button" onClick={() => toggleToday(false)} className="min-h-11 px-3 text-sm text-muted underline underline-offset-2 hover:text-text">
            Undo
          </button>
        ) : (
          <button
            ref={toggleRef}
            type="button"
            onClick={() => toggleToday(true)}
            className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-lg font-semibold text-on-primary transition-transform duration-(--duration-fast) active:scale-[0.98] hover:brightness-110"
          >
            <Check size={24} strokeWidth={2} aria-hidden="true" />
            I journaled today
          </button>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className={iconButtonClass}>
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <div className="text-center">
            <p className="font-semibold">{formatMonthYear(month)}</p>
            <p className="text-caption text-subtle tabular-nums">
              {count} of {elapsed} days
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            disabled={isCurrentMonth}
            className={cx(iconButtonClass, 'disabled:invisible')}
          >
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
          {WEEKDAYS.map((d, i) => (
            <span key={i} className="text-caption font-medium text-subtle">
              {d}
            </span>
          ))}
        </div>
        <ol className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: (month.getDay() + 6) % 7 }, (_, i) => (
            <li key={`pad-${i}`} aria-hidden="true" />
          ))}
          {days.map((key) => {
            const date = fromDateKey(key)
            const on = marked.has(key)
            const future = key > today
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={future}
                  aria-pressed={on}
                  aria-label={formatLongDate(date)}
                  onClick={() => void setJournaled(key, !on)}
                  className={cx(
                    'grid aspect-square w-full place-items-center rounded-sm text-caption font-medium tabular-nums disabled:opacity-40',
                    on ? 'bg-success font-semibold text-on-success' : 'bg-raised text-subtle hover:ring-1 hover:ring-border-strong',
                    key === today && 'outline-2 outline-offset-1 outline-primary',
                  )}
                >
                  {date.getDate()}
                </button>
              </li>
            )
          })}
        </ol>
        <p className="text-caption text-subtle">Tap a past day to mark or unmark it.</p>
      </Card>
    </>
  )
}
