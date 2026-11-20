import { describe, expect, it } from 'vitest'
import { localToEpoch } from './time'
import { rainAt, trafficAt } from './traffic'
import type { Weather } from './types'

const TZ = 'Australia/Brisbane'
const CENTRE = { lat: -27.4698, lon: 153.0251 }
const SUBURB = { lat: -27.2509, lon: 152.9928 }
const at = (date: string, hhmm: string) => localToEpoch(date, hhmm, TZ)
const MON = '2026-11-23'
const SAT = '2026-11-28'

const inbound = (e: number, w?: Weather) => trafficAt(e, SUBURB, CENTRE, CENTRE, TZ, w)
const outbound = (e: number, w?: Weather) => trafficAt(e, CENTRE, SUBURB, CENTRE, TZ, w)

function rainy(epoch: number, mm: number, prob = 90): Weather {
  const hour = Math.floor(epoch / 3600_000) * 3600_000
  return { hourly: [{ time: hour, precipMm: mm, precipProb: prob, tempC: 20, code: 61 }] }
}

describe('trafficAt', () => {
  it('is heavy inbound at 8am on a weekday', () => {
    const t = inbound(at(MON, '08:00'))
    expect(t.factor).toBeGreaterThan(1.4)
    expect(t.label).toBe('heavy')
  })

  it('is free flowing at 3am', () => {
    const t = inbound(at(MON, '03:00'))
    expect(t.factor).toBeCloseTo(1, 1)
    expect(t.label).toBe('light')
  })

  it('is lighter outbound than inbound at 8am', () => {
    expect(outbound(at(MON, '08:00')).factor).toBeLessThan(inbound(at(MON, '08:00')).factor)
  })

  it('is heavier outbound than inbound at 5pm', () => {
    expect(outbound(at(MON, '17:00')).factor).toBeGreaterThan(inbound(at(MON, '17:00')).factor)
  })

  it('raises the factor and the spread in rain', () => {
    const e = at(MON, '08:00')
    const dry = inbound(e)
    const wet = inbound(e, rainy(e, 5))
    expect(wet.factor).toBeGreaterThan(dry.factor)
    expect(wet.cv).toBeGreaterThan(dry.cv)
    expect(wet.rain).toBe(true)
    expect(dry.rain).toBe(false)
  })

  it('heavy rain hurts more than light rain', () => {
    const e = at(MON, '08:00')
    expect(inbound(e, rainy(e, 5)).factor).toBeGreaterThan(inbound(e, rainy(e, 1)).factor)
  })

  it('is lighter on a weekend than at a weekday peak', () => {
    expect(inbound(at(SAT, '08:00')).factor).toBeLessThan(inbound(at(MON, '08:00')).factor)
  })

  it('never goes below free flow', () => {
    for (let h = 0; h < 24; h++) {
      expect(inbound(at(MON, `${String(h).padStart(2, '0')}:00`)).factor).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('rainAt', () => {
  it('returns zeros without weather', () => {
    expect(rainAt(undefined, 0)).toEqual({ mm: 0, prob: 0 })
    expect(rainAt({ hourly: [] }, 0)).toEqual({ mm: 0, prob: 0 })
  })
  it('ignores forecasts more than two hours away', () => {
    const e = at(MON, '08:00')
    const w = rainy(e, 5)
    expect(rainAt(w, e).mm).toBe(5)
    expect(rainAt(w, e + 4 * 3600_000)).toEqual({ mm: 0, prob: 0 })
  })
})
