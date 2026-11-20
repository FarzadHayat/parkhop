import { describe, expect, it } from 'vitest'
import { legOnTimeProb, runLeg, simulateDay, type DaySimLeg } from './simulate'
import { mulberry32 } from './rng'
import type { LegSimInput, TransitAlternative } from './types'

const MIN = 60_000
const T0 = Date.UTC(2026, 10, 22, 21, 0) // arbitrary

function alt(readyBy: number, arrive: number, index = 0): TransitAlternative {
  return { readyBy, board: readyBy + 3 * MIN, arrive, index, mainMode: 'rail' }
}

function sim(extra: Partial<LegSimInput> = {}): LegSimInput {
  return {
    depart: T0,
    driveBeforeMin: 0,
    driveBeforeCv: 0,
    bufferAfterDriveMin: 0,
    lotFullProb: 0,
    lotFullPenaltyMin: 0,
    alternatives: [],
    driveAfterMin: 0,
    driveAfterCv: 0,
    walkBeforeMin: 0,
    transitDelaySdMin: 0,
    ...extra,
  }
}

describe('runLeg', () => {
  it('adds a deterministic drive when cv is 0', () => {
    expect(runLeg(sim({ driveBeforeMin: 30 }), T0, mulberry32(1))).toBe(T0 + 30 * MIN)
  })

  it('does not leave before the planned departure', () => {
    expect(runLeg(sim({ driveBeforeMin: 10 }), T0 - 60 * MIN, mulberry32(1))).toBe(T0 + 10 * MIN)
  })

  it('adds the lot-full penalty when the lot is certainly full', () => {
    const s = sim({ driveBeforeMin: 10, lotFullProb: 1, lotFullPenaltyMin: 7, bufferAfterDriveMin: 3 })
    expect(runLeg(s, T0, mulberry32(1))).toBe(T0 + 20 * MIN)
  })

  it('picks the first catchable service', () => {
    const a1 = alt(T0 + 5 * MIN, T0 + 40 * MIN, 0)
    const a2 = alt(T0 + 15 * MIN, T0 + 50 * MIN, 1)
    const a3 = alt(T0 + 25 * MIN, T0 + 60 * MIN, 2)
    // Ready at T0: first service is catchable.
    expect(runLeg(sim({ alternatives: [a1, a2, a3] }), T0, mulberry32(1))).toBe(T0 + 40 * MIN)
    // Ready at T0+10: first is gone, take the second.
    expect(runLeg(sim({ alternatives: [a1, a2, a3], depart: T0 }), T0 + 10 * MIN, mulberry32(1))).toBe(T0 + 50 * MIN)
  })

  it('is stranded when no service is left', () => {
    const a1 = alt(T0 + 5 * MIN, T0 + 40 * MIN)
    expect(runLeg(sim({ alternatives: [a1] }), T0 + 30 * MIN, mulberry32(1))).toBe(Infinity)
  })

  it('misses a service when the drive runs past its ready time', () => {
    const a1 = alt(T0 + 10 * MIN, T0 + 40 * MIN, 0)
    const a2 = alt(T0 + 20 * MIN, T0 + 50 * MIN, 1)
    const s = sim({ driveBeforeMin: 15, alternatives: [a1, a2] })
    expect(runLeg(s, T0, mulberry32(1))).toBe(T0 + 50 * MIN)
  })

  it('drives after transit (retrieve leg)', () => {
    const a1 = alt(T0 + 5 * MIN, T0 + 40 * MIN)
    expect(runLeg(sim({ alternatives: [a1], driveAfterMin: 20 }), T0, mulberry32(1))).toBe(T0 + 60 * MIN)
  })
})

describe('simulateDay', () => {
  const driveLeg = (deadlineOffsetMin: number): DaySimLeg => ({
    sim: sim({ driveBeforeMin: 30, driveBeforeCv: 0.1 }),
    dwellBeforeMin: 0,
    deadline: T0 + deadlineOffsetMin * MIN,
    destStopIndex: 1,
  })

  it('is on time with probability 1 for a trivially early plan', () => {
    const r = simulateDay([driveLeg(240)])
    expect(r.onTimeProb).toBe(1)
    expect(r.perStop[0].prob).toBe(1)
    expect(r.perStop[0].stopIndex).toBe(1)
  })

  it('is near 0 for an impossible plan', () => {
    const r = simulateDay([driveLeg(5)])
    expect(r.onTimeProb).toBeLessThan(0.01)
    expect(r.perStop[0].p90LateMin).toBeGreaterThan(0)
  })

  it('is deterministic for the same seed', () => {
    const legs = [driveLeg(33)]
    expect(simulateDay(legs, 500, 42)).toEqual(simulateDay(legs, 500, 42))
  })

  it('differs between seeds for a marginal plan', () => {
    const legs = [driveLeg(33)]
    const a = simulateDay(legs, 300, 1)
    const b = simulateDay(legs, 300, 2)
    expect(a.onTimeProb).toBeGreaterThan(0)
    expect(a.onTimeProb).toBeLessThan(1)
    expect(a.onTimeProb).not.toBe(b.onTimeProb)
  })

  it('is 1 when there are no deadlines', () => {
    const r = simulateDay([{ sim: sim({ driveBeforeMin: 30 }), dwellBeforeMin: 0, destStopIndex: 1 }])
    expect(r.onTimeProb).toBe(1)
    expect(r.histogram).toBeUndefined()
  })

  it('fails the day when a service is missed for good', () => {
    const l: DaySimLeg = { sim: sim({ alternatives: [alt(T0 - 10 * MIN, T0 + 20 * MIN)], depart: T0 }), dwellBeforeMin: 0, deadline: T0 + 600 * MIN, destStopIndex: 1 }
    expect(simulateDay([l]).onTimeProb).toBe(0)
  })

  it('carries lateness into later legs (dwell added)', () => {
    const l1: DaySimLeg = { sim: sim({ driveBeforeMin: 30 }), dwellBeforeMin: 0, deadline: T0 + 60 * MIN, destStopIndex: 1 }
    const l2: DaySimLeg = { sim: sim({ depart: T0 + 60 * MIN, driveBeforeMin: 30 }), dwellBeforeMin: 10, deadline: T0 + 100 * MIN, destStopIndex: 2 }
    expect(simulateDay([l1, l2]).onTimeProb).toBe(1)
    const l2tight = { ...l2, deadline: T0 + 69 * MIN }
    expect(simulateDay([l1, l2tight]).onTimeProb).toBe(0)
  })
})

describe('legOnTimeProb', () => {
  it('is 1 or 0 for deterministic legs', () => {
    expect(legOnTimeProb(sim({ driveBeforeMin: 30 }), T0 + 31 * MIN)).toBe(1)
    expect(legOnTimeProb(sim({ driveBeforeMin: 30 }), T0 + 29 * MIN)).toBe(0)
  })
})
