import { useEffect } from 'react'
import { addActiveTime } from '../data/speech'

const FLUSH_MS = 15_000

/**
 * Counts time a task screen is open and visible, saving it every 15 s, when the
 * app is backgrounded, and on leaving. Hidden time never counts.
 */
export function useActiveTime(sessionId: number | undefined) {
  useEffect(() => {
    if (sessionId === undefined) return
    let since = document.visibilityState === 'visible' ? performance.now() : null

    const flush = () => {
      if (since === null) return
      const now = performance.now()
      void addActiveTime(sessionId, now - since)
      since = now
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush()
        since = null
      } else since = performance.now()
    }

    const id = setInterval(flush, FLUSH_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [sessionId])
}
