import { useState } from 'react'
import { cx } from './ui'

export interface TrendPoint {
  label: string
  value: number | null
}

const W = 300
const H = 72
const PAD = { top: 10, bottom: 8, x: 8 }

/**
 * One-series line chart for a weekly trend (small multiple). The title names
 * the series, so there is no legend; hover shows the value; a hidden table
 * carries the same data for screen readers.
 */
export function TrendChart({
  title,
  unit,
  points,
  lowerIsBetter = true,
  inPoints = false,
  format = (v) => String(v),
}: {
  title: string
  unit: string
  points: TrendPoint[]
  lowerIsBetter?: boolean
  /** Report change in percentage points (for values that are already percentages). */
  inPoints?: boolean
  format?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  const max = Math.max(...values, lowerIsBetter ? 0.1 : 1)
  const min = Math.min(0, ...values)
  const x = (i: number) => PAD.x + (i * (W - PAD.x * 2)) / Math.max(1, points.length - 1)
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom)

  // Line segments break where a week has no data.
  const segments: string[] = []
  let current = ''
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current)
      current = ''
    } else current += `${current ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`
  })
  if (current) segments.push(current)

  const delta = trendDelta(points, lowerIsBetter, inPoints)
  const shown = hover ?? lastIndex(points)

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        {delta && <span className={cx('text-caption font-medium', delta.good ? 'text-success' : 'text-subtle')}>{delta.text}</span>}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full overflow-visible" role="img" aria-label={`${title}, weekly. ${delta?.text ?? ''}`} onMouseLeave={() => setHover(null)}>
          <line x1={PAD.x} x2={W - PAD.x} y1={H - PAD.bottom} y2={H - PAD.bottom} className="stroke-border" strokeWidth={1} />
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-primary" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {points.map((p, i) =>
            p.value === null ? null : (
              <g key={i}>
                <circle cx={x(i)} cy={y(p.value)} r={i === shown ? 5 : 4} className={cx('fill-primary stroke-surface', i === shown && 'fill-text')} strokeWidth={2} />
                {/* Hit target larger than the mark. */}
                <rect x={x(i) - 18} y={0} width={36} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
              </g>
            ),
          )}
        </svg>
      </div>
      <div className="flex justify-between text-caption text-subtle" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>This week</span>
      </div>
      <p className="text-caption text-subtle tabular-nums" aria-live="polite">
        {shown !== null && points[shown].value !== null ? `${points[shown].label}: ${format(points[shown].value!)} ${unit}` : 'No data yet'}
      </p>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <th scope="row">Week of {p.label}</th>
              <td>{p.value === null ? 'no answers' : `${format(p.value)} ${unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

function lastIndex(points: TrendPoint[]) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value !== null) return i
  return null
}

/** Compares the first and last two weeks that have data. */
function trendDelta(points: TrendPoint[], lowerIsBetter: boolean, inPoints: boolean) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (vals.length < 3) return null
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const early = avg(vals.slice(0, 2))
  const late = avg(vals.slice(-2))
  if (inPoints) {
    const pts = Math.round(late - early)
    if (Math.abs(pts) < 5) return { text: 'Steady', good: false }
    const good = lowerIsBetter ? pts < 0 : pts > 0
    return { text: `${pts < 0 ? '↓' : '↑'} ${Math.abs(pts)} pts · ${good ? 'better' : 'worse'}`, good }
  }
  if (early === 0 && late === 0) return { text: 'None', good: true }
  const change = early === 0 ? 100 : Math.round(((late - early) / early) * 100)
  if (Math.abs(change) < 10) return { text: 'Steady', good: false }
  const better = lowerIsBetter ? change < 0 : change > 0
  return { text: `${change < 0 ? '↓' : '↑'} ${Math.abs(change)}% · ${better ? 'better' : 'worse'}`, good: better }
}
