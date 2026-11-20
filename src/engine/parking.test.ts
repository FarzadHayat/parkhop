import { describe, expect, it } from 'vitest'
import { checkLotStay, lotFullProbability, stopParkingCost } from './parking'
import { localToEpoch } from './time'
import type { Lot } from './types'

const TZ = 'Australia/Brisbane'
const DATE = '2026-11-23'
const at = (hhmm: string) => localToEpoch(DATE, hhmm, TZ)
const HOUR = 3600_000

function mkLot(extra: Partial<Lot> = {}): Lot {
  return {
    id: 'l',
    name: 'Test Lot',
    lat: 0,
    lon: 0,
    perDay: 0,
    fillSource: 'reported',
    station: { name: 'Test', lat: 0, lon: 0, modes: ['rail'] },
    source: 'test',
    ...extra,
  }
}

describe('lotFullProbability', () => {
  const lot = mkLot({ fillsByHhmm: '07:30' })
  it('is low well before the fill time', () => {
    expect(lotFullProbability(lot, at('06:00'), DATE, TZ)).toBeLessThan(0.05)
  })
  it('is high well after the fill time', () => {
    expect(lotFullProbability(lot, at('09:00'), DATE, TZ)).toBeGreaterThan(0.95)
  })
  it('increases with arrival time', () => {
    const a = lotFullProbability(lot, at('07:10'), DATE, TZ)
    const b = lotFullProbability(lot, at('07:30'), DATE, TZ)
    expect(b).toBeGreaterThan(a)
  })
  it('is about 0.02 when the lot rarely fills', () => {
    expect(lotFullProbability(mkLot(), at('08:00'), DATE, TZ)).toBeCloseTo(0.02, 5)
  })
  it('stays within [0.01, 0.98]', () => {
    expect(lotFullProbability(lot, at('23:00'), DATE, TZ)).toBeLessThanOrEqual(0.98)
    expect(lotFullProbability(lot, at('00:00'), DATE, TZ)).toBeGreaterThanOrEqual(0.01)
  })
  it('estimated fill times are fuzzier than reported ones', () => {
    const est = mkLot({ fillsByHhmm: '07:30', fillSource: 'estimated' })
    expect(lotFullProbability(est, at('06:50'), DATE, TZ)).toBeGreaterThan(lotFullProbability(lot, at('06:50'), DATE, TZ))
  })
})

describe('checkLotStay', () => {
  it('allows an ordinary stay', () => {
    expect(checkLotStay(mkLot(), at('07:00'), at('17:00'), DATE, TZ)).toEqual({ ok: true })
  })
  it('rejects a stay over maxStayHours', () => {
    const r = checkLotStay(mkLot({ maxStayHours: 4 }), at('07:00'), at('17:00'), DATE, TZ)
    expect(r.ok).toBe(false)
  })
  it('allows a stay right at maxStayHours', () => {
    expect(checkLotStay(mkLot({ maxStayHours: 10 }), at('07:00'), at('17:00'), DATE, TZ).ok).toBe(true)
  })
  it('rejects parking before opening', () => {
    const r = checkLotStay(mkLot({ opensHhmm: '06:00' }), at('05:30'), at('17:00'), DATE, TZ)
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toContain('opens')
  })
  it('rejects returning after closing', () => {
    const r = checkLotStay(mkLot({ closesHhmm: '16:00' }), at('07:00'), at('17:00'), DATE, TZ)
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toContain('closes')
  })
  it('allows returning before closing', () => {
    expect(checkLotStay(mkLot({ closesHhmm: '18:00' }), at('07:00'), at('17:00'), DATE, TZ).ok).toBe(true)
  })
  it('computes hours from the timestamps', () => {
    const t = at('07:00')
    expect(checkLotStay(mkLot({ maxStayHours: 2 }), t, t + 2 * HOUR, DATE, TZ).ok).toBe(true)
    expect(checkLotStay(mkLot({ maxStayHours: 2 }), t, t + 3 * HOUR, DATE, TZ).ok).toBe(false)
  })
})

describe('stopParkingCost', () => {
  it('is null when there is no parking', () => {
    expect(stopParkingCost(undefined, 60)).toBeNull()
  })
  it('is the daily fee when there is no hourly rate', () => {
    expect(stopParkingCost({ perDay: 28 }, 600)).toBe(28)
  })
  it('charges hourly, rounding up, and caps at perDay', () => {
    const p = { perDay: 20, perHour: 5 }
    expect(stopParkingCost(p, 90)).toBe(10)
    expect(stopParkingCost(p, 61)).toBe(10)
    expect(stopParkingCost(p, 600)).toBe(20)
  })
  it('is null when over maxStayMin', () => {
    expect(stopParkingCost({ perDay: 5, maxStayMin: 120 }, 121)).toBeNull()
    expect(stopParkingCost({ perDay: 5, maxStayMin: 120 }, 120)).toBe(5)
  })
})
