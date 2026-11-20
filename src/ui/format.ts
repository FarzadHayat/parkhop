import { formatHhmm } from '../engine/time'
import type { SegmentMode } from '../engine/types'
import { region } from '../data/seq'

export const tz = region.timeZone

export const time = (epoch: number) => formatHhmm(epoch, tz)

export function money(v: number, digits?: number): string {
  const d = digits ?? (Math.abs(v) < 10 && v % 1 !== 0 ? 2 : 0)
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: region.currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v)
}

export function duration(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export const pct = (p: number) => `${Math.round(p * 100)}%`

export const MODE_LABEL: Record<SegmentMode, string> = {
  drive: 'Drive',
  walk: 'Walk',
  wait: 'Wait',
  park: 'Park',
  rail: 'Train',
  metro: 'Metro',
  bus: 'Bus',
  tram: 'Tram',
  ferry: 'Ferry',
}

/** CSS custom property per mode, defined in styles.css for light and dark. */
export const modeVar = (m: SegmentMode) => `var(--mode-${m})`

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}
