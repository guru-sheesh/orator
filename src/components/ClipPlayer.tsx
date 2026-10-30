import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { ShadowSegment } from '../data/db'
import { ENVELOPE_RATE } from '../lib/audioAnalysis'
import { formatClock } from './recording'

export interface ClipPlayerHandle {
  play: () => void
  pause: () => void
}

const BARS = 56

/**
 * Plays one range of an imported recording with a waveform and playhead.
 * Stops itself at the end of the range.
 */
export function ClipPlayer({
  blob,
  envelope,
  range,
  label,
  onEnded,
  hideControls,
  ref,
}: {
  blob: Blob
  envelope: Uint8Array
  range: ShadowSegment
  label: string
  onEnded?: () => void
  hideControls?: boolean
  ref?: Ref<ClipPlayerHandle>
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(range.start)
  const ended = useRef(onEnded)
  ended.current = onEnded

  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  // A new range resets the playhead.
  useEffect(() => {
    audio.current?.pause()
    setPosition(range.start)
  }, [range.start, range.end])

  // Watch the playhead each frame: timeupdate fires too rarely to stop precisely.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const a = audio.current
      if (!a) return
      setPosition(a.currentTime)
      if (a.currentTime >= range.end) {
        a.pause()
        ended.current?.()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, range.end])

  function play(fromStart = false) {
    const a = audio.current
    if (!a) return
    if (fromStart || a.currentTime < range.start || a.currentTime >= range.end - 0.05) a.currentTime = range.start
    void a.play()
  }

  useImperativeHandle(ref, () => ({ play: () => play(true), pause: () => audio.current?.pause() }))

  const bars = waveform(envelope, range)
  const progress = Math.min(1, Math.max(0, (position - range.start) / (range.end - range.start)))

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-16 items-center gap-[2px]" role="img" aria-label={`${label} waveform, ${Math.round(progress * 100)} percent played`}>
        {bars.map((h, i) => (
          <i key={i} className={i / BARS < progress ? 'flex-1 rounded-[1px] bg-primary' : 'flex-1 rounded-[1px] bg-border-strong'} style={{ height: `${h}%` }} />
        ))}
        <span className="absolute inset-y-0 w-0.5 bg-text" style={{ left: `${progress * 100}%` }} aria-hidden="true" />
      </div>
      <div className="flex justify-between text-caption text-subtle tabular-nums">
        <span>{formatClock((position - range.start) * 1000)}</span>
        <span>{formatClock((range.end - range.start) * 1000)}</span>
      </div>
      {!hideControls && (
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={() => play(true)} aria-label={`Restart ${label}`} className="grid size-11 place-items-center rounded-md text-muted hover:bg-raised">
            <RotateCcw size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => (playing ? audio.current?.pause() : play())}
            aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
            className="grid size-14 place-items-center rounded-full bg-primary text-on-primary"
          >
            {playing ? <Pause size={24} strokeWidth={2} aria-hidden="true" /> : <Play size={24} strokeWidth={2} aria-hidden="true" />}
          </button>
          <span className="size-11" aria-hidden="true" />
        </div>
      )}
      <audio ref={audio} src={url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
    </div>
  )
}

function waveform(envelope: Uint8Array, range: ShadowSegment): number[] {
  const from = Math.floor(range.start * ENVELOPE_RATE)
  const to = Math.max(from + 1, Math.ceil(range.end * ENVELOPE_RATE))
  const per = (to - from) / BARS
  return Array.from({ length: BARS }, (_, i) => {
    let max = 0
    for (let f = Math.floor(from + i * per); f < Math.floor(from + (i + 1) * per) && f < envelope.length; f++) max = Math.max(max, envelope[f])
    return 10 + (max / 255) * 90
  })
}
