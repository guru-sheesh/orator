import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AudioLines, Check, ChevronRight, Library, MonitorPlay, Repeat, SkipForward } from 'lucide-react'
import { useSettings } from '../../data/daily'
import { nextPendingTask, startSession, TASKS, useLatestFeedbackAttempt, useTodaySession } from '../../data/speech'
import { formatClock } from '../../components/recording'
import { useTodaysClip } from '../../data/clips'
import { useToday } from '../../hooks/useToday'
import { useOnline } from '../../hooks/useOnline'
import { buttonClass, Card, cx, iconButtonClass, PageHeader } from '../../components/ui'

/** Today's built-in clip, shown (and downloaded) before the session starts. */
function TodaysClip({ hasSession, sessionClip }: { hasSession: boolean; sessionClip: string | undefined }) {
  const today = useToday()
  const todays = useTodaysClip(today, sessionClip)
  const online = useOnline()
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
    <section aria-label="Today’s clip" className="flex items-center gap-4 rounded-lg border border-border/70 bg-surface px-5 py-4">
      <span className="grid size-11 flex-none place-items-center rounded-full bg-primary-soft text-primary">
        <AudioLines size={20} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-subtle">Today’s speaker</p>
        <p className="line-clamp-2 font-serif text-[1.1875rem] leading-snug">{clip.speaker}</p>
        <p className="truncate text-caption text-subtle">
          {clip.title} · part {clip.index} of {clip.of} · {formatClock(clip.durationSec * 1000)}
        </p>
        <p className="mt-1 text-caption text-subtle" role="status">
          {ready ? 'On this phone, plays offline' : online ? 'Downloading…' : 'Not on this phone yet. It downloads when you reconnect.'}
        </p>
      </div>
      <button type="button" onClick={() => void listen()} disabled={opening} aria-label={`Go to shadowing with ${clip.speaker}`} className={cx(iconButtonClass, 'bg-raised text-text')}>
        <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </section>
  )
}

export default function SpeakHome() {
  const session = useTodaySession()
  const settings = useSettings()
  const navigate = useNavigate()
  const [starting, setStarting] = useState(false)
  const feedbackAttempt = useLatestFeedbackAttempt(session?.id)

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

      <section aria-label="Today’s session" className="flex flex-col gap-4 pt-1">
        <div className="flex items-end justify-between gap-3">
          <p
            role="progressbar"
            aria-label="Session time"
            aria-valuemin={0}
            aria-valuemax={targetMs}
            aria-valuenow={Math.min(session?.activeMs ?? 0, targetMs)}
            aria-valuetext={`${Math.floor((session?.activeMs ?? 0) / 60_000)} of ${settings.targets.articulationMinutes} minutes`}
            className="text-[3.25rem] leading-none font-semibold tracking-[-0.02em] tabular-nums"
          >
            <Clock ms={session?.activeMs ?? 0} />
            <span className="ml-2 text-title font-normal text-subtle">of {settings.targets.articulationMinutes} min</span>
          </p>
          <p className="pb-1 text-sm text-muted">{session ? `${doneCount} of 6 tasks` : '6 tasks'}</p>
        </div>
        <ol aria-hidden="true" className="grid grid-cols-6 gap-1.5">
          {TASKS.map((t) => {
            const status = session?.tasks[t.id] ?? 'pending'
            return (
              <li
                key={t.id}
                className={cx(
                  'h-1.5 rounded-pill',
                  status === 'done' ? 'bg-success' : status === 'skipped' ? 'bg-border-strong' : t.id === next && session ? 'bg-primary' : 'bg-raised',
                )}
              />
            )
          })}
        </ol>
        <p className="text-secondary text-muted">
          {!session
            ? 'Six short tasks, about 30 minutes. Time counts while a task is open.'
            : next
              ? `Next: ${TASKS.find((t) => t.id === next)!.title.toLowerCase()}.`
              : 'All six tasks done for today. Retry any answer from its feedback.'}
        </p>
        {next && (
          <button type="button" onClick={() => void begin()} disabled={starting} className={buttonClass.primary}>
            {starting ? 'Preparing…' : !session ? 'Start today’s session' : `Continue with task ${TASKS.findIndex((t) => t.id === next) + 1}`}
          </button>
        )}
      </section>

      <TodaysClip hasSession={!!session} sessionClip={session?.plan.clip} />

      <Card className="gap-0 py-2" aria-label="Tasks">
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
        {(() => {
          const inner = (
            <>
              <span className="grid size-8 flex-none place-items-center rounded-full bg-raised">
                <Repeat size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Feedback and retry</span>
                <span className="block text-caption">
                  {feedbackAttempt ? 'Open your latest answer: feedback, then retry' : 'Appears here once you’ve recorded an answer'}
                </span>
              </span>
              {feedbackAttempt && <ChevronRight size={20} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />}
            </>
          )
          const row = 'flex min-h-14 items-center gap-3 border-t border-border py-3'
          return feedbackAttempt ? (
            <Link to={`/speak/attempt/${feedbackAttempt.id}`} className={cx(row, '-mx-2 rounded-md px-2 hover:bg-raised active:bg-raised')}>
              {inner}
            </Link>
          ) : (
            <div className={cx(row, 'text-subtle')}>{inner}</div>
          )
        })()}
      </Card>

    </>
  )
}

/** Big session clock; the colon is tightened so tabular digits don't leave gaps. */
function Clock({ ms }: { ms: number }) {
  const [m, sec] = formatClock(ms).split(':')
  return (
    <>
      {m}
      <span className="mx-[-0.06em] inline-block -translate-y-[0.06em]">:</span>
      {sec}
    </>
  )
}
