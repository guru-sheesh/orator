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
    // "_timestamped" exports are built for word timing; the Xenova ones are the fallback.
    repos: ['onnx-community/whisper-base.en_timestamped', 'Xenova/whisper-base.en'],
    approxMB: 105,
  },
  tiny: {
    label: 'Light',
    detail: 'About three times faster, a little less accurate. For older phones.',
    repos: ['onnx-community/whisper-tiny.en_timestamped', 'Xenova/whisper-tiny.en'],
    approxMB: 70,
  },
}

const SAMPLE_RATE = 16000
/** Whisper sees 30 s at a time; stay under it and cut at quiet moments so no word is split. */
const MAX_WINDOW_SEC = 28
const MIN_WINDOW_SEC = 18
const CACHE_NAME = 'transformers-cache'
/** No byte for this long during a download (or a long wait in the queue) means it's stuck. */
const LOAD_STALL_MS = 15 * 60_000
/** One ≤28 s window should finish well inside this, even on a slow phone. */
const RUN_STALL_MS = 5 * 60_000
/** Free the model's memory after this long without use. */
const IDLE_UNLOAD_MS = 2 * 60_000

// ---------- worker plumbing ----------

type Pending = {
  resolve: (r: Extract<WorkerResponse, { type: 'result' | 'loaded' }>) => void
  reject: (e: Error) => void
  onMessage: (msg: WorkerResponse) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
let idleTimer: ReturnType<typeof setTimeout> | undefined

function resetWorker(reason: string) {
  worker?.terminate()
  worker = null
  const err = new Error(reason)
  const waiting = [...pending.values()]
  pending.clear()
  for (const p of waiting) p.reject(err)
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    p.onMessage(msg)
    if (msg.type === 'progress' || msg.type === 'status') return
    pending.delete(msg.id)
    if (msg.type === 'error') p.reject(new Error(msg.message))
    else p.resolve(msg)
  }
  // A crash (often out of memory on older phones) kills the worker: fail everything waiting and start fresh next time.
  worker.onerror = (e) => {
    e.preventDefault?.()
    resetWorker(e.message || 'The speech model stopped unexpectedly (possibly out of memory).')
  }
  return worker
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

/**
 * Sends one request to the worker. A watchdog fails it if the worker goes
 * quiet: long while downloading or queued (progress re-arms it), shorter once
 * inference has started.
 */
function call<T extends 'result' | 'loaded'>(req: WithoutId<WorkerRequest>, onProgress?: (loaded: number, total: number) => void, transfer: Transferable[] = []) {
  const id = nextId++
  clearTimeout(idleTimer)
  return new Promise<Extract<WorkerResponse, { type: T }>>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('stopped responding'))
        // The worker may be stuck mid-download or mid-inference: start a fresh one next time.
        resetWorker('stopped responding')
      }, ms)
    }
    arm(LOAD_STALL_MS)
    const finish = () => {
      clearTimeout(timer)
      if (pending.size === 0) {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => void unloadWhisper(), IDLE_UNLOAD_MS)
      }
    }
    pending.set(id, {
      resolve: (r) => {
        finish()
        resolve(r as Extract<WorkerResponse, { type: T }>)
      },
      reject: (e) => {
        finish()
        reject(e)
      },
      onMessage: (msg) => {
        if (msg.type === 'progress') {
          arm(LOAD_STALL_MS)
          onProgress?.(msg.loaded, msg.total)
        } else if (msg.type === 'status') arm(msg.status === 'transcribing' ? RUN_STALL_MS : LOAD_STALL_MS)
      },
    })
    getWorker().postMessage({ ...req, id } as WorkerRequest, transfer)
  })
}

/** Frees the model's memory (it reloads from the phone's cache on next use). */
export async function unloadWhisper() {
  if (!worker || pending.size) return
  resetWorker('unloaded')
}

// ---------- model download / cache ----------

/** Whether the model's files and the speech runtime are already on this device (so it works offline). */
export async function isWhisperCached(size: WhisperSize): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(CACHE_NAME)
    const keys = (await cache.keys()).map((r) => r.url)
    const runtime = keys.some((u) => /ort-wasm[^/]*\.wasm$/.test(u))
    return (
      runtime &&
      WHISPER_MODELS[size].repos.some((repo) => {
        const files = keys.filter((u) => u.includes(`/${repo}/`))
        return files.filter((u) => u.endsWith('.onnx')).length >= 2 && files.some((u) => u.endsWith('tokenizer.json'))
      })
    )
  } catch {
    return false
  }
}

/** Downloads (first time) and loads the model. Reports bytes as they arrive. */
export async function prepareWhisper(size: WhisperSize, onProgress?: (fraction: number) => void) {
  if (!navigator.onLine && !(await isWhisperCached(size)))
    throw new TranscriptionError('You’re offline and the speech model isn’t on this phone yet. It downloads when you reconnect.', 'offline')
  try {
    await call<'loaded'>({ type: 'load', repos: WHISPER_MODELS[size].repos }, (l, t) => t > 0 && onProgress?.(Math.min(1, l / t)))
  } catch (err) {
    throw toTranscriptionError(err, 'load')
  }
}

/** Removes downloaded model files and the speech runtime (frees ~100 MB). */
export async function deleteWhisperModels() {
  resetWorker('Model removed')
  if (typeof caches === 'undefined') return
  const cache = await caches.open(CACHE_NAME)
  for (const req of await cache.keys()) if (/whisper|ort-wasm/i.test(req.url)) await cache.delete(req)
}

function toTranscriptionError(err: unknown, phase: 'load' | 'run'): TranscriptionError {
  if (err instanceof TranscriptionError) return err
  const text = String(err instanceof Error ? err.message : err)
  if (/memory|allocation|OOM|RangeError/i.test(text))
    return new TranscriptionError('This phone ran out of memory for the speech model. Try the Light model in Settings.', 'service')
  if (/Model removed/.test(text)) return new TranscriptionError('The speech model was removed. Download it again in Settings.', 'offline')
  if (phase === 'load') {
    if (!navigator.onLine) return new TranscriptionError('You’re offline and the speech model isn’t on this phone yet. It downloads when you reconnect.', 'offline')
    if (/fetch|network|Failed to load|load failed|stopped responding|unloaded/i.test(text))
      return new TranscriptionError('Couldn’t download the speech model. The recording is saved and will be transcribed once the model downloads.', 'offline')
  }
  if (/stopped responding/i.test(text)) return new TranscriptionError('Transcription took too long on this phone. Try the Light model in Settings.', 'service')
  return new TranscriptionError(`On-phone transcription failed (${text.slice(0, 120)}).`, 'service')
}

// ---------- audio ----------

/** Mono 16 kHz samples of a recording, or of a range of it (e.g. one clip of a long imported file). */
export async function decodeTo16k(blob: Blob, range?: { start: number; end: number }): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()
  // Most browsers decode straight to 16 kHz here, which keeps memory low.
  try {
    const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes.slice(0))
    return mixRange(decoded, range)
  } catch {
    // Older Safari can't decode at 16 kHz: decode at 44.1 kHz, then resample the needed range.
  }
  try {
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes)
    const from = range ? Math.max(0, Math.floor(range.start * decoded.sampleRate)) : 0
    const to = range ? Math.min(decoded.length, Math.ceil(range.end * decoded.sampleRate)) : decoded.length
    const frames = Math.max(1, to - from)
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((frames / decoded.sampleRate) * SAMPLE_RATE)), SAMPLE_RATE)
    const src = ctx.createBufferSource()
    if (!range) src.buffer = decoded
    else {
      const slice = ctx.createBuffer(decoded.numberOfChannels, frames, decoded.sampleRate)
      for (let c = 0; c < decoded.numberOfChannels; c++) slice.copyToChannel(decoded.getChannelData(c).subarray(from, to), c)
      src.buffer = slice
    }
    src.connect(ctx.destination)
    src.start()
    return (await ctx.startRendering()).getChannelData(0)
  } catch {
    throw new TranscriptionError('This recording couldn’t be decoded for transcription.', 'unreadable')
  }
}

function mixRange(buffer: AudioBuffer, range?: { start: number; end: number }) {
  const from = range ? Math.max(0, Math.floor(range.start * buffer.sampleRate)) : 0
  const to = range ? Math.min(buffer.length, Math.ceil(range.end * buffer.sampleRate)) : buffer.length
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice(from, to)
  const out = new Float32Array(Math.max(0, to - from))
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c)
    for (let i = from; i < to; i++) out[i - from] += ch[i] / buffer.numberOfChannels
  }
  return out
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

/**
 * Whisper can loop on silence ("Thank you. Thank you. Thank you. Thank you.").
 * Only whole sentences of 2+ words repeated 4+ times in a row are dropped, so
 * real stutters ("I I I think") and deliberate repeats stay for the analysis.
 */
export function dropLoops(words: TranscriptWord[]): TranscriptWord[] {
  const norm = (w: TranscriptWord) => w.text.toLowerCase()
  for (let n = 2; n <= 8; n++) {
    for (let i = 0; i + n * 4 <= words.length; i++) {
      if (!/[.!?]/.test(words[i + n - 1].punct ?? '')) continue
      let reps = 1
      while (i + n * (reps + 1) <= words.length && words.slice(i + n * reps, i + n * (reps + 1)).every((w, k) => norm(w) === norm(words[i + k]))) reps++
      if (reps >= 4) return dropLoops([...words.slice(0, i + n), ...words.slice(i + n * reps)])
    }
  }
  return words
}

export function wordsToText(words: TranscriptWord[]) {
  return words.map((w) => w.text + (w.punct ?? '')).join(' ')
}

/** Transcribes a recording (or a range of it) on the device. `wordTimes` is false when timing had to be estimated. */
export async function transcribeWithWhisper(
  blob: Blob,
  size: WhisperSize,
  opts: { range?: { start: number; end: number }; onProgress?: (fraction: number) => void } = {},
): Promise<Transcription & { wordTimes: boolean }> {
  await prepareWhisper(size)
  const audio = await decodeTo16k(blob, opts.range)
  const seconds = audio.length / SAMPLE_RATE
  const windows = splitWindows(audio)
  const words: TranscriptWord[] = []
  let wordTimes = true
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]
    const slice = audio.slice(Math.floor(w.start * SAMPLE_RATE), Math.floor(w.end * SAMPLE_RATE))
    // Silent windows make Whisper invent text; skip them.
    let peak = 0
    for (let k = 0; k < slice.length; k++) peak = Math.max(peak, Math.abs(slice[k]))
    if (peak < 0.01 || w.end - w.start < 0.3) continue
    let result: Extract<WorkerResponse, { type: 'result' }>
    try {
      result = await call<'result'>({ type: 'transcribe', repos: WHISPER_MODELS[size].repos, audio: slice }, undefined, [slice.buffer])
    } catch (err) {
      throw toTranscriptionError(err, 'run')
    }
    if (!result.wordTimes) wordTimes = false
    words.push(...chunksToWords(result.chunks, w.start, w.end))
    opts.onProgress?.((i + 1) / windows.length)
  }
  const clean = dropLoops(words)
  return { text: wordsToText(clean), words: clean, audioSeconds: seconds, wordTimes }
}
