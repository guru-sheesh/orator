/**
 * Microphone recording behind a small service layer (CLAUDE.md §21), so the
 * capture details can change without touching screens.
 *
 * iOS Safari records audio/mp4 (AAC); Chrome/Android records audio/webm (Opus).
 */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
}

export class RecorderError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'no-device' | 'unsupported' | 'insecure' | 'unknown',
  ) {
    super(message)
  }
}

function describe(err: unknown): RecorderError {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return new RecorderError('Microphone access is blocked. Allow it in your browser’s site settings, then try again.', 'denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return new RecorderError('No microphone was found. Connect one or check your phone’s settings.', 'no-device')
  if (name === 'NotReadableError') return new RecorderError('The microphone is in use by another app. Close it and try again.', 'no-device')
  return new RecorderError('Recording couldn’t start. Try again; if it keeps failing, restart the app.', 'unknown')
}

/**
 * One recording at a time. `prepare()` opens the mic (call it from a tap so iOS
 * allows it), `start()` begins capturing, `stop()` resolves with the audio and
 * releases the mic so the system indicator goes away.
 */
export class Recorder {
  private stream: MediaStream | null = null
  private media: MediaRecorder | null = null
  private chunks: Blob[] = []
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private samples: Uint8Array<ArrayBuffer> | null = null
  private startedAt = 0

  async prepare(): Promise<void> {
    if (this.stream) return
    if (!window.isSecureContext) throw new RecorderError('Recording needs a secure (https) connection.', 'insecure')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw new RecorderError('This browser can’t record audio. Use Chrome on Android or Safari on iPhone.', 'unsupported')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      throw describe(err)
    }
    this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser)
    this.samples = new Uint8Array(this.analyser.fftSize)
  }

  async start(): Promise<void> {
    await this.prepare()
    const mimeType = pickMimeType()
    this.chunks = []
    this.media = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined)
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.media.start(1000)
    this.startedAt = performance.now()
  }

  get recording() {
    return this.media?.state === 'recording'
  }

  /** Current input loudness, 0-1. Cheap enough to call every animation frame. */
  level(): number {
    if (!this.analyser || !this.samples) return 0
    this.analyser.getByteTimeDomainData(this.samples)
    let sum = 0
    for (const v of this.samples) {
      const x = (v - 128) / 128
      sum += x * x
    }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 3)
  }

  stop(): Promise<RecordingResult> {
    const media = this.media
    if (!media || media.state === 'inactive') {
      this.release()
      return Promise.reject(new RecorderError('Nothing is being recorded.', 'unknown'))
    }
    return new Promise((resolve) => {
      media.onstop = () => {
        const mimeType = media.mimeType || pickMimeType() || 'audio/webm'
        const result = { blob: new Blob(this.chunks, { type: mimeType }), mimeType, durationMs: performance.now() - this.startedAt }
        this.release()
        resolve(result)
      }
      media.stop()
    })
  }

  /** Stops everything without keeping audio (leaving a screen mid-recording). */
  release() {
    if (this.media && this.media.state !== 'inactive') {
      this.media.onstop = null
      this.media.stop()
    }
    this.media = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
  }
}
