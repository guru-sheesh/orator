import { useEffect, useRef, useState, type RefObject } from 'react'
import { Mic, Pause, Play, Square } from 'lucide-react'
import type { RecorderState } from '../hooks/useRecorder'
import { cx } from './ui'

export function formatClock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The 80px record control from the design system (§5). */
export function RecordButton({
  state,
  onStart,
  onStop,
  idleLabel = 'Record',
  disabled,
}: {
  state: RecorderState
  onStart: () => void
  onStop: () => void
  idleLabel?: string
  disabled?: boolean
}) {
  const recording = state === 'recording'
  const busy = state === 'preparing' || state === 'stopping'
  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <button
        type="button"
        onClick={recording ? onStop : onStart}
        disabled={disabled || busy}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : idleLabel}
        className={cx(
          'relative grid size-20 place-items-center rounded-full bg-danger text-on-danger transition-transform duration-(--duration-fast) active:scale-95 disabled:opacity-40',
          recording &&
            'after:absolute after:-inset-2 after:rounded-full after:border-2 after:border-danger after:opacity-50 after:motion-safe:animate-[pulse-ring_2s_ease-in-out_infinite]',
        )}
      >
        {recording ? <Square size={28} strokeWidth={2} fill="currentColor" aria-hidden="true" /> : <Mic size={32} strokeWidth={1.75} aria-hidden="true" />}
      </button>
      <p className="text-caption text-subtle" aria-live="polite">
        {busy ? (state === 'preparing' ? 'Starting microphone…' : 'Saving…') : recording ? 'Recording · tap to stop' : idleLabel}
      </p>
    </div>
  )
}

/** Live input bars driven by a ref so the meter doesn't re-render the screen. */
export function LevelMeter({ levelRef, active }: { levelRef: RefObject<number>; active: boolean }) {
  const bars = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const history: number[] = Array(28).fill(0)
    let frame = 0
    const draw = () => {
      history.shift()
      history.push(levelRef.current ?? 0)
      const el = bars.current
      if (el) history.forEach((v, i) => ((el.children[i] as HTMLElement).style.height = `${12 + v * 88}%`))
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [active, levelRef])

  return (
    <div ref={bars} aria-hidden="true" className="flex h-12 w-full max-w-64 items-center justify-center gap-[3px]">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} className={cx('block w-[3px] rounded-sm', active ? 'bg-danger/80' : 'bg-border-strong')} style={{ height: '12%' }} />
      ))}
    </div>
  )
}

/** Compact player for a recorded attempt. durationMs covers WebM files whose length the browser reports as unknown. */
export function AttemptPlayer({ blob, label, durationMs }: { blob: Blob; label: string; durationMs?: number }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
        aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
        className="grid size-11 flex-none place-items-center rounded-full bg-primary text-on-primary"
      >
        {playing ? <Pause size={18} strokeWidth={2} aria-hidden="true" /> : <Play size={18} strokeWidth={2} aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-caption text-subtle tabular-nums">
          {formatClock(time * 1000)} / {formatClock(Number.isFinite(duration) && duration > 0 ? duration * 1000 : (durationMs ?? 0))}
        </p>
      </div>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  )
}

/** Visible prep countdown; calls onDone once at zero. */
export function Countdown({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [left, setLeft] = useState(seconds)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const began = performance.now()
    const id = setInterval(() => {
      const remaining = seconds - Math.floor((performance.now() - began) / 1000)
      setLeft(Math.max(0, remaining))
      if (remaining <= 0) {
        clearInterval(id)
        done.current()
      }
    }, 200)
    return () => clearInterval(id)
  }, [seconds])
  return (
    <div className="flex flex-col items-center gap-1 py-2" role="timer" aria-live="off">
      <p className="text-caption font-medium tracking-[0.06em] text-subtle uppercase">Prepare</p>
      <p className="text-display font-semibold tabular-nums">{left}</p>
    </div>
  )
}
