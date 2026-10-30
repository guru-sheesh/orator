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
import { NotFound } from './screens/Placeholder'
import { processPendingTranscriptions } from './data/transcription'
import SpeakHome from './screens/speak/SpeakHome'
import TaskScreen from './screens/speak/TaskScreen'
import { LibraryEdit, LibraryImport, LibraryList } from './screens/speak/Library'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Today /> },
      { path: 'speak', element: <SpeakHome /> },
      { path: 'speak/library', element: <LibraryList /> },
      { path: 'speak/library/new', element: <LibraryImport /> },
      { path: 'speak/library/:id', element: <LibraryEdit /> },
      { path: 'speak/:task', element: <TaskScreen /> },
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

// Finish transcriptions left over from offline use or a closed app.
void processPendingTranscriptions()
window.addEventListener('online', () => void processPendingTranscriptions())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
