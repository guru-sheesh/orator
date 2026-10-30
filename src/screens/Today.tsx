import { Link } from 'react-router'
import { BookOpen, ChartNoAxesColumn, Check, ChevronRight, HardDriveDownload, Mic, NotebookPen, Settings, type LucideIcon } from 'lucide-react'
import { useBackupDue, useDailySummary } from '../data/daily'
import { TECHNIQUE_FOCUS, useTrends } from '../data/trends'
import { formatLongDate, toDateKey } from '../lib/date'
import { buttonClass, Card, cx, iconButtonClass, Label, PageHeader, ProgressBar, ProgressRing } from '../components/ui'

export default function Today() {
  const summary = useDailySummary(toDateKey())
  const backupDue = useBackupDue()
  const trends = useTrends()
  const focus = trends?.recurring ? TECHNIQUE_FOCUS[trends.recurring.tag] : null

  // Dexie resolves within a frame; render nothing rather than a misleading 0/3.
  if (!summary) return null
  const { articulation, journal, reading, completedCount } = summary
  const remaining = 3 - completedCount

  const next = !articulation.done
    ? { to: '/speak', title: 'Articulation practice', body: `${articulation.target - articulation.minutes} ${articulation.target - articulation.minutes === 1 ? 'minute' : 'minutes'} left today.`, cta: articulation.minutes > 0 ? 'Continue session' : 'Start session' }
    : !journal.done
      ? { to: '/journal', title: 'Journal', body: 'Mark it once you’ve journaled today.', cta: 'Mark journal done' }
      : !reading.done
        ? { to: '/read', title: 'Reading', body: `${reading.target - reading.pages} ${reading.target - reading.pages === 1 ? 'page' : 'pages'} to go.`, cta: 'Log pages' }
        : null

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate()}
        title="Today"
        actions={
          <>
            <Link to="/progress" aria-label="Progress" className={iconButtonClass}>
              <ChartNoAxesColumn size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <Link to="/settings" aria-label="Settings" className={iconButtonClass}>
              <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </>
        }
      />

      <Card className="flex-row items-center gap-4">
        <ProgressRing value={completedCount} max={3} label="Daily progress">
          <span className="text-sm font-semibold tabular-nums">{completedCount}/3</span>
        </ProgressRing>
        <div>
          <Label>Daily progress</Label>
          <p className="text-title font-semibold">
            {remaining === 0 ? 'All targets complete' : `${remaining} ${remaining === 1 ? 'target' : 'targets'} left today`}
          </p>
        </div>
      </Card>

      <StatusRow
        to="/speak"
        icon={Mic}
        label="Articulation"
        done={articulation.done}
        value={`${articulation.minutes} / ${articulation.target} min`}
        progress={{ value: articulation.minutes, max: articulation.target }}
      />
      <StatusRow to="/journal" icon={NotebookPen} label="Journal" done={journal.done} value="Not done" />
      <StatusRow
        to="/read"
        icon={BookOpen}
        label="Reading"
        done={reading.done}
        value={`${reading.pages} / ${reading.target} pages`}
        doneValue={`${reading.pages} / ${reading.target} pages`}
        progress={{ value: reading.pages, max: reading.target }}
      />

      {next && (
        <Card>
          <Label>Next up</Label>
          <p className="text-title font-semibold">{next.title}</p>
          <p className="text-secondary text-muted">{next.body}</p>
          <Link to={next.to} className={cx(buttonClass.primary, 'w-full')}>
            {next.cta}
          </Link>
        </Card>
      )}

      {focus && (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <Label>Focus this week</Label>
            <Link to="/progress" className={cx(buttonClass.ghost, 'min-h-11 text-sm')}>
              Trends
            </Link>
          </div>
          <p className="font-medium">{focus.label}</p>
          <p className="text-sm text-muted">{focus.tip}</p>
        </Card>
      )}

      {backupDue && (
        <Link to="/settings" className="flex items-center gap-3 rounded-lg bg-info-soft px-4 py-3 text-sm">
          <HardDriveDownload size={20} strokeWidth={1.75} className="flex-none text-info" aria-hidden="true" />
          <span className="flex-1">Your data lives only on this phone. Export a backup this week.</span>
          <ChevronRight size={20} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />
        </Link>
      )}
    </>
  )
}

function StatusRow({
  to,
  icon: Icon,
  label,
  value,
  doneValue = 'Complete',
  done,
  progress,
}: {
  to: string
  icon: LucideIcon
  label: string
  value: string
  doneValue?: string
  done: boolean
  progress?: { value: number; max: number }
}) {
  return (
    <Link to={to} className="flex items-center gap-4 rounded-lg bg-surface px-5 py-4 transition-colors duration-(--duration-fast) hover:bg-raised active:bg-raised light:border light:border-border">
      <span
        className={cx('grid size-10 flex-none place-items-center rounded-md', done ? 'bg-success-soft text-success' : 'bg-raised text-muted')}
      >
        {done ? <Check size={20} strokeWidth={1.75} aria-hidden="true" /> : <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span>{label}</span>
          <span className={cx('font-semibold tabular-nums', done && 'text-success')}>{done ? doneValue : value}</span>
        </div>
        {progress && <ProgressBar value={progress.value} max={progress.max} label={`${label} progress`} valueText={value} done={done} />}
      </div>
    </Link>
  )
}
