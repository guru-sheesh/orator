/// <reference lib="webworker" />
/**
 * On-device Whisper (transformers.js). Runs in a worker so the UI never freezes.
 * Model files and the ONNX runtime are cached by transformers.js in the
 * browser's Cache Storage ("transformers-cache"), so after the first download
 * everything works offline.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse, WhisperChunk } from './whisperProtocol'

env.allowLocalModels = false
env.useBrowserCache = true

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)

interface Loaded {
  repo: string
  pipe: AutomaticSpeechRecognitionPipeline
  wordTimestamps: boolean
}
let loaded: Loaded | null = null
let loading: Promise<Loaded> | null = null
let loadingFor = ''

async function load(repos: string[], requestId: number): Promise<Loaded> {
  const key = repos.join('|')
  if (loaded && repos.includes(loaded.repo)) return loaded
  if (loading && loadingFor === key) return loading
  loadingFor = key
  loading = (async () => {
    if (loaded) {
      await loaded.pipe.dispose().catch(() => {})
      loaded = null
    }
    let lastError: unknown
    for (const repo of repos) {
      try {
        const pipe = (await pipeline('automatic-speech-recognition', repo, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p) => {
            if (p.status === 'progress_total') post({ type: 'progress', id: requestId, loaded: p.loaded, total: p.total })
          },
        })) as AutomaticSpeechRecognitionPipeline
        const next: Loaded = { repo, pipe, wordTimestamps: true }
        loaded = next
        return next
      } catch (err) {
        lastError = err
      }
    }
    throw lastError ?? new Error('No model could be loaded')
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
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

async function transcribe(id: number, repos: string[], audio: Float32Array) {
  const model = await load(repos, id)
  post({ type: 'status', id, status: 'transcribing' })
  if (model.wordTimestamps) {
    try {
      const out = (await model.pipe(audio, { return_timestamps: 'word' })) as { text: string; chunks?: WhisperChunk[] }
      return { text: out.text, chunks: out.chunks ?? [], wordTimes: true }
    } catch (err) {
      // Some exports lack the attention outputs word timing needs; fall back to segment timing.
      if (!/attention|alignment|cross/i.test(String(err))) throw err
      model.wordTimestamps = false
    }
  }
  const out = (await model.pipe(audio, { return_timestamps: true })) as { text: string; chunks?: WhisperChunk[] }
  return { text: out.text, chunks: spreadWords(out.chunks ?? []), wordTimes: false }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      const m = await load(msg.repos, msg.id)
      post({ type: 'loaded', id: msg.id, repo: m.repo })
    } else if (msg.type === 'transcribe') {
      const r = await transcribe(msg.id, msg.repos, msg.audio)
      post({ type: 'result', id: msg.id, ...r })
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
