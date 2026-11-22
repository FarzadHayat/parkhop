import { decodePolyline, thin } from '../engine/geo'
import type { LatLon } from '../engine/types'
import { getJson, limiter, memoAsync } from './http'
import type { DriveRoute } from './types'

interface ValhallaResponse {
  trip?: {
    summary?: { length?: number; time?: number }
    legs?: { shape?: string; maneuvers?: { street_names?: string[] }[] }[]
  }
}

/**
 * A route that stays off toll roads, from the public Valhalla server. OSRM's
 * demo server cannot exclude tolls and often offers no toll-free alternative,
 * so this is the fallback when "Avoid toll roads" is on. Returns null when
 * there is no answer, and the planner then keeps the OSRM route.
 */
export function valhallaTollFree(base = 'https://valhalla1.openstreetmap.de') {
  const run = limiter(2)
  return memoAsync(
    async (a: LatLon, b: LatLon): Promise<DriveRoute | null> => {
      const json = {
        locations: [
          { lat: Number(a.lat.toFixed(5)), lon: Number(a.lon.toFixed(5)) },
          { lat: Number(b.lat.toFixed(5)), lon: Number(b.lon.toFixed(5)) },
        ],
        costing: 'auto',
        costing_options: { auto: { use_tolls: 0 } },
        directions_options: { units: 'kilometers' },
      }
      try {
        const res = await run(() => getJson<ValhallaResponse>(`${base}/route?json=${encodeURIComponent(JSON.stringify(json))}`, { timeoutMs: 15_000 }))
        const trip = res.trip
        if (!trip?.summary?.time || trip.summary.length === undefined) return null
        const legs = trip.legs ?? []
        return {
          durationMin: trip.summary.time / 60,
          distanceKm: trip.summary.length,
          geometry: thin(legs.flatMap((l) => (l.shape ? decodePolyline(l.shape, 6) : []))),
          roadNames: [...new Set(legs.flatMap((l) => (l.maneuvers ?? []).flatMap((m) => m.street_names ?? [])))],
        }
      } catch {
        return null
      }
    },
    (a, b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`,
  )
}
