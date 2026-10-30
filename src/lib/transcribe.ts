/**
 * Transcription + pronunciation assessment via Azure Speech, behind a
 * replaceable service layer (CLAUDE.md §0.5, §21). The SDK (~1 MB) loads only
 * when the first transcription runs.
 */

export interface TranscriptWord {
  text: string
  /** Seconds from the start of the recording. */
  start: number
  end: number
  /** Azure pronunciation accuracy 0-100. Used only to flag possibly unclear words, never as a score. */
  accuracy?: number
  /** Punctuation Azure placed after this word in its display text (sentence and clause boundaries). */
  punct?: string
}

export interface Transcription {
  text: string
  words: TranscriptWord[]
  /** Azure's utterance-level scores; kept for analysis, not shown as a headline. */
  scores?: { accuracy?: number; fluency?: number; prosody?: number; completeness?: number }
  audioSeconds: number
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'not-configured' | 'quota' | 'unreadable' | 'service',
  ) {
    super(message)
  }
}

// ---------- token ----------

let cached: { token: string; region: string; expires: number } | null = null

async function getToken() {
  if (cached && cached.expires > Date.now()) return cached
  if (!navigator.onLine) throw new TranscriptionError('You’re offline. The recording is saved and will be transcribed when you’re back online.', 'offline')
  const request = () => fetch('/api/speech-token', { cache: 'no-store' }).catch(() => null)
  let res = await request()
  // One quick retry absorbs transient server or network blips.
  if (!res || (!res.ok && res.status !== 503)) res = await new Promise<Response | null>((r) => setTimeout(() => void request().then(r), 1500))
  if (!res) throw new TranscriptionError('Couldn’t reach the transcription service. It will retry later.', 'offline')
  if (res.status === 503) throw new TranscriptionError('Transcription isn’t set up yet: the Azure key is missing on the server.', 'not-configured')
  if (!res.ok) throw new TranscriptionError('The transcription service refused the request. Check the Azure key and region.', 'service')
  const body = (await res.json()) as { token: string; region: string; expiresInSec: number }
  cached = { token: body.token, region: body.region, expires: Date.now() + (body.expiresInSec - 30) * 1000 }
  return cached
}

// ---------- audio ----------

const SAMPLE_RATE = 16000

/** Decodes any recording the browser can play into 16 kHz mono 16-bit PCM. */
async function toPcm(blob: Blob, range?: { start: number; end: number }): Promise<{ pcm: ArrayBuffer; seconds: number }> {
  let buffer: AudioBuffer
  try {
    buffer = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await blob.arrayBuffer())
  } catch {
    throw new TranscriptionError('This recording couldn’t be decoded for transcription.', 'unreadable')
  }
  const from = range ? Math.floor(range.start * buffer.sampleRate) : 0
  const to = range ? Math.min(buffer.length, Math.ceil(range.end * buffer.sampleRate)) : buffer.length
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    let s = 0
    for (const ch of channels) s += ch[i]
    s = Math.max(-1, Math.min(1, s / channels.length))
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return { pcm: out.buffer, seconds: out.length / SAMPLE_RATE }
}

// ---------- recognition ----------

interface AzureWord {
  Word: string
  Offset: number
  Duration: number
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string }
}
interface AzureResult {
  DisplayText?: string
  NBest?: {
    Display?: string
    Words?: AzureWord[]
    PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; ProsodyScore?: number; CompletenessScore?: number }
  }[]
}

const TICKS = 10_000_000 // Azure offsets are in 100 ns units

/**
 * Transcribes a recording with word timings and pronunciation assessment.
 * `referenceText` switches assessment to scripted mode (shadowing); without it
 * assessment is unscripted.
 */
export async function transcribe(blob: Blob, opts: { referenceText?: string; range?: { start: number; end: number } } = {}): Promise<Transcription> {
  const [{ token, region }, { pcm, seconds }, sdk] = await Promise.all([
    getToken(),
    toPcm(blob, opts.range),
    import('microsoft-cognitiveservices-speech-sdk'),
  ])

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region)
  speechConfig.speechRecognitionLanguage = 'en-US'
  speechConfig.outputFormat = sdk.OutputFormat.Detailed
  speechConfig.requestWordLevelTimestamps()
  speechConfig.setProfanity(sdk.ProfanityOption.Raw)

  const push = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(SAMPLE_RATE, 16, 1))
  push.write(pcm)
  push.close()
  const recognizer = new sdk.SpeechRecognizer(speechConfig, sdk.AudioConfig.fromStreamInput(push))

  const pa = new sdk.PronunciationAssessmentConfig(opts.referenceText ?? '', sdk.PronunciationAssessmentGradingSystem.HundredMark, sdk.PronunciationAssessmentGranularity.Word, !!opts.referenceText)
  pa.enableProsodyAssessment = true
  pa.applyTo(recognizer)

  const results: AzureResult[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      recognizer.recognized = (_s, e) => {
        if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return
        const json = e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)
        if (json) results.push(JSON.parse(json))
      }
      recognizer.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.EndOfStream) return resolve()
        const quota = e.errorCode === sdk.CancellationErrorCode.TooManyRequests
        reject(
          new TranscriptionError(
            quota ? 'Azure’s free monthly limit has been reached.' : `Transcription failed (${e.errorDetails || 'service error'}).`,
            quota ? 'quota' : 'service',
          ),
        )
      }
      recognizer.sessionStopped = () => resolve()
      recognizer.startContinuousRecognitionAsync(undefined, (err) => reject(new TranscriptionError(`Transcription couldn’t start (${err}).`, 'service')))
    })
  } finally {
    recognizer.close()
  }

  const words: TranscriptWord[] = []
  const scores: Required<Transcription>['scores'][] = []
  const parts: string[] = []
  for (const r of results) {
    const best = r.NBest?.[0]
    if (!best) continue
    const display = best.Display ?? r.DisplayText ?? ''
    parts.push(display)
    const tokens = display.split(/\s+/).filter(Boolean)
    let t = 0
    for (const w of best.Words ?? []) {
      // Omissions in scripted mode are words the speaker skipped: not part of what was said.
      if (w.PronunciationAssessment?.ErrorType === 'Omission') continue
      // Align with the display text to recover capitals and punctuation (sentence boundaries).
      let text = w.Word
      let punct: string | undefined
      for (let look = t; look < Math.min(tokens.length, t + 3); look++) {
        const m = tokens[look].match(/^(.*?)([.,!?;:]*)$/)!
        if (normalise(m[1]) === normalise(w.Word)) {
          text = m[1]
          punct = m[2] || undefined
          t = look + 1
          break
        }
      }
      words.push({ text, punct, start: w.Offset / TICKS, end: (w.Offset + w.Duration) / TICKS, accuracy: w.PronunciationAssessment?.AccuracyScore })
    }
    const p = best.PronunciationAssessment
    if (p) scores.push({ accuracy: p.AccuracyScore, fluency: p.FluencyScore, prosody: p.ProsodyScore, completeness: p.CompletenessScore })
  }

  const avg = (k: keyof NonNullable<Transcription['scores']>) => {
    const v = scores.map((s) => s[k]).filter((x): x is number => typeof x === 'number')
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : undefined
  }
  return {
    text: parts.join(' ').trim(),
    words,
    scores: scores.length ? { accuracy: avg('accuracy'), fluency: avg('fluency'), prosody: avg('prosody'), completeness: avg('completeness') } : undefined,
    audioSeconds: seconds,
  }
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '')
