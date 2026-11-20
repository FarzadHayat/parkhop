import { inboundFraction } from './geo'
import { localHour, localWeekday } from './time'
import type { LatLon, Weather } from './types'

/**
 * Free-flow router times (OSRM) ignore traffic. Without a live traffic feed we
 * scale them with a typical weekday congestion profile, split by direction:
 * inbound to the city is worst in the morning, outbound in the evening.
 *
 * Values are peak multipliers on free-flow time, roughly in line with
 * published congestion indices for Australian capitals (peak trips take
 * 40-70% longer than free flow). They are estimates and labelled as such.
 */
const PEAK_INBOUND_AM = 1.65
const PEAK_OUTBOUND_PM = 1.55
const COUNTER_PEAK = 1.2
const DAYTIME = 1.18
const NIGHT = 1.0

function bump(hour: number, centre: number, width: number): number {
  const x = (hour - centre) / width
  return Math.exp(-x * x)
}

export interface TrafficEstimate {
  /** Multiplier on free-flow time. */
  factor: number
  /** Coefficient of variation for the trip time (spread of bad days). */
  cv: number
  label: 'light' | 'moderate' | 'heavy'
  rain: boolean
}

export function rainAt(weather: Weather | undefined, epoch: number): { mm: number; prob: number } {
  if (!weather?.hourly.length) return { mm: 0, prob: 0 }
  let best = weather.hourly[0]
  for (const h of weather.hourly) if (Math.abs(h.time - epoch) < Math.abs(best.time - epoch)) best = h
  if (Math.abs(best.time - epoch) > 2 * 3600_000) return { mm: 0, prob: 0 }
  return { mm: best.precipMm, prob: best.precipProb }
}

export function trafficAt(
  epoch: number,
  from: LatLon,
  to: LatLon,
  centre: LatLon,
  timeZone: string,
  weather?: Weather,
): TrafficEstimate {
  const h = localHour(epoch, timeZone)
  const wd = localWeekday(epoch, timeZone)
  const weekend = wd === 0 || wd === 6
  const inbound = inboundFraction(from, to, centre)

  let factor: number
  if (weekend) {
    factor = 1 + (DAYTIME - 1) * bump(h, 12, 4)
  } else {
    const am = bump(h, 8, 1.1)
    const pm = bump(h, 17, 1.3)
    const amPeak = inbound * PEAK_INBOUND_AM + (1 - inbound) * COUNTER_PEAK
    const pmPeak = (1 - inbound) * PEAK_OUTBOUND_PM + inbound * COUNTER_PEAK
    const day = h >= 6 && h <= 20 ? DAYTIME : NIGHT
    factor = Math.max(day, 1 + (amPeak - 1) * am, 1 + (pmPeak - 1) * pm)
  }

  // Rain slows urban traffic roughly 5-15% and makes it less predictable.
  const rain = rainAt(weather, epoch)
  const raining = rain.mm >= 0.5 || rain.prob >= 60
  if (raining) factor *= rain.mm >= 4 ? 1.15 : 1.08

  const congestion = Math.max(0, factor - 1)
  const cv = 0.07 + congestion * 0.22 + (raining ? 0.04 : 0)
  const label = factor >= 1.4 ? 'heavy' : factor >= 1.15 ? 'moderate' : 'light'
  return { factor, cv, label, rain: raining }
}
