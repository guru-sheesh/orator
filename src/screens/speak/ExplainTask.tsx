import { useEffect, useRef, useState } from 'react'
import { ExternalLink, EyeOff } from 'lucide-react'
import { loadPassages, TIMING, useAttempts, type Passage } from '../../data/speech'
import { PromptRecorder } from '../../components/PromptRecorder'
import { buttonClass, Card, Label } from '../../components/ui'
import type { TaskProps } from './TaskScreen'

type Phase = 'reading' | 'explaining' | 'review'

export function ExplainTask({ session, finish }: TaskProps) {
  const [passage, setPassage] = useState<Passage | null>()
  const [phase, setPhase] = useState<Phase>('reading')
  const attempts = useAttempts(session.id, 'explain')
  const explainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (phase === 'explaining') explainRef.current?.focus()
  }, [phase])

  useEffect(() => {
    let cancelled = false
    loadPassages()
      .then((all) => {
        if (!cancelled) setPassage(all.find((p) => p.id === session.plan.passage) ?? all[0] ?? null)
      })
      .catch(() => !cancelled && setPassage(null))
    return () => {
      cancelled = true
    }
  }, [session.plan.passage])

  if (passage === undefined || !attempts) return <p className="text-muted">Loading passage…</p>
  if (passage === null)
    return (
      <Card>
        <p className="font-semibold">The passage couldn’t load</p>
        <p className="text-muted">Connect to the internet once so the passages can be saved to your phone, then reopen this task.</p>
      </Card>
    )

  return (
    <>
      {phase === 'reading' && (
        <>
          <Card>
            <Label>Read once</Label>
            <h2 className="text-title font-semibold">{passage.title}</h2>
            <div className="flex flex-col gap-3 font-serif text-transcript">
              {passage.text.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            <SourceLine passage={passage} />
          </Card>
          <button type="button" onClick={() => setPhase('explaining')} className={buttonClass.primary}>
            <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" />
            Done reading
          </button>
        </>
      )}

      {phase !== 'reading' && (
        <Card ref={explainRef} tabIndex={-1} className="outline-none">
          <Label>Explain what you understood</Label>
          <p className="text-title font-medium">{passage.title}</p>
          <p className="text-secondary text-muted">What is it? → How does it work? → Why does it matter? → What is an example?</p>
          <p className="text-caption text-subtle">Explain it, don’t recite it. The passage stays hidden until you’ve recorded.</p>
        </Card>
      )}

      {phase !== 'reading' && (
        <PromptRecorder
          session={session}
          task="explain"
          promptId={passage.id}
          prompt={`Explain: ${passage.title}`}
          prepSec={TIMING.explain.prepSec}
          maxSec={TIMING.explain.maxSec}
          onSaved={() => setPhase('review')}
        />
      )}

      {phase === 'review' && (
        <>
          <details className="rounded-lg bg-surface px-5 py-4 light:border light:border-border">
            <summary className="min-h-11 cursor-pointer content-center font-medium">Compare with the passage</summary>
            <div className="mt-2 flex flex-col gap-3 font-serif text-transcript">
              {passage.text.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            <SourceLine passage={passage} />
          </details>
          <button type="button" onClick={finish} className={buttonClass.primary}>
            Finish task
          </button>
        </>
      )}
    </>
  )
}

function SourceLine({ passage }: { passage: Passage }) {
  return (
    <p className="mt-2 text-caption text-subtle">
      Source: Wikipedia,{' '}
      <a href={passage.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-text">
        {passage.title}
        <span className="sr-only"> (opens in a new tab)</span>
        <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
      </a>{' '}
      (CC BY-SA 4.0). Excerpt, trimmed.
    </p>
  )
}
