import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CircleCheck, CloudDownload, HardDrive, TriangleAlert } from 'lucide-react'
import { updateSettings } from '../data/daily'
import { db } from '../data/db'
import { downloadModel, markModelRemoved, refreshOfflinePack, useOfflineState } from '../data/offline'
import { processPendingTranscriptions } from '../data/transcription'
import { deleteWhisperModels, WHISPER_MODELS, type WhisperSize } from '../lib/whisper'
import { useOnline } from '../hooks/useOnline'
import { buttonClass, Card, cx, Label, ProgressBar, Segmented } from '../components/ui'

const ENGINES = [
  { value: 'whisper', label: 'On this phone' },
  { value: 'azure', label: 'Azure (online)' },
] as const

const SIZES = [
  { value: 'base', label: 'Standard' },
  { value: 'tiny', label: 'Light' },
] as const

/** Which engine turns recordings into text, and the on-phone model's status. */
export function SpeechSettings({ engine, size }: { engine: 'whisper' | 'azure'; size: WhisperSize }) {
  const s = useOfflineState()
  const online = useOnline()
  const [busy, setBusy] = useState(false)

  async function chooseEngine(next: 'whisper' | 'azure') {
    await updateSettings({ transcriptionEngine: next })
    await downloadModel()
    void processPendingTranscriptions()
  }
  async function chooseSize(next: WhisperSize) {
    setBusy(true)
    try {
      await updateSettings({ whisperSize: next })
      await downloadModel()
      void processPendingTranscriptions()
    } finally {
      setBusy(false)
    }
  }
  async function removeModel() {
    setBusy(true)
    try {
      await deleteWhisperModels()
      await markModelRemoved()
    } finally {
      setBusy(false)
    }
  }

  const model = s.model
  return (
    <Card>
      <Label>Speech to text</Label>
      <Segmented label="Where recordings are transcribed" options={ENGINES} value={engine} onChange={(v) => void chooseEngine(v)} />
      {engine === 'whisper' ? (
        <>
          <p className="text-sm text-muted">
            Your recordings are turned into text on this phone with Whisper. Free, private (audio never leaves the phone) and works offline once the model is downloaded.
          </p>
          <Segmented label="Speech model" options={SIZES} value={size} onChange={(v) => void chooseSize(v)} disabled={busy} />
          <p className="text-caption text-subtle">
            {WHISPER_MODELS[size].detail} About {WHISPER_MODELS[size].approxMB} MB.
          </p>
          <div className="flex items-start gap-2.5 text-sm" role="status">
            {model.state === 'ready' ? (
              <CircleCheck size={18} strokeWidth={1.75} className="mt-0.5 flex-none text-success" aria-hidden="true" />
            ) : model.state === 'error' ? (
              <TriangleAlert size={18} strokeWidth={1.75} className="mt-0.5 flex-none text-danger" aria-hidden="true" />
            ) : (
              <CloudDownload size={18} strokeWidth={1.75} className="mt-0.5 flex-none text-subtle" aria-hidden="true" />
            )}
            <span className="flex-1">
              {model.state === 'ready'
                ? 'Downloaded. Transcription works offline.'
                : model.state === 'downloading'
                  ? `Downloading… ${Math.round(model.progress * 100)}%`
                  : model.state === 'error'
                    ? model.error
                    : online
                      ? 'Not downloaded yet. It downloads by itself on Wi-Fi, or tap below.'
                      : 'Not downloaded yet. Connect to the internet once to download it.'}
            </span>
          </div>
          {model.state === 'downloading' && <ProgressBar value={Math.round(model.progress * 100)} max={100} label="Speech model download" />}
          {(model.state === 'missing' || model.state === 'error' || model.state === 'unknown') && (
            <button type="button" disabled={!online || busy} onClick={() => void downloadModel({ force: true }).then(() => processPendingTranscriptions())} className={cx(buttonClass.secondary, 'min-h-11 text-sm')}>
              <CloudDownload size={16} strokeWidth={1.75} aria-hidden="true" />
              Download now
            </button>
          )}
          {model.state === 'ready' && (
            <button type="button" disabled={busy} onClick={() => void removeModel()} className={cx(buttonClass.ghost, 'self-start text-sm text-muted')}>
              Remove model from this phone
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          Recordings are sent to Azure Speech for transcription. Needs a connection and the Azure key on the server, and is limited to about 5 hours a month on the free tier. Adds pronunciation clarity flags.
        </p>
      )}
    </Card>
  )
}

function formatMB(bytes: number) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

/** What's stored on the phone for offline use. */
export function OfflineSettings() {
  const s = useOfflineState()
  const online = useOnline()
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const clipCount = useLiveQuery(() => db.clipAudio.count())
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {})
  }, [s.clips.ready, s.model.state])
  useEffect(() => {
    // Opening this screen re-checks what's on the phone.
    void refreshOfflinePack()
    if (location.hash === '#offline') document.getElementById('offline')?.scrollIntoView({ block: 'start' })
  }, [])

  const clipsDone = s.clips.total > 0 && s.clips.ready >= s.clips.total
  return (
    <Card id="offline" className="scroll-mt-4">
      <Label>Offline</Label>
      <p className="text-sm text-muted">
        The app, your data, the next month of shadowing clips and the speech model are kept on this phone, so a full session works with no connection. Only the AI coach needs the internet; offline you get the on-phone review instead.
      </p>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt>Shadowing clips ready</dt>
          <dd className={cx('tabular-nums', clipsDone ? 'text-success' : 'text-muted')}>
            {s.clips.total ? `${s.clips.ready} of ${s.clips.total} days` : clipCount !== undefined ? `${clipCount} saved` : '…'}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Storage used</dt>
          <dd className="text-muted tabular-nums">{estimate ? formatMB(estimate.usage) : '…'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Protected from clean-up</dt>
          <dd className="text-muted">{s.persisted === null ? '…' : s.persisted ? 'Yes' : 'No (install the app to protect it)'}</dd>
        </div>
      </dl>
      {s.clips.downloading && <ProgressBar value={s.clips.ready} max={s.clips.total} label="Shadowing clips downloaded" />}
      {s.clips.error && <p className="text-sm text-danger">{s.clips.error}</p>}
      {!clipsDone && !s.clips.downloading && (
        <button type="button" disabled={!online} onClick={() => void refreshOfflinePack()} className={cx(buttonClass.secondary, 'min-h-11 text-sm')}>
          <HardDrive size={16} strokeWidth={1.75} aria-hidden="true" />
          {online ? 'Download the next month now' : 'Connect to download'}
        </button>
      )}
    </Card>
  )
}
