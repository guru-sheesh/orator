import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ShadowStage, SpeechSession, TaskId } from '../data/db'
import { saveAttempt } from '../data/speech'
import { useRecorder } from '../hooks/useRecorder'
import { AttemptPlayer, Countdown, formatClock, LevelMeter, RecordButton } from './recording'
import { AttemptTranscript } from './Transcript'
import { buttonClass, cx } from './ui'

type Phase = 'ready' | 'prep' | 'recording' | 'done'

/**
 * The standard "prepare → record → listen back" block used by every task.
 * Each finished recording is saved as a SpeechAttempt.
 */
export function PromptRecorder({
  session,
  task,
  promptId,
  prompt,
  stage,
  prepSec,
  maxSec,
  startLabel = 'Start',
  onRecordingStart,
  onRecordingEnd,
  onSaved,
}: {
  session: SpeechSession
  task: TaskId
  promptId: string
  prompt: string
  stage?: ShadowStage
  prepSec: number
  maxSec: number
  startLabel?: string
  onRecordingStart?: () => void
  onRecordingEnd?: () => void
  onSaved?: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [last, setLast] = useState<{ blob: Blob; durationMs: number } | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [attemptId, setAttemptId] = useState<number | null>(null)
  // The control the user pressed disappears between phases; move focus to what replaced it.
  const resultRef = useRef<HTMLDivElement>(null)
  const prepRef = useRef<HTMLDivElement>(null)
  const recordRef = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    const target = phase === 'done' ? resultRef.current : phase === 'prep' ? prepRef.current : recordRef.current?.querySelector('button')
    target?.focus()
  }, [phase])
  const go = (next: Phase) => {
    moved.current = true
    setPhase(next)
  }

  const rec = useRecorder({
    maxMs: maxSec * 1000,
    onComplete: async (result) => {
      onRecordingEnd?.()
      setLast({ blob: result.blob, durationMs: result.durationMs })
      go('done')
      try {
        setAttemptId(await saveAttempt({ session, task, promptId, prompt, stage, ...result }))
        setSaveError(false)
        onSaved?.()
      } catch {
        setSaveError(true)
      }
    },
  })

  async function begin() {
    if (prepSec > 0) {
      // Open the mic on this tap (iOS needs a gesture), then count down.
      if (await rec.prepare()) go('prep')
    } else {
      await record()
    }
  }

  async function record() {
    // If the microphone fails, stay put (and don't start a shadowing clip).
    if (!(await rec.start())) {
      setPhase('ready')
      return
    }
    setPhase('recording')
    onRecordingStart?.()
  }

  const recording = rec.state === 'recording'

  return (
    <div className="flex flex-col items-center gap-2">
      {phase === 'prep' && (
        <div ref={prepRef} tabIndex={-1} className="outline-none">
          <p role="status" className="sr-only">
            Prepare. Recording starts automatically in {prepSec} seconds.
          </p>
          <Countdown seconds={prepSec} onDone={() => void record()} />
        </div>
      )}

      {(phase === 'recording' || phase === 'ready') && (
        <>
          <p className={cx('text-display font-semibold tabular-nums', !recording && 'text-subtle')}>
            {formatClock(rec.elapsedMs)} <span className="text-title font-medium text-subtle">/ {formatClock(maxSec * 1000)}</span>
          </p>
          <LevelMeter levelRef={rec.levelRef} active={recording} />
        </>
      )}

      {phase !== 'prep' && phase !== 'done' && (
        <div ref={recordRef} className="contents">
        <RecordButton
          state={rec.state === 'error' ? 'idle' : rec.state}
          onStart={() => void begin()}
          onStop={() => void rec.stop()}
          idleLabel={prepSec > 0 ? `${startLabel} · ${prepSec} s to prepare` : startLabel}
        />
        </div>
      )}

      {phase === 'done' && last && (
        <div ref={resultRef} tabIndex={-1} aria-label="Your recording" role="group" className="flex w-full flex-col gap-3 rounded-md bg-raised p-4 outline-none focus-visible:outline-2 focus-visible:outline-focus">
          <AttemptPlayer blob={last.blob} durationMs={last.durationMs} label="Your answer" />
          {attemptId !== null && <AttemptTranscript attemptId={attemptId} />}
          <p className="text-caption text-subtle">
            {saveError ? 'This recording couldn’t be saved, but you can still play it here.' : 'Saved.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setLast(null)
              setAttemptId(null)
              go('ready')
            }}
            className={cx(buttonClass.secondary, 'min-h-11 text-sm')}
          >
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
            Record again
          </button>
        </div>
      )}

      {rec.error && (
        <p role="alert" className="text-center text-sm text-danger">
          {rec.error}
        </p>
      )}
    </div>
  )
}
