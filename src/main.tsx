import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './styles/tokens.css'
import { AppShell } from './components/AppShell'
import Today from './screens/Today'
import Settings from './screens/Settings'
import Progress from './screens/Progress'
import Journal from './screens/Journal'
import JournalHistory from './screens/JournalHistory'
import Read from './screens/Read'
import Books from './screens/Books'
import BookForm from './screens/BookForm'
import Placeholder, { NotFound } from './screens/Placeholder'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Today /> },
      {
        path: 'speak',
        element: <Placeholder title="Speak" phase="phases 5–11" description="Recording, the six-task session, transcription, analysis, coaching and retry." />,
      },
      { path: 'journal', element: <Journal /> },
      { path: 'journal/history', element: <JournalHistory /> },
      { path: 'read', element: <Read /> },
      { path: 'read/books', element: <Books /> },
      { path: 'read/books/new', element: <BookForm /> },
      { path: 'read/books/:id', element: <BookForm /> },
      { path: 'progress', element: <Progress /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
