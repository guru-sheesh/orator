import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AudioLines, Check, ChevronRight, Library, MonitorPlay, Repeat, SkipForward } from 'lucide-react'
import { useSettings } from '../../data/daily'
import { nextPendingTask, startSession, TASKS, useTodaySession } from '../../data/speech'
import { formatClock } from '../../components/recording'
import { useTodaysClip } from '../../data/clips'
import { useToday } from '../../hooks/useToday'
import { buttonClass, Card, cx, iconButtonClass, Label, PageHeader, ProgressRing } from '../../components/ui'

/** Today's built-in clip, shown (and downloaded) before the session starts. */
function TodaysClip({ hasSession, sessionClip }: { hasSession: boolean; sessionClip: string | undefined }) {
  const today = useToday()
  const todays = useTodaysClip(today, sessionClip)
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  if (!todays) return null
  const { clip, ready } = todays

  async function listen() {
    setOpening(true)
    try {
      if (!hasSession) await startSession()
      navigate('/speak/shadowing')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-md bg-primary-soft text-primary">
          <AudioLines size={20} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <Label>Today’s clip</Label>
          <p className="truncate font-medium">{clip.title}</p>
          <p className="truncate text-caption text-subtle">
            {clip.speaker} · Clip {clip.index} of {clip.of} · {formatClock(clip.durationSec * 1000)}
          </p>
        </div>
      </div>
      <p className="text-caption text-subtle" role="status">
        {ready ? 'Downloaded. It plays even without internet.' : 'Downloading…'}
      </p>
      <button type="button" onClick={() => void listen()} disabled={opening} className={buttonClass.secondary}>
        {opening ? 'Opening…' : 'Go to shadowing'}
      </button>
    </Card>
  )
}

export default function SpeakHome() {
  const session = useTodaySession()
  const settings = useSettings()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)

  if (session === undefined || !settings) return null
  const targetMs = settings.targets.articulationMinutes * 60_000
  const next = session ? nextPendingTask(session) : TASKS[0].id
  const doneCount = session ? TASKS.filter((t) => session.tasks[t.id] !== 'pending').length : 0

  async function begin() {
    setStarting(true)
    try {
      if (!session) await startSession()
      navigate(`/speak/${next ?? TASKS[0].id}`)
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Speak"
        actions={
          <>
            <Link to="/speak/talks" aria-label="Talks to watch" className={iconButtonClass}>
              <MonitorPlay size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
            <Link to="/speak/library" aria-label="Shadowing audio library" className={iconButtonClass}>
              <Library size={20} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </>
        }
      />

      <Card className="items-center gap-2 text-center">
        <Label>Today’s session</Label>
        <ProgressRing
          value={session?.activeMs ?? 0}
          max={targetMs}
          label="Session time"
          valueText={`${Math.floor((session?.activeMs ?? 0) / 60_000)} of ${settings.targets.articulationMinutes} minutes`}
          size={120}
          stroke={6}
        >
          <p className="text-stat font-semibold tabular-nums">{formatClock(session?.activeMs ?? 0)}</p>
          <p className="text-caption text-subtle">of {settings.targets.articulationMinutes}:00</p>
        </ProgressRing>
        <p className="text-secondary text-muted">
          {!session
            ? 'Six short tasks, about 30 minutes. Time counts while a task is open.'
            : next
              ? `${doneCount} of 6 tasks done.`
              : 'All six tasks done for today.'}
        </p>
      </Card>

      <TodaysClip hasSession={!!session} sessionClip={session?.plan.clip} />

      <Card className="gap-0 py-2">
        {TASKS.map((t, i) => {
          const status = session?.tasks[t.id] ?? 'pending'
          const current = t.id === next && !!session
          const inner = (
            <>
              <span
                className={cx(
                  'grid size-8 flex-none place-items-center rounded-full text-sm font-semibold',
                  status === 'done' && 'bg-success-soft text-success',
                  status === 'skipped' && 'bg-raised text-subtle',
                  status === 'pending' && (current ? 'bg-primary text-on-primary' : 'bg-raised text-muted'),
                )}
              >
                {status === 'done' ? (
                  <>
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                    <span className="sr-only">Done:</span>
                  </>
                ) : status === 'skipped' ? (
                  <SkipForward size={14} strokeWidth={2} aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.title}</span>
                <span className="block text-caption text-subtle">
                  {status === 'skipped' ? 'Skipped' : `${t.summary} · ${t.minutes} min`}
                </span>
              </span>
              {session && <ChevronRight size={20} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />}
            </>
          )
          const row = 'flex min-h-14 items-center gap-3 border-t border-border py-3 first:border-t-0'
          return session ? (
            <Link key={t.id} to={`/speak/${t.id}`} aria-current={current ? 'step' : undefined} className={cx(row, '-mx-2 rounded-md px-2 hover:bg-raised active:bg-raised')}>
              {inner}
            </Link>
          ) : (
            <div key={t.id} className={row}>
              {inner}
            </div>
          )
        })}
        <div className="flex min-h-14 items-center gap-3 border-t border-border py-3 text-subtle">
          <span className="grid size-8 flex-none place-items-center rounded-full bg-raised">
            <Repeat size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Feedback and retry</span>
            <span className="block text-caption">Under each analysed answer: see feedback, then retry</span>
          </span>
        </div>
      </Card>

      {next && (
        <button type="button" onClick={() => void begin()} disabled={starting} className={buttonClass.primary}>
          {starting ? 'Preparing…' : !session ? 'Start today’s session' : `Continue with task ${TASKS.findIndex((t) => t.id === next) + 1}`}
        </button>
      )}
    </>
  )
}
