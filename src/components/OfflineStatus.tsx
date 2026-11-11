import { Link } from 'react-router'
import { CloudDownload, CloudOff, TriangleAlert } from 'lucide-react'
import { useOfflineState } from '../data/offline'
import { useOnline } from '../hooks/useOnline'
import { ProgressBar } from './ui'

/** One quiet line on Today while the offline pack downloads, or when something needs attention. Hidden when all is ready. */
export function OfflineStatus() {
  const s = useOfflineState()
  const online = useOnline()
  const clipsDone = s.clips.total > 0 && s.clips.ready >= s.clips.total
  const modelOk = s.model.state === 'ready' || s.model.state === 'not-needed' || s.model.state === 'unknown'
  if (clipsDone && modelOk) return null
  if (s.model.state === 'unknown' && !s.clips.downloading && s.clips.ready === 0 && online) return null

  const downloading = s.clips.downloading || s.model.state === 'downloading'
  const problem = s.model.state === 'error' ? s.model.error : s.clips.error
  const Icon = !online ? CloudOff : problem ? TriangleAlert : CloudDownload
  const parts = [
    s.clips.total ? `${s.clips.ready} of ${s.clips.total} days of shadowing clips` : '',
    s.model.state === 'downloading' ? `speech model ${Math.round(s.model.progress * 100)}%` : s.model.state === 'missing' ? 'speech model not downloaded' : '',
  ].filter(Boolean)
  const fraction = s.model.state === 'downloading' ? s.model.progress : s.clips.total ? s.clips.ready / s.clips.total : 0

  return (
    <Link to="/settings#offline" className="flex flex-col gap-2 rounded-lg px-1 py-2 text-sm" aria-live="polite">
      <span className="flex items-center gap-2.5 text-muted">
        <Icon size={18} strokeWidth={1.75} className={problem ? 'flex-none text-danger' : 'flex-none text-subtle'} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {!online ? 'Offline. ' : downloading ? 'Getting ready to work offline: ' : problem ? `${problem} ` : 'Offline pack: '}
          {parts.join(' · ')}
        </span>
      </span>
      {downloading && <ProgressBar value={Math.round(fraction * 100)} max={100} label="Offline download progress" valueText={parts.join(', ')} />}
    </Link>
  )
}
