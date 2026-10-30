import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { SpeechAttempt } from '../data/db'
import { buttonClass, cx } from './ui'

/** Shown under an analysed answer: feedback status and the way into it. */
export function FeedbackLink({ attempt }: { attempt: SpeechAttempt }) {
  if (attempt.analysisStatus !== 'done') return null
  const ready = attempt.feedbackStatus === 'done'
  return (
    <Link to={`/speak/attempt/${attempt.id}`} className={cx(buttonClass.primary, 'w-full', !ready && 'opacity-80')}>
      {ready ? 'See feedback and retry' : 'Preparing feedback…'}
      <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
    </Link>
  )
}
