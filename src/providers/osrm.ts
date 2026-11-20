import { km } from '../engine/geo'
import type { LatLon } from '../engine/types'
import { getJson, limiter, memoAsync } from './http'
import type { DriveProvider, DriveRoute } from './types'

interface OsrmResponse {
  code: string
  routes: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[]
}

/** Straight-line fallback when the router is unreachable. Clearly marked as an estimate. */
export function guessDrive(a: LatLon, b: LatLon): DriveRoute {
  const d = km(a, b) * 1.35
  return {
    durationMin: (d / 55) * 60 + 2,
    distanceKm: d,
    geometry: [
      [a.lon, a.lat],
      [b.lon, b.lat],
    ],
    estimated: true,
  }
}

/** Car routing via an OSRM server (public demo by default: fair use, no SLA). */
export function osrmProvider(base = 'https://router.project-osrm.org'): DriveProvider {
  const run = limiter(3)
  const route = memoAsync(
    async (a: LatLon, b: LatLon): Promise<DriveRoute> => {
      const coords = `${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}`
      try {
        const res = await run(() =>
          getJson<OsrmResponse>(`${base}/route/v1/driving/${coords}?overview=simplified&geometries=geojson`, {
            timeoutMs: 12_000,
          }),
        )
        const r = res.routes?.[0]
        if (res.code !== 'Ok' || !r) return guessDrive(a, b)
        return { durationMin: r.duration / 60, distanceKm: r.distance / 1000, geometry: r.geometry.coordinates }
      } catch {
        return guessDrive(a, b)
      }
    },
    (a, b) => `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`,
  )
  return { route }
}
