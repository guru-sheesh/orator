/// <reference lib="webworker" />
/**
 * On-device Whisper (transformers.js). Runs in a worker so the UI never freezes.
 * Model files and the ONNX runtime are cached by transformers.js in the
 * browser's Cache Storage ("transformers-cache"), so after the first download
 * everything works offline.
 *
 * Requests run one at a time (a single chain): two models or two inferences
 * in memory at once would crash older phones.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse, WhisperChunk } from './whisperProtocol'

env.allowLocalModels = false
env.useBrowserCache = true

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)

interface Loaded {
  repo: string
  repos: string[]
  pipe: AutomaticSpeechRecognitionPipeline
}
let loaded: Loaded | null = null
/** Repos that turned out not to support word timing, so they're skipped next time. */
const noWordTiming = new Set<string>()

async function dispose() {
  if (!loaded) return
  await loaded.pipe.dispose().catch(() => {})
  loaded = null
}

/** Loads the first repo in the list that works (skipping `skip`). Progress goes to the request that asked. */
async function load(repos: string[], requestId: number, skip = new Set<string>()): Promise<Loaded> {
  if (loaded && repos.includes(loaded.repo) && !skip.has(loaded.repo)) return loaded
  await dispose()
  let lastError: unknown
  for (const repo of repos) {
    if (skip.has(repo)) continue
    try {
      const pipe = (await pipeline('automatic-speech-recognition', repo, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress_total') post({ type: 'progress', id: requestId, loaded: p.loaded, total: p.total })
          else post({ type: 'status', id: requestId, status: 'loading' })
        },
      })) as AutomaticSpeechRecognitionPipeline
      loaded = { repo, repos, pipe }
      return loaded
    } catch (err) {
      lastError = err
    }
  }
  throw lastError ?? new Error('No speech model could be loaded')
}

/** Splits segment-level chunks into words with times spread by length, when word timing isn't available. */
function spreadWords(chunks: WhisperChunk[]): WhisperChunk[] {
  const out: WhisperChunk[] = []
  for (const c of chunks) {
    const parts = c.text.split(/\s+/).filter(Boolean)
    const [from, to] = c.timestamp
    const end = to ?? from + parts.length * 0.35
    const totalChars = parts.reduce((s, w) => s + w.length + 1, 0) || 1
    let t = from
    for (const w of parts) {
      const d = ((end - from) * (w.length + 1)) / totalChars
      out.push({ text: ` ${w}`, timestamp: [t, t + d] })
      t += d
    }
  }
  return out
}

const isTimingError = (err: unknown) => /attention|alignment|cross|timestamp/i.test(String(err))

async function transcribe(id: number, repos: string[], audio: Float32Array) {
  let model = await load(repos, id, noWordTiming)
  post({ type: 'status', id, status: 'transcribing' })
  // Word timing first; if this export can't do it, try the next model before giving up on it.
  for (;;) {
    try {
      const out = (await model.pipe(audio, { return_timestamps: 'word' })) as { text: string; chunks?: WhisperChunk[] }
      return { text: out.text, chunks: out.chunks ?? [], wordTimes: true }
    } catch (err) {
      if (!isTimingError(err)) throw err
      noWordTiming.add(model.repo)
      if (repos.every((r) => noWordTiming.has(r))) break
      model = await load(repos, id, noWordTiming)
      post({ type: 'status', id, status: 'transcribing' })
    }
  }
  // No model gave word timing: sentence-level timing, spread across words (pauses become approximate).
  model = await load(repos, id)
  const out = (await model.pipe(audio, { return_timestamps: true })) as { text: string; chunks?: WhisperChunk[] }
  return { text: out.text, chunks: spreadWords(out.chunks ?? []), wordTimes: false }
}

async function handle(msg: WorkerRequest) {
  try {
    if (msg.type === 'load') {
      const m = await load(msg.repos, msg.id, noWordTiming)
      post({ type: 'loaded', id: msg.id, repo: m.repo })
    } else if (msg.type === 'transcribe') {
      const r = await transcribe(msg.id, msg.repos, msg.audio)
      post({ type: 'result', id: msg.id, ...r })
    } else if (msg.type === 'unload') {
      await dispose()
      post({ type: 'loaded', id: msg.id, repo: '' })
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}

let chain: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  // Tell the caller its request is queued, so its watchdog knows the worker is alive.
  post({ type: 'status', id: e.data.id, status: 'queued' })
  chain = chain.then(() => handle(e.data)).catch(() => {})
}
