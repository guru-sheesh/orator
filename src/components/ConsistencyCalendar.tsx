import type { DayProgress } from '../data/progress'
import { formatShortDate, fromDateKey, toDateKey } from '../lib/date'
import { cx } from './ui'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// Fill + outline style differ per level so the state never relies on colour alone.
const LEVEL_CLASS = [
  'bg-raised text-subtle',
  'bg-raised text-muted ring-1 ring-inset ring-border-strong',
  'bg-success-soft text-success ring-1 ring-inset ring-success',
  'bg-success text-bg font-semibold',
]

/** Day grid, Monday first. `days` must be contiguous; leading blanks pad the first week. */
export function ConsistencyCalendar({ days }: { days: DayProgress[] }) {
  const today = toDateKey()
  const lead = days.length ? (fromDateKey(days[0].date).getDay() + 6) % 7 : 0

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="pb-1 text-xs font-medium text-subtle">
            {d}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1.5" aria-label="Targets met per day">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`pad-${i}`} aria-hidden="true" />
        ))}
        {days.map((day) => {
          const date = fromDateKey(day.date)
          const future = day.date > today
          return (
            <li
              key={day.date}
              aria-label={`${WEEKDAY_NAMES[(date.getDay() + 6) % 7]} ${formatShortDate(date)}: ${future ? 'upcoming' : `${day.met} of 3 targets met`}`}
              className={cx(
                'grid aspect-square place-items-center rounded-sm text-xs font-medium tabular-nums',
                future ? 'text-subtle opacity-60' : LEVEL_CLASS[day.met],
                day.date === today && 'outline-2 outline-offset-1 outline-primary',
              )}
            >
              {date.getDate()}
            </li>
          )
        })}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-subtle">
        {[3, 2, 1].map((level) => (
          <li key={level} className="flex items-center gap-1.5">
            <span className={cx('size-3 rounded-[3px]', LEVEL_CLASS[level])} aria-hidden="true" />
            {level} of 3
          </li>
        ))}
      </ul>
    </div>
  )
}
