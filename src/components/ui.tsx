import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function Card({ className, ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={cx('flex flex-col gap-3 rounded-lg bg-surface px-5 py-4 light:border light:border-border', className)}
      {...props}
    />
  )
}

export function Label({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cx('text-caption font-medium uppercase tracking-[0.06em] text-subtle', className)} {...props} />
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return (
    <header className="flex min-h-12 items-center gap-2">
      <div className="flex-1">
        {eyebrow && <p className="text-caption text-subtle">{eyebrow}</p>}
        <h1 className="text-headline font-semibold">{title}</h1>
      </div>
      {actions}
    </header>
  )
}

/** Pill segmented control of toggle buttons (one pressed at a time). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-pill bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-11 flex-1 rounded-pill text-sm font-medium text-muted hover:text-text aria-pressed:bg-surface aria-pressed:text-text aria-pressed:shadow-[0_0_0_1px_var(--border)]"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, max, label, done }: { value: number; max: number; label: string; done?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-1.5 overflow-hidden rounded-pill bg-raised"
    >
      <div
        className={cx('h-full rounded-pill transition-[width] duration-(--duration-base) ease-(--ease-standard)', done ? 'bg-success' : 'bg-primary')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function ProgressRing({
  value,
  max,
  label,
  size = 56,
  stroke = 4,
  children,
}: {
  value: number
  max: number
  label: string
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const done = value >= max
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="relative grid flex-none place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-raised" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cx('transition-[stroke-dashoffset] duration-(--duration-base)', done ? 'stroke-success' : 'stroke-primary')}
        />
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  )
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md px-5 font-semibold transition-transform duration-(--duration-fast) active:scale-[0.98] disabled:opacity-40'

export const buttonClass = {
  primary: cx(buttonBase, 'min-h-13 bg-primary text-on-primary hover:brightness-110'),
  secondary: cx(buttonBase, 'min-h-12 border border-border bg-raised text-text hover:border-border-strong'),
  ghost: cx(buttonBase, 'min-h-11 min-w-11 px-3 text-primary hover:bg-primary-soft'),
  /** Only inside a confirmation dialog (design-system.md §5). */
  danger: cx(buttonBase, 'min-h-13 bg-danger text-on-danger hover:brightness-110'),
}

/** 44px icon-only control; pair with `aria-label`. Works on <button> and <Link>. */
export const iconButtonClass = 'grid size-11 place-items-center rounded-md text-muted hover:bg-raised hover:text-text active:bg-raised'
