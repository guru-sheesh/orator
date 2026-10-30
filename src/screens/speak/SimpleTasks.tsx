import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAttempts, IMPROMPTU, QUESTIONS, STRUCTURE_STEPS, TIMING, WORDS } from '../../data/speech'
import { PromptRecorder } from '../../components/PromptRecorder'
import { buttonClass, Card, Label } from '../../components/ui'
import type { TaskProps } from './TaskScreen'

const AI_LABEL = 'AI-generated practice material'

/** Steps through several prompts, one recording each, then finishes the task. */
function Sequence({
  session,
  finish,
  task,
  items,
  render,
}: TaskProps & {
  task: 'words' | 'questions'
  items: { id: string; prompt: string }[]
  render: (item: { id: string; prompt: string }) => ReactNode
}) {
  const attempts = useAttempts(session.id, task)
  const recorded = new Set(attempts?.map((a) => a.promptId))
  const firstOpen = items.findIndex((i) => !recorded.has(i.id))
  const [index, setIndex] = useState(firstOpen < 0 ? 0 : firstOpen)
  const item = items[index]
  const last = index === items.length - 1
  if (!attempts || !item) return null

  return (
    <>
      <p className="text-caption text-subtle" aria-live="polite">
        {index + 1} of {items.length}
      </p>
      <Card>{render(item)}</Card>
      <PromptRecorder key={item.id} session={session} task={task} promptId={item.id} prompt={item.prompt} prepSec={TIMING[task].prepSec} maxSec={TIMING[task].maxSec} />
      {recorded.has(item.id) && (
        <button type="button" onClick={() => (last ? finish() : setIndex(index + 1))} className={buttonClass.primary}>
          {last ? 'Finish task' : 'Next'}
        </button>
      )}
    </>
  )
}

export function WordsTask(props: TaskProps) {
  const items = props.session.plan.words.map((id) => WORDS.find((w) => w.id === id)!).filter(Boolean)
  return (
    <Sequence
      {...props}
      task="words"
      items={items.map((w) => ({ id: w.id, prompt: w.word }))}
      render={(item) => (
        <>
          <Label>Describe this word without saying it</Label>
          <p className="text-[34px] leading-tight font-semibold">{item.prompt}</p>
          <p className="text-sm text-muted">If a better word won’t come, describe around it and keep talking.</p>
          <p className="text-caption text-subtle">{AI_LABEL}</p>
        </>
      )}
    />
  )
}

export function QuestionsTask(props: TaskProps) {
  const items = props.session.plan.questions.map((id) => QUESTIONS.find((q) => q.id === id)!).filter(Boolean)
  return (
    <Sequence
      {...props}
      task="questions"
      items={items.map((q) => ({ id: q.id, prompt: q.text }))}
      render={(item) => (
        <>
          <Label>Answer without notes</Label>
          <p className="text-title font-medium">{item.prompt}</p>
          <p className="text-sm text-muted">Optional structure: Point → Reason → Example → Conclusion.</p>
          <p className="text-caption text-subtle">{AI_LABEL}</p>
        </>
      )}
    />
  )
}

export function ImpromptuTask({ session, finish }: TaskProps) {
  const q = IMPROMPTU.find((i) => i.id === session.plan.impromptu)
  const attempts = useAttempts(session.id, 'impromptu')
  if (!q || !attempts) return null
  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-2">
          <Label>Your question</Label>
          <span className="rounded-sm bg-raised px-2 py-1 text-caption font-medium text-muted capitalize">{q.type}</span>
        </div>
        <p className="text-title font-medium">{q.text}</p>
        <div className="border-t border-border pt-3">
          <p className="text-caption text-subtle">Suggested structure</p>
          <p className="text-[15px] text-muted">{STRUCTURE_STEPS[q.structure].join(' → ')}</p>
        </div>
        <p className="text-caption text-subtle">{AI_LABEL}</p>
      </Card>
      <PromptRecorder session={session} task="impromptu" promptId={q.id} prompt={q.text} prepSec={TIMING.impromptu.prepSec} maxSec={TIMING.impromptu.maxSec} />
      {attempts.length > 0 && (
        <button type="button" onClick={finish} className={buttonClass.primary}>
          Finish task
        </button>
      )}
    </>
  )
}

export function ParaphraseTask({ session, finish }: TaskProps) {
  const attempts = useAttempts(session.id, 'paraphrase')
  const shadow = session.plan.shadow
  if (!attempts) return null
  if (!shadow)
    return (
      <Card>
        <p className="font-semibold">This task follows shadowing</p>
        <p className="text-muted">You paraphrase the speech you just shadowed. Import a recording and do Task 3 first, or skip this task today.</p>
        <Link to="/speak/shadowing" className={buttonClass.secondary}>
          Go to shadowing
        </Link>
      </Card>
    )

  const promptId = `${shadow.sourceId}:${shadow.segment}`
  return (
    <>
      <Card>
        <Label>Paraphrase the speaker</Label>
        <p className="text-title font-medium">Explain the speaker’s central message in your own words.</p>
        <ul className="list-disc pl-5 text-[15px] text-muted">
          <li>Keep the main message; leave out minor details.</li>
          <li>Don’t repeat their exact wording.</li>
          <li>Organise it so someone who didn’t hear it would understand.</li>
        </ul>
      </Card>
      <PromptRecorder
        session={session}
        task="paraphrase"
        promptId={promptId}
        prompt="Explain the speaker’s central message in your own words."
        prepSec={TIMING.paraphrase.prepSec}
        maxSec={TIMING.paraphrase.maxSec}
      />
      {attempts.length > 0 && (
        <button type="button" onClick={finish} className={buttonClass.primary}>
          Finish task
        </button>
      )}
    </>
  )
}
