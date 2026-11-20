import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ShiftPlan } from '../state/shifts'
import type { DayOption, DayPlan, Place, Warning } from '../engine/types'
import { demoRoster } from './roster'

// src/state/shifts.ts pulls in the zustand store and src/state/deps.ts, which
// calls fetch at import time. Stub the browser globals before importing it.
type Shifts = typeof import('../state/shifts')
let shifts: Shifts

beforeAll(async () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() }
  }
  vi.stubGlobal('localStorage', mem())
  vi.stubGlobal('sessionStorage', mem())
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline')
  })
  shifts = await import('../state/shifts')
})

const HHMM = (epoch: number) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(epoch))

describe('demoRoster', () => {
  const r = demoRoster('2026-11-23')
  it('has 5 shifts all at Fortitude Valley with start before finish', () => {
    expect(r.shifts).toHaveLength(5)
    for (const s of r.shifts) {
      expect(s.place.name).toContain('Fortitude Valley')
      expect(s.start).toBeLessThan(s.finish)
    }
  })
  it('first shift starts 06:00 Brisbane time', () => {
    expect(r.shifts[0].start).toBe(Date.parse('2026-11-23T06:00:00+10:00'))
  })
})

describe('dayPlanForShift', () => {
  const home: Place = { name: 'Home', lat: -27.25, lon: 152.99 }
  const shift = demoRoster('2026-11-23').shifts[0] // 06:00 to 14:00

  it('arrives 10 minutes early, leaves at finish, home/work/home', () => {
    const p = shifts.dayPlanForShift(shift, home)
    expect(p.stops.map((s) => s.label.split(' ')[0])).toEqual(['Home', 'Work', 'Home'])
    expect(p.stops[1].arriveByHhmm).toBe('05:50')
    expect(p.stops[1].leaveAfterHhmm).toBe('14:00')
    expect(p.stops[1].leaveAfterHhmm).toBe(HHMM(shift.finish))
    expect(p.date).toBe('2026-11-23')
    expect(p.legRules).toEqual(['any', 'any'])
  })

  it('uses the Brisbane local date, not the UTC date', () => {
    // 06:00 Brisbane is 20:00 UTC the previous day.
    expect(new Date(shift.start).toISOString().slice(0, 10)).toBe('2026-11-22')
    expect(shifts.dayPlanForShift(shift, home).date).toBe('2026-11-23')
  })
})

describe('weekTotals', () => {
  const shift = demoRoster('2026-11-23').shifts[0]
  const opt = (costTotal: number, strategy: DayOption['strategy'] = 'transit') => ({ costTotal, strategy }) as DayOption
  const mkSp = (plan: DayPlan, status: ShiftPlan['status'], best: DayOption | undefined, drive: DayOption | undefined, flags: Warning[]): ShiftPlan => ({
    shift,
    plan,
    status,
    best,
    drive,
    flags,
  })

  it('sums only done plans and counts risky ones', () => {
    const plan = shifts.dayPlanForShift(shift, { name: 'H', lat: -27.25, lon: 152.99 })
    const sp = (...a: [ShiftPlan['status'], DayOption | undefined, DayOption | undefined, Warning[]]) => mkSp(plan, ...a)
    const t = shifts.weekTotals([
      sp('done', opt(10), opt(30, 'drive'), []),
      sp('done', opt(20), opt(25, 'drive'), [{ level: 'info', text: 'fyi' }]),
      sp('done', opt(5), undefined, [{ level: 'caution', text: 'hmm' }]),
      sp('error', opt(999), opt(999, 'drive'), [{ level: 'blocker', text: 'x' }]),
      sp('waiting', undefined, undefined, []),
      sp('done', undefined, opt(7, 'drive'), []), // no best: not counted
    ])
    expect(t.shifts).toBe(3)
    expect(t.best).toBe(35)
    expect(t.drive).toBe(30 + 25 + 5) // missing drive falls back to best
    expect(t.saving).toBe(25)
    expect(t.risky).toBe(1)
  })
})
