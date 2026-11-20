import { localToEpoch, localWeekday } from './time'
import type { Lot, StopParking } from './types'

/**
 * Chance the lot is full when you pull in. Weekday commuter lots fill over the
 * half hour before their typical "full by" time, stay full through the day, and
 * empty out as commuters return from about 3:45 pm. Weekends are mostly free.
 */
export function lotFullProbability(lot: Lot, arrive: number, date: string, timeZone: string): number {
  if (!lot.fillsByHhmm) return 0.02
  const wd = localWeekday(arrive, timeZone)
  if (wd === 0 || wd === 6) return 0.05
  const fullBy = localToEpoch(date, lot.fillsByHhmm, timeZone)
  const emptying = localToEpoch(date, '15:45', timeZone)
  const minsAfter = (arrive - fullBy) / 60_000
  // Estimated fill times are fuzzier than reported ones.
  const spread = lot.fillSource === 'reported' || lot.fillSource === 'user' ? 7 : 11
  const filling = 1 / (1 + Math.exp(-(minsAfter + 4) / spread))
  const leaving = 1 / (1 + Math.exp(-((arrive - emptying) / 60_000) / 25))
  const p = filling * (1 - leaving * 0.9)
  return Math.min(0.98, Math.max(0.01, p))
}

export type LotStayCheck = { ok: true } | { ok: false; reason: string }

/** Can the car legally stay from `parkAt` until `leaveAt`? */
export function checkLotStay(lot: Lot, parkAt: number, leaveAt: number, date: string, timeZone: string): LotStayCheck {
  const hours = (leaveAt - parkAt) / 3600_000
  if (lot.maxStayHours !== undefined && hours > lot.maxStayHours + 0.01) {
    return { ok: false, reason: `${lot.name} allows ${lot.maxStayHours} h; you would park ${hours.toFixed(1)} h` }
  }
  if (lot.opensHhmm && parkAt < localToEpoch(date, lot.opensHhmm, timeZone)) {
    return { ok: false, reason: `${lot.name} opens at ${lot.opensHhmm}` }
  }
  if (lot.closesHhmm && leaveAt > localToEpoch(date, lot.closesHhmm, timeZone)) {
    return { ok: false, reason: `${lot.name} closes at ${lot.closesHhmm}, before you get back` }
  }
  return { ok: true }
}

/** Cost of leaving the car at a stop for `minutes`, or null if not allowed. */
export function stopParkingCost(p: StopParking | undefined, minutes: number): number | null {
  if (!p) return null
  if (p.maxStayMin !== undefined && minutes > p.maxStayMin) return null
  if (p.perHour !== undefined) return Math.min(p.perDay || Infinity, Math.ceil(minutes / 60) * p.perHour)
  return p.perDay
}
