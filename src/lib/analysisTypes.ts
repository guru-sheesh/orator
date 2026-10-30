/**
 * SpeechAnalysis (CLAUDE.md §17) as returned by /api/coach. Coaching feedback is a
 * separate, later call (step 10) to keep each request well inside the 10 s limit.
 * Shared by the app and the Netlify function; the JSON schema below is what the
 * model must follow. Word positions are indices into the transcript sent.
 */

/** Fixed vocabulary so 'Watch this' talks (step 10) can be matched by technique. */
export const TECHNIQUE_TAGS = [
  'direct-opening',
  'deliberate-pausing',
  'strategic-emphasis',
  'parallel-structure',
  'controlled-repetition',
  'argument-development',
  'signposting',
  'short-declaratives',
  'strong-conclusion',
  'pace-control',
  'storytelling',
  'explaining-complex-ideas',
  'concise-wording',
  'talking-around-a-word',
] as const
export type TechniqueTag = (typeof TECHNIQUE_TAGS)[number]

export type FillerPosition = 'sentence-start' | 'word-search' | 'mid-sentence'

export interface SpeechAnalysis {
  fillers: { text: string; wordIndex: number; position: FillerPosition }[]
  /** Unrecognised sounds the model judged to be fillers (index into metrics.unrecognisedSounds). */
  soundFillers: number[]
  repetitions: { text: string; wordIndexes: number[]; kind: 'word' | 'phrase' | 'opening' | 'idea'; deliberate: boolean }[]
  restarts: { wordIndex: number; kind: 'restart' | 'abandoned' | 'incomplete'; note: string }[]
  sentenceIssues: { wordIndex: number; kind: 'run-on' | 'too-many-ideas' | 'awkward' | 'unclear-reference'; note: string }[]
  grammar: { wordIndex: number; said: string; better: string; note: string }[]
  conciseness: { wordIndex: number; said: string; tighter: string }[]
  organisation: { mainPoint: 'first' | 'early' | 'late' | 'missing'; structure: string; issues: string[] }
  /** Read → Hide → Explain and Paraphrase only. */
  content: { remembered: string[]; missed: string[]; incorrect: string[]; copiedPhrases: string[] } | null
  /** Word description only: whether the user said the target word. */
  saidTargetWord: boolean | null
  delivery: string[]
  priority: { weakness: string; evidence: string }
  strengths: string[]
  /** 1-3 techniques that address the main weaknesses; used to pick a talk to watch (step 10). */
  techniqueTags: TechniqueTag[]
}

export interface CoachRequest {
  task: 'words' | 'questions' | 'paraphrase' | 'explain' | 'impromptu' | 'shadowing'
  prompt: string
  /** Passage (explain), clip transcript (paraphrase/shadowing) or target word (words). */
  reference?: string
  /** Transcript with word indices and pause/sound markers, e.g. "0:So 1:the <pause 1.2s> 2:main". */
  transcript: string
  metrics: string
}

const str = { type: 'string' }
const int = { type: 'integer' }
const strs = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties) })
const arr = (items: unknown) => ({ type: 'array', items })
const enm = (...values: string[]) => ({ type: 'string', enum: values })

/** OpenAPI-subset schema accepted by Gemini's responseSchema (and used as Claude tool input_schema). */
export const ANALYSIS_SCHEMA = obj({
  fillers: arr(obj({ text: str, wordIndex: int, position: enm('sentence-start', 'word-search', 'mid-sentence') })),
  soundFillers: arr(int),
  repetitions: arr(obj({ text: str, wordIndexes: arr(int), kind: enm('word', 'phrase', 'opening', 'idea'), deliberate: { type: 'boolean' } })),
  restarts: arr(obj({ wordIndex: int, kind: enm('restart', 'abandoned', 'incomplete'), note: str })),
  sentenceIssues: arr(obj({ wordIndex: int, kind: enm('run-on', 'too-many-ideas', 'awkward', 'unclear-reference'), note: str })),
  grammar: arr(obj({ wordIndex: int, said: str, better: str, note: str })),
  conciseness: arr(obj({ wordIndex: int, said: str, tighter: str })),
  organisation: obj({ mainPoint: enm('first', 'early', 'late', 'missing'), structure: str, issues: strs }),
  content: { ...obj({ remembered: strs, missed: strs, incorrect: strs, copiedPhrases: strs }), nullable: true },
  saidTargetWord: { type: 'boolean', nullable: true },
  delivery: strs,
  priority: obj({ weakness: str, evidence: str }),
  strengths: strs,
  techniqueTags: arr(enm(...TECHNIQUE_TAGS)),
})

/** CoachingFeedback (CLAUDE.md §6, §10), from a second /api/coach call after analysis. */
export interface CoachingFeedback {
  wentWell: string[]
  wentWrong: { title: string; evidence: string }[]
  whyItWeakened: string
  howToStructure: string
  howToDeliver: string
  /** Short improved version of the user's own answer; shown as "Example answer (AI-written)". */
  exampleAnswer: string
  retryTargets: string[]
  /** id from the candidate talks sent, or null when none fits. */
  talkId: string | null
  /** How the recommended talk relates to this answer (general, no timestamps or quotations). */
  talkReason: string
}

export interface FeedbackRequest {
  mode: 'feedback'
  task: CoachRequest['task']
  prompt: string
  reference?: string
  transcript: string
  /** Compact summary of the analysis (priority, fillers, structure…). */
  analysis: string
  talks: { id: string; title: string; speaker: string; tags: string[]; notice: string }[]
}

export const FEEDBACK_SCHEMA = obj({
  wentWell: strs,
  wentWrong: arr(obj({ title: str, evidence: str })),
  whyItWeakened: str,
  howToStructure: str,
  howToDeliver: str,
  exampleAnswer: str,
  retryTargets: strs,
  talkId: { type: 'string', nullable: true },
  talkReason: str,
})