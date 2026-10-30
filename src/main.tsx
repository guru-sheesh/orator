import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './styles/tokens.css'
import { AppShell } from './components/AppShell'
import { RouteError } from './components/RouteError'
import Today from './screens/Today'

/**
 * Lazy route: the screen's code (and anything only it needs, like the Speech
 * SDK or practice banks) downloads the first time it's opened. Today loads
 * eagerly as the start screen.
 */
function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  return { lazy: async () => ({ Component: pick(await load()) }) }
}
const speak = () => import('./screens/speak/Library')

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Today /> },
      { path: 'speak', ...page(() => import('./screens/speak/SpeakHome'), (m) => m.default) },
      { path: 'speak/library', ...page(speak, (m) => m.LibraryList) },
      { path: 'speak/library/new', ...page(speak, (m) => m.LibraryImport) },
      { path: 'speak/library/:id', ...page(speak, (m) => m.LibraryEdit) },
      { path: 'speak/attempt/:id', ...page(() => import('./screens/speak/FeedbackScreen'), (m) => m.default) },
      { path: 'speak/talks', ...page(() => import('./screens/speak/TalksScreen'), (m) => m.default) },
      { path: 'speak/compare/:id', ...page(() => import('./screens/speak/CompareScreen'), (m) => m.default) },
      { path: 'speak/:task', ...page(() => import('./screens/speak/TaskScreen'), (m) => m.default) },
      { path: 'journal', ...page(() => import('./screens/Journal'), (m) => m.default) },
      { path: 'read', ...page(() => import('./screens/Read'), (m) => m.default) },
      { path: 'read/books', ...page(() => import('./screens/Books'), (m) => m.default) },
      { path: 'read/books/new', ...page(() => import('./screens/BookForm'), (m) => m.default) },
      { path: 'read/books/:id', ...page(() => import('./screens/BookForm'), (m) => m.default) },
      { path: 'progress', ...page(() => import('./screens/Progress'), (m) => m.default) },
      { path: 'settings', ...page(() => import('./screens/Settings'), (m) => m.default) },
      { path: '*', ...page(() => import('./screens/Placeholder'), (m) => m.NotFound) },
    ],
  },
])

// Finish transcriptions left over from offline use or a closed app, once the first screen is up.
const resume = () => {
  void import('./data/transcription').then((m) => m.processPendingTranscriptions())
  // Have today's shadowing clip on the phone before the session even starts.
  void Promise.all([import('./data/clips'), import('./lib/date')]).then(([c, d]) => c.prefetchTodaysClip(d.toDateKey())).catch(() => {})
}
if ('requestIdleCallback' in window) requestIdleCallback(resume, { timeout: 5000 })
else setTimeout(resume, 2000)
window.addEventListener('online', resume)

// After a deploy, an app left open still asks for the old screen files, which are gone: reload once into the new version.
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('reloaded-for-update')) return
  e.preventDefault()
  sessionStorage.setItem('reloaded-for-update', '1')
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('reloaded-for-update'), 10_000))

// Installed apps are resumed rather than reloaded, so check for a new version when the app comes back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void navigator.serviceWorker?.getRegistration().then((r) => r?.update())
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
