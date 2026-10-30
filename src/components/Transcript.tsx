import { Fragment } from 'react'
import { RefreshCw } from 'lucide-react'
import type { TranscriptWord } from '../lib/transcribe'
import { useAttempt } from '../data/speech'
import { transcribeAttempt } from '../data/transcription'
import { buttonClass, cx } from './ui'

/** Gaps between words at least this long are shown as pauses (silence is not an error, §5B). */
const PAUSE_SEC = 0.7
const LONG_PAUSE_SEC = 2
/**
 * Below this Azure accuracy a word is flagged as possibly hard to understand.
 * Deliberately low: accents are never treated as errors (§0.5, rule 11).
 */
const UNCLEAR_ACCURACY = 35

export function wordsPerMinute(words: TranscriptWord[]) {
  if (words.length < 2) return null
  const minutes = (words.at(-1)!.end - words[0].start) / 60
  return minutes > 0 ? Math.round(words.length / minutes) : null
}

/** Transcript with pause markers and gently flagged unclear words. */
export function TranscriptText({ words, highlightAt, className }: { words: TranscriptWord[]; highlightAt?: number; className?: string }) {
  return (
    <p className={cx('font-serif text-transcript', className)}>
      {words.map((w, i) => {
        const gap = i > 0 ? w.start - words[i - 1].end : 0
        const unclear = w.accuracy !== undefined && w.accuracy < UNCLEAR_ACCURACY
        const current = highlightAt !== undefined && highlightAt >= w.start && highlightAt < w.end + 0.05
        return (
          <Fragment key={i}>
            {gap >= PAUSE_SEC && (
              <span
                className={cx(
                  'mx-0.5 inline-flex h-[22px] items-center rounded-[6px] px-1.5 align-[2px] font-sans text-xs font-medium tabular-nums',
                  gap >= LONG_PAUSE_SEC ? 'bg-danger-soft text-danger' : 'bg-info-soft text-info',
                )}
                aria-label={`pause, ${gap.toFixed(1)} seconds`}
              >
                ‖ {gap.toFixed(1)}s
              </span>
            )}{' '}
            <span
              className={cx(
                current && 'rounded-[4px] bg-primary-soft',
                highlightAt !== undefined && !current && w.end <= highlightAt && 'text-text',
                highlightAt !== undefined && !current && w.start > highlightAt && 'text-muted',
                unclear && 'underline decoration-info decoration-dashed decoration-[1.5px] underline-offset-4',
              )}
              title={unclear ? 'This word may be hard to understand' : undefined}
            >
              {w.text}
            </span>
          </Fragment>
        )
      })}
    </p>
  )
}

/** Live transcription status and result for one saved attempt. */
export function AttemptTranscript({ attemptId }: { attemptId: number }) {
  const attempt = useAttempt(attemptId)
  if (!attempt) return null

  if (attempt.transcription === 'skipped') return null
  if (attempt.transcription === 'pending' || attempt.transcription === undefined)
    return (
      <p className="text-caption text-subtle" aria-live="polite">
        Transcribing…
      </p>
    )
  if (attempt.transcription === 'failed')
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="text-sm text-muted">{attempt.transcriptionError ?? 'Transcription failed.'}</p>
        <button type="button" onClick={() => void transcribeAttempt(attemptId)} className={cx(buttonClass.secondary, 'min-h-11 text-sm')}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          Try transcription again
        </button>
      </div>
    )

  const words = attempt.words ?? []
  const wpm = wordsPerMinute(words)
  const pauses = words.filter((w, i) => i > 0 && w.start - words[i - 1].end >= PAUSE_SEC).length
  const unclear = words.filter((w) => w.accuracy !== undefined && w.accuracy < UNCLEAR_ACCURACY).length

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="text-caption font-medium tracking-[0.06em] text-subtle uppercase">Transcript</p>
      {words.length ? <TranscriptText words={words} className="text-base" /> : <p className="text-muted">No speech was recognised in this recording.</p>}
      {words.length > 0 && (
        <div className="flex flex-wrap gap-2 text-caption">
          {wpm && <span className="rounded-sm bg-surface px-2 py-1 text-muted tabular-nums">{wpm} words/min</span>}
          <span className="rounded-sm bg-info-soft px-2 py-1 text-info tabular-nums">
            {pauses} {pauses === 1 ? 'pause' : 'pauses'}
          </span>
          {unclear > 0 && (
            <span className="rounded-sm bg-surface px-2 py-1 text-muted">
              {unclear} {unclear === 1 ? 'word' : 'words'} may be hard to understand
            </span>
          )}
        </div>
      )}
    </div>
  )
}
