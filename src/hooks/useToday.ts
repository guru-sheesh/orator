import { useSyncExternalStore } from 'react'
import { toDateKey } from '../lib/date'

/**
 * Today's date key, updated when the date changes. An installed app is usually
 * resumed from memory rather than reloaded, so it must notice a new day itself:
 * on returning to the app, and at midnight while it stays open.
 */
export function useToday() {
  return useSyncExternalStore(subscribe, toDateKey)
}

function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    timer = setTimeout(() => {
      onChange()
      schedule()
    }, midnight.getTime() - now.getTime() + 1000)
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    onChange()
    clearTimeout(timer)
    schedule() // timers are paused while a phone sleeps
  }
  schedule()
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }
}
