# Personal Development App - Product Handover

# 0. Technical Setup & Decisions (read this first)

This section fixes the technical choices. Sections 1-22 below define the product. If anything below conflicts with them, ask the user before deciding.

## 0.1 Platform

- Mobile-first **PWA**: React + Vite + TypeScript + Tailwind CSS. Installable via "Add to Home Screen".
- Must work on both Android (Chrome) and iPhone (Safari). Test microphone recording and audio playback on both; handle iOS audio formats (MediaRecorder on iOS produces mp4/aac, not webm).
- Icons: Lucide. Fonts: Google Fonts (one sans for UI, one serif for quotes/transcripts at most).
- Dark mode by default, light mode optional.

## 0.2 Hosting & backend

- Host on **Netlify** (user already has an account). Code in a new GitHub repo on the user's account (`guru-sheesh`).
- Backend = **Netlify Functions** only. No other server.
- Netlify Functions time out after ~10 seconds on the free plan. Never proxy long audio through a function. Instead:
  - `/api/speech-token`: issues a short-lived Azure Speech token (10 min). The browser then talks to Azure directly with the Speech SDK.
  - `/api/coach`: sends a transcript plus analysis JSON to the AI and returns structured feedback. Keep payloads small and stream if needed.

## 0.3 Secrets

- Keys live ONLY in `.env` locally and in Netlify environment variables. Never in client code, never committed.
- Variables: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (= `southafricanorth`), `AI_API_KEY`, `AI_PROVIDER` (= `gemini`).
- `.gitignore` must include `.env`, `node_modules`, `dist`.

## 0.4 Data storage: local-first

- All personal data (journal, reading, attempts, analysis, trends) is stored **on the device** in IndexedDB (use Dexie). No cloud database in v1.
- User audio recordings are NOT kept by default: they're held in memory, sent for analysis, then discarded. Keep only the transcript plus analysis results. Add a setting "Keep recordings on this device" (off by default) for Attempt 1 vs Attempt 2 playback.
- Rule 14 (export/delete): provide **Export all data (JSON)** and **Delete all data** in Settings. Remind the user weekly to export a backup, since clearing browser data or losing the phone loses everything.

## 0.5 Speech services (behind a replaceable service layer, per section 21)

- **Transcription + word timings:** Azure Speech-to-Text with word-level timestamps.
- **Pronunciation/fluency/prosody:** Azure Pronunciation Assessment (reference text = clip transcript for shadowing tasks; unscripted mode for the others).
- **Pauses and pace:** compute in the app from Azure word timestamps (gaps between words = pauses; words per minute per sentence = pace).
- **Accent rule (section 19 rule 11):** Azure's pronunciation score compares against a native en-US model. Do NOT show it as a headline score or treat accent differences as errors. Use it only to flag words that were genuinely unclear (very low accuracy), worded as "this word may be hard to understand", never "wrong accent".
- **Language analysis** (fillers in context, repetition, sentence construction, grammar, organisation, conciseness): the AI via `/api/coach`, returning strict JSON matching the SpeechAnalysis / CoachingFeedback models.

## 0.6 Usage limits: plan for them

- Azure free tier (F0) covers about **5 hours of audio a month**. A full 30-minute daily routine can exceed that (roughly 10-15 min of recorded speech a day plus shadowing clips adds up to about 5-7 hours a month).
- Build a usage meter (minutes of Azure audio used this month, stored locally) and show it in Settings.
- When nearing the limit, fall back to the browser's built-in speech recognition (transcript only, no timings or prosody) and tell the user which analysis dimensions are reduced.
- Gemini free tier has rate limits. Batch analysis per task (one coach call per attempt, not per sentence). Handle `429` errors gracefully with a retry message.

## 0.7 Shadowing source material (section 4, Task 3)

- The user will import **their own audio files** (MP3/M4A/AAC/WAV) from their phone. Store files in IndexedDB on the device only. Never upload them to Netlify or any server except the 60-second clip sent to Azure for transcription.
- Auto-split each file into ~60-second segments at the nearest natural pause (silence detection with the Web Audio API). Segments are start/end timestamps, not new files.
- Transcribe a segment the first time it's used, then cache the transcript locally.
- Each imported file gets editable metadata: speaker, title, date, source, licence/rights note (matching the section 8 fields). Mark user imports as `rights: "personal use, user-provided"`.
- Show a waveform with a playhead and word-by-word transcript highlighting during playback.

## 0.8a Coaching decisions (user, 2026-10-30) — SUPERSEDES 0.8 and sections 7-9 where they conflict

The user decided feedback does NOT need citations. Replace the source library with:

- Feedback order: What you did well → What went wrong (evidence from the user's own words) → Why it weakened the answer → **How you could have handled it** (a short example version of the user's own answer, labelled "Example answer (AI-written)") → **Watch this** (one recommended talk/speech) → Retry targets (2-3) → retry.
- "Watch this" recommendations come ONLY from a curated **talk list** stored in the app (title, speaker, official link, technique tags, one line on what to notice, in our own words). Claude Code builds the starter list (~20-30 real talks from official sources such as TED.com, presidential libraries, official channels) and checks every link resolves. The AI picks by ID; it never names a talk free-hand. The user can add favourites in Settings. No timestamps unless checked.
- Safeguard kept: the AI must never invent quotations or claim a real person said/did something specific. Generic technique names ("point first") are fine.
- Step 9 (source library + verification admin) is dropped; it becomes the talk-list screen.
- No book recommendations for now.

## 0.9a Practice content decisions (user, 2026-10-30)

- Read → Hide → Explain passages: ~300 trimmed (not rewritten) Wikipedia excerpts, 150-250 words, topics in `content/passage-topics.md` — deliberately NEW territory, no solar/electrical/telecom. Show "Source: Wikipedia, [article] (CC BY-SA)" with a link. Loaded lazily, cached offline. Gemini may add more later (labelled AI-generated).
- Word, unexpected-question and impromptu banks are built in (labelled "AI-generated practice material"), with rotation so items don't repeat until exhausted, and difficulty rising over time. Impromptu keeps a minority of professional/technical work scenarios; the rest is new territory. The user can add their own questions.
- Shadowing audio: the user imports their own files (personal use, no verification needed). Copyrighted audio is never committed or bundled.

## 0.8 Source library: anti-fabrication rules (sections 7-9) — see 0.8a

- The coaching AI may ONLY cite sources that exist in the app's `SourceReference` table, by ID. It must never write a citation, quotation, author or page number free-hand.
- `/api/coach` sends the AI the list of available sources (ID, title, author, technique tags, short technique summary written in our own words, NOT copyrighted text). The AI returns a source ID or `null`.
- If `null`, the UI says "No verified source in the library for this; this is general guidance" (hierarchy level 4).
- Books: store only metadata plus a technique summary in our own words plus chapter/page location. Never store copyrighted passages.
- Seed library: start EMPTY of fabricated data (section 21). Provide an admin screen so the user can add verified sources. Claude Code may propose candidate public-domain speeches with links for the user to verify, marked `verified: false` until the user confirms.

## 0.9 Generated practice content

- Word lists, questions and Read → Hide → Explain passages may be AI-generated, but label them "AI-generated practice material". Passages on technical topics (solar PV, telecom, electrical) must be flagged so the user can report errors.
- Never present generated content as a quote from a real person.

## 0.10 Privacy (section 19 rule 13)

- Gemini's free tier may use submitted data to improve Google's products. Show this in Settings and keep `AI_PROVIDER` switchable (`gemini` or `claude`) so the user can move to a paid/private provider without code changes.
- Send only transcripts plus metrics to the AI, never raw audio or journal entries.
- Journal content never leaves the device.

## 0.11 Build process

- Build in phases following section 21. **Stop after each phase**, summarise what was built, and tell the user how to test it on their phone before continuing.
- Use the installed design skills (UI/UX Pro Max for the design system and screens; Vercel agent skills for the accessibility/performance review) before writing UI code, and again at final UX refinement.
- Deploy a preview to Netlify at the end of each phase so the user can test on their phone.
- Ask the user before any decision that changes cost, privacy or data storage.

## 0.12 UI design workflow: use the design plugins (required)

Design comes BEFORE code. Do not write UI code until the user has approved the design system and screen mockups.

**Installed plugins and what each is for:**

| Plugin / skill | Use it for | When |
|---|---|---|
| **UI/UX Pro Max** (`nextlevelbuilder/ui-ux-pro-max-skill`) | Main design engine: generate the design system and all screen designs | Step 1 and every new screen |
| **Vercel agent skills** (`vercel-labs/agent-skills`) | Accessibility (WCAG), mobile performance, React best practices | End of every phase, and final UX refinement |
| **frontend-design** (Anthropic) | Fallback if UI/UX Pro Max is unavailable; second opinion on visual direction | Only if needed |

If any of these are not installed, STOP and tell the user how to install them (`/plugin marketplace add <repo>` then `/plugin`). Do not silently continue without them.

**Step 1: design system (before Phase 1 code).** Use UI/UX Pro Max to create a design system from section 18 (UX principles): serious, calm, professional; dark mode first; no badges, coins, mascots or celebration animations. Output a `design-system.md` plus Tailwind tokens covering:
- Colour palette (dark and light) with WCAG AA contrast checked
- Typography scale (UI font and transcript/quote font)
- Spacing, radii, elevation
- Core components: buttons, cards, progress ring/bar, record button (large, at least 72px, one-thumb reachable), waveform player, transcript view with word highlighting, feedback cards, attempt comparison table, bottom navigation (Today / Speak / Journal / Read)

**Step 2: screen mockups.** Use UI/UX Pro Max to mock up these screens at phone size (390×844) as static HTML the user can open on their phone:
1. Today dashboard (section 2)
2. Speak: session overview (the 6 tasks plus timer)
3. Speak: recording screen
4. Speak: shadowing player (waveform, transcript, Listen/Repeat/Shadow/Deliver stages)
5. Speak: feedback screen (section 10 order)
6. Speak: Attempt 1 vs Attempt 2 comparison (section 12)
7. Journal: prompted entry plus Free Write
8. Read: current book plus log pages
9. Progress: weekly/monthly view
10. Settings: data export/delete, Azure usage meter, AI provider, source library admin

Deploy the mockups to a Netlify preview and STOP for user approval. Apply their feedback before writing app code.

**Step 3: build using the approved system only.** Every screen built in later phases must use the design-system tokens and components; no one-off colours or spacing. When a new screen is needed that wasn't mocked up, design it with UI/UX Pro Max first.

**Step 4: review every phase.** At the end of each phase, run the Vercel agent skills over the new screens (accessibility, touch targets of at least 44px, contrast, performance, bundle size) and fix the issues before showing the user.

**Step 5: final UX refinement (section 21, step 13).** Full pass with UI/UX Pro Max (visual consistency) plus Vercel skills (accessibility and performance) across the whole app.

---

## 1. Project Overview

Build a focused personal development app for daily use.

The app has three core areas only:

1. Articulation training.
2. Journaling.
3. Reading at least 10 pages per day.

Do not add strength training, cooking, generic habit tracking, general to-do lists, or unrelated productivity features.

The app should feel focused, professional, calm, and practical. The purpose is to help the user improve communication, reflection, and learning through consistent daily practice.

---

# 2. Main Navigation

Use four primary areas:

- Today
- Speak
- Journal
- Read

Progress can be accessible from the Today screen or profile rather than requiring a major navigation tab.

The Today screen should answer one question immediately:

> What do I still need to complete today?

Example:

```text
TODAY

Articulation     0 / 30 min
Journal          Not completed
Reading          4 / 10 pages

Daily progress   0 / 3 complete
```

When all daily targets are complete:

```text
TODAY

Articulation     Complete
Journal          Complete
Reading          14 / 10 pages

Daily progress   3 / 3 complete
```

---

# 3. PART 1 - ARTICULATION TRAINING

## Objective

The articulation system should improve:

- Spontaneous speaking.
- Word retrieval.
- Organisation of thoughts.
- Fluency.
- Clear sentence construction.
- Controlled pacing.
- Effective pauses.
- Conciseness.
- Explanation skills.
- Professional communication.
- Pronunciation clarity without attempting to erase the user's natural accent.

The user should spend approximately 30 minutes per day on this section.

The central learning cycle is:

```text
Listen
  -> Imitate
  -> Understand
  -> Retrieve
  -> Speak
  -> Analyse
  -> Reference
  -> Recommend
  -> Retry
  -> Compare
```

The app should spend more time making the user speak than making the user read instructions or look at scores.

---

# 4. Daily Articulation Session - 30 Minutes

## Task 1 - Word Description

Target time: 2 minutes.

Give the user approximately 2-3 words.

The user must describe each word without saying the target word itself.

Example target:

```text
Reliability
```

Possible description:

```text
It describes the ability of something to perform consistently without frequently failing.
```

Purpose:

- Lexical retrieval.
- Paraphrasing.
- Verbal flexibility.
- Ability to continue speaking when a specific word cannot immediately be recalled.

Difficulty can move from concrete objects to processes and then abstract concepts.

Examples:

Beginner:

- Bicycle.
- Hospital.
- Refrigerator.
- Solar panel.

Intermediate:

- Troubleshooting.
- Maintenance.
- Negotiation.
- Communication.

Advanced:

- Reliability.
- Resilience.
- Accountability.
- Sustainability.

Record and transcribe every response.

---

## Task 2 - Unexpected Questions

Target time: 3 minutes.

Give the user approximately two unpredictable questions.

Preparation time should be short, around 5 seconds.

The user then responds verbally without notes.

Examples:

```text
Why do intelligent people sometimes make poor decisions?

Why is preventive maintenance important?

What makes someone trustworthy?

What makes an engineer effective?

Why do networks experience congestion?
```

The aim is not perfect answers. The aim is to improve the speed and quality of thought-to-speech production.

An optional starting structure is:

```text
Point -> Reason -> Example -> Conclusion
```

Do not force the framework when another structure is more appropriate.

---

## Task 3 - Speech Shadowing and Imitation

Target time: 5 minutes.

Use a verified, legally usable speech or speaking sample from an accomplished speaker or orator.

Prefer authentic recordings when licensing permits their use.

The exercise has four stages.

### Stage A - Listen

The user listens without speaking.

Highlight when useful:

- Pauses.
- Emphasis.
- Rhythm.
- Changes in pace.
- Intonation.
- Transitions.

### Stage B - Repeat

Split the excerpt into short sections.

Play a segment. The user repeats it.

### Stage C - Shadow

Replay the original and let the user speak almost simultaneously with the speaker.

The user should imitate speaking mechanics such as:

- Rhythm.
- Timing.
- Pauses.
- Emphasis.
- Intonation.

Do not instruct the user to imitate the speaker's identity or accent.

### Stage D - Independent Delivery

Remove the audio and let the user deliver the passage independently.

At easier levels the transcript may remain visible. At higher levels it can be removed.

---

## Task 4 - Paraphrase the Speaker

Target time: 3 minutes.

This immediately follows shadowing.

Remove the original transcript and audio.

Give the user a short preparation period, then ask them to explain the speaker's central message using their own words.

Do not reward memorisation of exact phrasing.

Purpose:

```text
Imitation -> Comprehension -> Retrieval -> Independent expression
```

Analyse whether:

- The main message was preserved.
- The explanation was logically organised.
- The user relied excessively on the original wording.
- Irrelevant ideas were introduced.
- The explanation was concise and understandable.

---

## Task 5 - Read -> Hide -> Explain

Target time: 6 minutes.

Present a short passage.

The user reads it once.

When they select `Done Reading`, hide the passage.

The user must then explain what they understood without reopening the original text during the attempt.

A useful structure is:

```text
What is it?
How does it work?
Why does it matter?
What is an example?
```

Possible topics:

- General knowledge.
- Science.
- Technology.
- Electrical engineering.
- Telecom and networking.
- Solar PV.
- Business.
- History.
- Other educational topics.

The goal is understanding and reconstruction, not verbatim recall.

Analyse:

- Important concepts remembered.
- Important concepts missed.
- Incorrect statements.
- Organisation.
- Clarity.
- Excessive copying.
- Repetition.
- Fillers.
- Sentence construction.

---

## Task 6 - Impromptu Speaking

Target time: 4 minutes.

Give the user one unfamiliar question.

Allow approximately 10 seconds of preparation.

The user then gives a longer spoken response.

Question difficulty should progress over time.

Examples:

### Description

```text
Describe a workplace where people can perform effectively.
```

### Opinion

```text
Is working from home better than working from an office?
```

### Explanation

```text
Why do technically strong projects sometimes fail?
```

### Argument

```text
Should companies prioritise reliability over short-term cost savings?
```

### Professional scenario

```text
A customer reports intermittent internet connectivity. Explain how you would investigate the problem.
```

### Technical scenario

```text
A solar inverter repeatedly reports a BMS communication fault. Explain the possible causes and your troubleshooting approach.
```

Possible structures include:

Opinion:

```text
Point -> Reason -> Example -> Conclusion
```

Technical explanation:

```text
What -> How -> Why -> Example
```

Troubleshooting:

```text
Problem -> Evidence -> Possible Cause -> Action
```

Professional update:

```text
Situation -> Impact -> Action -> Current Status -> Next Step
```

The system should select the framework based on the task rather than forcing every answer into one pattern.

---

# 5. Speech Analysis Engine

The speech analysis engine is a major feature.

Analyse both the audio and the transcript. Do not rely only on transcription because pace, pauses, rhythm, emphasis, and intonation require audio evidence.

The feedback engine should not simply produce a generic fluency score.

It must explain what happened and how the user should improve.

## A. Filler Words

Detect recurring fillers such as:

- Um.
- Uh.
- Like.
- Basically.
- Actually.
- You know.
- I mean.
- Repeated use of "so" where it functions as a filler.
- Other recurring fillers learned from the user's speaking history.

Show:

- Number detected.
- Type.
- Location in transcript.
- Whether they appear at sentence starts or during word search.
- Change after retry.

Do not assume every occurrence of words such as "so" or "like" is a filler. Use context.

---

## B. Pause Analysis

Differentiate:

- Deliberate pauses.
- Hesitation pauses.
- Long word-search pauses.
- Pauses placed inside phrases unnaturally.
- Insufficient pauses caused by rushing.

Silence is not automatically an error.

The system should encourage deliberate silence instead of unnecessary fillers.

---

## C. Speaking Pace

Analyse:

- Overall pace.
- Sudden acceleration.
- Rushing through important points.
- Very slow sections caused by hesitation.
- Fast sentence endings.
- Pace consistency.

Recommendations must be specific to the observed behaviour.

---

## D. Repetition

Detect:

- Repeated words.
- Repeated phrases.
- Repeated sentence openings.
- Repeated ideas.
- Accidental rhetorical loops.
- Restating the same point without developing it.

Differentiate accidental repetition from deliberate rhetorical repetition.

---

## E. Sentence Construction

Detect:

- Incomplete sentences.
- Abandoned sentences.
- Frequent restarts.
- Run-on sentences.
- Too many ideas within one sentence.
- Awkward construction that affects clarity.
- Unclear references.

---

## F. Grammar

Identify spoken grammar errors that materially affect clarity.

Avoid treating natural conversational speech like a formal written essay.

Prioritise errors that make the meaning inaccurate, confusing, or noticeably awkward.

---

## G. Organisation and Reasoning

Analyse whether ideas progress logically.

Look for:

- Clear central point.
- Appropriate reasoning.
- Relevant examples.
- Logical transitions.
- Completed arguments.
- Appropriate conclusion.

Flag:

- Jumping between ideas.
- Introducing evidence before establishing the point when this harms clarity.
- Unrelated examples.
- Repeating instead of developing.
- Missing conclusion.
- Beginning an argument but not completing it.

---

## H. Conciseness

Detect unnecessary wording.

Example:

```text
What I am basically trying to say in terms of this particular problem is that...
```

A more direct approach might be:

```text
The main problem is...
```

However, recommendations should be grounded in an appropriate speech, book, or research-based technique as described later. Do not present a generated stylistic preference as an authoritative rule.

---

## I. Delivery

Where the audio supports it, analyse observable delivery characteristics:

- Intonation.
- Rhythm.
- Emphasis.
- Volume consistency.
- Weak sentence endings.
- Monotonous delivery.
- Excessive hesitation.

Do not claim to infer internal emotional states such as confidence, anxiety, intelligence, or personality from speech.

Do not penalise the user's natural accent merely for differing from the model speaker.

---

# 6. Feedback Engine

The feedback system must answer more than "What went wrong?"

Every major response should answer:

1. What did I do well?
2. What did I do wrong?
3. Why did it weaken my response?
4. How should I have structured it?
5. How should I have delivered it?
6. What established speaking technique addresses this?
7. Where does that technique come from?
8. Can I see or hear a real example?
9. How should I apply it to my own response?
10. What should I change on the retry?

---

# 7. Source-Based Coaching - Critical Requirement

This is one of the most important product requirements.

The correction system should NOT simply invent an ideal speech and present it as authority.

The preferred hierarchy is:

```text
1. Verified speech or authentic recording from a recognised speaker/orator
2. Reputable book about rhetoric, speaking, argumentation, or communication
3. Peer-reviewed research or an established evidence-based communication framework
4. Clearly state that no suitable source was found
```

AI may be used to:

- Analyse the user's speech.
- Identify weaknesses.
- Search the approved source library.
- Match a weakness to an established technique.
- Explain the technique.
- Show how the technique could be applied to the user's own material.
- Compare attempts.

AI must NOT:

- Invent quotations.
- Invent speech passages.
- Fabricate book passages.
- Attribute generated wording to an orator or author.
- Claim that a speaker used a technique without verifiable evidence.
- Present an AI-written answer as though it came from a historical speech.

Always distinguish four things:

```text
AUTHENTIC SOURCE
What the source actually contains.

OBSERVED / DOCUMENTED TECHNIQUE
What the cited example demonstrates or what a credible source explicitly teaches.

APPLICATION
How the technique relates to the user's speech.

USER RETRY
The user's new attempt using the technique.
```

---

# 8. Speech Reference Library

Build a curated library of verified speeches and recordings suitable for teaching techniques such as:

- Direct openings.
- Clear central claims.
- Deliberate pausing.
- Strategic emphasis.
- Parallel construction.
- Controlled rhetorical repetition.
- Argument development.
- Transitions.
- Short declarative statements.
- Strong conclusions.
- Changes in pace.
- Storytelling.
- Explanation of complex ideas.

Potential historical and professional speakers can be included only where the source is verified and use is legally permitted.

Every stored speech example needs metadata such as:

- Speaker.
- Speech title.
- Date, when verified.
- Context, when verified.
- Transcript source.
- Audio/video source when available.
- Rights/licence status.
- Technique tags.
- Exact excerpt location.

Do not depend on unattributed social-media clips.

---

# 9. Book and Research Fallback Library

If no appropriate speech demonstrates the user's weakness clearly, search a curated book library.

Possible source categories:

- Classical rhetoric.
- Public speaking.
- Argumentation.
- Communication.
- Presentation design and delivery.
- Storytelling.
- Persuasion.

A book can be used only when its content is legally accessible for the intended use, or when the app stores appropriately licensed excerpts/metadata instead of unauthorised copyrighted text.

If no suitable book example exists, use peer-reviewed research or a well-established communication framework.

Every recommendation must retain the source citation and clearly distinguish source content from application advice.

---

# 10. Feedback Presentation

A typical feedback screen should appear in this order.

## What You Did Well

State useful strengths that should be retained.

## What Went Wrong

List the highest-impact problems with evidence from the user's own response.

Example:

```text
You restarted three sentences while searching for words.
You used "basically" four times.
Your main point did not become clear until the final part of the response.
```

## Why It Weakened the Response

Explain the practical effect on a listener.

## Reference Technique

Show the verified speech, book, or research source selected for this weakness.

Include appropriate source metadata.

## Authentic Example

Where legally permitted, show or play the relevant short excerpt.

Do not alter an authentic quotation and still present it as exact.

## What the Example Demonstrates

Explain the technique based on the source evidence.

## How to Apply It

Map the technique to the user's response.

This section can reorganise the user's own ideas but must be clearly labelled as an application, not a quotation from the referenced speaker.

## Retry Targets

Give only the highest-priority 2-3 corrections.

Example:

```text
1. State your main point in the first sentence.
2. Replace unnecessary fillers with silent pauses.
3. Separate each troubleshooting step into its own sentence.
```

Then require a retry.

---

# 11. Worked Feedback Examples

## Example A - Filler Words

Question:

```text
Why is preventive maintenance important?
```

User response:

```text
Um, preventive maintenance is basically important because, you know, machines can sometimes fail, and basically when they fail, it can cause losses.
```

Analysis:

- The answer contains fillers.
- "Basically" is repeated.
- The central point is surrounded by unnecessary phrasing.
- There is no developed example.

Recommended coaching process:

1. Identify fillers and their locations.
2. Explain how they delay or interrupt the point.
3. Retrieve a verified reference demonstrating direct opening and controlled pausing.
4. Explain that technique.
5. Ask the user to retry by stating the main point first and using silence instead of fillers.

Do not fabricate a famous speaker's version of a preventive-maintenance answer.

---

## Example B - Disorganised Technical Response

Question:

```text
A customer reports intermittent internet connectivity. How would you investigate it?
```

User response:

```text
I would first check the router, but also it may be the cable, and sometimes congestion can cause it, so I would ask the customer when it happens, and then maybe check the signal and the router configuration.
```

Detected problems:

- Possible causes and investigative actions are mixed.
- The sequence is unclear.
- Multiple ideas are packed into one sentence.

The engine should retrieve a verified source demonstrating clear sequencing or signposting.

Application advice might then be:

```text
Problem -> Evidence -> Checks -> Possible Cause -> Next Action
```

This structure must be labelled as the application's recommended application unless a source explicitly teaches the exact framework.

The retry should ask the user to explain the investigation chronologically.

---

## Example C - Word Search

User response:

```text
Resilience is when someone... um... goes through something difficult and they... what is the word... they can come back from it.
```

Detected weakness:

- Speech stops while searching for an exact word.

Recommended skill:

- Paraphrase around the missing word rather than abandoning the sentence.

Example strategy:

```text
Cannot recall "deteriorate" -> say "become worse".
Cannot recall "intermittent" -> say "happening at irregular times".
Cannot recall "mitigate" -> say "reduce the effect".
```

Where possible, source the communication strategy from an appropriate speech, book, or research reference rather than treating it as an unsupported rule.

---

# 12. Retry and Comparison

After coaching, require the user to answer the same task again.

The system compares Attempt 1 with Attempt 2.

Metrics may include:

- Filler count.
- Sentence restarts.
- Long hesitation pauses.
- Repeated ideas.
- Pace consistency.
- Structural clarity.
- Completion of the argument.
- Grammar errors affecting clarity.

Example comparison:

```text
ATTEMPT 1
Fillers: 8
Restarts: 4
Long hesitations: 3
Repeated ideas: 2
Main point: Introduced late

ATTEMPT 2
Fillers: 3
Restarts: 1
Long hesitations: 1
Repeated ideas: 0
Main point: Introduced clearly
```

Do not reduce the entire session to a single meaningless articulation score.

Show individual dimensions and trends.

Finish with:

- What improved.
- What still needs work.
- The most important next priority.

Track recurring weaknesses across days so future practice can adapt.

---

# 13. Articulation Session Timing

Target allocation:

```text
Word Description              2 min
Unexpected Questions          3 min
Shadowing                     5 min
Paraphrase Speaker            3 min
Read -> Hide -> Explain       6 min
Impromptu Speaking            4 min
Analysis + Source Retrieval   3 min
Correction + Retry            4 min
                              ------
Total                         30 min
```

The exact seconds do not need to be rigid. Keep the session close to 30 minutes without sacrificing a meaningful retry.

---

# 14. PART 2 - JOURNALING

## Objective

Provide a low-friction daily reflection system.

Daily target:

```text
1 journal entry per day
```

Do not make journaling complicated.

## Default Daily Prompts

1. What happened today?
2. What went well?
3. What could I have handled better?
4. What did I learn today?
5. What is important tomorrow?

Also provide a Free Write mode so the user can ignore prompts and write normally.

## Journal Features

- Autosave drafts.
- Save by date.
- Calendar history.
- Search previous entries.
- Edit own previous entries.
- Daily completion state.
- Weekly/monthly consistency view.

Do not require sentiment analysis or psychological interpretation.

The journal is for reflection and personal record, not mental-state diagnosis.

---

# 15. PART 3 - READING

## Objective

Make reading at least 10 pages every day measurable and easy to maintain.

Daily target:

```text
Minimum 10 pages
```

## Track

For each book:

- Title.
- Author.
- Optional cover image.
- Total pages when known.
- Current page.
- Date started.
- Date completed when applicable.

For each reading session:

- Starting page.
- Ending page.
- Pages read.
- Date.
- Optional note: "One thing I learned."

Calculate pages read from the recorded page range where appropriate.

Example:

```text
CURRENT BOOK

The Art of Public Speaking

Start page today: 74
Current page: 86
Pages today: 12 / 10
Status: Complete
```

## Reading Dashboard

Show:

- Pages read today.
- Daily target progress.
- Pages this week.
- Pages this month.
- Current book.
- Current page.
- Books completed.
- Reading consistency.

Optional integration:

A user-created reading note or legally available source text can later be used as material for the articulation module's `Read -> Hide -> Explain` exercise.

Do not ingest or reproduce copyrighted book text without appropriate rights or user-provided access.

---

# 16. Progress System

The progress system combines the three areas without turning the app into a generic habit tracker.

## Daily View

```text
ARTICULATION
Complete / Incomplete
Minutes completed

JOURNAL
Complete / Incomplete

READING
Pages completed / 10
```

## Weekly View

Possible presentation:

```text
THIS WEEK

Articulation   6 / 7 days
Journal        5 / 7 days
Reading        78 pages
Reading target 70 pages minimum for 7 days
```

For articulation, also show meaningful skill trends such as:

- Filler usage trend.
- Sentence restart trend.
- Hesitation trend.
- Pace consistency.
- Organisation improvements.
- Recurring weakness.
- Retry improvement.

Do not claim psychological attributes from these metrics.

## Monthly View

Show:

- Articulation sessions completed.
- Articulation practice minutes.
- Recurring speech weaknesses and improvement trends.
- Journal entries completed.
- Reading pages completed.
- Books completed.
- Daily-consistency calendar.

---

# 17. Data Model - Suggested Minimum

Create suitable data structures for at least the following entities.

## User

- id
- name
- preferences
- articulation settings
- daily targets

## DailyStatus

- date
- articulation completed
- articulation minutes
- journal completed
- reading pages
- reading target achieved

## SpeechExercise

- id
- exercise type
- prompt
- source reference when applicable
- date
- difficulty

## SpeechAttempt

- id
- exercise id
- attempt number
- audio reference
- transcript
- duration
- analysis results
- timestamp

## SpeechAnalysis

- filler events
- pause events
- speaking pace metrics
- repetition events
- sentence restart events
- grammar issues
- organisation issues
- clarity issues
- delivery observations
- high-priority weakness

## SourceReference

- type: speech/book/research
- title
- speaker or author
- source metadata
- rights/licence metadata
- excerpt location
- technique tags
- verified status

## CoachingFeedback

- strengths
- weaknesses
- explanation
- source reference
- technique
- application guidance
- retry targets

## JournalEntry

- date
- prompted responses
- free-write content
- last updated

## Book

- title
- author
- total pages
- current page
- started date
- completed date

## ReadingSession

- book id
- date
- starting page
- ending page
- pages read
- optional learning note

---

# 18. UX Principles

The app should feel like a serious personal development tool, not a childish gamified habit tracker.

Use:

- Clean typography.
- Strong visual hierarchy.
- Minimal clutter.
- Clear progress states.
- Simple charts where they genuinely help.
- Comfortable reading and recording screens.
- Dark mode if practical.
- Responsive mobile-first design.

Avoid:

- Excessive badges.
- Coins.
- Cartoon mascots.
- Constant celebratory animations.
- Unnecessary social features.
- Generic productivity features.

The main motivation should come from visible improvement and consistency.

---

# 19. Product Rules

1. Keep the product limited to Articulation, Journal, and Reading.
2. Daily articulation target is approximately 30 minutes.
3. Reading target is at least 10 pages per day.
4. Journaling target is one entry per day.
5. The speech engine must explain errors rather than just score them.
6. The engine must recommend how the user should improve.
7. Source-based speaking advice is preferred over unsupported AI-generated corrections.
8. Never fabricate a quotation or source.
9. Keep authentic source material clearly separate from generated application guidance.
10. Use legally permitted or appropriately licensed speech/book materials.
11. Do not treat accents as articulation defects simply because they differ from a reference speaker.
12. Do not infer emotions, intelligence, personality, or mental state from speech.
13. Store recordings and journal content as sensitive personal data and design privacy controls accordingly.
14. Make deletion/export of personal records straightforward.
15. Keep everyday usage fast enough that the tracking itself does not become another burden.

---

# 20. Acceptance Criteria

A functional first release should allow the user to:

- Open Today and see all three daily targets.
- Complete the full articulation routine.
- Record speech directly in the app.
- Receive transcripts for recorded attempts.
- Receive speech analysis covering the major fluency dimensions listed above.
- Receive clear explanations of what went wrong.
- Receive source-backed speaking techniques where appropriate.
- Inspect the source used for the coaching recommendation.
- Retry an exercise after feedback.
- Compare the first and second attempts.
- Track recurring articulation weaknesses over time.
- Complete a prompted journal or free-write entry.
- Browse and search personal journal history.
- Add a book.
- Log reading pages.
- Track progress toward at least 10 pages each day.
- View daily, weekly, and monthly progress across the three areas.

---

# 21. Development Priority

Build in this order unless technical dependencies require a different sequence:

```text
1. App shell + Today dashboard
2. User data + daily tracking
3. Journal
4. Reading tracker
5. Speech recording + playback
6. Speech exercise flows
7. Transcription
8. Speech analysis engine
9. Source/reference library and retrieval
10. Coaching feedback
11. Retry + attempt comparison
12. Long-term articulation trends
13. Final UX refinement
```

For any feature that depends on an external AI, transcription provider, speech-analysis API, licensed content source, or database, keep the integration replaceable behind a clear service layer.

Do not hard-code fabricated speech sources or mock quotations into production data.

---

# 22. Final Product Definition

This app is a personal daily development system centred on three behaviours:

```text
SPEAK BETTER
30 minutes of structured articulation practice, evidence/source-based feedback, and correction.

REFLECT DAILY
One useful journal entry each day.

READ DAILY
At least 10 pages every day.
```

Everything in the product should support one of these three outcomes. If a proposed feature does not materially improve articulation, journaling, reading, or progress tracking for these areas, leave it out of the initial product.
