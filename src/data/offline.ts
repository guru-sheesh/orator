/**
 * Offline pack: everything the app needs to run a full session with no
 * connection, downloaded in the background whenever the app is online:
 * - the next month of shadowing clips with their transcripts,
 * - the on-phone speech model (Whisper),
 * - the clip catalogue (saved in IndexedDB) and the app itself (service worker).
 */
import { useSyncExternalStore } from 'react'
import { db } from './db'
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

let modelRunning = false
export async function downloadModel() {
  if (modelRunning) return
  modelRunning = true
  try {
    const { engine, size } = await engineSettings()
    const label = `${WHISPER_MODELS[size].label} speech model (about ${WHISPER_MODELS[size].approxMB} MB)`
    if (engine !== 'whisper') return set({ model: { state: 'not-needed', progress: 0, label } })
    if (await isWhisperCached(size)) return set({ model: { state: 'ready', progress: 1, label } })
    if (!navigator.onLine) return set({ model: { state: 'missing', progress: 0, label } })
    set({ model: { state: 'downloading', progress: 0, label } })
    try {
      await prepareWhisper(size, (p) => set({ model: { state: 'downloading', progress: p, label } }))
      set({ model: { state: (await isWhisperCached(size)) ? 'ready' : 'error', progress: 1, label, error: (await isWhisperCached(size)) ? undefined : 'The model loaded but couldn’t be saved for offline use.' } })
    } catch (err) {
      set({ model: { state: 'error', progress: 0, label, error: err instanceof Error ? err.message : 'Download failed.' } })
    }
  } finally {
    modelRunning = false
  }
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

/** Runs at start-up and whenever the connection comes back. Safe to call repeatedly. */
export async function refreshOfflinePack() {
  await persist()
  // Clips first: small, and needed for shadowing; the model is larger.
  await downloadClips().catch(() => {})
  await downloadModel().catch(() => {})
}
