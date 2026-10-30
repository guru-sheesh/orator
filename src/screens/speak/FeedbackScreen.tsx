import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, ExternalLink, Info, RefreshCw } from 'lucide-react'
import { db, type SpeechAttempt } from '../../data/db'
import { findTalk, requestFeedback } from '../../data/feedback'
import { TASKS, TIMING, useAttempt, useSession } from '../../data/speech'
import { AttemptTranscript } from '../../components/Transcript'
import { AttemptPlayer } from '../../components/recording'
import { PromptRecorder } from '../../components/PromptRecorder'
import { buttonClass, Card, cx, iconButtonClass, Label } from '../../components/ui'
import { NotFound } from '../Placeholder'
import { useSiblingAttempts } from './CompareScreen'

/** Coaching for one attempt, in the order of CLAUDE.md §10, then the retry. */
export default function FeedbackScreen() {
  const { id } = useParams()
  const attempt = useAttempt(Number(id))
  const session = useSession(attempt?.sessionId)
  const recording = useLiveQuery(async () => (attempt?.id ? ((await db.recordings.get(attempt.id)) ?? null) : null), [attempt?.id])
  const siblings = useSiblingAttempts(attempt)

  if (attempt === undefined) return null
  if (attempt === null) return <NotFound />
  const task = TASKS.find((t) => t.id === attempt.task)!

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to={`/speak/${attempt.task}`} aria-label={`Back to ${task.title}`} className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-subtle">
            {task.title} · Attempt {attempt.attemptNumber}
          </p>
          <h1 className="text-title font-semibold">Feedback</h1>
        </div>
      </header>

      <Card>
        <Label>{attempt.task === 'words' ? 'Your word' : 'Prompt'}</Label>
        <p className="font-medium">{attempt.prompt}</p>
        {recording && <AttemptPlayer blob={recording.blob} durationMs={attempt.durationMs} label="Your answer" />}
        <AttemptTranscript attemptId={attempt.id!} showFeedbackLink={false} />
      </Card>

      <Coaching attempt={attempt} />

      {session && attempt.feedbackStatus === 'done' && (
        <Card>
          <Label>Retry</Label>
          <p className="text-sm text-muted">Answer the same prompt again, applying the retry targets above.</p>
          <PromptRecorder
            session={session}
            task={attempt.task}
            promptId={attempt.promptId}
            prompt={attempt.prompt}
            stage={attempt.stage}
            prepSec={TIMING[attempt.task].prepSec}
            maxSec={TIMING[attempt.task].maxSec}
            startLabel="Start retry"
          />
        </Card>
      )}

      {siblings && siblings.length > 1 && (
        <Link to={`/speak/compare/${attempt.id}`} className={buttonClass.primary}>
          Compare attempt {siblings[0].attemptNumber} with {siblings.at(-1)!.attemptNumber}
          <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
        </Link>
      )}
    </>
  )
}

function Coaching({ attempt }: { attempt: SpeechAttempt }) {
  const fb = attempt.feedback
  const talk = useLiveQuery(() => findTalk(fb?.talkId), [fb?.talkId])

  if (attempt.analysisStatus !== 'done')
    return <p className="text-sm text-muted">Feedback follows once the analysis above is ready.</p>
  if (attempt.feedbackStatus === 'pending' || attempt.feedbackStatus === undefined) return <p className="text-sm text-muted" aria-live="polite">Preparing your feedback…</p>
  if (attempt.feedbackStatus === 'failed' || !fb)
    return (
      <Card>
        <p className="text-sm text-muted">{attempt.feedbackError ?? 'Feedback couldn’t be generated.'}</p>
        <button type="button" onClick={() => void requestFeedback(attempt.id!)} className={cx(buttonClass.secondary, 'min-h-11 text-sm')}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          Try again
        </button>
      </Card>
    )

  return (
    <>
      <Step n={1} title="What you did well">
        <Bullets items={fb.wentWell} />
      </Step>

      <Step n={2} title="What went wrong">
        <ul className="flex flex-col gap-2">
          {fb.wentWrong.map((w, i) => (
            <li key={i}>
              <p className="font-medium">{w.title}</p>
              <p className="text-sm text-muted">{w.evidence}</p>
            </li>
          ))}
        </ul>
      </Step>

      <Step n={3} title="Why it weakened the answer">
        <p className="text-muted">{fb.whyItWeakened}</p>
      </Step>

      <Step n={4} title="How you could have handled it">
        <p className="text-sm">
          <span className="font-medium">Structure: </span>
          <span className="text-muted">{fb.howToStructure}</span>
        </p>
        <p className="text-sm">
          <span className="font-medium">Delivery: </span>
          <span className="text-muted">{fb.howToDeliver}</span>
        </p>
        <div className="flex flex-col gap-2 rounded-md bg-raised px-4 py-3.5">
          <p className="text-caption font-medium tracking-[0.06em] text-subtle uppercase">Example answer (AI-written)</p>
          <p className="font-serif text-base leading-relaxed">{fb.exampleAnswer}</p>
          <p className="text-caption text-subtle">Built from your own ideas to show the structure. Not a quotation from anyone.</p>
        </div>
      </Step>

      <Step n={5} title="Watch this">
        {talk ? (
          <a href={talk.url} target="_blank" rel="noreferrer" className="flex flex-col gap-1 rounded-md border-l-[3px] border-primary bg-raised px-4 py-3 hover:bg-surface">
            <span className="flex items-center gap-1.5 font-medium">
              {talk.title}
              <ExternalLink size={14} strokeWidth={1.75} className="flex-none text-subtle" aria-hidden="true" />
            </span>
            <span className="text-caption text-subtle">{talk.speaker}</span>
            <span className="text-sm text-muted">{fb.talkReason || talk.notice}</span>
          </a>
        ) : (
          <p className="flex gap-2 rounded-md bg-info-soft px-3 py-2.5 text-sm">
            <Info size={18} strokeWidth={1.75} className="mt-0.5 flex-none text-info" aria-hidden="true" />
            <span>
              No talk in your list matches this yet.{' '}
              <Link to="/speak/talks" className="underline underline-offset-2">
                Add one you like
              </Link>
              .
            </span>
          </p>
        )}
      </Step>

      <Step n={6} title="Retry targets">
        <ol className="flex flex-col gap-2.5">
          {fb.retryTargets.map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-7 flex-none place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
      </Step>
    </>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="text-caption font-semibold text-primary">
        {n} · {title}
      </h2>
      {children}
    </Card>
  )
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
)

/** Shown under an analysed answer: feedback status and the way into it. */
export function FeedbackLink({ attempt }: { attempt: SpeechAttempt }) {
  if (attempt.analysisStatus !== 'done') return null
  const ready = attempt.feedbackStatus === 'done'
  return (
    <Link to={`/speak/attempt/${attempt.id}`} className={cx(buttonClass.primary, 'w-full', !ready && 'opacity-80')}>
      {ready ? 'See feedback and retry' : 'Preparing feedback…'}
      <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
    </Link>
  )
}
