/**
 * /api/coach: AI analysis and coaching for one attempt. Receives only the
 * transcript, timing metrics and practice material, never audio or journal
 * text (CLAUDE.md §0.10), and returns strict JSON. Two modes, each its own
 * call so both stay inside Netlify's 10 s limit:
 *   - analysis (default): SpeechAnalysis
 *   - feedback: CoachingFeedback, given the analysis and candidate talks
 * Provider is switchable with AI_PROVIDER = gemini | claude, no code changes needed.
 */
import { ANALYSIS_SCHEMA, FEEDBACK_SCHEMA, type CoachRequest, type FeedbackRequest } from '../../src/lib/analysisTypes.ts'

const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS) || 9_000 // Netlify free functions stop at ~10 s

const TASK_NOTES: Record<CoachRequest['task'], string> = {
  words: 'Word description: the speaker had to describe the reference word WITHOUT saying it. Set saidTargetWord. Reward fluent paraphrasing around the word; note stalls while searching for a word.',
  questions: 'Unexpected question answered after 5 seconds of preparation. Judge speed and quality of thought-to-speech; an optional structure is Point, Reason, Example, Conclusion but do not force it.',
  paraphrase: "Paraphrase of a speech clip (reference = the clip transcript). Fill content: was the central message preserved, what was missed or wrong, and which phrases were copied word for word (copying is NOT rewarded). Also judge organisation and concision.",
  explain: 'Read, Hide, Explain: the speaker read the reference passage once and explained it from memory. Fill content: key concepts remembered, important concepts missed, incorrect statements, phrases copied verbatim. Useful structure: What is it, How does it work, Why does it matter, Example.',
  impromptu: 'Impromptu answer to the question after 10 seconds of preparation. Judge organisation, reasoning, examples, transitions, conclusion. Pick the structure that fits the question type rather than forcing one.',
  shadowing: 'Independent delivery of a practised clip (reference = original transcript). Focus on rhythm, pauses and completeness; content judgement is minimal.',
}

const SHARED_RULES = `- Never treat accent or pronunciation differences as errors. Never infer emotions, confidence, intelligence, personality or mental state.
- No citations, no named sources, no quotations attributed to real people. Generic technique names are fine.
- British English spelling.`

const ANALYSIS_SYSTEM = `You are a speaking coach analysing ONE spoken answer for an adult professional practising articulation.
Input: the task, the prompt, optional reference text, the transcript with word indices like "12:word", pause markers "<pause 1.4s deliberate|hesitation|word-search|inside-phrase>" and "<sound#N 0.4s>" for voiced sounds the recogniser could not turn into words (often "um"/"uh"), plus timing metrics computed from audio.

Rules:
- Evidence must come from the speaker's own words; quote them exactly. Put word indices only in the wordIndex/wordIndexes fields, never inside text (write "So I think", not "0:So").
- Fillers: um, uh, like, basically, actually, you know, I mean, "so" as a filler, etc. Use context: "so" or "like" are fillers only when they carry no meaning. List each occurrence with its index and whether it is at a sentence start, during word search (near a pause/stall), or mid-sentence. In soundFillers list the N of each <sound#N> that is most likely a filler.
- Repetition: separate accidental repetition from deliberate rhetorical repetition.
- Grammar: only errors that make meaning inaccurate, confusing or noticeably awkward. Natural spoken style is fine.
- Silence is not an error. Deliberate pauses at boundaries are good; recommend silence instead of fillers.
- strengths: 1-3 specific things to keep. techniqueTags: 1-3 techniques that address the main weaknesses. priority: the single highest-impact weakness with evidence.
- Keep every string short (under 20 words). Empty arrays when nothing applies. content is null unless the task is explain or paraphrase; saidTargetWord is null unless the task is words.
${SHARED_RULES}`

const FEEDBACK_SYSTEM = `You are a speaking coach giving feedback on ONE spoken answer, using an analysis already done. Speak directly to the speaker ("you").
Answer, in order: what went well; what went wrong (highest impact first, max 3, each with the speaker's exact words as evidence); why it weakened the answer for a listener; how the answer should have been structured; how it should have been delivered (pauses, pace, emphasis); an example answer; 2-3 retry targets.

Rules:
- exampleAnswer: 60-120 words, written to be spoken, re-using THIS speaker's own ideas and points, improved in structure and wording. Output only the answer itself (the app adds the label). Never present it as anyone else's words.
- whyItWeakened: describe the observable effect on a listener (e.g. "the listener waits for your point", "the main idea gets lost"), never how the speaker seems or feels (no uncertain, nervous, confident, unprepared).
- retryTargets: 2-3 concrete, checkable actions for the next attempt (e.g. "State your main point in the first sentence").
- talkId: choose the ONE candidate talk whose techniques best address the main weakness, or null if none fits. Use only an id from the list. talkReason: one sentence on what to watch for, based only on the talk's description; no timestamps, no quotations.
- Be specific, plain and adult. No praise inflation, no exclamation marks. Strings under 30 words except exampleAnswer.
${SHARED_RULES}`

interface Prompt {
  system: string
  user: string
  schema: unknown
}

function analysisPrompt(r: CoachRequest): Prompt {
  const user = [`TASK: ${r.task}. ${TASK_NOTES[r.task]}`, `PROMPT: ${r.prompt}`, r.reference ? `REFERENCE:\n${r.reference}` : '', `METRICS: ${r.metrics}`, r.history ? `SPEAKER HISTORY (use to recognise habitual fillers; judge this answer on its own): ${r.history}` : '', `TRANSCRIPT:\n${r.transcript}`]
  return { system: ANALYSIS_SYSTEM, user: user.filter(Boolean).join('\n\n'), schema: ANALYSIS_SCHEMA }
}

function feedbackPrompt(r: FeedbackRequest): Prompt {
  const talks = r.talks.map((t) => `${t.id}: "${t.title}" by ${t.speaker} [${t.tags.join(', ')}] ${t.notice}`).join('\n')
  const user = [
    `TASK: ${r.task}. ${TASK_NOTES[r.task]}`,
    `PROMPT: ${r.prompt}`,
    r.reference ? `REFERENCE:\n${r.reference}` : '',
    `TRANSCRIPT:\n${r.transcript}`,
    `ANALYSIS:\n${r.analysis}`,
    r.history ? `SPEAKER HISTORY (mention a recurring weakness only if this answer shows it): ${r.history}` : '',
    `CANDIDATE TALKS:\n${talks || '(none)'}`,
  ]
  return { system: FEEDBACK_SYSTEM, user: user.filter(Boolean).join('\n\n'), schema: FEEDBACK_SCHEMA }
}

type Result = { ok: true; data: unknown } | { ok: false; status: number; error: string }

async function callGemini(p: Prompt, key: string, signal: AbortSignal): Promise<Result> {
  // Pinned: measured ~5 s with thinking off; 'latest' aliases were far slower (Oct 2026).
  const model = process.env.AI_MODEL || 'gemini-3.5-flash'
  const body = (thinking: boolean) => ({
    systemInstruction: { parts: [{ text: p.system }] },
    contents: [{ role: 'user', parts: [{ text: p.user }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: p.schema,
      // Thinking adds seconds the 10 s function limit can't afford.
      ...(thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  })
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const send = (thinking: boolean) =>
    fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(thinking)) })
  let res = await send(false)
  // Some models reject a zero thinking budget; retry with the model's default.
  if (res.status === 400 && /thinking/i.test(await res.clone().text())) res = await send(true)
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) }
  const data = (await res.json()) as any
  const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? ''
  return { ok: true, data: JSON.parse(text) }
}

async function callClaude(p: Prompt, key: string, signal: AbortSignal): Promise<Result> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-haiku-5-5',
      max_tokens: 3000,
      temperature: 0.2,
      system: p.system,
      tools: [{ name: 'report', description: 'Return the result.', input_schema: p.schema }],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content: p.user }],
    }),
  })
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) }
  const data = (await res.json()) as any
  const tool = data?.content?.find((c: { type: string }) => c.type === 'tool_use')
  return tool ? { ok: true, data: tool.input } : { ok: false, status: 502, error: 'no tool output' }
}

export default async (req: Request): Promise<Response> => {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return Response.json({ error: 'forbidden' }, { status: 403 })

  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const key = process.env.AI_API_KEY
  if (req.method === 'GET') return Response.json({ provider, configured: !!key })
  if (!key) return Response.json({ error: 'not-configured' }, { status: 503 })

  let body: CoachRequest | FeedbackRequest
  try {
    body = (await req.json()) as CoachRequest | FeedbackRequest
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  if (!body?.transcript || body.transcript.length > 20_000) return Response.json({ error: 'bad-request' }, { status: 400 })
  const prompt = 'mode' in body && body.mode === 'feedback' ? feedbackPrompt(body) : analysisPrompt(body as CoachRequest)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const result = provider === 'claude' ? await callClaude(prompt, key, controller.signal) : await callGemini(prompt, key, controller.signal)
    if (!result.ok) {
      return Response.json({ error: result.status === 429 ? 'rate-limited' : 'provider', detail: result.error }, { status: result.status === 429 ? 429 : 502 })
    }
    return Response.json({ result: result.data, provider }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const timedOut = controller.signal.aborted
    return Response.json({ error: timedOut ? 'timeout' : 'provider', detail: String(err).slice(0, 200) }, { status: timedOut ? 504 : 502 })
  } finally {
    clearTimeout(timer)
  }
}

export const config = { path: '/api/coach' }
