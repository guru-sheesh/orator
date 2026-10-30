import type { ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import type { SpeechSession, TaskId } from '../../data/db'
import { nextPendingTask, setTaskStatus, TASKS, useTodaySession } from '../../data/speech'
import { useActiveTime } from '../../hooks/useActiveTime'
import { formatClock } from '../../components/recording'
import { buttonClass, cx, iconButtonClass } from '../../components/ui'
import { ImpromptuTask, ParaphraseTask, QuestionsTask, WordsTask } from './SimpleTasks'
import { ShadowTask } from './ShadowTask'
import { ExplainTask } from './ExplainTask'

export interface TaskProps {
  session: SpeechSession
  /** Marks the task done and moves to the next pending one. */
  finish: () => void
}

export default function TaskScreen() {
  const { task } = useParams()
  const session = useTodaySession()
  useActiveTime(session?.id)

  const meta = TASKS.find((t) => t.id === task)
  if (!meta) return <Navigate to="/speak" replace />
  if (session === undefined) return null
  if (session === null) return <Navigate to="/speak" replace />
  return <TaskBody key={meta.id} session={session} taskId={meta.id} />
}

function TaskBody({ session, taskId }: { session: SpeechSession; taskId: TaskId }) {
  const navigate = useNavigate()
  const index = TASKS.findIndex((t) => t.id === taskId)
  const meta = TASKS[index]
  const status = session.tasks[taskId]

  async function complete(next: 'done' | 'skipped') {
    await setTaskStatus(session.id!, taskId, next)
    // Move forward through the session, wrapping round to anything skipped past earlier.
    const tasks = { ...session.tasks, [taskId]: next }
    const after = TASKS.slice(index + 1).find((t) => tasks[t.id] === 'pending')?.id ?? nextPendingTask({ ...session, tasks })
    navigate(after ? `/speak/${after}` : '/speak', { replace: true })
  }

  const props: TaskProps = { session, finish: () => void complete('done') }
  const body: Record<TaskId, ReactNode> = {
    words: <WordsTask {...props} />,
    questions: <QuestionsTask {...props} />,
    shadowing: <ShadowTask {...props} />,
    paraphrase: <ParaphraseTask {...props} />,
    explain: <ExplainTask {...props} />,
    impromptu: <ImpromptuTask {...props} />,
  }

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/speak" aria-label="Back to session" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-caption text-subtle">Task {index + 1} of 6</p>
          <h1 className="truncate text-title font-semibold">{meta.title}</h1>
        </div>
        <span className="rounded-sm bg-raised px-2.5 py-1 text-caption font-medium text-muted tabular-nums" title="Session time today">
          {formatClock(session.activeMs)}
        </span>
      </header>

      {status !== 'pending' && (
        <p className="rounded-md bg-raised px-4 py-3 text-sm text-muted">
          {status === 'done' ? 'You’ve completed this task today. You can practise it again.' : 'You skipped this task. You can still do it now.'}
        </p>
      )}

      {body[taskId]}

      {status === 'pending' && (
        <button type="button" onClick={() => void complete('skipped')} className={cx(buttonClass.ghost, 'self-center text-sm text-muted')}>
          Skip this task today
        </button>
      )}
    </>
  )
}
