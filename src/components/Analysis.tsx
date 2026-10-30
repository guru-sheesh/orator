import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import type { SpeechAttempt } from '../data/db'
import { analyseAttempt } from '../data/analysis'
import type { PauseKind } from '../lib/metrics'
import { buttonClass, cx } from './ui'

/** Filler word indexes and likely-filler sounds, for marking up the transcript. */
export function analysisMarks(a: SpeechAttempt) {
  // Multi-word fillers ("you know", "I mean") mark every word they cover.
  const fillers = new Set(a.analysis?.fillers.flatMap((f) => Array.from({ length: f.text.trim().split(/\s+/).length }, (_, k) => f.wordIndex + k)))
  const soundsBefore = new Map<number, number>()
  for (const n of a.analysis?.soundFillers ?? []) {
    const s = a.metrics?.unrecognisedSounds[n]
    if (s) soundsBefore.set(s.beforeWord, (soundsBefore.get(s.beforeWord) ?? 0) + 1)
  }
  return { fillers, soundsBefore }
}

const PAUSE_LABEL: Record<PauseKind, string> = {
  deliberate: 'deliberate (at a boundary)',
  hesitation: 'hesitation (mid-sentence)',
  'word-search': 'long word-search (2.5 s+)',
  'inside-phrase': 'inside a phrase',
}

const MAIN_POINT: Record<string, string> = {
  first: 'Main point stated first',
  early: 'Main point stated early',
  late: 'Main point arrived late',
  missing: 'No clear main point',
}

function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'info' | 'success' }) {
  return (
    <span
      className={cx(
        'rounded-sm px-2 py-1 text-caption tabular-nums',
        tone === 'neutral' && 'bg-raised text-muted',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'info' && 'bg-info-soft text-info',
        tone === 'success' && 'bg-success-soft text-success',
      )}
    >
      {children}
    </span>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
    {items.map((x, i) => (
      <li key={i}>{x}</li>
    ))}
  </ul>
)

/** Speech analysis (CLAUDE.md §5): individual dimensions, never a single score. */
export function AnalysisPanel({ attempt }: { attempt: SpeechAttempt }) {
  const { analysisStatus: status, analysis: a, metrics: m, words = [] } = attempt
  if (!status || status === 'skipped' || !m) return null

  if (status === 'pending')
    return (
      <p className="text-caption text-subtle">
        Analysing your answer…
      </p>
    )
  if (status === 'failed' || !a)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">{attempt.analysisError ?? 'The analysis failed.'}</p>
        <button type="button" onClick={() => void analyseAttempt(attempt.id!)} className={cx(buttonClass.secondary, 'min-h-11 text-sm')}>
          <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
          Analyse again
        </button>
      </div>
    )

  const fillerCount = a.fillers.length + a.soundFillers.length
  const hesitations = m.pauses.filter((p) => p.kind !== 'deliberate').length
  const deliberate = m.pauses.length - hesitations
  const accidental = a.repetitions.filter((r) => !r.deliberate)
  const quote = (i: number, span = 4) => `“${words.slice(Math.max(0, i - 1), i + span).map((w) => w.text).join(' ')}…”`

  const fillerTypes = new Map<string, { count: number; positions: Set<string> }>()
  for (const f of a.fillers) {
    const key = f.text.toLowerCase()
    const entry = fillerTypes.get(key) ?? { count: 0, positions: new Set() }
    entry.count++
    entry.positions.add(f.position.replace('-', ' '))
    fillerTypes.set(key, entry)
  }

  return (
    <div className="mt-1 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Chip tone={fillerCount ? 'danger' : 'success'}>
          {fillerCount} {fillerCount === 1 ? 'filler' : 'fillers'}
        </Chip>
        <Chip tone="info">
          {hesitations} {hesitations === 1 ? 'hesitation' : 'hesitations'} · {deliberate} deliberate {deliberate === 1 ? 'pause' : 'pauses'}
        </Chip>
        {a.restarts.length > 0 && (
          <Chip>
            {a.restarts.length} {a.restarts.length === 1 ? 'restart' : 'restarts'}
          </Chip>
        )}
        {accidental.length > 0 && <Chip>{accidental.length} repeated</Chip>}
        {m.wpm != null && m.wpm > 0 && (
          <Chip>
            {m.wpm} wpm{m.paceVariation !== null ? (m.paceVariation <= 15 ? ' · steady' : ' · uneven') : ''}
          </Chip>
        )}
        <Chip tone={a.organisation.mainPoint === 'first' || a.organisation.mainPoint === 'early' ? 'success' : 'neutral'}>{MAIN_POINT[a.organisation.mainPoint]}</Chip>
      </div>

      {a.saidTargetWord && <p className="text-sm text-danger">You said the word itself. Describe around it instead.</p>}

      <div className="rounded-md bg-raised px-4 py-3">
        <p className="text-caption font-medium tracking-[0.06em] text-subtle uppercase">Top priority</p>
        <p className="font-medium">{a.priority.weakness}</p>
        {a.priority.evidence && <p className="text-sm text-muted">{a.priority.evidence}</p>}
      </div>

      {a.content && (
        <div className="flex flex-col gap-2 rounded-md bg-raised px-4 py-3">
          {a.content.remembered.length > 0 && <ContentList title="You covered" items={a.content.remembered} />}
          {a.content.missed.length > 0 && <ContentList title="You missed" items={a.content.missed} />}
          {a.content.incorrect.length > 0 && <ContentList title="Not accurate" items={a.content.incorrect} />}
          {a.content.copiedPhrases.length > 0 && <ContentList title="Copied word for word" items={a.content.copiedPhrases.map((p) => `“${p}”`)} />}
        </div>
      )}

      <details className="rounded-md bg-raised px-4 py-1">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Full analysis</summary>
        <div className="flex flex-col gap-3 pb-3">
          <Section title="Fillers">
            {fillerCount === 0 ? (
              <p className="text-sm text-muted">None detected.</p>
            ) : (
              <List
                items={[
                  ...[...fillerTypes].map(([text, f]) => `“${text}” × ${f.count} (${[...f.positions].join(', ')})`),
                  ...(a.soundFillers.length ? [`${a.soundFillers.length} filler ${a.soundFillers.length === 1 ? 'sound' : 'sounds'} such as “um” (the recogniser drops these, so they’re found from the audio)`] : []),
                ]}
              />
            )}
          </Section>

          <Section title="Pauses">
            {m.pauses.length === 0 ? (
              <p className="text-sm text-muted">No noticeable pauses.</p>
            ) : (
              <List
                items={(Object.keys(PAUSE_LABEL) as PauseKind[])
                  .map((k) => [k, m.pauses.filter((p) => p.kind === k)] as const)
                  .filter(([, ps]) => ps.length)
                  .map(([k, ps]) => `${ps.length} ${PAUSE_LABEL[k]}, longest ${Math.max(...ps.map((p) => p.seconds))} s`)}
              />
            )}
            {m.rushedBoundaries > 0 && <p className="text-sm text-muted">{m.rushedBoundaries} sentence {m.rushedBoundaries === 1 ? 'ending ran' : 'endings ran'} straight into the next with no pause.</p>}
          </Section>

          <Section title="Pace">
            <List
              items={[
                `${m.wpm ?? '?'} words per minute overall${m.sentenceWpm.length > 1 ? `; sentences ranged ${Math.min(...m.sentenceWpm)}–${Math.max(...m.sentenceWpm)}` : ''}`,
                ...(m.rushedSentences.length ? [`${m.rushedSentences.length} ${m.rushedSentences.length === 1 ? 'sentence was' : 'sentences were'} noticeably faster than your usual pace`] : []),
                ...(m.fastEndings.length ? [`${m.fastEndings.length} ${m.fastEndings.length === 1 ? 'sentence' : 'sentences'} sped up at the end`] : []),
              ]}
            />
          </Section>

          {(a.repetitions.length > 0 || a.restarts.length > 0 || a.sentenceIssues.length > 0) && (
            <Section title="Repetition and sentence construction">
              <List
                items={[
                  ...a.repetitions.map((r) => `${r.deliberate ? 'Deliberate' : 'Repeated'} ${r.kind}: “${r.text}”`),
                  ...a.restarts.map((r) => `${r.kind === 'restart' ? 'Restart' : r.kind === 'abandoned' ? 'Abandoned sentence' : 'Incomplete sentence'} at ${quote(r.wordIndex)}: ${r.note}`),
                  ...a.sentenceIssues.map((s) => `${quote(s.wordIndex)}: ${s.note}`),
                ]}
              />
            </Section>
          )}

          {a.grammar.length > 0 && (
            <Section title="Grammar affecting clarity">
              <List items={a.grammar.map((g) => `“${g.said}” → “${g.better}”. ${g.note}`)} />
            </Section>
          )}

          <Section title="Organisation">
            <p className="text-sm text-muted">
              {MAIN_POINT[a.organisation.mainPoint]}. {a.organisation.structure}
            </p>
            {a.organisation.issues.length > 0 && <List items={a.organisation.issues} />}
          </Section>

          {a.conciseness.length > 0 && (
            <Section title="Conciseness">
              <List items={a.conciseness.map((c) => `“${c.said}” → “${c.tighter}”`)} />
            </Section>
          )}

          {a.delivery.length > 0 && (
            <Section title="Delivery">
              <List items={a.delivery} />
            </Section>
          )}
          <p className="pt-1 text-caption text-subtle">Language analysis is AI-generated from your transcript; pauses and pace are measured from the audio.</p>
        </div>
      </details>
    </div>
  )
}

function ContentList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-caption font-medium tracking-[0.06em] text-subtle uppercase">{title}</p>
      <List items={items} />
    </div>
  )
}
