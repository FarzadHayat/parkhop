import { decodePolyline, thin } from '../engine/geo'
import type { Segment, SegmentMode } from '../engine/types'
import { getJson, limiter, memoAsync } from './http'
import type { TransitItinerary, TransitProvider, TransitQuery } from './types'

// MOTIS 2 API as served by Transitous (https://transitous.org): free,
// community-run, worldwide GTFS + GTFS-RT. CORS is open.

interface MotisPlace {
  name: string
  lat: number
  lon: number
}

interface MotisLeg {
  mode: string
  from: MotisPlace
  to: MotisPlace
  startTime: string
  endTime: string
  scheduledStartTime: string
  scheduledEndTime: string
  realTime: boolean
  distance?: number
  routeShortName?: string
  displayName?: string
  headsign?: string
  routeColor?: string
  legGeometry?: { points: string; precision: number }
  alerts?: { headerText?: string; descriptionText?: string; impactPeriod?: { start?: string; end?: string }[] }[]
  cancelled?: boolean
}

interface MotisItinerary {
  startTime: string
  endTime: string
  transfers: number
  legs: MotisLeg[]
}

interface MotisPlan {
  itineraries: MotisItinerary[]
}

export function mapMode(m: string): SegmentMode {
  switch (m) {
    case 'WALK':
      return 'walk'
    case 'CAR':
    case 'CAR_PARKING':
      return 'drive'
    case 'BUS':
    case 'COACH':
      return 'bus'
    case 'TRAM':
    case 'CABLE_CAR':
    case 'FUNICULAR':
      return 'tram'
    case 'FERRY':
      return 'ferry'
    case 'SUBWAY':
    case 'METRO':
      return 'metro'
    default:
      return 'rail'
  }
}

export function mapItinerary(it: MotisItinerary): TransitItinerary {
  const segments: Segment[] = it.legs
    .filter((l) => !(l.mode === 'WALK' && Date.parse(l.endTime) - Date.parse(l.startTime) < 30_000))
    .map((l) => {
      const start = Date.parse(l.startTime)
      const end = Date.parse(l.endTime)
      const sched = Date.parse(l.scheduledStartTime)
      const geometry = l.legGeometry ? thin(decodePolyline(l.legGeometry.points, l.legGeometry.precision), 150) : undefined
      // Keep only alerts in effect while you are on this leg.
      const active = (l.alerts ?? []).filter(
        (a) =>
          !a.impactPeriod?.length ||
          a.impactPeriod.some((r) => (!r.start || Date.parse(r.start) <= end) && (!r.end || Date.parse(r.end) >= start)),
      )
      const alerts = [...new Set(active.map((a) => (a.headerText || a.descriptionText || '').trim()).filter(Boolean))].slice(0, 2)
      if (l.cancelled) alerts.unshift('Cancelled')
      return {
        mode: mapMode(l.mode),
        fromName: l.from.name === 'START' ? '' : l.from.name,
        toName: l.to.name === 'END' ? '' : l.to.name,
        start,
        end,
        distanceM: l.distance,
        geometry,
        route: l.routeShortName || l.displayName,
        headsign: l.headsign,
        colour: l.routeColor ? `#${l.routeColor}` : undefined,
        realtime: l.realTime,
        delayMin: l.realTime ? Math.round((start - sched) / 60_000) : undefined,
        alerts: alerts.length ? alerts : undefined,
      }
    })
  return { start: Date.parse(it.startTime), end: Date.parse(it.endTime), transfers: it.transfers, segments }
}

/** `headers` is for non-browser use: Transitous blocks generic user agents (browsers send their own). */
export function transitousProvider(base = 'https://api.transitous.org', headers?: Record<string, string>): TransitProvider {
  const run = limiter(3)
  const plan = memoAsync(
    async (q: TransitQuery): Promise<TransitItinerary[]> => {
      const p = new URLSearchParams({
        fromPlace: `${q.from.lat.toFixed(6)},${q.from.lon.toFixed(6)}`,
        toPlace: `${q.to.lat.toFixed(6)},${q.to.lon.toFixed(6)}`,
        time: new Date(q.time).toISOString(),
        arriveBy: String(q.arriveBy),
        searchWindow: String(Math.round(q.windowMin * 60)),
        numItineraries: '6',
        detailedTransfers: 'false',
        preTransitModes: 'WALK',
        postTransitModes: 'WALK',
        directModes: 'WALK',
        maxDirectTime: '0',
        maxPreTransitTime: String(q.maxWalkMin * 60),
        maxPostTransitTime: String(q.maxWalkMin * 60),
      })
      const res = await run(() => getJson<MotisPlan>(`${base}/api/v5/plan?${p}`, { timeoutMs: 25_000, retries: 2, headers }))
      return (res.itineraries ?? [])
        .filter((it) => it.legs.some((l) => l.mode !== 'WALK'))
        .map(mapItinerary)
        .sort((a, b) => a.start - b.start)
    },
    (q) => JSON.stringify([q.from.lat.toFixed(4), q.from.lon.toFixed(4), q.to.lat.toFixed(4), q.to.lon.toFixed(4), q.time, q.arriveBy, q.windowMin, q.maxWalkMin]),
  )
  return { plan }
}
