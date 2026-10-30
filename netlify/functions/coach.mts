/**
 * /api/coach: one AI call per attempt (CLAUDE.md §0.6). Receives only the
 * transcript and timing metrics, never audio or journal text (§0.10), and
 * returns strict JSON matching SpeechAnalysis. Provider is switchable with
 * AI_PROVIDER = gemini | claude, no code changes needed.
 */
import { ANALYSIS_SCHEMA, type CoachRequest } from '../../src/lib/analysisTypes.ts'

const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS) || 9_000 // Netlify free functions stop at ~10 s

const TASK_NOTES: Record<CoachRequest['task'], string> = {
  words: 'Word description: the speaker had to describe the reference word WITHOUT saying it. Set saidTargetWord. Reward fluent paraphrasing around the word; note stalls while searching for a word.',
  questions: 'Unexpected question answered after 5 seconds of preparation. Judge speed and quality of thought-to-speech; an optional structure is Point, Reason, Example, Conclusion but do not force it.',
  paraphrase: "Paraphrase of a speech clip (reference = the clip transcript). Fill content: was the central message preserved, what was missed or wrong, and which phrases were copied word for word (copying is NOT rewarded). Also judge organisation and concision.",
  explain: 'Read, Hide, Explain: the speaker read the reference passage once and explained it from memory. Fill content: key concepts remembered, important concepts missed, incorrect statements, phrases copied verbatim. Useful structure: What is it, How does it work, Why does it matter, Example.',
  impromptu: 'Impromptu answer to the question after 10 seconds of preparation. Judge organisation, reasoning, examples, transitions, conclusion. Pick the structure that fits the question type rather than forcing one.',
  shadowing: 'Independent delivery of a practised clip (reference = original transcript). Focus on rhythm, pauses and completeness; content judgement is minimal.',
}

const SYSTEM = `You are a speaking coach analysing ONE spoken answer for an adult professional practising articulation.
Input: the task, the prompt, optional reference text, the transcript with word indices like "12:word", pause markers "<pause 1.4s deliberate|hesitation|word-search|inside-phrase>" and "<sound#N 0.4s>" for voiced sounds the recogniser could not turn into words (often "um"/"uh"), plus timing metrics computed from audio.

Rules:
- Evidence must come from the speaker's own words; quote them exactly. Put word indices only in the wordIndex/wordIndexes fields, never inside text (write "So I think", not "0:So").
- Fillers: um, uh, like, basically, actually, you know, I mean, "so" as a filler, etc. Use context: "so" or "like" are fillers only when they carry no meaning. List each occurrence with its index and whether it is at a sentence start, during word search (near a pause/stall), or mid-sentence. In soundFillers list the N of each <sound#N> that is most likely a filler.
- Repetition: separate accidental repetition from deliberate rhetorical repetition.
- Grammar: only errors that make meaning inaccurate, confusing or noticeably awkward. Natural spoken style is fine.
- Silence is not an error. Deliberate pauses at boundaries are good; recommend silence instead of fillers.
- Never treat accent or pronunciation differences as errors. Never infer emotions, confidence, intelligence, personality or mental state.
- No citations, no named sources, no quotations attributed to real people. Generic technique names are fine.
- strengths: 1-3 specific things to keep. techniqueTags: 1-3 techniques that address the main weaknesses. priority: the single highest-impact weakness with evidence.
- Keep every string short (under 20 words). Empty arrays when nothing applies. content is null unless the task is explain or paraphrase; saidTargetWord is null unless the task is words.
- British English spelling.`

function userMessage(r: CoachRequest) {
  return [
    `TASK: ${r.task}. ${TASK_NOTES[r.task]}`,
    `PROMPT: ${r.prompt}`,
    r.reference ? `REFERENCE:\n${r.reference}` : '',
    `METRICS: ${r.metrics}`,
    `TRANSCRIPT:\n${r.transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

type Result = { ok: true; analysis: unknown } | { ok: false; status: number; error: string }

async function callGemini(req: CoachRequest, key: string, signal: AbortSignal): Promise<Result> {
  // Pinned: measured ~6 s with thinking off; 'latest' aliases were far slower (Oct 2026).
  const model = process.env.AI_MODEL || 'gemini-3.5-flash'
  const body = (thinking: boolean) => ({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: userMessage(req) }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: ANALYSIS_SCHEMA,
      // Thinking adds seconds the 10 s function limit can't afford.
      ...(thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  })
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  let res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(false)) })
  // Some models reject a zero thinking budget; retry with the model's default.
  if (res.status === 400 && /thinking/i.test(await res.clone().text())) {
    res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body(true)) })
  }
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) }
  const data = (await res.json()) as any
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  return { ok: true, analysis: JSON.parse(text) }
}

async function callClaude(req: CoachRequest, key: string, signal: AbortSignal): Promise<Result> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-haiku-5-5',
      max_tokens: 3000,
      temperature: 0.2,
      system: SYSTEM,
      tools: [{ name: 'report_analysis', description: 'Return the speech analysis.', input_schema: ANALYSIS_SCHEMA }],
      tool_choice: { type: 'tool', name: 'report_analysis' },
      messages: [{ role: 'user', content: userMessage(req) }],
    }),
  })
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) }
  const data = (await res.json()) as any
  const tool = data?.content?.find((c: { type: string }) => c.type === 'tool_use')
  return tool ? { ok: true, analysis: tool.input } : { ok: false, status: 502, error: 'no tool output' }
}

export default async (req: Request): Promise<Response> => {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return Response.json({ error: 'forbidden' }, { status: 403 })

  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase()
  const key = process.env.AI_API_KEY
  if (req.method === 'GET') return Response.json({ provider, configured: !!key })
  if (!key) return Response.json({ error: 'not-configured' }, { status: 503 })

  let body: CoachRequest
  try {
    body = (await req.json()) as CoachRequest
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 })
  }
  if (!body?.transcript || body.transcript.length > 20_000) return Response.json({ error: 'bad-request' }, { status: 400 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const result = provider === 'claude' ? await callClaude(body, key, controller.signal) : await callGemini(body, key, controller.signal)
    if (!result.ok) {
      const status = result.status === 429 ? 429 : result.status === 401 || result.status === 403 ? 502 : 502
      return Response.json({ error: result.status === 429 ? 'rate-limited' : 'provider', detail: result.error }, { status })
    }
    return Response.json({ analysis: result.analysis, provider }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const timedOut = controller.signal.aborted
    return Response.json({ error: timedOut ? 'timeout' : 'provider', detail: String(err).slice(0, 200) }, { status: timedOut ? 504 : 502 })
  } finally {
    clearTimeout(timer)
  }
}

export const config = { path: '/api/coach' }
