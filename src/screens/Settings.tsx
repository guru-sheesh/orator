import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Download, FileAudio, Trash2, Upload } from 'lucide-react'
import { updateSettings, updateTargets, useSettings } from '../data/daily'
import { backupFileName, deleteAllData, downloadBlob, exportAllData, importAllData } from '../data/backup'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Card, cx, iconButtonClass, Label, Segmented } from '../components/ui'
import { getTheme, setTheme, type Theme } from '../lib/theme'

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function describeExport(at?: number) {
  if (!at) return 'Never backed up'
  const days = Math.floor((Date.now() - at) / 86_400_000)
  return `Last backup ${relative.format(-days, 'day')}`
}

type Pending = { kind: 'delete' } | { kind: 'import'; file: File } | null

export default function Settings() {
  const settings = useSettings()
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function choose(next: Theme) {
    setTheme(next)
    setThemeState(next)
  }

  async function handleExport() {
    try {
      downloadBlob(await exportAllData(), backupFileName())
      setMessage({ text: 'Backup downloaded. Keep it somewhere other than this phone, such as cloud storage or email to yourself.' })
    } catch {
      setMessage({ text: 'The export failed. Try again; if it keeps failing, restart the app.', error: true })
    }
  }

  async function confirmPending() {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'delete') {
        await deleteAllData()
        setMessage({ text: 'All data on this device has been deleted.' })
      } else {
        await importAllData(await pending.file.text())
        setMessage({ text: `Restored from ${pending.file.name}.` })
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Something went wrong. Nothing was changed.', error: true })
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  return (
    <>
      <header className="flex min-h-12 items-center gap-2">
        <Link to="/" aria-label="Back to Today" className={iconButtonClass}>
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="text-headline font-semibold">Settings</h1>
      </header>

      <Card>
        <Label>Daily targets</Label>
        {settings && (
          <>
            <TargetField
              id="target-articulation"
              label="Articulation"
              unit="minutes"
              value={settings.targets.articulationMinutes}
              min={5}
              max={120}
              onSave={(v) => updateTargets({ articulationMinutes: v })}
            />
            <TargetField
              id="target-reading"
              label="Reading"
              unit="pages"
              value={settings.targets.readingPages}
              min={1}
              max={200}
              onSave={(v) => updateTargets({ readingPages: v })}
            />
            <div className="flex min-h-12 items-center justify-between gap-3">
              <span>Journal</span>
              <span className="text-muted">1 entry</span>
            </div>
          </>
        )}
      </Card>

      <Card className="gap-1">
        <Label>Speaking practice</Label>
        {settings && (
          <label htmlFor="keep-recordings" className="flex min-h-14 cursor-pointer items-center gap-3">
            <span className="flex-1">
              <span className="block">Keep recordings on this device</span>
              <span className="block text-caption text-subtle">Off: audio is discarded after each task. On: needed to replay Attempt 1 vs 2 later.</span>
            </span>
            <input
              id="keep-recordings"
              type="checkbox"
              role="switch"
              checked={settings.keepRecordings}
              onChange={(e) => void updateSettings({ keepRecordings: e.target.checked })}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative h-8 w-13 flex-none rounded-pill border border-border-strong bg-raised transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-[3px] after:left-[3px] after:size-6 after:rounded-full after:bg-muted after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-on-primary"
            />
          </label>
        )}
        <Link to="/speak/library" className="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 hover:bg-raised">
          <FileAudio size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1">Shadowing audio</span>
          <ChevronRight size={20} strokeWidth={1.75} className="text-subtle" aria-hidden="true" />
        </Link>
      </Card>

      <Card>
        <Label>Appearance</Label>
        <Segmented
          label="Appearance"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          value={theme}
          onChange={choose}
        />
      </Card>

      <Card className="gap-1">
        <Label>Your data</Label>
        <p className="py-1 text-caption text-subtle">
          Everything is stored only on this device. Clearing browser data or losing the phone loses it, so export a backup weekly.{' '}
          <span className="text-muted">{settings && describeExport(settings.lastExportAt)}.</span>
        </p>
        <SettingButton icon={Download} onClick={handleExport}>
          Export all data (JSON)
        </SettingButton>
        <SettingButton icon={Upload} onClick={() => fileInput.current?.click()}>
          Restore from backup
        </SettingButton>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) setPending({ kind: 'import', file })
          }}
        />
        <SettingButton icon={Trash2} onClick={() => setPending({ kind: 'delete' })} danger>
          Delete all data
        </SettingButton>
        <p role="status" aria-live="polite" className={cx('text-sm', message?.error ? 'text-danger' : 'text-muted', message && 'pt-2')}>
          {message?.text}
        </p>
      </Card>

      <ConfirmDialog
        open={pending?.kind === 'delete'}
        title="Delete all data?"
        confirmLabel="Delete everything"
        destructive
        busy={busy}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      >
        <p>This permanently removes every journal entry, reading log and practice record on this device. It can't be undone.</p>
        <p>If you might want them later, cancel and export a backup first.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === 'import'}
        title="Replace data with this backup?"
        confirmLabel="Restore backup"
        busy={busy}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      >
        <p>Everything currently on this device will be replaced by the contents of {pending?.kind === 'import' ? pending.file.name : 'the file'}.</p>
      </ConfirmDialog>
    </>
  )
}

function TargetField({
  id,
  label,
  unit,
  value,
  min,
  max,
  onSave,
}: {
  id: string
  label: string
  unit: string
  value: number
  min: number
  max: number
  onSave: (value: number) => void
}) {
  // Uncontrolled: commit on blur so partial typing ("1" on the way to "15") isn't saved.
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <label htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          key={value}
          id={id}
          name={id}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={min}
          max={max}
          defaultValue={value}
          onBlur={(e) => {
            const n = Math.round(Number(e.target.value))
            const clamped = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value
            e.target.value = String(clamped)
            if (clamped !== value) onSave(clamped)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-11 w-20 rounded-sm border border-border-strong bg-raised px-3 text-right tabular-nums"
        />
        <span className="w-16 text-muted">{unit}</span>
      </div>
    </div>
  )
}

function SettingButton({
  icon: Icon,
  onClick,
  danger,
  children,
}: {
  icon: typeof Download
  onClick: () => void
  danger?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        '-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 text-left hover:bg-raised',
        danger && 'text-danger',
      )}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      {children}
    </button>
  )
}
