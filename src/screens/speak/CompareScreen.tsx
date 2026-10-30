import { Link, useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp, ChevronLeft, Minus } from 'lucide-react'
import { db, type SpeechAttempt } from '../../data/db'
import { setTaskStatus, TASKS, useAttempt } from '../../data/speech'
import { compareAttempts, type Direction } from '../../lib/compare'
import { AttemptPlayer } from '../../components/recording'
import { buttonClass, Card, cx, iconButtonClass, Label } from '../../components/ui'
import { NotFound } from '../Placeholder'

/** All analysed attempts at the same prompt, oldest first. */
export function useSiblingAttempts(attempt: SpeechAttempt | null | undefined) {
  return useLiveQuery(async () => {
    if (!attempt) return []
    const all = await db.speechAttempts.where('sessionId').equals(attempt.sessionId).toArray()
    return all
      .filter((a) => a.task === attempt.task && a.promptId === attempt.promptId && a.stage === attempt.stage && a.analysisStatus === 'done')
      .sort((a, b) => a.attemptNumber - b.attemptNumber)
  }, [attempt?.id, attempt?.analysisStatus])
}

const ICON: Record<Direction, typeof ArrowDown> = { improved: ArrowDown, worse: ArrowUp, same: Minus }

/** Attempt 1 vs the latest retry (CLAUDE.md §12). */
export default function CompareScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const attempt = useAttempt(Number(id))
  const siblings = useSiblingAttempts(attempt)
  const first = siblings?.[0]
  const latest = siblings?.at(-1)
  const recordings = useLiveQuery(async () => (first && latest ? await db.recordings.bulkGet([first.id!, latest.id!]) : []), [first?.id, latest?.id])

  if (attempt === undefined || siblings === undefined) return null
  if (attempt === null) return <NotFound />
  const task = TASKS.find((t) => t.id === attempt.task)!

  if (!first || !latest || first.id === latest.id)
    return (
      <>
        <Header back={`/speak/attempt/${attempt.id}`} task={task.title} />
        <Card>
          <p className="text-muted">The comparison appears once your retry has been analysed.</p>
        </Card>
      </>
    )

  const { rows, improved, needsWork, nextPriority } = compareAttempts(first, latest)

  return (
    <>
      <Header back={`/speak/attempt/${latest.id}`} task={task.title} />

      <Card>
        <Label>{attempt.task === 'words' ? 'Word' : 'Prompt'}</Label>
        <p className="font-medium">{attempt.prompt}</p>
      </Card>

      <Card>
        <table className="w-full border-collapse text-[15px]">
          <caption className="sr-only">
            Attempt {first.attemptNumber} compared with attempt {latest.attemptNumber}
          </caption>
          <thead>
            <tr className="text-caption text-subtle">
              <th scope="col" className="pb-2 text-left font-medium">
                Dimension
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {first.attemptNumber}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {latest.attemptNumber}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = ICON[r.direction]
              return (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="py-3 pr-2 text-left font-normal">
                    {r.label}
                  </th>
                  <td className="py-3 text-right tabular-nums">{r.first}</td>
                  <td className="py-3 pl-2 text-right tabular-nums">{r.second}</td>
                  <td
                    className={cx(
                      'py-3 pl-2 text-right text-caption font-medium whitespace-nowrap',
                      r.direction === 'improved' && 'text-success',
                      r.direction === 'worse' && 'text-danger',
                      r.direction === 'same' && 'text-subtle',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Icon size={13} strokeWidth={2} aria-hidden="true" />
                      {r.change}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-caption text-subtle">No overall score: each dimension is tracked on its own.</p>
      </Card>

      {recordings?.some(Boolean) ? (
        <Card>
          <Label>Listen back</Label>
          {recordings[0] && <AttemptPlayer blob={recordings[0].blob} durationMs={first.durationMs} label={`Attempt ${first.attemptNumber}`} />}
          {recordings[1] && <AttemptPlayer blob={recordings[1].blob} durationMs={latest.durationMs} label={`Attempt ${latest.attemptNumber}`} />}
        </Card>
      ) : (
        <p className="px-1 text-caption text-subtle">
          To replay both attempts here, turn on <Link to="/settings" className="underline underline-offset-2">Keep recordings on this device</Link>.
        </p>
      )}

      <Card>
        <Summary title="What improved" items={improved} empty="No dimension improved this time. That happens; the retry targets still apply." />
        <div className="divider h-px bg-border" />
        <Summary title="What still needs work" items={needsWork} empty="Nothing flagged on the retry." />
        <div className="h-px bg-border" />
        <div>
          <p className="text-caption font-semibold text-primary">Next priority</p>
          <p className="font-medium">{nextPriority}</p>
        </div>
      </Card>

      <button
        type="button"
        onClick={async () => {
          await setTaskStatus(attempt.sessionId, attempt.task, 'done')
          navigate('/speak')
        }}
        className={buttonClass.primary}
      >
        Continue session
      </button>
      <Link to={`/speak/attempt/${latest.id}`} className={cx(buttonClass.ghost, 'self-center text-sm')}>
        See feedback on attempt {latest.attemptNumber} and retry again
      </Link>
    </>
  )
}

function Header({ back, task }: { back: string; task: string }) {
  return (
    <header className="flex min-h-12 items-center gap-2">
      <Link to={back} aria-label="Back to feedback" className={iconButtonClass}>
        <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-subtle">{task}</p>
        <h1 className="text-title font-semibold">Attempt comparison</h1>
      </div>
    </header>
  )
}

function Summary({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="text-caption font-semibold text-primary">{title}</p>
      {items.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  )
}
