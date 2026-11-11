/**
 * Offline pack: everything the app needs to run a full session with no
 * connection, downloaded in the background whenever the app is online:
 * - the next month of shadowing clips with their transcripts,
 * - the on-phone speech model (Whisper),
 * - the clip catalogue (saved in IndexedDB) and the app itself (service worker).
 */
import { useSyncExternalStore } from 'react'
import { db } from './db'
import { updateSettings } from './daily'
import { CLIPS_AHEAD, findClip, getClipAudio, loadClipCatalogue, pruneClipAudio, upcomingClipIds, type BuiltInClip } from './clips'
import { engineSettings } from './transcription'
import { isWhisperCached, prepareWhisper, WHISPER_MODELS } from '../lib/whisper'

export interface OfflineState {
  clips: { ready: number; total: number; downloading: boolean; error?: string }
  model: { state: 'unknown' | 'missing' | 'downloading' | 'ready' | 'error' | 'not-needed'; progress: number; error?: string; label: string }
  persisted: boolean | null
}

let state: OfflineState = {
  clips: { ready: 0, total: CLIPS_AHEAD, downloading: false },
  model: { state: 'unknown', progress: 0, label: '' },
  persisted: null,
}
const listeners = new Set<() => void>()
function set(patch: Partial<OfflineState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function useOfflineState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

async function saveTranscript(clip: BuiltInClip) {
  if (await db.clipTranscripts.get(clip.id)) return
  const res = await fetch(`/audio/transcripts/${clip.id}.json`, { cache: 'no-cache' })
  if (!res.ok) return
  const shipped = (await res.json().catch(() => null)) as { text: string; words: { text: string; start: number; end: number; punct?: string }[] } | null
  if (shipped?.words?.length) await db.clipTranscripts.put({ clipId: clip.id, text: shipped.text, words: shipped.words })
}

/** Clips needed for the coming month, including today's session clip. */
async function wantedClips(): Promise<BuiltInClip[]> {
  const ids = await upcomingClipIds(CLIPS_AHEAD)
  const today = await db.speechSessions.orderBy('id').last()
  if (today?.plan.clip && !ids.includes(today.plan.clip)) ids.unshift(today.plan.clip)
  const clips = await Promise.all(ids.map((id) => findClip(id)))
  return clips.filter((c): c is BuiltInClip => !!c)
}

async function countReady(clips: BuiltInClip[]) {
  let n = 0
  for (const c of clips) if ((await db.clipAudio.get(c.id)) && (await db.clipTranscripts.get(c.id))) n++
  return n
}

let clipsRunning = false
async function downloadClips() {
  if (clipsRunning) return
  clipsRunning = true
  try {
    if (!(await loadClipCatalogue())) return
    const clips = await wantedClips()
    let ready = await countReady(clips)
    set({ clips: { ready, total: clips.length, downloading: navigator.onLine && ready < clips.length } })
    if (!navigator.onLine) return
    for (const clip of clips) {
      if ((await db.clipAudio.get(clip.id)) && (await db.clipTranscripts.get(clip.id))) continue
      try {
        await getClipAudio(clip)
        await saveTranscript(clip)
        ready = await countReady(clips)
        set({ clips: { ready, total: clips.length, downloading: true } })
      } catch {
        set({ clips: { ready, total: clips.length, downloading: false, error: navigator.onLine ? 'Some clips didn’t download. Retrying later.' : 'Offline. Downloads resume when you reconnect.' } })
        return
      }
    }
    set({ clips: { ready, total: clips.length, downloading: false } })
    await pruneClipAudio()
  } finally {
    clipsRunning = false
  }
}

/** On mobile data or data-saver, the ~100 MB model waits for Wi-Fi unless the user asks. */
function meteredConnection() {
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection
  return !!c && (c.saveData === true || c.type === 'cellular')
}

let modelRunning: Promise<void> | null = null
let modelAgain = false

/**
 * Makes sure the chosen speech model is on the phone. `force` downloads even
 * on mobile data or after the user removed it. If settings change while a
 * download runs, it runs once more for the new choice.
 */
export async function downloadModel(opts: { force?: boolean } = {}): Promise<void> {
  if (modelRunning) {
    modelAgain = true
    return modelRunning
  }
  modelRunning = (async () => {
    const settings = (await db.settings.get('user')) ?? null
    const { engine, size } = await engineSettings()
    const label = `${WHISPER_MODELS[size].label} speech model (about ${WHISPER_MODELS[size].approxMB} MB)`
    if (engine !== 'whisper') return set({ model: { state: 'not-needed', progress: 0, label } })
    if (await isWhisperCached(size)) return set({ model: { state: 'ready', progress: 1, label } })
    const auto = settings?.whisperAutoDownload !== false && !meteredConnection()
    if (!navigator.onLine || (!opts.force && !auto)) return set({ model: { state: 'missing', progress: 0, label } })
    if (opts.force && settings?.whisperAutoDownload === false) await updateSettings({ whisperAutoDownload: true })
    set({ model: { state: 'downloading', progress: 0, label } })
    try {
      await prepareWhisper(size, (p) => set({ model: { state: 'downloading', progress: p, label } }))
      const cached = await isWhisperCached(size)
      set({ model: { state: cached ? 'ready' : 'error', progress: 1, label, error: cached ? undefined : 'The model loaded but couldn’t be saved for offline use.' } })
    } catch (err) {
      set({ model: { state: 'error', progress: 0, label, error: err instanceof Error ? err.message : 'Download failed.' } })
    }
  })()
  try {
    await modelRunning
  } finally {
    modelRunning = null
  }
  if (modelAgain) {
    modelAgain = false
    await downloadModel(opts)
  }
}

/** After the user removes the model: don't fetch it again until they ask. */
export async function markModelRemoved() {
  await updateSettings({ whisperAutoDownload: false })
  await downloadModel()
}

/** Asks the browser not to clear this app's storage when space runs low. */
async function persist() {
  try {
    const already = await navigator.storage?.persisted?.()
    set({ persisted: already || (await navigator.storage?.persist?.()) || false })
  } catch {
    set({ persisted: false })
  }
}

/**
 * Runs at start-up and whenever the connection comes back. Safe to call
 * repeatedly. Clips and the model download side by side, so a slow model
 * download never holds up the clips. `afterModel` runs once the model step ends.
 */
export async function refreshOfflinePack(afterModel?: () => Promise<unknown>) {
  void persist()
  await Promise.all([
    downloadClips().catch(() => {}),
    downloadModel()
      .catch(() => {})
      .then(() => afterModel?.())
      .catch(() => {}),
  ])
}
