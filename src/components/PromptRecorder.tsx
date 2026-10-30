import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ShadowStage, SpeechSession, TaskId } from '../data/db'
import { saveAttempt } from '../data/speech'
import { useRecorder } from '../hooks/useRecorder'
import { AttemptPlayer, Countdown, formatClock, LevelMeter, RecordButton } from './recording'
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

  const rec = useRecorder({
    maxMs: maxSec * 1000,
    onComplete: async (result) => {
      onRecordingEnd?.()
      setLast({ blob: result.blob, durationMs: result.durationMs })
      setPhase('done')
      try {
        await saveAttempt({ session, task, promptId, prompt, stage, ...result })
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
      if (await rec.prepare()) setPhase('prep')
    } else {
      await record()
    }
  }

  async function record() {
    await rec.start()
    setPhase('recording')
    onRecordingStart?.()
  }

  const recording = rec.state === 'recording'

  return (
    <div className="flex flex-col items-center gap-2">
      {phase === 'prep' && <Countdown seconds={prepSec} onDone={() => void record()} />}

      {(phase === 'recording' || phase === 'ready') && (
        <>
          <p className={cx('text-display font-semibold tabular-nums', !recording && 'text-subtle')}>
            {formatClock(rec.elapsedMs)} <span className="text-title font-medium text-subtle">/ {formatClock(maxSec * 1000)}</span>
          </p>
          <LevelMeter levelRef={rec.levelRef} active={recording} />
        </>
      )}

      {phase !== 'prep' && phase !== 'done' && (
        <RecordButton
          state={rec.state === 'error' ? 'idle' : rec.state}
          onStart={() => void begin()}
          onStop={() => void rec.stop()}
          idleLabel={prepSec > 0 ? `${startLabel} · ${prepSec} s to prepare` : startLabel}
        />
      )}

      {phase === 'done' && last && (
        <div className="flex w-full flex-col gap-3 rounded-md bg-raised p-4">
          <AttemptPlayer blob={last.blob} durationMs={last.durationMs} label="Your answer" />
          <p className="text-caption text-subtle">
            {saveError ? 'This recording couldn’t be saved, but you can still play it here.' : 'Saved. Transcript and feedback arrive in a later update.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setLast(null)
              setPhase('ready')
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
