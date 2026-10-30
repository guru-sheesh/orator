import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'

/**
 * Built-in shadowing clips (CLAUDE.md §0.9c): one ~1-minute clip a day, in a
 * fixed shuffled order chosen at build time. Only the day's clip is downloaded,
 * then kept on the device for offline practice.
 */
export interface BuiltInClip {
  id: string
  speaker: string
  title: string
  index: number
  of: number
  file: string
  durationSec: number
  envelope: string
}

interface ClipCatalogue {
  clips: BuiltInClip[]
  order: string[]
}

let catalogue: Promise<ClipCatalogue | null> | null = null

export function loadClipCatalogue(): Promise<ClipCatalogue | null> {
  // no-cache: older builds served this file as immutable for a year, so always recheck it.
  catalogue ??= fetch('/audio/clips.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<ClipCatalogue>) : null))
    .catch(() => null)
  void catalogue.then((c) => {
    if (!c) catalogue = null // retry next time (offline on first try)
  })
  return catalogue
}

/** The built-in speeches, each with its clips in order, plus the clip scheduled for today. */
export function useBuiltInSpeeches() {
  const [speeches, setSpeeches] = useState<{ speaker: string; title: string; clips: BuiltInClip[] }[] | null>()
  useEffect(() => {
    let cancelled = false
    void loadClipCatalogue().then((cat) => {
      if (cancelled) return
      if (!cat) return setSpeeches(null)
      const byTitle = new Map<string, { speaker: string; title: string; clips: BuiltInClip[] }>()
      for (const c of cat.clips) {
        const key = `${c.speaker}\u0000${c.title}`
        if (!byTitle.has(key)) byTitle.set(key, { speaker: c.speaker, title: c.title, clips: [] })
        byTitle.get(key)!.clips.push(c)
      }
      setSpeeches([...byTitle.values()].sort((a, b) => a.speaker.localeCompare(b.speaker) || a.title.localeCompare(b.title)))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return speeches
}

export async function findClip(id: string) {
  return (await loadClipCatalogue())?.clips.find((c) => c.id === id)
}

/** Next clip in the schedule: the Nth practice day gets order[N]. */
export async function clipForNewSession(): Promise<string | undefined> {
  const cat = await loadClipCatalogue()
  if (!cat?.order.length) return undefined
  const days = new Set((await db.speechSessions.toArray()).map((s) => s.date)).size
  return cat.order[days % cat.order.length]
}

export function decodeEnvelope(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

const isAudio = (blob: Blob) => !blob.type.startsWith('text/') && blob.size > 0

/** Clip audio from the device, downloading it the first time. */
export async function getClipAudio(clip: BuiltInClip): Promise<Blob> {
  const cached = await db.clipAudio.get(clip.id)
  if (cached && isAudio(cached.blob)) return cached.blob
  const res = await fetch(clip.file)
  if (!res.ok) throw new Error('download failed')
  const blob = await res.blob()
  // A missing file can come back as the app's HTML page; never keep that as audio.
  if (!isAudio(blob)) throw new Error('download failed')
  await db.clipAudio.put({ clipId: clip.id, blob })
  // Keep only the last few clips so storage doesn't grow without limit.
  const all = await db.clipAudio.toCollection().primaryKeys()
  if (all.length > 7) {
    const recent = new Set((await db.speechSessions.orderBy('id').reverse().limit(7).toArray()).map((s) => s.plan.clip))
    await db.clipAudio.bulkDelete(all.filter((k) => !recent.has(k) && k !== clip.id))
  }
  return blob
}

/** Today's clip: the one today's session has, else the one starting a session would pick. */
export async function todaysClip(today: string): Promise<BuiltInClip | undefined> {
  const session = await db.speechSessions.where('date').equals(today).last()
  if (session && !session.plan.clip) return undefined // today uses imported audio
  const id = session?.plan.clip ?? (await clipForNewSession())
  return id ? findClip(id) : undefined
}

/**
 * Downloads today's clip and its ready-made transcript ahead of time, so it's
 * on the phone before the session starts and works offline later in the day.
 */
export async function prefetchClip(clip: BuiltInClip) {
  await getClipAudio(clip)
  if (await db.clipTranscripts.get(clip.id)) return
  const shipped = await fetch(`/audio/transcripts/${clip.id}.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (shipped?.words?.length) await db.clipTranscripts.put({ clipId: clip.id, text: shipped.text, words: shipped.words })
}

export async function prefetchTodaysClip(today: string) {
  if (!navigator.onLine) return
  const clip = await todaysClip(today)
  if (clip) await prefetchClip(clip)
}

/** Today's clip with whether it's already on the phone; it downloads in the background. */
export function useTodaysClip(today: string, sessionClip: string | undefined) {
  const [clip, setClip] = useState<BuiltInClip | null>()
  useEffect(() => {
    let cancelled = false
    void todaysClip(today).then((c) => {
      if (cancelled) return
      setClip(c ?? null)
      if (c && navigator.onLine) void prefetchClip(c).catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [today, sessionClip])
  const ready = useLiveQuery(async () => (clip ? !!(await db.clipAudio.get(clip.id)) : false), [clip?.id])
  return clip === undefined ? undefined : clip && { clip, ready: !!ready }
}

export function useClipTranscript(clipId: string | undefined) {
  return useLiveQuery(async () => (clipId ? ((await db.clipTranscripts.get(clipId)) ?? null) : null), [clipId])
}

/** promptId used for attempts on a built-in clip. */
export const clipPromptId = (clipId: string) => `clip:${clipId}`
export const clipIdFromPrompt = (promptId: string) => (promptId.startsWith('clip:') ? promptId.slice(5) : undefined)
