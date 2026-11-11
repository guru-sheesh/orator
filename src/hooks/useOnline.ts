import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** Whether the browser thinks it has a connection. */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine)
}
