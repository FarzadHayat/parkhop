import { describe, expect, it } from 'vitest'
import type { DriveProvider, TransitItinerary, TransitProvider, TransitQuery } from '../providers/types'
import { km } from './geo'
import { defaultSettings, planDay, rerank } from './planner'
import type { DayOption, DayPlan, LatLon, LegRule, Lot, Region, Segment } from './types'

const MIN = 60_000
const TZ = 'Australia/Brisbane'
const DATE = '2026-11-23' // Monday

const HOME = { name: 'Home', lat: -27.2509, lon: 152.9928 }
const WORK = { name: 'Work', lat: -27.471, lon: 153.0236 }

function mkLot(id: string, lat: number, lon: number, extra: Partial<Lot> = {}): Lot {
  return {
    id,
    name: `${id} lot`,
    lat,
    lon,
    perDay: 0,
    fillSource: 'unknown',
    station: { name: `${id} station`, lat, lon, modes: ['rail'] },
    source: 'test',
    ...extra,
  }
}

function mkRegion(lots: Lot[]): Region {
  return {
    id: 'test',
    name: 'Test',
    timeZone: TZ,
    currency: 'AUD',
    centre: { lat: -27.4698, lon: 153.0251 },
    bounds: [152.4, -28.3, 153.6, -26.3],
    cityRadiusKm: 2.2,
    cityParkingPerDay: 28,
    farePerJourney: 0.5,
    fareNote: '',
    defaultFuelPrice: 1.95,
    lots,
  }
}

const LOT_A = () => mkLot('A', -27.34, 152.995)
const LOT_B = () => mkLot('B', -27.4, 153.01, { perDay: 2 })
const LOT_NEAR_WORK = () => mkLot('C', -27.46, 153.02) // too close to destination, never shortlisted

const drive: DriveProvider = {
  async route(a: LatLon, b: LatLon) {
    const d = km(a, b)
    return { durationMin: d * 1.2, distanceKm: d }
  },
}

/** Trains every 10 minutes: 3 min walk, 25 min rail, 3 min walk. */
const SPAN = 31
function itinerary(start: number): TransitItinerary {
  const w1: Segment = { mode: 'walk', fromName: 'a', toName: 'stn', start, end: start + 3 * MIN }
  const rail: Segment = { mode: 'rail', fromName: 'stn', toName: 'stn2', start: start + 5 * MIN, end: start + 30 * MIN, route: 'R' }
  const w2: Segment = { mode: 'walk', fromName: 'stn2', toName: 'b', start: rail.end, end: rail.end + 1 * MIN }
  return { start, end: start + SPAN * MIN, transfers: 0, segments: [w1, rail, w2] }
}
function makeTransit(): TransitProvider & { queries: TransitQuery[] } {
  const queries: TransitQuery[] = []
  return {
    queries,
    async plan(q) {
      queries.push(q)
      const G = 10 * MIN
      const out: TransitItinerary[] = []
      if (q.arriveBy) {
        const lastStart = Math.floor((q.time - SPAN * MIN) / G) * G
        for (let s = lastStart; s > lastStart - q.windowMin * MIN; s -= G) out.push(itinerary(s))
        out.reverse()
      } else {
        const first = Math.ceil(q.time / G) * G
        for (let s = first; s < first + q.windowMin * MIN; s += G) out.push(itinerary(s))
      }
      return out
    },
  }
}

function mkPlan(rules: LegRule[], workParkPerDay = 28): DayPlan {
  return {
    date: DATE,
    stops: [
      { id: 'home', label: 'Home', place: HOME, dwellMin: 0, leaveAfterHhmm: '06:30', parking: { perDay: 0 } },
      { id: 'work', label: 'Work', place: WORK, dwellMin: 0, arriveByHhmm: '08:45', leaveAfterHhmm: '17:00', parking: { perDay: workParkPerDay } },
      { id: 'home2', label: 'Home', place: HOME, dwellMin: 0, parking: { perDay: 0 } },
    ],
    legRules: rules,
  }
}

async function run(rules: LegRule[], lots: Lot[] = [LOT_A(), LOT_B(), LOT_NEAR_WORK()], workPark = 28) {
  return planDay(mkPlan(rules, workPark), mkRegion(lots), defaultSettings, { drive, transit: makeTransit() })
}

describe('planDay round trip with rules any/any', () => {
  it('produces drive, transit and park & ride options', async () => {
    const res = await run(['any', 'any'])
    const strategies = new Set(res.options.map((o) => o.strategy))
    expect(strategies.has('drive')).toBe(true)
    expect(strategies.has('transit')).toBe(true)
    expect(strategies.has('parkride')).toBe(true)
  })

  it('park & ride options retrieve the car from the same lot', async () => {
    const res = await run(['any', 'any'])
    const pr = res.options.filter((o) => o.strategy === 'parkride')
    expect(pr.length).toBeGreaterThan(0)
    const roundTrip = pr.filter((o) => o.legs[0].kind === 'parkride')
    expect(roundTrip.length).toBeGreaterThan(0)
    for (const o of roundTrip) {
      expect(o.legs[1].kind).toBe('retrieve')
      expect(o.legs[1].lotId).toBe(o.legs[0].lotId)
      expect(['A', 'B']).toContain(o.legs[0].lotId)
    }
  })

  it('never parks at a lot beside the destination on the way in', async () => {
    const res = await run(['any', 'any'])
    expect(res.options.every((o) => o.legs[0].lotId !== 'C')).toBe(true)
  })

  it('never ends with the car left at a lot or at work', async () => {
    const res = await run(['any', 'any'])
    expect(res.options.length).toBeGreaterThan(0)
    for (const o of res.options) {
      // Every leg that leaves the car at a lot is followed by a retrieve from it.
      o.legs.forEach((l, k) => {
        if (l.kind === 'parkride') {
          const back = o.legs.slice(k + 1).find((x) => x.kind === 'retrieve' && x.lotId === l.lotId)
          expect(back).toBeDefined()
        }
      })
      const last = o.legs[o.legs.length - 1]
      expect(['drive', 'retrieve', 'transit']).toContain(last.kind)
      // A final drive/retrieve brings the car home; transit-only keeps it home all day.
      if (last.kind === 'transit') expect(o.legs.every((l) => l.kind === 'transit')).toBe(true)
    }
    expect(res.options.every((o) => o.legs.length === 2)).toBe(true)
  })

  it('includes the work stop parking in drive-only cost', async () => {
    const res = await run(['any', 'any'], [LOT_A(), LOT_B()], 37)
    const d = res.options.find((o) => o.strategy === 'drive')!
    expect(d.cost.parking).toBe(37)
    expect(d.cost.fares).toBe(0)
    expect(d.costTotal).toBeCloseTo(d.cost.fuel + d.cost.wear + 37, 6)
    const t = res.options.find((o) => o.strategy === 'transit')!
    expect(t.cost.parking).toBe(0)
    expect(t.cost.fares).toBeCloseTo(1, 6)
  })

  it('charges the lot daily fee for park & ride', async () => {
    const res = await run(['any', 'any'], [LOT_B()])
    const pr = res.options.find((o) => o.strategy === 'parkride')!
    expect(pr.lotIds).toEqual(['B'])
    expect(pr.cost.parking).toBe(2)
    expect(pr.cost.fares).toBeCloseTo(1, 6)
  })

  it('computes reliability for every option', async () => {
    const res = await run(['any', 'any'])
    for (const o of res.options) {
      expect(o.reliability.onTimeProb).toBeGreaterThanOrEqual(0)
      expect(o.reliability.onTimeProb).toBeLessThanOrEqual(1)
      expect(o.leaveBy).toBe(o.legs[0].depart)
    }
  })
})

describe('leg rules', () => {
  it("['transit','transit'] yields only transit options", async () => {
    const res = await run(['transit', 'transit'])
    expect(res.options.length).toBeGreaterThan(0)
    expect(res.options.every((o) => o.strategy === 'transit' && o.legs.every((l) => l.kind === 'transit'))).toBe(true)
  })

  it("['car','any'] never parks at a lot on leg 0", async () => {
    const res = await run(['car', 'any'])
    expect(res.options.length).toBeGreaterThan(0)
    for (const o of res.options) {
      expect(o.legs[0].kind).toBe('drive')
      expect(o.legs[0].lotId).toBeUndefined()
    }
  })

  it("['car','car'] is drive only", async () => {
    const res = await run(['car', 'car'])
    expect(res.options.length).toBeGreaterThan(0)
    expect(res.options.every((o) => o.strategy === 'drive')).toBe(true)
  })
})

describe('lot restrictions', () => {
  it('rejects a lot that closes before you are back, with a reason', async () => {
    const lots = [mkLot('A', -27.34, 152.995, { closesHhmm: '16:00' }), mkLot('B', -27.4, 153.01, { closesHhmm: '16:00' })]
    const res = await run(['any', 'any'], lots)
    expect(res.options.some((o) => o.lotIds.length > 0)).toBe(false)
    expect(res.rejected.some((r) => /closes/.test(r.reason))).toBe(true)
    // Baselines remain.
    expect(res.options.some((o) => o.strategy === 'drive')).toBe(true)
    expect(res.options.some((o) => o.strategy === 'transit')).toBe(true)
  })

  it('keeps a lot that closes after you are back', async () => {
    const lots = [mkLot('A', -27.34, 152.995, { closesHhmm: '23:00' })]
    const res = await run(['any', 'any'], lots)
    expect(res.options.some((o) => o.lotIds.includes('A'))).toBe(true)
  })

  it('rejects a lot with a stay limit shorter than the working day', async () => {
    const lots = [mkLot('A', -27.34, 152.995, { maxStayHours: 4 })]
    const res = await run(['any', 'any'], lots)
    expect(res.options.some((o) => o.lotIds.includes('A'))).toBe(false)
    expect(res.rejected.some((r) => /allows 4 h/.test(r.reason))).toBe(true)
  })
})

describe('planDay input checks', () => {
  it('throws when a stop has no place', async () => {
    const plan = mkPlan(['any', 'any'])
    plan.stops[1].place = null
    await expect(planDay(plan, mkRegion([]), defaultSettings, { drive, transit: makeTransit() })).rejects.toThrow()
  })

  it('reports transit failures as rejections instead of throwing', async () => {
    const failing: TransitProvider = { plan: async () => { throw new Error('down') } }
    const res = await planDay(mkPlan(['any', 'any']), mkRegion([LOT_A()]), defaultSettings, { drive, transit: failing })
    expect(res.options.every((o) => o.strategy === 'drive')).toBe(true)
    expect(res.rejected.length).toBeGreaterThan(0)
  })

  it('adds a data note when no weather is available', async () => {
    const res = await run(['any', 'any'])
    expect(res.dataNotes).toContain('Weather forecast unavailable')
  })

  it('reports progress', async () => {
    const seen: [number, number][] = []
    await planDay(mkPlan(['any', 'any']), mkRegion([LOT_A()]), defaultSettings, { drive, transit: makeTransit() }, { onProgress: (d, t) => seen.push([d, t]) })
    expect(seen.length).toBeGreaterThan(0)
    const [d, t] = seen[seen.length - 1]
    expect(d).toBe(t)
  })
})

describe('rerank', () => {
  it("puts the cheapest option first for priority 'cheapest'", async () => {
    const res = await run(['any', 'any'])
    expect(res.options.length).toBeGreaterThan(2)
    const ranked = rerank(res.options, { ...defaultSettings, priority: 'cheapest' })
    const min = Math.min(...res.options.map((o) => o.costTotal))
    expect(ranked[0].costTotal).toBeCloseTo(min, 6)
    expect(ranked).toHaveLength(res.options.length)
  })

  it("puts the quickest option first for priority 'fastest'", async () => {
    const res = await run(['any', 'any'])
    const ranked = rerank(res.options, { ...defaultSettings, priority: 'fastest' })
    const best = res.options.reduce((a, b) => (a.totalTravelMin + (1 - a.reliability.onTimeProb) * 45 <= b.totalTravelMin + (1 - b.reliability.onTimeProb) * 45 ? a : b))
    expect(ranked[0].id).toBe(best.id)
  })

  it('sinks infeasible options and does not mutate its input', () => {
    const mk = (id: string, feasible: boolean, costTotal: number): DayOption => ({
      id,
      title: id,
      strategy: 'drive',
      legs: [],
      lotIds: [],
      leaveBy: 0,
      totalTravelMin: 60,
      cost: { fuel: 0, wear: 0, parking: 0, fares: 0 },
      costTotal,
      reliability: { onTimeProb: 1, perStop: [] },
      warnings: [],
      score: 0,
      feasible,
    })
    const input = [mk('bad', false, 1), mk('ok', true, 50)]
    const out = rerank(input, { ...defaultSettings, priority: 'cheapest' })
    expect(out.map((o) => o.id)).toEqual(['ok', 'bad'])
    expect(input[0].id).toBe('bad')
    expect(input[0].score).toBe(0)
  })
})

