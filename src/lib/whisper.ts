/**
 * On-device transcription with Whisper (transformers.js in a Web Worker).
 * Free, private (audio never leaves the phone) and offline once the model is
 * downloaded. Produces the same Transcription shape as the Azure service.
 */
import { TranscriptionError, type Transcription, type TranscriptWord } from './transcribe'
import type { WorkerRequest, WorkerResponse, WhisperChunk } from './whisperProtocol'

export type WhisperSize = 'base' | 'tiny'

export const WHISPER_MODELS: Record<WhisperSize, { label: string; detail: string; repos: string[]; approxMB: number }> = {
  base: {
    label: 'Standard',
    detail: 'More accurate. Best on most phones from the last few years.',
    repos: ['Xenova/whisper-base.en', 'onnx-community/whisper-base.en_timestamped'],
    approxMB: 80,
  },
  tiny: {
    label: 'Light',
    detail: 'About three times faster, a little less accurate. For older phones.',
    repos: ['Xenova/whisper-tiny.en', 'onnx-community/whisper-tiny.en_timestamped'],
    approxMB: 45,
  },
}

const SAMPLE_RATE = 16000
/** Whisper sees 30 s at a time; stay under it and cut at quiet moments so no word is split. */
const MAX_WINDOW_SEC = 28
const MIN_WINDOW_SEC = 18
const CACHE_NAME = 'transformers-cache'

// ---------- worker plumbing ----------

type Pending = {
  resolve: (r: Extract<WorkerResponse, { type: 'result' | 'loaded' }>) => void
  reject: (e: Error) => void
  onProgress?: (loaded: number, total: number) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'progress') p.onProgress?.(msg.loaded, msg.total)
    else if (msg.type === 'status') return
    else {
      pending.delete(msg.id)
      if (msg.type === 'error') p.reject(new Error(msg.message))
      else p.resolve(msg)
    }
  }
  // A crash (often out of memory on older phones) kills the worker: fail everything waiting and start fresh next time.
  worker.onerror = (e) => {
    e.preventDefault?.()
    const err = new Error(e.message || 'The speech model stopped unexpectedly.')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

/**
 * Sends one request to the worker. `stallMs` fails it if nothing (no progress,
 * no answer) arrives for that long: a hung download or a frozen worker never
 * leaves the app waiting for ever.
 */
function call<T extends 'result' | 'loaded'>(req: WithoutId<WorkerRequest>, onProgress?: Pending['onProgress'], transfer: Transferable[] = [], stallMs = 120_000) {
  const id = nextId++
  return new Promise<Extract<WorkerResponse, { type: T }>>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending.delete(id)
        // The worker may be stuck mid-download or mid-inference: start a fresh one next time.
        worker?.terminate()
        worker = null
        for (const p of pending.values()) p.reject(new Error('The speech model stopped responding.'))
        pending.clear()
        reject(new Error('The speech model stopped responding.'))
      }, stallMs)
    }
    arm()
    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r as Extract<WorkerResponse, { type: T }>)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
      onProgress: (l, t) => {
        arm()
        onProgress?.(l, t)
      },
    })
    getWorker().postMessage({ ...req, id } as WorkerRequest, transfer)
  })
}

// ---------- model download / cache ----------

/** Whether the model's files are already on this device (so it works offline). */
export async function isWhisperCached(size: WhisperSize): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(CACHE_NAME)
    const keys = (await cache.keys()).map((r) => r.url)
    return WHISPER_MODELS[size].repos.some((repo) => {
      const files = keys.filter((u) => u.includes(`/${repo}/`))
      return files.filter((u) => u.endsWith('.onnx')).length >= 2 && files.some((u) => u.endsWith('tokenizer.json'))
    })
  } catch {
    return false
  }
}

/** Downloads (first time) and loads the model. Reports bytes as they arrive. */
export async function prepareWhisper(size: WhisperSize, onProgress?: (fraction: number) => void) {
  if (!navigator.onLine && !(await isWhisperCached(size)))
    throw new TranscriptionError('The speech model isn’t on this phone yet. Connect once to download it.', 'offline')
  try {
    await call<'loaded'>({ type: 'load', repos: WHISPER_MODELS[size].repos }, (l, t) => t > 0 && onProgress?.(Math.min(1, l / t)))
  } catch (err) {
    throw toTranscriptionError(err)
  }
}

/** Removes downloaded model files (frees ~50-80 MB). */
export async function deleteWhisperModels() {
  worker?.terminate()
  worker = null
  for (const p of pending.values()) p.reject(new Error('Model removed'))
  pending.clear()
  if (typeof caches === 'undefined') return
  const cache = await caches.open(CACHE_NAME)
  for (const req of await cache.keys()) if (/whisper/i.test(req.url)) await cache.delete(req)
}

function toTranscriptionError(err: unknown): TranscriptionError {
  if (err instanceof TranscriptionError) return err
  const text = String(err instanceof Error ? err.message : err)
  if (!navigator.onLine || /fetch|network|Failed to load|load failed/i.test(text))
    return new TranscriptionError('Couldn’t download the speech model. It will try again when you’re online.', 'offline')
  if (/memory|allocation|OOM|RangeError/i.test(text))
    return new TranscriptionError('This phone ran out of memory for the speech model. Try the Light model in Settings.', 'service')
  return new TranscriptionError(`On-device transcription failed (${text.slice(0, 120)}).`, 'service')
}

// ---------- audio ----------

export async function decodeTo16k(blob: Blob, range?: { start: number; end: number }): Promise<Float32Array> {
  let buffer: AudioBuffer
  try {
    const bytes = await blob.arrayBuffer()
    // Decode at the file's own rate, then resample: some browsers (older Safari) can't decode straight to 16 kHz.
    const probe = new OfflineAudioContext(1, 1, 44100)
    const decoded = await probe.decodeAudioData(bytes)
    const from = range ? Math.max(0, Math.floor(range.start * decoded.sampleRate)) : 0
    const to = range ? Math.min(decoded.length, Math.ceil(range.end * decoded.sampleRate)) : decoded.length
    const frames = Math.max(1, to - from)
    const length = Math.max(1, Math.ceil((frames / decoded.sampleRate) * SAMPLE_RATE))
    const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE)
    const src = ctx.createBufferSource()
    const slice = ctx.createBuffer(decoded.numberOfChannels, frames, decoded.sampleRate)
    for (let c = 0; c < decoded.numberOfChannels; c++) slice.copyToChannel(decoded.getChannelData(c).subarray(from, to), c)
    src.buffer = slice
    src.connect(ctx.destination)
    src.start()
    buffer = await ctx.startRendering()
  } catch {
    throw new TranscriptionError('This recording couldn’t be decoded for transcription.', 'unreadable')
  }
  return buffer.getChannelData(0).slice()
}

/** Energy per 50 ms frame. */
function frameEnergy(audio: Float32Array) {
  const step = SAMPLE_RATE / 20
  const out = new Float32Array(Math.ceil(audio.length / step))
  for (let f = 0; f < out.length; f++) {
    let s = 0
    const end = Math.min(audio.length, (f + 1) * step)
    for (let i = f * step; i < end; i++) s += audio[i] * audio[i]
    out[f] = Math.sqrt(s / Math.max(1, end - f * step))
  }
  return out
}

/** Cuts long audio into ≤28 s windows at the quietest moment between 18 and 28 s. */
export function splitWindows(audio: Float32Array): { start: number; end: number }[] {
  const total = audio.length / SAMPLE_RATE
  if (total <= MAX_WINDOW_SEC) return [{ start: 0, end: total }]
  const energy = frameEnergy(audio)
  const windows: { start: number; end: number }[] = []
  let start = 0
  while (total - start > MAX_WINDOW_SEC) {
    const lo = Math.floor((start + MIN_WINDOW_SEC) * 20)
    const hi = Math.min(energy.length - 1, Math.floor((start + MAX_WINDOW_SEC) * 20))
    let best = hi
    for (let f = lo; f <= hi; f++) if (energy[f] < energy[best]) best = f
    const cut = best / 20
    windows.push({ start, end: cut })
    start = cut
  }
  windows.push({ start, end: total })
  return windows
}

// ---------- transcript shaping ----------

/** Non-speech annotations Whisper sometimes emits. */
const NON_SPEECH = /^[[(].*[\])]$|^♪+$/

export function chunksToWords(chunks: WhisperChunk[], offset: number, windowEnd: number): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const c of chunks) {
    const raw = c.text.trim()
    if (!raw || NON_SPEECH.test(raw)) continue
    const [from, to] = c.timestamp
    // One chunk can hold several tokens ("U.S." or "well-known") or, rarely, two words.
    for (const token of raw.split(/\s+/)) {
      // Abbreviations like "U.S." keep their dots and don't end a sentence.
      const abbr = token.match(/^["'“‘(]*((?:[A-Za-z]\.){2,})([,!?;:]*)["'”’)]*$/)
      const m = abbr ?? token.match(/^["'“‘(]*(.*?)([.,!?;:…]*)["'”’)]*$/)
      const text = m?.[1] ?? token
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue
      const start = Math.min(windowEnd, offset + from)
      const end = Math.min(windowEnd, offset + (to ?? from + 0.3))
      words.push({ text, start, end: Math.max(start + 0.05, end), punct: m?.[2] ? m[2].replace('…', '.') : undefined })
    }
  }
  return words
}

/** Whisper can loop on silence ("Thank you. Thank you. Thank you."): drop a phrase repeated 3+ times in a row. */
export function dropLoops(words: TranscriptWord[]): TranscriptWord[] {
  const norm = (w: TranscriptWord) => w.text.toLowerCase()
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + n * 3 <= words.length; i++) {
      let reps = 1
      while (i + n * (reps + 1) <= words.length && words.slice(i + n * reps, i + n * (reps + 1)).every((w, k) => norm(w) === norm(words[i + k]))) reps++
      if (reps >= 3) return dropLoops([...words.slice(0, i + n), ...words.slice(i + n * reps)])
    }
  }
  return words
}

export function wordsToText(words: TranscriptWord[]) {
  return words.map((w) => w.text + (w.punct ?? '')).join(' ')
}

/** Transcribes a recording (or a range of it) on the device. */
export async function transcribeWithWhisper(
  blob: Blob,
  size: WhisperSize,
  opts: { range?: { start: number; end: number }; onProgress?: (fraction: number) => void } = {},
): Promise<Transcription> {
  await prepareWhisper(size)
  const audio = await decodeTo16k(blob, opts.range)
  const seconds = audio.length / SAMPLE_RATE
  const windows = splitWindows(audio)
  const words: TranscriptWord[] = []
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const slice = audio.slice(Math.floor(w.start * SAMPLE_RATE), Math.floor(w.end * SAMPLE_RATE))
    // Silent windows make Whisper invent text; skip them.
    let peak = 0
    for (let k = 0; k < slice.length; k++) peak = Math.max(peak, Math.abs(slice[k]))
    if (peak < 0.01 || w.end - w.start < 0.3) continue
    let result: Extract<WorkerResponse, { type: 'result' }>
    try {
      // Up to 28 s of audio; even a slow phone finishes well inside 5 minutes.
      result = await call<'result'>({ type: 'transcribe', repos: WHISPER_MODELS[size].repos, audio: slice }, undefined, [slice.buffer], 300_000)
    } catch (err) {
      throw toTranscriptionError(err)
    }
    words.push(...chunksToWords(result.chunks, w.start, w.end))
    opts.onProgress?.((i + 1) / windows.length)
  }
  const clean = dropLoops(words)
  return { text: wordsToText(clean), words: clean, audioSeconds: seconds }
}
