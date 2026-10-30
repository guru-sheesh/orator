/**
 * Pauses and pace computed in the app from word timings (CLAUDE.md §0.5, §5B-C).
 * Silence is not an error: deliberate pauses at boundaries are counted
 * separately from hesitations.
 */
import type { TranscriptWord } from './transcribe'
import { ENVELOPE_RATE } from './audioAnalysis'

export type PauseKind = 'deliberate' | 'hesitation' | 'word-search' | 'inside-phrase'

export interface PauseEvent {
  /** Index of the word after the pause. */
  beforeWord: number
  seconds: number
  kind: PauseKind
}

export interface SoundEvent {
  /** Index of the word after the sound (words.length when at the end). */
  beforeWord: number
  start: number
  seconds: number
}

export interface SpeechMetrics {
  durationSec: number
  wordCount: number
  /** Words per minute while speaking (first to last word). */
  wpm: number | null
  sentenceWpm: number[]
  /** Coefficient of variation of sentence pace, %; higher = less consistent. */
  paceVariation: number | null
  /** Sentences noticeably faster than the speaker's median pace. */
  rushedSentences: number[]
  /** Sentences whose last words sped up. */
  fastEndings: number[]
  /** Sentence boundaries with almost no pause (rushing into the next point). */
  rushedBoundaries: number
  pauses: PauseEvent[]
  /** Voiced sound with no recognised word: often a filler the recogniser dropped ("um"). */
  unrecognisedSounds: SoundEvent[]
}

const PAUSE_MIN = 0.3
const HESITATION_MIN = 0.7
const WORD_SEARCH_MIN = 2.5
/** Words that lead into a phrase; a pause straight after them splits the phrase. */
const PHRASE_OPENERS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'very', 'and', 'but', 'is', 'are', 'was', 'were', 'be'])

const endsSentence = (w: TranscriptWord) => !!w.punct && /[.!?]/.test(w.punct)
const endsClause = (w: TranscriptWord) => !!w.punct && /[,;:]/.test(w.punct)

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function computeMetrics(words: TranscriptWord[], durationSec: number, envelope?: Uint8Array): SpeechMetrics {
  const pauses: PauseEvent[] = []
  let rushedBoundaries = 0
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]
    const gap = words[i].start - prev.end
    const boundary = endsSentence(prev) || endsClause(prev)
    if (endsSentence(prev) && gap < 0.15) rushedBoundaries++
    if (gap < PAUSE_MIN) continue
    let kind: PauseKind
    if (gap >= WORD_SEARCH_MIN) kind = 'word-search'
    else if (boundary) kind = 'deliberate'
    else if (PHRASE_OPENERS.has(prev.text.toLowerCase()) && gap >= 0.5) kind = 'inside-phrase'
    else if (gap >= HESITATION_MIN) kind = 'hesitation'
    else continue // short mid-sentence breath: not worth flagging
    pauses.push({ beforeWord: i, seconds: Math.round(gap * 10) / 10, kind })
  }

  // Sentences from punctuation; per-sentence pace and fast endings.
  const sentences: [number, number][] = []
  let from = 0
  words.forEach((w, i) => {
    if (endsSentence(w) || i === words.length - 1) {
      sentences.push([from, i])
      from = i + 1
    }
  })
  const rate = (a: number, b: number) => {
    const secs = words[b].end - words[a].start
    return secs > 0.5 ? ((b - a + 1) / secs) * 60 : null
  }
  const sentenceWpm: number[] = []
  const rushedSentences: number[] = []
  const fastEndings: number[] = []
  sentences.forEach(([a, b], si) => {
    const r = b - a >= 3 ? rate(a, b) : null
    if (r !== null) sentenceWpm.push(Math.round(r))
    if (r !== null && b - a >= 7) {
      const tail = rate(b - 2, b)
      if (tail !== null && tail > r * 1.35) fastEndings.push(si)
    }
  })
  const med = median(sentenceWpm)
  sentenceWpm.forEach((r, i) => r > med * 1.25 && sentenceWpm.length >= 3 && rushedSentences.push(i))
  const mean = sentenceWpm.reduce((a, b) => a + b, 0) / (sentenceWpm.length || 1)
  const sd = Math.sqrt(sentenceWpm.reduce((a, b) => a + (b - mean) ** 2, 0) / (sentenceWpm.length || 1))

  return {
    durationSec: Math.round(durationSec * 10) / 10,
    wordCount: words.length,
    wpm: words.length > 1 && words.at(-1)!.end > words[0].start ? Math.round((words.length / (words.at(-1)!.end - words[0].start)) * 60) : null,
    sentenceWpm,
    paceVariation: sentenceWpm.length >= 3 ? Math.round((sd / mean) * 100) : null,
    rushedSentences,
    fastEndings,
    rushedBoundaries,
    pauses,
    unrecognisedSounds: envelope ? findUnrecognisedSounds(words, envelope) : [],
  }
}

/**
 * Voiced stretches (150 ms+) where the recogniser produced no word. Azure tends
 * to drop "um"/"uh", so these are likely fillers; the AI decides in context.
 */
function findUnrecognisedSounds(words: TranscriptWord[], envelope: Uint8Array): SoundEvent[] {
  const sorted = Array.from(envelope).sort((a, b) => a - b)
  const speech = sorted[Math.floor(sorted.length * 0.7)] ?? 0
  const threshold = Math.max(10, speech * 0.35)
  const covered = (t: number) => words.some((w) => t >= w.start - 0.1 && t <= w.end + 0.1)
  const events: SoundEvent[] = []
  let runStart = -1
  for (let f = 0; f <= envelope.length; f++) {
    const t = f / ENVELOPE_RATE
    const voiced = f < envelope.length && envelope[f] >= threshold && !covered(t)
    if (voiced && runStart < 0) runStart = f
    if (!voiced && runStart >= 0) {
      const seconds = (f - runStart) / ENVELOPE_RATE
      if (seconds >= 0.15 && seconds <= 2) {
        const start = runStart / ENVELOPE_RATE
        const next = words.findIndex((w) => w.start >= start)
        events.push({ beforeWord: next < 0 ? words.length : next, start: Math.round(start * 100) / 100, seconds: Math.round(seconds * 100) / 100 })
      }
      runStart = -1
    }
  }
  return events
}
