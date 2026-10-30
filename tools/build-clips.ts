/**
 * Builds the built-in shadowing clips (user decision, CLAUDE.md §0.9c).
 * Cuts each prepared speech into ~1-minute clips at natural pauses (the app's
 * own splitter), skips intros/outros and short leftovers, and writes:
 *   public/audio/clips/<id>.m4a   one file per clip (mono AAC)
 *   public/audio/clips.json       metadata, loudness envelope, daily order
 * Usage: node --experimental-strip-types tools/build-clips.ts <folder with "Speaker — Title (part x of y).m4a">
 * Needs ffmpeg on PATH.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENVELOPE_RATE, splitSegments } from '../src/lib/audioAnalysis.ts'

const RATE = 8000
const MIN_CLIP_SEC = 30
const src = process.argv[2]
const outDir = join('public', 'audio', 'clips')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

function envelopeOf(file: string) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 * 1024 })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2)
  const win = RATE / ENVELOPE_RATE
  const frames = Math.ceil(samples.length / win)
  const rms = new Float32Array(frames)
  let peak = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const to = Math.min(samples.length, (f + 1) * win)
    for (let i = f * win; i < to; i++) sum += (samples[i] / 32768) ** 2
    rms[f] = Math.sqrt(sum / win)
    peak = Math.max(peak, rms[f])
  }
  return { envelope: Uint8Array.from(rms, (v) => Math.round((v / peak) * 255)), duration: samples.length / RATE }
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

interface Clip {
  id: string
  speaker: string
  title: string
  /** 1-based position within the whole speech, for "clip 3 of 17". */
  index: number
  of: number
  file: string
  durationSec: number
  /** Loudness envelope (20/s) for the waveform and Repeat-stage phrases, base64. */
  envelope: string
}

const bySpeech = new Map<string, { speaker: string; title: string; parts: { part: number; total: number; file: string }[] }>()
for (const name of readdirSync(src).filter((f) => f.endsWith('.m4a'))) {
  const m = name.match(/^(.+?) — (.+?)(?: \(part (\d+) of (\d+)\))?\.m4a$/)
  if (!m) throw new Error(`Name not "Speaker — Title": ${name}`)
  const [, speaker, title, part = '1', total = '1'] = m
  const key = `${speaker}|${title}`
  const entry = bySpeech.get(key) ?? { speaker, title, parts: [] }
  entry.parts.push({ part: Number(part), total: Number(total), file: join(src, name) })
  bySpeech.set(key, entry)
}

const clips: Clip[] = []
for (const { speaker, title, parts } of bySpeech.values()) {
  parts.sort((a, b) => a.part - b.part)
  const speechClips: Omit<Clip, 'index' | 'of'>[] = []
  parts.forEach(({ file, part, total }) => {
    const { envelope, duration } = envelopeOf(file)
    let segments = splitSegments(envelope, duration)
    // Skip host introductions/opening music and closing applause.
    if (part === 1) segments = segments.slice(1)
    if (part === total) segments = segments.slice(0, -1)
    for (const seg of segments.filter((s) => s.end - s.start >= MIN_CLIP_SEC)) {
      const id = `${slug(speaker)}-${slug(title)}-${String(speechClips.length + 1).padStart(2, '0')}`
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(seg.start), '-to', String(seg.end), '-i', file, '-ac', '1', '-ar', '22050', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', join(outDir, `${id}.m4a`)])
      const from = Math.floor(seg.start * ENVELOPE_RATE)
      const env = envelope.slice(from, from + Math.ceil((seg.end - seg.start) * ENVELOPE_RATE))
      speechClips.push({ id, speaker, title, file: `/audio/clips/${id}.m4a`, durationSec: Math.round((seg.end - seg.start) * 10) / 10, envelope: Buffer.from(env).toString('base64') })
    }
  })
  speechClips.forEach((c, i) => clips.push({ ...c, index: i + 1, of: speechClips.length }))
  console.log(`${String(speechClips.length).padStart(3)} clips  ${speaker} — ${title}`)
}

// Daily order: shuffled (fixed seed, so it never changes between builds), never the same speaker two days running.
let seed = 20261030
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pool = [...clips].sort(() => random() - 0.5)
const order: string[] = []
let lastSpeaker = ''
while (pool.length) {
  const i = pool.findIndex((c) => c.speaker !== lastSpeaker)
  const [pick] = pool.splice(i < 0 ? 0 : i, 1)
  order.push(pick.id)
  lastSpeaker = pick.speaker
}

writeFileSync(join('public', 'audio', 'clips.json'), JSON.stringify({ rights: 'personal practice copies', clips, order }))
const bytes = readdirSync(outDir).reduce((s, f) => s + statSync(join(outDir, f)).size, 0)
console.log(`${clips.length} clips, ${(bytes / 1048576).toFixed(0)} MB`)
