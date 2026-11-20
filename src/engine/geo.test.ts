import { describe, expect, it } from 'vitest'
import { decodePolyline, inboundFraction, km, shortlistLots, thin } from './geo'
import type { Lot } from './types'

const CBD = { lat: -27.4698, lon: 153.0251 }
const STRATHPINE = { lat: -27.3063, lon: 152.9908 }

function lot(id: string, lat: number, lon: number, extra: Partial<Lot> = {}): Lot {
  return {
    id,
    name: id,
    lat,
    lon,
    perDay: 0,
    fillSource: 'unknown',
    station: { name: `${id} station`, lat, lon, modes: ['rail'] },
    source: 'test',
    ...extra,
  }
}

describe('km', () => {
  it('is zero for the same point', () => {
    expect(km(CBD, CBD)).toBe(0)
  })
  it('puts Brisbane CBD about 18-20 km from Strathpine', () => {
    const d = km(CBD, STRATHPINE)
    expect(d).toBeGreaterThan(17.5)
    expect(d).toBeLessThan(20.5)
  })
  it('is symmetric', () => {
    expect(km(CBD, STRATHPINE)).toBeCloseTo(km(STRATHPINE, CBD), 10)
  })
})

describe('decodePolyline', () => {
  it('decodes the Google example at precision 5 as [lon, lat]', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)
    const expected = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]
    expect(pts).toHaveLength(3)
    pts.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 5)
      expect(p[1]).toBeCloseTo(expected[i][1], 5)
    })
  })
  it('returns [] for an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })
})

describe('thin', () => {
  it('keeps short lines and always keeps the last point of long ones', () => {
    const short: [number, number][] = [[0, 0], [1, 1]]
    expect(thin(short)).toBe(short)
    const long: [number, number][] = Array.from({ length: 1000 }, (_, i) => [i, i])
    const out = thin(long, 100)
    expect(out.length).toBeLessThanOrEqual(102)
    expect(out[out.length - 1]).toEqual([999, 999])
  })
})

describe('inboundFraction', () => {
  it('is high heading to the centre and low heading away', () => {
    expect(inboundFraction(STRATHPINE, CBD, CBD)).toBeGreaterThan(0.9)
    expect(inboundFraction(CBD, STRATHPINE, CBD)).toBeLessThan(0.1)
  })
  it('is 0.5 for tiny trips', () => {
    expect(inboundFraction(CBD, { lat: CBD.lat + 0.001, lon: CBD.lon }, CBD)).toBe(0.5)
  })
})

describe('shortlistLots', () => {
  const home = { lat: -27.2509, lon: 152.9928 } // Kallangur
  const work = CBD
  const mid = lot('mid', -27.36, 153.0)
  const mid2 = lot('mid2', -27.4, 153.01)

  it('returns [] for trips under 4 km', () => {
    const a = { lat: -27.47, lon: 153.02 }
    const b = { lat: -27.49, lon: 153.03 } // ~2.4 km
    expect(km(a, b)).toBeLessThan(4)
    expect(shortlistLots(a, b, [lot('x', -27.48, 153.025)])).toEqual([])
  })

  it('keeps lots on the way', () => {
    const ids = shortlistLots(home, work, [mid, mid2]).map((c) => c.lot.id)
    expect(ids.sort()).toEqual(['mid', 'mid2'])
  })

  it('excludes lots near the destination', () => {
    const near = lot('near', -27.46, 153.02)
    expect(shortlistLots(home, work, [near, mid]).map((c) => c.lot.id)).toEqual(['mid'])
  })

  it('excludes lots behind the origin', () => {
    const behind = lot('behind', -27.15, 152.99)
    expect(shortlistLots(home, work, [behind, mid]).map((c) => c.lot.id)).toEqual(['mid'])
  })

  it('excludes lots far off the route', () => {
    const off = lot('off', -27.36, 153.35)
    expect(shortlistLots(home, work, [off, mid]).map((c) => c.lot.id)).toEqual(['mid'])
  })

  it('returns at most `limit`, sorted by rough time', () => {
    const lots = Array.from({ length: 12 }, (_, i) => lot(`l${i}`, -27.28 - i * 0.012, 152.995 + i * 0.001))
    const out = shortlistLots(home, work, lots, 3)
    expect(out).toHaveLength(3)
    for (let i = 1; i < out.length; i++) expect(out[i].roughMin).toBeGreaterThanOrEqual(out[i - 1].roughMin)
    expect(shortlistLots(home, work, lots, 6).length).toBeLessThanOrEqual(6)
  })
})
