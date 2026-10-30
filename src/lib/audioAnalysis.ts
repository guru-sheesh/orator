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
