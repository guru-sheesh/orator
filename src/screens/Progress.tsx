import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePeriodProgress } from '../data/progress'
import { TECHNIQUE_FOCUS, useTrends, weekLabel, type WeekPoint } from '../data/trends'
import { TrendChart } from '../components/TrendChart'
import { ConsistencyCalendar } from '../components/ConsistencyCalendar'
import { Card, cx, iconButtonClass, Label, Segmented } from '../components/ui'
import {
  addDays,
  endOfMonth,
  formatMonthYear,
  formatShortDate,
  fromDateKey,
  startOfMonth,
  startOfWeek,
  toDateKey,
} from '../lib/date'

type View = 'week' | 'month'

export default function Progress() {
  // View and period live in the URL so back/forward and reloads keep your place.
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'month' ? 'month' : 'week'
  const at = params.get('at')
  const anchor = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? fromDateKey(at) : new Date()

  const { start, end } = periodOf(view, anchor)
  const isCurrent = containsToday(start, end)
  const data = usePeriodProgress(start, end)

  function go(next: { view?: View; at?: Date }) {
    const v = next.view ?? view
    const p = new URLSearchParams({ view: v })
    // Omit `at` for the current period so the default URL always means "now".
    if (next.at) {
      const period = periodOf(v, next.at)
      if (!containsToday(period.start, period.end)) p.set('at', toDateKey(next.at))
    }
    setParams(p, { replace: true })
  }

  const step = (dir: -1 | 1) => go({ at: view === 'week' ? addDays(start, dir * 7) : new Date(start.getFullYear(), start.getMonth() + dir, 1) })
  const title =
    view === 'week'
      ? isCurrent
        ? 'This week'
        : `${formatShortDate(start)} – ${formatShortDate(end)}`
      : isCurrent
        ? 'This month'
        : formatMonthYear(start)

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/" aria-label="Back to Today" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="text-headline font-semibold">Progress</h1>
      </header>

      <Segmented
        label="Period"
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        value={view}
        onChange={(v) => go({ view: v })}
      />

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} aria-label={`Previous ${view}`} className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <p className="font-semibold" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label={`Next ${view}`}
          disabled={isCurrent}
          className={cx(iconButtonClass, 'disabled:invisible')}
        >
          <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {data && (
        <>
          <Card>
            <Label>{view === 'week' ? 'Days on target' : 'Month totals'}</Label>
            <Stat label="Articulation" value={`${data.articulationDays} / ${data.elapsedDays} days`} />
            {view === 'month' && <Stat label="Practice time" value={`${data.articulationMinutes} min`} />}
            <Stat label="Journal" value={`${data.journalDays} / ${data.elapsedDays} days`} />
            <Stat
              label="Reading"
              value={`${data.readingPages} / ${data.readingTarget} pages`}
              done={data.readingTarget > 0 && data.readingPages >= data.readingTarget}
            />
            {view === 'month' && <Stat label="Books completed" value={String(data.booksCompleted)} />}
            {isCurrent && <p className="text-caption text-subtle">Counts days up to today; the reading target is your daily target × {data.elapsedDays} days.</p>}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-2">
              <Label>Consistency</Label>
              <p className="text-caption text-subtle">Targets met per day</p>
            </div>
            <ConsistencyCalendar days={data.days} />
          </Card>

          <SpeechTrends />
        </>
      )}
    </>
  )
}

function periodOf(view: View, d: Date) {
  if (view === 'week') {
    const start = startOfWeek(d)
    return { start, end: addDays(start, 6) }
  }
  return { start: startOfMonth(d), end: endOfMonth(d) }
}

function containsToday(start: Date, end: Date) {
  const today = toDateKey()
  return toDateKey(start) <= today && today <= toDateKey(end)
}

function Stat({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={cx('font-semibold tabular-nums', done && 'text-success')}>{value}</span>
    </div>
  )
}


/** Long-term articulation trends (CLAUDE.md §12, §16): 8 weeks, first attempts only, no single score. */
function SpeechTrends() {
  const t = useTrends()
  if (!t) return null
  if (t.totalAnswers < 3)
    return (
      <Card>
        <Label>Speech trends</Label>
        <p className="text-muted">
          Trends for fillers, hesitations, restarts and structure appear after {3 - t.totalAnswers} more analysed {3 - t.totalAnswers === 1 ? 'answer' : 'answers'}.
        </p>
      </Card>
    )

  const pts = (k: keyof WeekPoint) => t.weeks.map((w) => ({ label: weekLabel(w.weekStart), value: w[k] as number | null }))
  const focus = t.recurring ? TECHNIQUE_FOCUS[t.recurring.tag] : null

  return (
    <>
      {focus && (
        <Card>
          <Label>Recurring weakness · last 2 weeks</Label>
          <p className="text-title font-semibold">{focus.label}</p>
          <p className="text-muted">{focus.tip}</p>
          <p className="text-caption text-subtle">Flagged in {t.recurring!.share}% of your answers.</p>
        </Card>
      )}

      <Card className="gap-5">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Speech trends · 8 weeks</Label>
          <p className="text-caption text-subtle tabular-nums">{t.totalAnswers} answers</p>
        </div>
        <TrendChart title="Fillers per minute" unit="per minute" points={pts('fillersPerMin')} />
        <TrendChart title="Hesitations per answer" unit="per answer" points={pts('hesitationsPerAnswer')} />
        <TrendChart title="Restarts per answer" unit="per answer" points={pts('restartsPerAnswer')} />
        <TrendChart title="Main point stated early" unit="of answers" points={pts('mainPointEarly')} lowerIsBetter={false} inPoints format={(v) => `${v}%`} />
        <TrendChart title="Pace variation" unit="(lower is steadier)" points={pts('paceVariation')} inPoints format={(v) => `${v}%`} />
        <p className="text-caption text-subtle">First attempts only, so retries don’t flatter the trend. Each dimension is tracked separately; there is no overall score.</p>
      </Card>

      {(t.topFillers.length > 0 || t.retries.pairs > 0) && (
        <Card>
          {t.topFillers.length > 0 && (
            <div>
              <Label>Your most common fillers</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {t.topFillers.map((f) => (
                  <span key={f.text} className="rounded-sm bg-raised px-2.5 py-1 text-sm tabular-nums">
                    “{f.text}” <span className="text-subtle">× {f.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {t.retries.pairs > 0 && (
            <div className={cx(t.topFillers.length > 0 && 'border-t border-border pt-3')}>
              <Label>Retries</Label>
              <p className="mt-1 text-muted">
                Of {t.retries.pairs} {t.retries.pairs === 1 ? 'retry' : 'retries'}, {t.retries.fillersImproved} had fewer fillers, {t.retries.hesitationsImproved} had fewer hesitations, and{' '}
                {t.retries.mainPointImproved} stated the main point earlier.
              </p>
            </div>
          )}
        </Card>
      )}
    </>
  )
}