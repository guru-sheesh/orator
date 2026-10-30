import { useCallback, useEffect, useRef, useState } from 'react'
import { Recorder, RecorderError, type RecordingResult } from '../lib/recorder'

export type RecorderState = 'idle' | 'preparing' | 'recording' | 'stopping' | 'error'

/**
 * React wrapper around Recorder: exposes state, elapsed time and a live level,
 * and auto-stops at `maxMs`. The mic is always released on unmount.
 */
export function useRecorder({ maxMs, onComplete }: { maxMs: number; onComplete: (r: RecordingResult) => void }) {
  const recorder = useRef<Recorder | null>(null)
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const levelRef = useRef(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const get = () => (recorder.current ??= new Recorder())

  const fail = (err: unknown) => {
    setError(err instanceof RecorderError ? err.message : 'Recording failed. Try again.')
    setState('error')
    recorder.current?.release()
  }

  /** Opens the microphone early (e.g. on the tap that starts a prep countdown). */
  const prepare = useCallback(async () => {
    setError(null)
    try {
      await get().prepare()
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setState('preparing')
    try {
      await get().start()
      setElapsedMs(0)
      setState('recording')
    } catch (err) {
      fail(err)
    }
  }, [])

  const stop = useCallback(async () => {
    const r = recorder.current
    if (!r?.recording) return
    setState('stopping')
    try {
      const result = await r.stop()
      setState('idle')
      onCompleteRef.current(result)
    } catch (err) {
      fail(err)
    }
  }, [])

  // Tick the timer and level meter while recording; auto-stop at the limit.
  useEffect(() => {
    if (state !== 'recording') return
    const began = performance.now()
    let frame = 0
    const tick = () => {
      const ms = performance.now() - began
      levelRef.current = recorder.current?.level() ?? 0
      setElapsedMs(Math.floor(ms / 250) * 250)
      if (ms >= maxMs) void stop()
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state, maxMs, stop])

  useEffect(() => () => recorder.current?.release(), [])

  return { state, error, elapsedMs, levelRef, prepare, start, stop }
}
