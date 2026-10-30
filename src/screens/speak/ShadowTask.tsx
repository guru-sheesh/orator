import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Headphones, Info } from 'lucide-react'
import { db, type ShadowStage } from '../../data/db'
import { assignBuiltInClip, assignShadow, TIMING, useAttempts } from '../../data/speech'
import { ensureBuiltInClipTranscript, ensureClipTranscript } from '../../data/transcription'
import { clipPromptId, decodeEnvelope, getClipAudio, loadClipCatalogue, useClipTranscript, type BuiltInClip } from '../../data/clips'
import { TranscriptText } from '../../components/Transcript'
import type { TranscriptWord } from '../../lib/transcribe'
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

export function ShadowTask(props: TaskProps) {
  const { plan } = props.session
  if (plan.clip) return <BuiltInShadow {...props} clipId={plan.clip} />
  if (plan.shadow) return <ImportedShadow {...props} />
  return <AssignClip {...props} />
}

/** A session without a clip yet (started before clips loaded): fetch today's built-in clip, else offer imported audio. */
function AssignClip(props: TaskProps) {
  const [state, setState] = useState<'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setState('loading')
    assignBuiltInClip(props.session.id!)
      .then((clip) => !cancelled && !clip && setState('failed'))
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [props.session.id, attempt])

  if (state === 'loading') return <p role="status" className="text-muted">Loading today’s clip…</p>
  return (
    <>
      <Card>
        <p className="font-semibold">Today’s clip couldn’t load</p>
        <p className="text-muted">Check your internet connection and try again. Once downloaded, the clip stays on your phone.</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass.primary}>
          Try again
        </button>
      </Card>
      <ImportedShadow {...props} />
    </>
  )
}

/** Today's built-in clip: downloaded once, then kept on the device. */
function BuiltInShadow({ session, finish, clipId }: TaskProps & { clipId: string }) {
  const [state, setState] = useState<{ clip: BuiltInClip; blob: Blob; envelope: Uint8Array } | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const transcript = useClipTranscript(clipId)
  useEffect(() => {
    let cancelled = false
    setState('loading')
    ;(async () => {
      const cat = await loadClipCatalogue()
      if (!cat) throw new Error('offline')
      const clip = cat.clips.find((c) => c.id === clipId)
      // The clip was removed from the app since this session started: pick today's clip again.
      if (!clip) return void (await db.speechSessions.update(session.id!, { 'plan.clip': undefined }))
      const blob = await getClipAudio(clip)
      if (!cancelled) setState({ clip, blob, envelope: decodeEnvelope(clip.envelope) })
    })().catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [clipId, session.id, attempt])

  if (state === 'loading') return <p role="status" className="text-muted">Loading today’s clip…</p>
  if (state === 'failed')
    return (
      <>
        <Card>
          <p className="font-semibold">Today’s clip couldn’t download</p>
          <p className="text-muted">Check your internet connection and try again. Once downloaded, the clip stays on your phone.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass.primary}>
            Try again
          </button>
        </Card>
        <ImportedShadow session={session} finish={finish} />
      </>
    )
  const { clip, blob, envelope } = state
  return (
    <ShadowStages
      session={session}
      finish={finish}
      title={clip.title}
      speaker={clip.speaker}
      blob={blob}
      envelope={envelope}
      segment={{ start: 0, end: clip.durationSec }}
      segmentLabel={`Clip ${clip.index} of ${clip.of}`}
      clipWords={transcript?.words}
      promptBase={clipPromptId(clipId)}
      ensureTranscript={() => ensureBuiltInClipTranscript(clip, blob)}
    />
  )
}

function ImportedShadow({ session, finish }: TaskProps) {
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
  return <ShadowStages session={session} finish={finish} title={source.title} speaker={source.speaker} blob={audio.blob} envelope={source.envelope} segment={segment} segmentLabel={`Clip ${plan.segment + 1} of ${source.segments.length}`} clipWords={source.clipTranscripts?.[plan.segment]?.words}
      promptBase={`${plan.sourceId}:${plan.segment}`}
      ensureTranscript={() => ensureClipTranscript(plan.sourceId, plan.segment)}
    />
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
  clipWords,
  promptBase,
  ensureTranscript,
}: TaskProps & {
  title: string
  speaker: string
  blob: Blob
  envelope: Uint8Array
  segment: { start: number; end: number }
  segmentLabel: string
  clipWords?: TranscriptWord[]
  /** Identifies the clip in saved attempts. */
  promptBase: string
  ensureTranscript: () => Promise<unknown>
}) {
  const [stage, setStage] = useState<Stage>('listen')
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [recordingNow, setRecordingNow] = useState(false)
  const player = useRef<ClipPlayerHandle>(null)
  const phrases = useMemo(() => splitPhrases(envelope, segment), [envelope, segment])
  const attempts = useAttempts(session.id, 'shadowing')
  const baseId = promptBase
  const delivered = attempts?.some((a) => a.stage === 'deliver')
  const clipSec = segment.end - segment.start
  const phrase = phrases[Math.min(phraseIndex, phrases.length - 1)]
  const transcript = clipWords ? { words: clipWords, offset: segment.start } : undefined
  const [transcriptStatus, setTranscriptStatus] = useState<'idle' | 'loading' | 'failed'>('idle')

  // Transcribe the clip on first use (cached afterwards) for word highlighting and as the shadowing reference.
  useEffect(() => {
    if (clipWords) return
    setTranscriptStatus('loading')
    ensureTranscript()
      .then((clip) => setTranscriptStatus(clip ? 'idle' : 'failed'))
      .catch(() => setTranscriptStatus('failed'))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per clip
  }, [clipWords, promptBase])

  return (
    <>
      <Segmented label="Stage" options={STAGES} value={stage} onChange={setStage} disabled={recordingNow} />

      <Card>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-caption text-subtle">{[speaker, segmentLabel].filter(Boolean).join(' · ')}</p>
        </div>

        {stage === 'listen' && (
          <>
            <ClipPlayer blob={blob} envelope={envelope} range={segment} label="Clip" transcript={transcript} />
            <p className="text-sm text-muted">Listen without speaking. Notice the pauses, which words are stressed, and where the pace changes.</p>
          </>
        )}

        {stage === 'repeat' && phrase && (
          <>
            <Label aria-live="polite">
              Phrase {phraseIndex + 1} of {phrases.length}
            </Label>
            <ClipPlayer blob={blob} envelope={envelope} range={phrase} label={`Phrase ${phraseIndex + 1}`} transcript={transcript} />
            <p className="text-sm text-muted">Play the phrase, then record yourself repeating it with the same rhythm and pauses.</p>
          </>
        )}

        {stage === 'shadow' && (
          <>
            <ClipPlayer ref={player} blob={blob} envelope={envelope} range={segment} label="Clip" hideControls transcript={transcript} />
            <p className="flex gap-2 text-sm text-muted">
              <Headphones size={20} strokeWidth={1.75} className="mt-0.5 flex-none text-info" aria-hidden="true" />
              Use headphones. Recording starts the clip; speak along almost at the same time, copying timing and emphasis.
            </p>
          </>
        )}

        {stage === 'deliver' && (
          <>
            <p className="text-sm text-muted">The audio is off now. Deliver the passage yourself, keeping the rhythm and pauses you practised.</p>
            {clipWords && (
              <details className="rounded-md bg-raised px-4 py-2">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Show the transcript</summary>
                <TranscriptText words={clipWords} className="pb-2 text-base" />
              </details>
            )}
          </>
        )}

        {transcriptStatus === 'loading' && <p role="status" className="text-caption text-subtle">Loading the transcript…</p>}
        {transcriptStatus === 'failed' && <p role="status" className="text-caption text-subtle">The clip transcript isn’t available right now; practice works without it.</p>}
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
            onRecordingStart={() => setRecordingNow(true)}
            onRecordingEnd={() => setRecordingNow(false)}
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
          onRecordingStart={() => {
            setRecordingNow(true)
            player.current?.play()
          }}
          onRecordingEnd={() => {
            setRecordingNow(false)
            player.current?.pause()
          }}
        />
      )}

      {stage === 'deliver' && (
        <PromptRecorder session={session} task="shadowing" stage="deliver" onRecordingStart={() => setRecordingNow(true)} onRecordingEnd={() => setRecordingNow(false)} promptId={baseId} prompt="Deliver the clip independently" prepSec={0} maxSec={Math.max(TIMING.shadowing.maxSec, Math.ceil(clipSec * 1.5))} />
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
