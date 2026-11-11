/**
 * Quick review made on the phone, with no AI and no connection. It fills the
 * same SpeechAnalysis / CoachingFeedback shapes as the AI coach, so feedback,
 * retry, comparison and trends all work offline. It only reports what can be
 * measured reliably from the words and their timing; judgements that need
 * understanding (grammar, logic) are left to the AI when it's available.
 */
import type { CoachingFeedback, CoachRequest, SpeechAnalysis, TechniqueTag } from './analysisTypes'
import type { SpeechMetrics } from './metrics'
import type { TranscriptWord } from './transcribe'

type Task = CoachRequest['task']

const PURE = new Set(['um', 'uh', 'er', 'erm', 'uhm', 'hmm', 'mm', 'ah', 'eh', 'umm', 'uhh'])
/** Words that are usually fillers in speech, though they can carry meaning. */
const SOFT = new Set(['basically', 'actually', 'literally', 'honestly', 'obviously'])
const MULTI: string[][] = [
  ['you', 'know'],
  ['i', 'mean'],
  ['kind', 'of'],
  ['sort', 'of'],
  ['you', 'see'],
]
const STOP = new Set(
  'a an the and or but so to of in on at for with by from as is are was were be been being it its this that these those i you he she we they me my your our their his her them us do does did have has had not no yes if then than there here what which who whom when where why how all any some can could would should will just very also about into over more most such only own same too s t don dont im its thats can cant wont isnt arent wasnt one get got make like really things thing lot well'.split(
    ' ',
  ),
)

/** Long-winded phrases with a tighter alternative. */
const WORDY: [RegExp, string][] = [
  [/\bwhat i(?:'m| am) (?:basically |really )?trying to say is\b/, 'say the point directly'],
  [/\bdue to the fact that\b/, 'because'],
  [/\bin order to\b/, 'to'],
  [/\bat the end of the day\b/, 'ultimately'],
  [/\bin terms of\b/, 'for / in'],
  [/\bthe thing is(?: that)?\b/, 'start with the point'],
  [/\bat this point in time\b/, 'now'],
  [/\bfor the purpose of\b/, 'to / for'],
  [/\bit is important to note that\b/, 'drop it and state the fact'],
  [/\ba lot of different\b/, 'many'],
  [/\bin the event that\b/, 'if'],
  [/\bhas the ability to\b/, 'can'],
  [/\bwith regards? to\b/, 'about'],
]

const norm = (w: TranscriptWord) => w.text.toLowerCase().replace(/[^a-z0-9']/g, '')
const endsSentence = (w: TranscriptWord) => !!w.punct && /[.!?]/.test(w.punct)

function sentences(words: TranscriptWord[]): [number, number][] {
  const out: [number, number][] = []
  let from = 0
  words.forEach((w, i) => {
    if (endsSentence(w) || i === words.length - 1) {
      out.push([from, i])
      from = i + 1
    }
  })
  return out
}

const quote = (words: TranscriptWord[], i: number, span = 6) =>
  `“${words
    .slice(Math.max(0, i - 2), i + span)
    .map((w) => w.text + (w.punct ?? ''))
    .join(' ')}…”`

function contentWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 3 && !STOP.has(w))
}

/** Very light stemming so "maintenance"/"maintain", "failures"/"failure" match. */
const stem = (w: string) => w.replace(/(ations?|ments?|ness|ing|ed|es|s|ly)$/, '').slice(0, 7)

function fillersIn(words: TranscriptWord[], metrics: SpeechMetrics): SpeechAnalysis['fillers'] {
  const pauseBefore = new Set(metrics.pauses.map((p) => p.beforeWord))
  const out: SpeechAnalysis['fillers'] = []
  const position = (i: number) =>
    i === 0 || endsSentence(words[i - 1]) ? 'sentence-start' : pauseBefore.has(i) || pauseBefore.has(i + 1) ? 'word-search' : 'mid-sentence'
  for (let i = 0; i < words.length; i++) {
    const w = norm(words[i])
    const next = words[i + 1] && norm(words[i + 1])
    const multi = MULTI.find(([a, b]) => w === a && next === b)
    if (multi) {
      // "you know" as a question ("do you know") or "kind of car" mid-noun phrase is real speech; require a comma or pause around it.
      const prev = words[i - 1]
      const framed = !prev || /[,.!?]/.test(prev.punct ?? '') || /[,]/.test(words[i + 1].punct ?? '') || pauseBefore.has(i) || pauseBefore.has(i + 2)
      const isQuestion = prev && ['do', 'did', 'does', 'if', 'what', 'don\'t', 'dont'].includes(norm(prev))
      if (framed && !isQuestion) out.push({ text: multi.join(' '), wordIndex: i, position: position(i) })
      if (framed && !isQuestion) i++
      continue
    }
    if (PURE.has(w)) out.push({ text: words[i].text, wordIndex: i, position: position(i) })
    else if (SOFT.has(w)) out.push({ text: words[i].text, wordIndex: i, position: position(i) })
    else if (w === 'like') {
      // Filler "like" is set off by commas or pauses; "I like…" / "looks like…" are real uses.
      const prev = words[i - 1]
      const framed = (prev && /,/.test(prev.punct ?? '')) || /,/.test(words[i].punct ?? '') || pauseBefore.has(i) || pauseBefore.has(i + 1)
      const verbUse = prev && ['i', 'you', 'we', 'they', 'would', 'looks', 'look', 'feel', 'feels', 'seems', 'something', 'just', 'not', "don't", 'dont', 'did', 'do', 'really'].includes(norm(prev))
      if (framed && !verbUse) out.push({ text: words[i].text, wordIndex: i, position: position(i) })
    }
  }
  // "So" opening most sentences is a habit, not a connector.
  const soStarts = sentences(words).filter(([a]) => norm(words[a]) === 'so').map(([a]) => a)
  if (soStarts.length >= 3) for (const a of soStarts) out.push({ text: words[a].text, wordIndex: a, position: 'sentence-start' })
  return out.sort((a, b) => a.wordIndex - b.wordIndex)
}

function restartsIn(words: TranscriptWord[]): SpeechAnalysis['restarts'] {
  const out: SpeechAnalysis['restarts'] = []
  for (let i = 0; i < words.length; i++) {
    for (const n of [3, 2, 1]) {
      if (i + 2 * n > words.length) continue
      const a = words.slice(i, i + n).map(norm)
      const b = words.slice(i + n, i + 2 * n).map(norm)
      // "very very" or "that that" can be deliberate; single-word repeats only count for function words.
      if (a.join(' ') !== b.join(' ') || !a.join('')) continue
      if (n === 1 && !STOP.has(a[0]) && !['i'].includes(a[0])) continue
      out.push({ wordIndex: i, kind: 'restart', note: `Started “${words.slice(i, i + n).map((w) => w.text).join(' ')}” twice` })
      i += 2 * n - 1
      break
    }
  }
  return out
}

function repetitionsIn(words: TranscriptWord[]): SpeechAnalysis['repetitions'] {
  const out: SpeechAnalysis['repetitions'] = []
  // Same sentence opening (first two words) three or more times.
  const openings = new Map<string, number[]>()
  for (const [a, b] of sentences(words)) {
    if (b - a < 3) continue
    const key = `${norm(words[a])} ${norm(words[a + 1])}`
    openings.set(key, [...(openings.get(key) ?? []), a])
  }
  for (const [key, idx] of openings) if (idx.length >= 3) out.push({ text: key, wordIndexes: idx, kind: 'opening', deliberate: false })
  // A content word leaned on far more than the rest of the vocabulary.
  const counts = new Map<string, number[]>()
  words.forEach((w, i) => {
    const t = norm(w)
    if (t.length > 3 && !STOP.has(t) && !SOFT.has(t)) counts.set(t, [...(counts.get(t) ?? []), i])
  })
  const limit = Math.max(4, Math.round(words.length / 40))
  for (const [t, idx] of counts) if (idx.length > limit) out.push({ text: t, wordIndexes: idx, kind: 'word', deliberate: false })
  return out.slice(0, 5)
}

function sentenceIssuesIn(words: TranscriptWord[]): SpeechAnalysis['sentenceIssues'] {
  const out: SpeechAnalysis['sentenceIssues'] = []
  for (const [a, b] of sentences(words)) {
    const len = b - a + 1
    const ands = words.slice(a, b + 1).filter((w) => ['and', 'but', 'so', 'then'].includes(norm(w))).length
    if (len > 40 || (len > 25 && ands >= 4))
      out.push({ wordIndex: a, kind: len > 40 ? 'run-on' : 'too-many-ideas', note: `One sentence of ${len} words joined with ${ands} “and/but/so”s` })
  }
  return out
}

function concisenessIn(words: TranscriptWord[]): SpeechAnalysis['conciseness'] {
  const text = words.map(norm)
  const joined = text.join(' ')
  const out: SpeechAnalysis['conciseness'] = []
  for (const [re, tighter] of WORDY) {
    const m = re.exec(joined)
    if (!m) continue
    const wordIndex = joined.slice(0, m.index).split(' ').filter(Boolean).length
    out.push({ wordIndex: Math.min(wordIndex, words.length - 1), said: m[0], tighter })
  }
  return out
}

function mainPoint(words: TranscriptWord[], prompt: string, task: Task): SpeechAnalysis['organisation']['mainPoint'] {
  const keys = new Set(contentWords(prompt).map(stem))
  if (!keys.size || task === 'words' || task === 'shadowing') return 'first'
  const sents = sentences(words)
  const hit = sents.findIndex(([a, b]) => words.slice(a, b + 1).some((w) => keys.has(stem(norm(w)))))
  if (hit < 0) return words.length > 30 ? 'missing' : 'early'
  const at = sents[hit][0] / Math.max(1, words.length)
  return hit === 0 ? 'first' : at < 0.25 ? 'early' : 'late'
}

function contentCheck(words: TranscriptWord[], reference: string): NonNullable<SpeechAnalysis['content']> {
  const said = new Set(words.map((w) => stem(norm(w))))
  const counts = new Map<string, { word: string; n: number }>()
  for (const w of contentWords(reference)) {
    const s = stem(w)
    const e = counts.get(s) ?? { word: w, n: 0 }
    e.n++
    counts.set(s, e)
  }
  // Key terms: the reference's most frequent content words (proper nouns and repeated terms carry the idea).
  const keys = [...counts.entries()]
    .filter(([, e]) => e.n >= 2 || /^[A-Z]/.test(reference.match(new RegExp(`\\b${e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'))?.[0] ?? ''))
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 10)
  const remembered = keys.filter(([s]) => said.has(s)).map(([, e]) => e.word)
  const missed = keys.filter(([s]) => !said.has(s)).map(([, e]) => e.word)
  // Copied wording: six or more words in a row taken from the reference.
  const ref = reference.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ')
  const copied: string[] = []
  const t = words.map(norm)
  for (let i = 0; i + 6 <= t.length; i++) {
    let n = 6
    if (!ref.includes(t.slice(i, i + n).join(' '))) continue
    while (i + n < t.length && ref.includes(t.slice(i, i + n + 1).join(' '))) n++
    copied.push(words.slice(i, i + n).map((w) => w.text).join(' '))
    i += n - 1
  }
  return { remembered, missed, incorrect: [], copiedPhrases: copied.slice(0, 3) }
}

function deliveryNotes(m: SpeechMetrics): string[] {
  const out: string[] = []
  if (m.wpm != null && m.wpm > 175) out.push(`Fast overall (${m.wpm} words a minute). Around 130–160 is easy to follow.`)
  if (m.wpm != null && m.wpm < 105 && m.wordCount > 20) out.push(`Slow overall (${m.wpm} words a minute), mostly from hesitation.`)
  if (m.fastEndings.length) out.push(`${m.fastEndings.length} sentence ${m.fastEndings.length === 1 ? 'ending' : 'endings'} sped up instead of landing.`)
  if (m.rushedBoundaries >= 2) out.push(`${m.rushedBoundaries} sentences ran straight into the next without a pause.`)
  if (m.paceVariation != null && m.paceVariation > 30) out.push(`Pace jumped around a lot between sentences (${m.paceVariation}% variation).`)
  return out
}

export function localAnalysis(input: { task: Task; prompt: string; reference?: string; words: TranscriptWord[]; metrics: SpeechMetrics }): SpeechAnalysis {
  const { task, prompt, reference, words, metrics: m } = input
  const fillers = fillersIn(words, m)
  // Unrecognised voiced sounds right before a pause or at a sentence start are almost always "um/uh".
  const soundFillers = m.unrecognisedSounds.map((_, i) => i)
  const restarts = restartsIn(words)
  const repetitions = repetitionsIn(words)
  const sentenceIssues = sentenceIssuesIn(words)
  const conciseness = concisenessIn(words)
  const point = mainPoint(words, prompt, task)
  const content = (task === 'explain' || task === 'paraphrase') && reference ? contentCheck(words, reference) : null
  const target = task === 'words' ? prompt.toLowerCase().trim() : ''
  const saidTargetWord = task === 'words' ? words.some((w) => norm(w) === target || (target.length > 4 && stem(norm(w)) === stem(target))) : null
  const delivery = deliveryNotes(m)
  const hesitations = m.pauses.filter((p) => p.kind === 'hesitation' || p.kind === 'word-search' || p.kind === 'inside-phrase')
  const deliberate = m.pauses.filter((p) => p.kind === 'deliberate').length
  const minutes = Math.max(0.25, m.durationSec / 60)
  const fillerCount = fillers.length + soundFillers.length

  // Rank the problems by how much a listener would notice them.
  const issues: { score: number; weakness: string; evidence: string; tag: TechniqueTag }[] = []
  if (saidTargetWord) issues.push({ score: 10, weakness: 'Said the target word', evidence: `You said “${prompt}” while describing it.`, tag: 'talking-around-a-word' })
  if (fillerCount) issues.push({ score: (fillerCount / minutes) * 1.2, weakness: 'Fillers interrupt your sentences', evidence: fillers[0] ? `${fillerCount} fillers, e.g. ${quote(words, fillers[0].wordIndex)}` : `${fillerCount} “um”-like sounds`, tag: 'deliberate-pausing' })
  const searches = m.pauses.filter((p) => p.kind === 'word-search')
  if (searches.length) issues.push({ score: searches.length * 2.5, weakness: 'Long stops while searching for words', evidence: `${searches.length} pause${searches.length > 1 ? 's' : ''} of 2.5 s or more, e.g. before ${quote(words, searches[0].beforeWord, 4)}`, tag: 'talking-around-a-word' })
  else if (hesitations.length >= 3) issues.push({ score: hesitations.length * 0.9, weakness: 'Hesitations in the middle of sentences', evidence: `${hesitations.length} mid-sentence pauses, e.g. before ${quote(words, hesitations[0].beforeWord, 4)}`, tag: 'deliberate-pausing' })
  if (restarts.length) issues.push({ score: restarts.length * 1.5, weakness: 'Restarted sentences', evidence: `${restarts[0].note}: ${quote(words, restarts[0].wordIndex)}`, tag: 'short-declaratives' })
  if (point === 'late' || point === 'missing') issues.push({ score: 4, weakness: point === 'late' ? 'The main point came late' : 'No clear main point', evidence: `Your first sentence: ${quote(words, 0, 12)}`, tag: 'direct-opening' })
  if (sentenceIssues.length) issues.push({ score: sentenceIssues.length * 2, weakness: 'Very long sentences', evidence: `${sentenceIssues[0].note}: ${quote(words, sentenceIssues[0].wordIndex, 10)}`, tag: 'short-declaratives' })
  const accidental = repetitions.filter((r) => !r.deliberate)
  if (accidental.length) issues.push({ score: accidental.length * 1.2, weakness: 'Repeated wording', evidence: `“${accidental[0].text}” used ${accidental[0].wordIndexes.length} times`, tag: 'concise-wording' })
  if (conciseness.length) issues.push({ score: conciseness.length, weakness: 'Wordy phrases', evidence: `“${conciseness[0].said}”`, tag: 'concise-wording' })
  if (content?.missed.length && content.missed.length > content.remembered.length) issues.push({ score: 4, weakness: 'Key ideas left out', evidence: `Not mentioned: ${content.missed.slice(0, 4).join(', ')}`, tag: 'explaining-complex-ideas' })
  if (content?.copiedPhrases.length) issues.push({ score: 2, weakness: 'Copied the original wording', evidence: `“${content.copiedPhrases[0]}”`, tag: 'explaining-complex-ideas' })
  if (delivery.length && (m.wpm ?? 140) > 175) issues.push({ score: 3, weakness: 'Speaking too fast', evidence: delivery[0], tag: 'pace-control' })
  else if (m.fastEndings.length >= 2 || m.rushedBoundaries >= 3) issues.push({ score: 2, weakness: 'Rushing between points', evidence: delivery.find((d) => /ending|pause/.test(d)) ?? '', tag: 'pace-control' })
  issues.sort((a, b) => b.score - a.score)

  const strengths: string[] = []
  if (fillerCount === 0 && words.length > 15) strengths.push('No fillers: you let silence do the work.')
  else if (fillerCount / minutes < 2 && words.length > 15) strengths.push('Very few fillers for unscripted speech.')
  if (deliberate >= 2) strengths.push(`You paused at sentence boundaries ${deliberate} times, which helps a listener follow.`)
  if (point === 'first' && task !== 'words' && task !== 'shadowing') strengths.push('You addressed the question in your first sentence.')
  if (m.wpm != null && m.wpm >= 120 && m.wpm <= 170) strengths.push(`Comfortable pace (${m.wpm} words a minute).`)
  if (m.paceVariation != null && m.paceVariation < 18) strengths.push('Steady pace from sentence to sentence.')
  if (!restarts.length && words.length > 20) strengths.push('No restarted sentences.')
  if (task === 'words' && saidTargetWord === false) strengths.push('You described the word without saying it.')
  if (content && content.remembered.length >= content.missed.length && content.remembered.length) strengths.push(`You covered the key ideas: ${content.remembered.slice(0, 4).join(', ')}.`)

  const tags = [...new Set(issues.map((i) => i.tag))].slice(0, 3)
  const top = issues[0]
  return {
    fillers,
    soundFillers,
    repetitions,
    restarts,
    sentenceIssues,
    grammar: [],
    conciseness,
    organisation: { mainPoint: point, structure: '', issues: point === 'late' ? ['The main point came after the opening sentences.'] : [] },
    content,
    saidTargetWord,
    delivery,
    priority: top ? { weakness: top.weakness, evidence: top.evidence } : { weakness: 'Keep building length and detail', evidence: 'No major issue measured in this answer.' },
    strengths: strengths.slice(0, 4),
    techniqueTags: tags.length ? tags : ['argument-development'],
    ranked: issues.map(({ weakness, evidence }) => ({ weakness, evidence })),
  }
}

const WHY: Record<string, string> = {
  'Fillers interrupt your sentences': 'Each filler delays the point and makes the listener wait. A silent pause sounds controlled; “um” sounds unsure.',
  'Long stops while searching for words': 'A long stop mid-sentence breaks the listener’s thread. Describing the idea in simpler words keeps them with you.',
  'Hesitations in the middle of sentences': 'Pauses inside a sentence split ideas apart, so the listener has to rebuild them.',
  'Restarted sentences': 'Starting a sentence twice signals you began speaking before knowing where the sentence was going.',
  'The main point came late': 'The listener spends the opening guessing what you mean. Leading with the point lets every later sentence support it.',
  'No clear main point': 'Without one clear claim, the details have nothing to hang on and the answer feels like a list.',
  'Very long sentences': 'Listeners can’t scroll back. Long sentences with many “and”s make them hold too much at once.',
  'Repeated wording': 'Repeating the same words without adding anything makes the answer feel like it’s circling.',
  'Wordy phrases': 'Warm-up phrases add length but no meaning, and push the point further away.',
  'Key ideas left out': 'An explanation that skips the key ideas leaves the listener with a partial picture.',
  'Copied the original wording': 'Repeating the original word for word shows memory, not understanding. Your own words prove you understood.',
  'Speaking too fast': 'At speed the listener can’t keep up, and important sentences pass without weight.',
  'Rushing between points': 'Without a beat between points, ideas blur together and none of them lands.',
  'Said the target word': 'The exercise trains talking around a word; saying it skips the practice.',
}

const STRUCTURES: Record<Task, string> = {
  words: 'Say what kind of thing it is, then what it does or how it’s used, then one example.',
  questions: 'Point → reason → example → conclusion. State your answer in the first sentence.',
  shadowing: 'Follow the speaker’s phrasing and pauses; keep each sentence to one breath.',
  paraphrase: 'Start with the speaker’s central message in one sentence, then two supporting ideas in your own words.',
  explain: 'What it is → how it works → why it matters → an example.',
  impromptu: 'Open with your position, give two reasons with an example each, then restate the position.',
}

export function localFeedback(task: Task, a: SpeechAnalysis, m: SpeechMetrics): CoachingFeedback {
  const ranked = a.ranked ?? (a.priority.evidence ? [a.priority] : [])
  const realWrong = ranked.slice(0, 3).map((r) => ({ title: r.weakness, evidence: r.evidence }))
  const fillers = a.fillers.length + a.soundFillers.length

  const targets: string[] = []
  const has = (t: string) => realWrong.some((w) => w.title === t)
  if (has('Said the target word')) targets.push('Describe the word without saying it: what kind of thing it is, what it does, an example.')
  if (has('The main point came late') || has('No clear main point')) targets.push('Say your main point in the first sentence.')
  if (has('Fillers interrupt your sentences') || has('Hesitations in the middle of sentences')) targets.push('When you need a moment, stop silently instead of saying “um”.')
  if (has('Long stops while searching for words')) targets.push('If a word won’t come, describe it in simpler words and keep going.')
  if (has('Restarted sentences') || has('Very long sentences')) targets.push('One idea per sentence. Finish it, pause, then start the next.')
  if (has('Speaking too fast') || has('Rushing between points')) targets.push('Pause for a full beat at the end of each sentence.')
  if (has('Key ideas left out')) targets.push(`Mention ${a.content?.missed.slice(0, 3).join(', ')}.`)
  if (has('Copied the original wording')) targets.push('Explain it in your own words, as if to a colleague.')
  if (has('Wordy phrases') || has('Repeated wording')) targets.push('Cut warm-up phrases and say each idea once.')
  if (!targets.length) targets.push('Add one concrete example to support your point.', 'End with one sentence that restates your answer.')

  const fast = (m.wpm ?? 140) > 170
  return {
    wentWell: a.strengths.length ? a.strengths : ['You kept going to the end of the answer.'],
    wentWrong: realWrong.length ? realWrong : [{ title: 'Nothing major measured', evidence: 'Fillers, pauses and pace were all within a comfortable range.' }],
    whyItWeakened: WHY[a.priority.weakness] ?? 'Small issues add up: each one asks a little more effort from the listener.',
    howToStructure: STRUCTURES[task],
    howToDeliver: fast
      ? 'Slow down for the key sentence and pause at every full stop.'
      : fillers
        ? 'Replace each “um” with a silent pause. Silence sounds deliberate.'
        : 'Keep the steady pace and lean on the one word in each sentence that matters most.',
    exampleAnswer: '',
    retryTargets: targets.slice(0, 3),
    talkId: null,
    talkReason: '',
  }
}
