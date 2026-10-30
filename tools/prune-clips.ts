/**
 * Removes clips that aren't the speaker (host introductions, audience Q&A) or
 * aren't suitable to repeat aloud, then renumbers and reshuffles the daily order.
 * Run after build-clips.ts and transcribe-clips.py.
 * Usage: node --experimental-strip-types tools/prune-clips.ts
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Clip numbers (as built, 1-based) to drop, per speech title, after reviewing the transcripts. */
const DROP: Record<string, number[]> = {
  // Host introduction (1-4); racist slogans quoted in a poem (13-14); audience Q&A (36-48).
  'Museum of Contemporary Art talk': [1, 2, 3, 4, 13, 14, ...Array.from({ length: 13 }, (_, i) => 36 + i)],
}

const path = join('public', 'audio', 'clips.json')
const catalogue = JSON.parse(readFileSync(path, 'utf8')) as {
  clips: { id: string; speaker: string; title: string; index: number; of: number }[]
  order: string[]
}

const drop = new Set(catalogue.clips.filter((c) => DROP[c.title]?.includes(c.index)).map((c) => c.id))
for (const id of drop) {
  rmSync(join('public', 'audio', 'clips', `${id}.m4a`), { force: true })
  rmSync(join('public', 'audio', 'transcripts', `${id}.json`), { force: true })
}
const clips = catalogue.clips.filter((c) => !drop.has(c.id))

// Renumber within each speech so the app shows "clip 3 of 29".
const bySpeech = new Map<string, typeof clips>()
for (const c of clips) bySpeech.set(`${c.speaker}|${c.title}`, [...(bySpeech.get(`${c.speaker}|${c.title}`) ?? []), c])
for (const list of bySpeech.values()) list.forEach((c, i) => Object.assign(c, { index: i + 1, of: list.length }))

// Keep the existing shuffle, then repair any same-speaker neighbours the removal created.
const speakerOf = new Map(clips.map((c) => [c.id, c.speaker]))
const order = catalogue.order.filter((id) => !drop.has(id))
for (let i = 1; i < order.length; i++) {
  if (speakerOf.get(order[i]) !== speakerOf.get(order[i - 1])) continue
  const j = order.findIndex((id, k) => k > i && speakerOf.get(id) !== speakerOf.get(order[i - 1]) && speakerOf.get(id) !== speakerOf.get(order[i + 1]))
  if (j > 0) [order[i], order[j]] = [order[j], order[i]]
}

writeFileSync(path, JSON.stringify({ ...catalogue, clips, order }))
const repeats = order.filter((id, i) => i > 0 && speakerOf.get(id) === speakerOf.get(order[i - 1])).length
console.log(`removed ${drop.size}; ${clips.length} clips left; same speaker back-to-back: ${repeats}`)
