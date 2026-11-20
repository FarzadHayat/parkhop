import type { LatLon, Lot } from './types'

const R = 6371

export function km(a: LatLon, b: LatLon): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export interface LotCandidate {
  lot: Lot
  /** Straight-line detour ratio: (a->lot + lot->b) / (a->b). */
  detour: number
  /** Rough door-to-door minutes, only used to shortlist. */
  roughMin: number
}

/**
 * Shortlist lots worth asking the routers about for a trip a -> b.
 * Keeps lots roughly on the way, not right next to either end, and ranks them
 * by a rough time estimate so we only spend network calls on plausible ones.
 */
export function shortlistLots(a: LatLon, b: LatLon, lots: Lot[], limit = 6): LotCandidate[] {
  const direct = km(a, b)
  if (direct < 4) return []
  const all: (LotCandidate & { progress: number })[] = []
  for (const lot of lots) {
    const toLot = km(a, lot)
    const fromLot = km(lot, b)
    const detour = (toLot + fromLot) / direct
    if (detour > 1.4) continue
    // Parking close to the destination is not park-and-ride.
    if (fromLot < Math.max(2.5, direct * 0.15)) continue
    // A lot behind you (further from b than you are) is pointless.
    if (fromLot > direct * 1.05) continue
    // Peak driving ~1.9 min/km on the road network; transit ~1.7 min/km plus waits.
    const big = (lot.capacity ?? 0) >= 300 ? -3 : 0
    const roughMin = toLot * 1.3 * 1.5 + fromLot * 1.7 + 8 + lot.perDay * 2 + big
    all.push({ lot, detour, roughMin, progress: toLot / (toLot + fromLot) })
  }
  all.sort((x, y) => x.roughMin - y.roughMin)
  // Keep a spread along the way: lots near home are reached before they fill,
  // lots further in mean less time on the train. Let the router decide.
  const bands: [number, number, number][] = [
    [0, 0.3, 2],
    [0.3, 0.55, 2],
    [0.55, 0.8, 1],
    [0.8, 1.01, 1],
  ]
  const picked: LotCandidate[] = []
  for (const [lo, hi, n] of bands) picked.push(...all.filter((c) => c.progress >= lo && c.progress < hi).slice(0, n))
  for (const c of all) {
    if (picked.length >= limit) break
    if (!picked.includes(c)) picked.push(c)
  }
  return picked
    .slice(0, limit)
    .sort((x, y) => x.roughMin - y.roughMin)
    .map(({ lot, detour, roughMin }) => ({ lot, detour, roughMin }))
}

/** Is the trip heading towards the city centre (peak direction in the morning)? */
export function inboundFraction(a: LatLon, b: LatLon, centre: LatLon): number {
  const da = km(a, centre)
  const db = km(b, centre)
  const span = km(a, b)
  if (span < 0.5) return 0.5
  // +1 fully inbound, -1 fully outbound, mapped to 0..1
  return Math.max(0, Math.min(1, 0.5 + (da - db) / (2 * span)))
}

export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision
  const coords: [number, number][] = []
  let lat = 0
  let lon = 0
  let i = 0
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0
      let result = 0
      let byte: number
      do {
        byte = str.charCodeAt(i++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    coords.push([lon / factor, lat / factor])
  }
  return coords
}

/** Keep every nth point so long geometries stay light. */
export function thin(coords: [number, number][], maxPoints = 200): [number, number][] {
  if (coords.length <= maxPoints) return coords
  const step = Math.ceil(coords.length / maxPoints)
  const out = coords.filter((_, i) => i % step === 0)
  out.push(coords[coords.length - 1])
  return out
}
