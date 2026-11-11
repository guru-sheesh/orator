/** Messages between the app and the Whisper worker. */
export interface WhisperChunk {
  text: string
  timestamp: [number, number | null]
}

export type WorkerRequest =
  | { type: 'load'; id: number; repos: string[] }
  | { type: 'transcribe'; id: number; repos: string[]; audio: Float32Array }
  | { type: 'unload'; id: number }

export type WorkerResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'status'; id: number; status: 'queued' | 'loading' | 'transcribing' }
  | { type: 'loaded'; id: number; repo: string }
  | { type: 'result'; id: number; text: string; chunks: WhisperChunk[]; wordTimes: boolean }
  | { type: 'error'; id: number; message: string }
