import type { ShadowSegment } from '../data/db'

/** Envelope resolution: one loudness value per 50 ms. */
export const ENVELOPE_RATE = 20
const DECODE_RATE = 8000 // plenty for loudness; keeps decoded memory small on phones
export const MAX_IMPORT_SECONDS = 30 * 60

export interface AudioProfile {
  durationSec: number
  envelope: Uint8Array
}

/**
 * Decodes a file at a low sample rate and reduces it to a loudness envelope.
 * The decoded samples are dropped as soon as the envelope is built.
 */
export async function profileAudio(file: Blob): Promise<AudioProfile> {
  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE)
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  const window = Math.round(buffer.sampleRate / ENVELOPE_RATE)
  const frames = Math.ceil(buffer.length / window)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))

  const rms = new Float32Array(frames)
  let peak = 0
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const from = f * window
    const to = Math.min(buffer.length, from + window)
    for (let i = from; i < to; i++) {
      let s = 0
      for (const ch of channels) s += ch[i]
      s /= channels.length
      sum += s * s
    }
    rms[f] = Math.sqrt(sum / Math.max(1, to - from))
    if (rms[f] > peak) peak = rms[f]
  }

  // Normalise so quiet recordings still show a usable waveform.
  const envelope = new Uint8Array(frames)
  for (let f = 0; f < frames; f++) envelope[f] = peak > 0 ? Math.round((rms[f] / peak) * 255) : 0
  return { durationSec: buffer.duration, envelope }
}

/** Loudness below this fraction of the recording's typical speech level counts as a pause. */
function silenceThreshold(envelope: Uint8Array) {
  const sorted = Array.from(envelope).filter((v) => v > 0).sort((a, b) => a - b)
  const speech = sorted[Math.floor(sorted.length * 0.6)] ?? 0
  return Math.max(4, speech * 0.25)
}

/** Runs of quiet frames as [startFrame, endFrame) with their length. */
function pauses(envelope: Uint8Array, from: number, to: number, threshold: number) {
  const runs: { start: number; end: number }[] = []
  let runStart = -1
  for (let f = from; f < to; f++) {
    const quiet = envelope[f] < threshold
    if (quiet && runStart < 0) runStart = f
    if ((!quiet || f === to - 1) && runStart >= 0) {
      runs.push({ start: runStart, end: quiet ? f + 1 : f })
      runStart = -1
    }
  }
  return runs
}

/**
 * Splits a recording into ~targetSec segments, cutting in the middle of the
 * longest pause near each target point (CLAUDE.md §0.7).
 */
export function splitSegments(envelope: Uint8Array, durationSec: number, targetSec = 60): ShadowSegment[] {
  const threshold = silenceThreshold(envelope)
  const total = envelope.length
  const segments: ShadowSegment[] = []
  let start = 0
  while (start < total) {
    const remaining = (total - start) / ENVELOPE_RATE
    if (remaining <= targetSec * 1.4) {
      segments.push({ start: start / ENVELOPE_RATE, end: durationSec })
      break
    }
    const lo = start + Math.round(targetSec * 0.75 * ENVELOPE_RATE)
    const hi = Math.min(total, start + Math.round(targetSec * 1.25 * ENVELOPE_RATE))
    const runs = pauses(envelope, lo, hi, threshold)
    const ideal = start + targetSec * ENVELOPE_RATE
    // Prefer long pauses, then ones close to the target length.
    const best = runs.sort((a, b) => b.end - b.start - (a.end - a.start) || Math.abs((a.start + a.end) / 2 - ideal) - Math.abs((b.start + b.end) / 2 - ideal))[0]
    const cut = best ? Math.round((best.start + best.end) / 2) : ideal
    segments.push({ start: start / ENVELOPE_RATE, end: cut / ENVELOPE_RATE })
    start = cut
  }
  return segments
}

/**
 * Short phrases inside a segment for the Repeat stage: cuts at pauses of at
 * least 300 ms, merging pieces so each lasts roughly 3–10 seconds.
 */
export function splitPhrases(envelope: Uint8Array, segment: ShadowSegment): ShadowSegment[] {
  const from = Math.floor(segment.start * ENVELOPE_RATE)
  const to = Math.min(envelope.length, Math.ceil(segment.end * ENVELOPE_RATE))
  const minPause = Math.round(0.3 * ENVELOPE_RATE)
  const cuts = pauses(envelope, from, to, silenceThreshold(envelope))
    .filter((r) => r.end - r.start >= minPause)
    .map((r) => Math.round((r.start + r.end) / 2))

  const phrases: ShadowSegment[] = []
  let begin = from
  for (const cut of [...cuts, to]) {
    const len = (cut - begin) / ENVELOPE_RATE
    if (len < 3 && cut !== to) continue
    if (len > 10 && phrases.length === 0 && cut !== to) {
      // No pause early enough: still cut so the first phrase is repeatable.
      phrases.push({ start: begin / ENVELOPE_RATE, end: cut / ENVELOPE_RATE })
      begin = cut
      continue
    }
    phrases.push({ start: begin / ENVELOPE_RATE, end: cut / ENVELOPE_RATE })
    begin = cut
  }
  // Fold a tiny tail into the previous phrase.
  const last = phrases.at(-1)
  if (phrases.length > 1 && last && last.end - last.start < 1.5) {
    phrases.pop()
    phrases[phrases.length - 1].end = last.end
  }
  return phrases
}

const PHRASE_MIN_SEC = 2.5
const PHRASE_MAX_SEC = 12
/** Words that lead into what follows; a phrase must not end on one. */
const LEADING_WORDS = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'these', 'those', 'i', "i'm", "i've", "i'd", "i'll", 'we', 'you', 'he', 'she', 'they', 'it', 'and', 'but', 'or', 'so', 'because', 'if', 'when', 'is', 'are', 'was', 'were', 'be', 'very', 'as'])
/** A gap between sentences longer than this isn't speech worth replaying. */
const LONG_GAP_SEC = 1.2

/** The bits of a transcript word this needs (times in seconds, relative to the clip). */
interface TimedWord {
  text?: string
  start: number
  end: number
  punct?: string
}

/** Words that usually open a new clause: the natural place to break a long sentence that has no comma. */
const JOINING_WORDS = new Set(['and', 'but', 'or', 'so', 'because', 'that', 'which', 'who', 'when', 'where', 'while', 'if', 'then', 'than', 'although', 'though', 'until', 'unless', 'since', 'before', 'after', 'to'])

/**
 * Phrases for the Repeat stage that follow the speaker's sentences: one phrase
 * per sentence, using the transcript's punctuation. Very short sentences join
 * the next one; long ones are divided at a comma (or, failing that, at their
 * longest pause) so each part can be held in mind and repeated. Every phrase
 * ends where a sentence or clause ends, never part-way through one.
 *
 * `offset` is where the clip starts in the recording, as word times are relative
 * to the clip. Returns null when the transcript has no punctuation to go by;
 * the caller then falls back to splitting on pauses alone.
 */
export function splitPhrasesBySentence(words: TimedWord[], offset: number, segment: ShadowSegment, envelope: Uint8Array): ShadowSegment[] | null {
  const merged = phraseWordRanges(words, offset, envelope)
  return merged && phraseTimes(merged, words, offset, segment, envelope)
}

/** Which words make up each Repeat phrase, as [first word, last word]. */
export function phraseWordRanges(words: TimedWord[], offset: number, envelope: Uint8Array): [number, number][] | null {
  if (words.length < 2 || !words.some((w) => /[.!?]/.test(w.punct ?? ''))) return null
  const dur = (a: number, b: number) => words[b].end - words[a].start
  const quiet = silenceThreshold(envelope)
  /** Longest run of silence (seconds) around the boundary between two words. */
  const silenceAround = (endSec: number, nextSec: number) => {
    const lo = Math.max(0, Math.floor((endSec - 0.25) * ENVELOPE_RATE))
    const hi = Math.min(envelope.length - 1, Math.ceil((Math.max(nextSec, endSec) + 0.25) * ENVELOPE_RATE))
    let run = 0
    let longest = 0
    for (let f = lo; f <= hi; f++) {
      run = envelope[f] < quiet ? run + 1 : 0
      if (run > longest) longest = run
    }
    return longest / ENVELOPE_RATE
  }

  // 1. Sentences, as [first word, last word].
  const sentences: [number, number][] = []
  let first = 0
  words.forEach((w, i) => {
    if (/[.!?]/.test(w.punct ?? '') || i === words.length - 1) {
      sentences.push([first, i])
      first = i + 1
    }
  })

  // 2. Divide sentences too long to repeat in one go.
  const divide = ([a, b]: [number, number]): [number, number][] => {
    const total = dur(a, b)
    if (total <= PHRASE_MAX_SEC || b - a < 3) return [[a, b]]
    const middle = words[a].start + total / 2
    const balanced = (i: number) => Math.abs(words[i].end - middle)
    const inside = Array.from({ length: b - a }, (_, k) => a + k) // a break after word i
    // Best: a comma that leaves a repeatable length on both sides.
    const clauses = inside.filter((i) => /[,;:]/.test(words[i].punct ?? '') && dur(a, i) >= 3 && dur(i + 1, b) >= 3)
    let at = clauses.sort((x, y) => balanced(x) - balanced(y))[0]
    if (at === undefined) {
      // No comma: break at a pause in the middle of the sentence, preferring one just before a joining word
      // ("... the report | because it was late"); failing any pause, simply at its middle.
      const central = inside.filter((i) => dur(a, i) >= total * 0.25 && dur(i + 1, b) >= total * 0.25)
      const score = (i: number) => {
        const next = words[i + 1].text ?? ''
        const here = (words[i].text ?? '').toLowerCase()
        // A real silence in the audio (word timings alone often hide it), up to a second.
        let s = Math.min(1, silenceAround(offset + words[i].end, offset + words[i + 1].start))
        // A capital mid-sentence usually means a new sentence the transcript didn't punctuate.
        if (/^[A-Z]/.test(next) && !/^I(\b|')/.test(next)) s += 0.4
        if (JOINING_WORDS.has(next.toLowerCase())) s += 0.25
        // Never leave a phrase hanging on "the", "I", "and"…
        if (LEADING_WORDS.has(here)) s -= 0.8
        return s
      }
      at = central.sort((x, y) => score(y) - score(x) || balanced(x) - balanced(y))[0] ?? inside.sort((x, y) => balanced(x) - balanced(y))[0]
    }
    return [...divide([a, at]), ...divide([at + 1, b])]
  }
  const pieces = sentences.flatMap(divide)

  // 3. Join sentences too short to be worth a turn ("Yes." "Thank you.") to their neighbour.
  const merged: [number, number][] = []
  for (const piece of pieces) {
    const prev = merged.at(-1)
    if (prev && dur(prev[0], prev[1]) < PHRASE_MIN_SEC && dur(prev[0], piece[1]) <= PHRASE_MAX_SEC) prev[1] = piece[1]
    else merged.push([...piece])
  }
  const tail = merged.at(-1)!
  if (merged.length > 1 && dur(tail[0], tail[1]) < PHRASE_MIN_SEC) {
    merged.pop()
    merged.at(-1)![1] = tail[1]
  }

  return merged
}

/** Turns word ranges into play ranges, cutting at the quietest moment between phrases so no word is clipped or carried over. */
function phraseTimes(merged: [number, number][], words: TimedWord[], offset: number, segment: ShadowSegment, envelope: Uint8Array): ShadowSegment[] {
  const clamp = (t: number) => Math.min(segment.end, Math.max(segment.start, t))
  /**
   * The cut between two phrases: the quietest moment in the gap between the last
   * word of one and the first word of the next, never inside either word, so a
   * phrase can't end with the first sound of the next sentence. With no gap
   * (words run together), it's the boundary itself.
   */
  const cutBetween = (lastEnd: number, nextStart: number) => {
    if (nextStart - lastEnd < 0.1) return (lastEnd + Math.max(lastEnd, nextStart)) / 2
    const lo = Math.ceil(lastEnd * ENVELOPE_RATE)
    const hi = Math.floor(nextStart * ENVELOPE_RATE) - 1
    if (hi < lo) return (lastEnd + nextStart) / 2
    let best = lo
    for (let f = lo; f <= hi; f++) if (envelope[f] < envelope[best]) best = f
    return Math.min(nextStart, Math.max(lastEnd, (best + 0.5) / ENVELOPE_RATE))
  }
  return merged
    .map(([a, b], i) => {
      const wordsStart = offset + words[a].start
      const wordsEnd = offset + words[b].end
      // Start: just before the first word, or at the shared cut with the previous phrase when they run together.
      let start = wordsStart - 0.4
      if (i > 0) {
        const prevEnd = offset + words[a - 1].end
        if (wordsStart - prevEnd <= LONG_GAP_SEC) start = cutBetween(prevEnd, wordsStart)
      }
      // End likewise. A long gap (applause, a laugh, a long silence) belongs to neither phrase.
      let end = wordsEnd + 0.6
      if (i < merged.length - 1) {
        const nextStart = offset + words[b + 1].start
        end = nextStart - wordsEnd <= LONG_GAP_SEC ? cutBetween(wordsEnd, nextStart) : Math.min(end, nextStart - 0.4)
      }
      return { start: clamp(start), end: clamp(end) }
    })
    .filter((p) => p.end - p.start > 0.3)
}
