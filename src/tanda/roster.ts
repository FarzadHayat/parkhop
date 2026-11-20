// Tanda roster import. Real data comes through the ParkHop server (Tanda's API
// does not allow browser calls from other sites) with the person's own token;
// the token is kept in this browser session only. Field names follow Tanda's
// published OpenAPI spec (my.tanda.co/api/v2/openapi.json).
import type { Place } from '../engine/types'
import { photonProvider } from '../providers/photon'
import { region } from '../data/seq'

export interface Shift {
  id: string
  /** Epoch ms. */
  start: number
  finish: number
  place: Place
  team?: string
}

export interface Roster {
  source: 'tanda' | 'demo'
  personName?: string
  home: Place | null
  shifts: Shift[]
}

// Shapes from the Tanda API (only the fields we use).
interface TandaSchedule {
  id: number
  user_id: number | null
  start: number | null
  finish: number | null
  department_id: number | null
  department_name?: string
  location_name?: string
}
interface TandaDepartment {
  id: number
  location_id: number | null
  name: string
}
interface TandaLocation {
  id: number
  name: string
  latitude: number | null
  longitude: number | null
  address: string | null
}
interface TandaMe {
  name: string
  address: string | null
}

async function tanda<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`/api/tanda${path}`, { headers: { 'x-tanda-token': token }, signal: AbortSignal.timeout(20_000) })
  if (r.status === 401) throw new Error('Tanda did not accept that token')
  if (!r.ok) throw new Error(`Tanda error ${r.status}`)
  return r.json() as Promise<T>
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** The next 7 days of the person's published shifts, with work locations and their home address. */
export async function loadTandaRoster(token: string): Promise<Roster> {
  const from = new Date()
  const to = new Date(from.getTime() + 6 * 86_400_000)
  const [me, schedules, departments, locations] = await Promise.all([
    tanda<TandaMe>('/users/me', token),
    tanda<TandaSchedule[]>(`/schedules?from=${ymd(from)}&to=${ymd(to)}&include_names=true&published_only=true`, token),
    tanda<TandaDepartment[]>('/departments', token).catch(() => [] as TandaDepartment[]),
    tanda<TandaLocation[]>('/locations', token).catch(() => [] as TandaLocation[]),
  ])
  const geocoder = photonProvider(region.bounds)
  const home = me.address ? ((await geocoder.search(me.address, region.centre).catch(() => []))[0] ?? null) : null
  const locById = new Map(locations.map((l) => [l.id, l]))
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const placeCache = new Map<string, Place | null>()

  async function placeFor(s: TandaSchedule): Promise<Place | null> {
    const dept = s.department_id != null ? deptById.get(s.department_id) : undefined
    const loc = dept?.location_id != null ? locById.get(dept.location_id) : undefined
    if (loc?.latitude != null && loc.longitude != null) return { name: loc.name, lat: loc.latitude, lon: loc.longitude }
    const text = loc?.address || s.location_name
    if (!text) return null
    if (!placeCache.has(text)) placeCache.set(text, (await geocoder.search(text, region.centre).catch(() => []))[0] ?? null)
    return placeCache.get(text) ?? null
  }

  const shifts: Shift[] = []
  for (const s of schedules) {
    if (s.start == null || s.finish == null) continue
    const place = await placeFor(s)
    if (!place) continue
    shifts.push({ id: String(s.id), start: s.start * 1000, finish: s.finish * 1000, place, team: s.department_name })
  }
  shifts.sort((a, b) => a.start - b.start)
  return { source: 'tanda', personName: me.name, home, shifts }
}

/**
 * A week for a Brisbane hospitality worker who lives in Kallangur and works in
 * Fortitude Valley: early opens, a midweek day, and late closes, which is where
 * public transport gets hard.
 */
export function demoRoster(weekStart: string): Roster {
  const valley: Place = { name: 'Brunswick Street Mall, Fortitude Valley', lat: -27.4573, lon: 153.0344 }
  const at = (dayOffset: number, hhmm: string) => {
    const [y, m, d] = weekStart.split('-').map(Number)
    const [hh, mm] = hhmm.split(':').map(Number)
    // Brisbane is UTC+10 all year.
    return Date.UTC(y, m - 1, d + dayOffset, hh - 10, mm)
  }
  const shift = (id: string, day: number, start: string, finish: string, team: string): Shift => ({
    id,
    start: at(day, start),
    finish: at(day, finish),
    place: valley,
    team,
  })
  return {
    source: 'demo',
    personName: 'Demo barista',
    home: { name: 'Kallangur', lat: -27.2509, lon: 152.9928 },
    shifts: [
      shift('d1', 0, '06:00', '14:00', 'Coffee bar (open)'),
      shift('d2', 1, '07:00', '15:30', 'Coffee bar'),
      shift('d3', 3, '09:30', '18:00', 'Kitchen'),
      shift('d4', 4, '16:00', '23:30', 'Bar (close)'),
      shift('d5', 5, '17:00', '23:45', 'Bar (close)'),
    ],
  }
}
