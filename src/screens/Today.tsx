import { Link } from 'react-router'
import { BookOpen, ChartNoAxesColumn, Check, ChevronRight, HardDriveDownload, Mic, NotebookPen, Settings, type LucideIcon } from 'lucide-react'
import { useBackupDue, useDailySummary } from '../data/daily'
import { TECHNIQUE_FOCUS, useTrends } from '../data/trends'
import { formatLongDate } from '../lib/date'
import { useToday } from '../hooks/useToday'
import { buttonClass, cx, iconButtonClass, ProgressBar } from '../components/ui'
import { OfflineStatus } from '../components/OfflineStatus'

const COUNT_WORDS = ['Nothing', 'One thing', 'Two things', 'Three things']

export default function Today() {
  const summary = useDailySummary(useToday())
  const backupDue = useBackupDue()
  const trends = useTrends()
  const focus = trends?.recurring ? TECHNIQUE_FOCUS[trends.recurring.tag] : null

  // Dexie resolves within a frame; render nothing rather than a misleading 0/3.
  if (!summary) return null
  const { articulation, journal, reading, completedCount } = summary
  const remaining = 3 - completedCount
  const minutesLeft = Math.max(0, articulation.target - articulation.minutes)
  const pagesLeft = Math.max(0, reading.target - reading.pages)

  const next = !articulation.done
    ? { to: '/speak', cta: articulation.minutes > 0 ? `Continue speaking · ${minutesLeft} min left` : 'Start today’s speaking session' }
    : !journal.done
      ? { to: '/journal', cta: 'Mark today’s journal' }
      : !reading.done
        ? { to: '/read', cta: `Log pages · ${pagesLeft} to go` }
        : null

  return (
    <>
      <header className="flex items-start gap-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-subtle">{formatLongDate()}</p>
          <h1 className="mt-2 font-serif text-[2.375rem] leading-[1.05] font-medium tracking-[-0.015em]">
            {remaining === 0 ? (
              <>Everything’s done for today.</>
            ) : (
              <>
                {COUNT_WORDS[remaining]} left
                <span className="text-muted"> today.</span>
              </>
            )}
          </h1>
        </div>
        <div className="-mr-2 flex flex-none">
          <Link to="/progress" aria-label="Progress" className={iconButtonClass}>
            <ChartNoAxesColumn size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
          <Link to="/settings" aria-label="Settings" className={iconButtonClass}>
            <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section aria-label="Daily targets" className="mt-3 flex flex-col rounded-lg border border-border/70 bg-surface">
        <Row
          to="/speak"
          icon={Mic}
          label="Speak"
          done={articulation.done}
          value={articulation.done ? `${articulation.minutes} min` : `${articulation.minutes} of ${articulation.target} min`}
          progress={{ value: articulation.minutes, max: articulation.target }}
        />
        <Row to="/journal" icon={NotebookPen} label="Journal" done={journal.done} value={journal.done ? 'Done' : 'Not yet'} />
        <Row
          to="/read"
          icon={BookOpen}
          label="Read"
          done={reading.done}
          value={`${reading.pages} of ${reading.target} pages`}
          progress={{ value: reading.pages, max: reading.target }}
        />
      </section>

      {next && (
        <Link to={next.to} className={cx(buttonClass.primary, 'mt-1 w-full')}>
          {next.cta}
        </Link>
      )}

      {focus && (
        <Link to="/progress" className="group mt-2 flex items-start gap-3 rounded-lg px-1 py-2">
          <span className="mt-1.5 size-2 flex-none rounded-full bg-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-caption text-subtle">Your focus this week</span>
            <span className="block font-serif text-[1.1875rem] leading-snug">{focus.label}</span>
            <span className="mt-0.5 block text-sm text-muted">{focus.tip}</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="mt-6 flex-none text-subtle group-hover:text-text" aria-hidden="true" />
        </Link>
      )}

      <OfflineStatus />

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

function Row({
  to,
  icon: Icon,
  label,
  value,
  done,
  progress,
}: {
  to: string
  icon: LucideIcon
  label: string
  value: string
  done: boolean
  progress?: { value: number; max: number }
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 border-t border-border/70 px-5 py-4 first:rounded-t-lg first:border-t-0 last:rounded-b-lg hover:bg-raised/60 active:bg-raised"
    >
      <span className={cx('grid size-10 flex-none place-items-center rounded-full', done ? 'bg-success-soft text-success' : 'bg-raised text-muted')}>
        {done ? <Check size={20} strokeWidth={2} aria-hidden="true" /> : <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[1.0625rem] font-medium">
            {label}
            {done && <span className="sr-only"> complete</span>}
          </span>
          <span className={cx('text-sm tabular-nums', done ? 'text-success' : 'text-muted')}>{value}</span>
        </span>
        {progress && !done && <ProgressBar value={progress.value} max={progress.max} label={`${label} progress`} valueText={value} done={done} />}
      </span>
    </Link>
  )
}
