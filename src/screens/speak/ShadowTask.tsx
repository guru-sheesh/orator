import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Headphones, Info } from 'lucide-react'
import { db, type ShadowStage } from '../../data/db'
import { assignShadow, TIMING, useAttempts } from '../../data/speech'
import { splitPhrases } from '../../lib/audioAnalysis'
import { ClipPlayer, type ClipPlayerHandle } from '../../components/ClipPlayer'
import { PromptRecorder } from '../../components/PromptRecorder'
import { buttonClass, Card, Label, Segmented } from '../../components/ui'
import type { TaskProps } from './TaskScreen'

type Stage = 'listen' | ShadowStage

const STAGES: { value: Stage; label: string }[] = [
  { value: 'listen', label: 'Listen' },
  { value: 'repeat', label: 'Repeat' },
  { value: 'shadow', label: 'Shadow' },
  { value: 'deliver', label: 'Deliver' },
]

export function ShadowTask({ session, finish }: TaskProps) {
  const plan = session.plan.shadow
  const sourceCount = useLiveQuery(() => db.shadowSources.count())
  const source = useLiveQuery(async () => (plan ? ((await db.shadowSources.get(plan.sourceId)) ?? null) : null), [plan?.sourceId])
  const audio = useLiveQuery(async () => (plan ? ((await db.shadowAudio.get(plan.sourceId)) ?? null) : null), [plan?.sourceId])

  if (sourceCount === undefined || source === undefined || audio === undefined) return null

  if (!plan || !source || !audio) {
    return (
      <Card>
        <p className="font-semibold">{sourceCount ? 'Choose today’s clip' : 'Import a speech to shadow'}</p>
        <p className="text-muted">
          {sourceCount
            ? 'Your audio was added after today’s session started.'
            : 'Use a recording of a speaker you admire: an MP3, M4A or WAV file on your phone. It stays on this device and is split into one-minute clips.'}
        </p>
        {sourceCount ? (
          <button type="button" onClick={() => void assignShadow(session.id!)} className={buttonClass.primary}>
            Use the next clip
          </button>
        ) : (
          <Link to="/speak/library/new" className={buttonClass.primary}>
            Import audio
          </Link>
        )}
      </Card>
    )
  }

  const segment = source.segments[plan.segment] ?? source.segments[0]
  return <ShadowStages session={session} finish={finish} title={source.title} speaker={source.speaker} blob={audio.blob} envelope={source.envelope} segment={segment} segmentLabel={`Clip ${plan.segment + 1} of ${source.segments.length}`} />
}

function ShadowStages({
  session,
  finish,
  title,
  speaker,
  blob,
  envelope,
  segment,
  segmentLabel,
}: TaskProps & { title: string; speaker: string; blob: Blob; envelope: Uint8Array; segment: { start: number; end: number }; segmentLabel: string }) {
  const [stage, setStage] = useState<Stage>('listen')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const player = useRef<ClipPlayerHandle>(null)
  const phrases = useMemo(() => splitPhrases(envelope, segment), [envelope, segment])
  const attempts = useAttempts(session.id, 'shadowing')
  const baseId = `${session.plan.shadow!.sourceId}:${session.plan.shadow!.segment}`
  const delivered = attempts?.some((a) => a.stage === 'deliver')
  const clipSec = segment.end - segment.start
  const phrase = phrases[Math.min(phraseIndex, phrases.length - 1)]

  return (
    <>
      <Segmented label="Stage" options={STAGES} value={stage} onChange={setStage} />

      <Card>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-caption text-subtle">{[speaker, segmentLabel].filter(Boolean).join(' · ')}</p>
        </div>

        {stage === 'listen' && (
          <>
            <ClipPlayer blob={blob} envelope={envelope} range={segment} label="Clip" />
            <p className="text-sm text-muted">Listen without speaking. Notice the pauses, which words are stressed, and where the pace changes.</p>
          </>
        )}

        {stage === 'repeat' && phrase && (
          <>
            <Label aria-live="polite">
              Phrase {phraseIndex + 1} of {phrases.length}
            </Label>
            <ClipPlayer blob={blob} envelope={envelope} range={phrase} label={`Phrase ${phraseIndex + 1}`} />
            <p className="text-sm text-muted">Play the phrase, then record yourself repeating it with the same rhythm and pauses.</p>
          </>
        )}

        {stage === 'shadow' && (
          <>
            <ClipPlayer ref={player} blob={blob} envelope={envelope} range={segment} label="Clip" hideControls />
            <p className="flex gap-2 text-sm text-muted">
              <Headphones size={18} strokeWidth={1.75} className="mt-0.5 flex-none text-info" aria-hidden="true" />
              Use headphones. Recording starts the clip; speak along almost at the same time, copying timing and emphasis.
            </p>
          </>
        )}

        {stage === 'deliver' && (
          <p className="text-sm text-muted">The audio is off now. Deliver the passage yourself, keeping the rhythm and pauses you practised. A transcript to read from arrives with transcription.</p>
        )}

        <p className="flex gap-2 text-caption text-subtle">
          <Info size={14} strokeWidth={1.75} className="mt-0.5 flex-none" aria-hidden="true" />
          Copy the rhythm and timing, not the speaker’s accent.
        </p>
      </Card>

      {stage === 'repeat' && phrase && (
        <>
          <PromptRecorder
            key={`repeat-${phraseIndex}`}
            session={session}
            task="shadowing"
            stage="repeat"
            promptId={`${baseId}:p${phraseIndex}`}
            prompt={`Repeat phrase ${phraseIndex + 1}`}
            prepSec={0}
            maxSec={Math.ceil(phrase.end - phrase.start) + 8}
          />
          <button
            type="button"
            onClick={() => (phraseIndex < phrases.length - 1 ? setPhraseIndex(phraseIndex + 1) : setStage('shadow'))}
            className={buttonClass.secondary}
          >
            {phraseIndex < phrases.length - 1 ? 'Next phrase' : 'Go to Shadow'}
          </button>
        </>
      )}

      {stage === 'shadow' && (
        <PromptRecorder
          session={session}
          task="shadowing"
          stage="shadow"
          promptId={baseId}
          prompt="Shadow the clip"
          prepSec={0}
          maxSec={Math.ceil(clipSec) + 2}
          startLabel="Start clip and record"
          onRecordingStart={() => player.current?.play()}
          onRecordingEnd={() => player.current?.pause()}
        />
      )}

      {stage === 'deliver' && (
        <PromptRecorder session={session} task="shadowing" stage="deliver" promptId={baseId} prompt="Deliver the clip independently" prepSec={0} maxSec={Math.max(TIMING.shadowing.maxSec, Math.ceil(clipSec * 1.5))} />
      )}

      {stage === 'listen' && (
        <button type="button" onClick={() => setStage('repeat')} className={buttonClass.secondary}>
          Go to Repeat
        </button>
      )}
      {stage === 'shadow' && (
        <button type="button" onClick={() => setStage('deliver')} className={buttonClass.secondary}>
          Go to Deliver
        </button>
      )}
      {delivered && (
        <button type="button" onClick={finish} className={buttonClass.primary}>
          Finish task
        </button>
      )}
    </>
  )
}
