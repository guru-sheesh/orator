import type { DateKey } from '../data/db'

/** Local (not UTC) date key, so "today" matches the user's clock. */
export function toDateKey(d: Date = new Date()): DateKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7))
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

/** Inclusive list of date keys from `start` to `end`. */
export function dateKeysBetween(start: Date, end: Date): DateKey[] {
  const keys: DateKey[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) keys.push(toDateKey(d))
  return keys
}

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

export function formatLongDate(d: Date = new Date()): string {
  return longDate.format(d)
}

export function formatShortDate(d: Date): string {
  return shortDate.format(d)
}

export function formatMonthYear(d: Date): string {
  return monthYear.format(d)
}
