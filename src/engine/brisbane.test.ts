import { describe, expect, it } from 'vitest'
import { region as seq } from '../data/seq'
import type { DriveProvider, TransitItinerary, TransitProvider } from '../providers/types'
import { km } from './geo'
import { candidateSpots, defaultSettings, planDay, spotTitle, tollsOn, walkMinutes } from './planner'
import { dayType, trafficAt } from './traffic'
import type { DayPlan, LatLon, Lot, Region, Segment } from './types'

const MIN = 60_000
const TZ = 'Australia/Brisbane'
const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+10:00`)

describe('tollsOn', () => {
  it('matches road names case-insensitively', () => {
    const hit = tollsOn(seq.tolls, ['clem jones TUNNEL'])
    expect(hit.map((t) => t.id)).toContain('clem7')
  })

  it('charges the clem7 price for Clem Jones Tunnel', () => {
    const clem = seq.tolls!.find((t) => t.id === 'clem7')!
    const hit = tollsOn(seq.tolls, ['Clem Jones Tunnel'])
    expect(hit).toHaveLength(1)
    expect(hit[0].carPrice).toBe(clem.carPrice)
    expect(clem.carPrice).toBeGreaterThan(0)
  })

  it('does not charge the Gateway bridge toll for Gateway Motorway alone', () => {
    const hit = tollsOn(seq.tolls, ['Gateway Motorway'])
    expect(hit.find((t) => t.id === 'gateway-murarrie')).toBeUndefined()
    expect(hit).toEqual([])
  })

  it('charges the Gateway bridge toll for the bridge names', () => {
    expect(tollsOn(seq.tolls, ['Sir Leo Hielscher Bridges']).map((t) => t.id)).toContain('gateway-murarrie')
    expect(tollsOn(seq.tolls, ['Gateway Bridge']).map((t) => t.id)).toContain('gateway-murarrie')
  })

  it('returns [] with no names or no roads', () => {
    expect(tollsOn(seq.tolls, [])).toEqual([])
    expect(tollsOn(seq.tolls, undefined)).toEqual([])
    expect(tollsOn(undefined, ['Clem Jones Tunnel'])).toEqual([])
  })
})

describe('dayType with the SEQ calendar', () => {
  const cal = seq.calendar!
  const t = (d: string) => at(d, '08:00')

  it('Saturday is weekend', () => expect(dayType(t('2026-11-28'), TZ, cal)).toBe('weekend'))
  it('Christmas Day is a public holiday', () => expect(dayType(t('2026-12-25'), TZ, cal)).toBe('public-holiday'))
  it('a weekday in the Christmas school holidays is holiday', () => expect(dayType(t('2027-01-12'), TZ, cal)).toBe('holiday'))
  it('a weekday in term is school', () => expect(dayType(t('2026-11-23'), TZ, cal)).toBe('school'))
  it('a weekday in a year the calendar does not cover is school', () => expect(dayType(t('2030-03-12'), TZ, cal)).toBe('school'))
  it('without a calendar every weekday is school', () => expect(dayType(t('2027-01-12'), TZ)).toBe('school'))

  it('8am inbound traffic is lighter on a school-holiday weekday than a term weekday', () => {
    const from: LatLon = { lat: -27.2509, lon: 152.9928 }
    const to: LatLon = seq.centre
    const term = trafficAt(t('2026-11-23'), from, to, seq.centre, TZ, undefined, cal)
    const hol = trafficAt(t('2027-01-12'), from, to, seq.centre, TZ, undefined, cal)
    expect(term.day).toBe('school')
    expect(hol.day).toBe('holiday')
    expect(hol.factor).toBeLessThan(term.factor)
  })
})

describe('walkMinutes', () => {
  it('is at least 1 minute for zero distance', () => {
    const p = { lat: -27.4, lon: 153 }
    expect(walkMinutes(p, p)).toBe(1)
  })

  it('is about 13 minutes for roughly 800 m', () => {
    const a = { lat: -27.4, lon: 153 }
    const b = { lat: a.lat + 0.8 / 111.19, lon: a.lon }
    expect(km(a, b) * 1000).toBeGreaterThan(780)
    expect(km(a, b) * 1000).toBeLessThan(820)
    expect(walkMinutes(a, b)).toBe(13)
  })
})

function mkLot(id: string, lat: number, lon: number, extra: Partial<Lot> = {}, station = `${id} station`): Lot {
  return {
    id,
    name: `${id} lot`,
    lat,
    lon,
    perDay: 0,
    fillSource: 'unknown',
    station: { name: station, lat, lon, modes: ['rail'] },
    source: 'test',
    ...extra,
  }
}

const HOME = { name: 'Home', lat: -27.2509, lon: 152.9928 }
const WORK = { name: 'Work', lat: -27.471, lon: 153.0236 }

describe('candidateSpots', () => {
  it('includes street parking alongside pnr at the same station, pnr first', () => {
    const lots = [
      mkLot('S', -27.3401, 152.9951, { kind: 'street', stayKnown: false }, 'Shared'),
      mkLot('P', -27.34, 152.995, { kind: 'pnr' }, 'Shared'),
      mkLot('Z', -27.2, 152.9, {}, 'Far'),
    ]
    const out = candidateSpots(HOME, WORK, lots, 1)
    const ids = out.map((l) => l.id)
    expect(ids).toContain('S')
    expect(ids).toContain('P')
    expect(ids.indexOf('P')).toBeLessThan(ids.indexOf('S'))
    expect(ids).not.toContain('Z')
  })

  it('returns at most 3 spots per station', () => {
    const lots = [0, 1, 2, 3, 4].map((i) => mkLot(`L${i}`, -27.34 + i * 0.0001, 152.995, { kind: i % 2 ? 'street' : 'pnr' }, 'Same'))
    expect(candidateSpots(HOME, WORK, lots, 1)).toHaveLength(3)
  })

  it('respects the station count', () => {
    const lots = [
      mkLot('A', -27.34, 152.995),
      mkLot('B', -27.38, 153.0),
      mkLot('C', -27.36, 153.01),
      mkLot('D', -27.32, 152.99),
    ]
    const n = (k: number) => new Set(candidateSpots(HOME, WORK, lots, k).map((l) => l.station.name)).size
    expect(n(1)).toBe(1)
    expect(n(2)).toBe(2)
  })
})

describe('spotTitle', () => {
  const base = mkLot('X', -27.3, 153, { name: 'X lot' }, 'Xville')
  it('pnr by default', () => expect(spotTitle(base)).toBe('Park & ride at X lot'))
  it('pnr explicit', () => expect(spotTitle({ ...base, kind: 'pnr' })).toBe('Park & ride at X lot'))
  it('carpark', () => expect(spotTitle({ ...base, kind: 'carpark' })).toBe('X lot, then Xville'))
  it('street', () => expect(spotTitle({ ...base, kind: 'street' })).toBe('Street parking near Xville'))
})

function mkRegion(lots: Lot[], extra: Partial<Region> = {}): Region {
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
    ...extra,
  }
}

function itinerary(start: number): TransitItinerary {
  const w1: Segment = { mode: 'walk', fromName: 'a', toName: 'stn', start, end: start + 3 * MIN }
  const rail: Segment = { mode: 'rail', fromName: 'stn', toName: 'stn2', start: start + 5 * MIN, end: start + 30 * MIN, route: 'R' }
  const w2: Segment = { mode: 'walk', fromName: 'stn2', toName: 'b', start: rail.end, end: rail.end + MIN }
  return { start, end: start + 31 * MIN, transfers: 0, segments: [w1, rail, w2] }
}
const transit: TransitProvider = {
  async plan(q) {
    const G = 10 * MIN
    const out: TransitItinerary[] = []
    if (q.arriveBy) {
      const lastStart = Math.floor((q.time - 31 * MIN) / G) * G
      for (let s = lastStart; s > lastStart - q.windowMin * MIN; s -= G) out.push(itinerary(s))
      out.reverse()
    } else {
      const first = Math.ceil(q.time / G) * G
      for (let s = first; s < first + q.windowMin * MIN; s += G) out.push(itinerary(s))
    }
    return out
  },
}

const plan: DayPlan = {
  date: '2026-11-23',
  stops: [
    { id: 'home', label: 'Home', place: HOME, dwellMin: 0, leaveAfterHhmm: '06:30', parking: { perDay: 0 } },
    { id: 'work', label: 'Work', place: WORK, dwellMin: 0, arriveByHhmm: '08:45', leaveAfterHhmm: '17:00', parking: { perDay: 28 } },
    { id: 'home2', label: 'Home', place: HOME, dwellMin: 0, parking: { perDay: 0 } },
  ],
  legRules: ['any', 'any'],
}

describe('planDay', () => {
  it('warns to check the signs for street parking with unknown stay', async () => {
    const drive: DriveProvider = {
      async route(a, b) {
        const d = km(a, b)
        return { durationMin: d * 1.2, distanceKm: d }
      },
    }
    const lots = [
      mkLot('P', -27.34, 152.995, { kind: 'pnr', stayKnown: true }, 'Shared'),
      mkLot('S', -27.3401, 152.9951, { kind: 'street', stayKnown: false, extraParkMin: 5 }, 'Shared'),
    ]
    const res = await planDay(plan, mkRegion(lots), defaultSettings, { drive, transit })
    const street = res.options.filter((o) => o.strategy === 'parkride' && o.lotIds.includes('S'))
    expect(street.length).toBeGreaterThan(0)
    for (const o of street) {
      const all = [...o.warnings, ...o.legs.flatMap((l) => l.warnings)]
      expect(all.some((w) => w.level === 'caution' && w.text.includes('check the signs'))).toBe(true)
    }
  })

  it('includes tolls in drive cost when the route uses a toll road', async () => {
    const drive: DriveProvider = {
      async route(a, b) {
        const d = km(a, b)
        return { durationMin: d * 1.2, distanceKm: d, roadNames: ['Clem Jones Tunnel'] }
      },
    }
    const clem = seq.tolls!.find((t) => t.id === 'clem7')!
    const reg = mkRegion([mkLot('P', -27.34, 152.995)], { tolls: [clem] })
    const res = await planDay(plan, reg, defaultSettings, { drive, transit })
    const d = res.options.find((o) => o.strategy === 'drive')!
    expect(d.cost.tolls).toBeGreaterThan(0)
    // One charge per drive leg, two legs.
    expect(d.cost.tolls).toBeCloseTo(clem.carPrice * 2, 5)
    const sum = d.cost.fuel + d.cost.wear + d.cost.parking + d.cost.fares + (d.cost.tolls ?? 0)
    expect(d.costTotal).toBeCloseTo(sum, 5)
  })
})
