// Links that hand a leg of the plan to the person's navigation app. These are
// plain web links: on a phone they open the installed app, on a computer they
// open the map in the browser.
import type { Segment } from '../engine/types'

export interface Point {
  lat: number
  lon: number
}

export interface NavLink {
  app: string
  href: string
}

const at = (p: Point) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`

/** Where a segment starts and ends, from its line on the map ([lon, lat] pairs). */
export function segmentStart(s: Segment): Point | null {
  const p = s.geometry?.[0]
  return p ? { lat: p[1], lon: p[0] } : null
}

export function segmentEnd(s: Segment): Point | null {
  const p = s.geometry?.[s.geometry.length - 1]
  return p ? { lat: p[1], lon: p[0] } : null
}

/** Turn-by-turn driving to a place, starting from wherever you are. */
export function driveLinks(to: Point): NavLink[] {
  return [
    { app: 'Google Maps', href: `https://www.google.com/maps/dir/?api=1&destination=${at(to)}&travelmode=driving` },
    { app: 'Apple Maps', href: `https://maps.apple.com/?daddr=${at(to)}&dirflg=d` },
    { app: 'Waze', href: `https://waze.com/ul?ll=${at(to)}&navigate=yes` },
  ]
}

/** Public transport directions between two points. Google Maps picks the next services itself. */
export function transitLink(from: Point, to: Point): NavLink {
  return { app: 'Google Maps', href: `https://www.google.com/maps/dir/?api=1&origin=${at(from)}&destination=${at(to)}&travelmode=transit` }
}

const NOT_TRANSIT = new Set(['drive', 'walk', 'wait', 'park'])

/** The public transport part of a leg: from where the walk to the stop starts, to where it ends. */
export function transitSpan(segments: Segment[]): { from: Point; to: Point } | null {
  const first = segments.findIndex((s) => s.mode !== 'drive' && s.mode !== 'park')
  if (first < 0 || !segments.some((s) => !NOT_TRANSIT.has(s.mode))) return null
  const from = segmentStart(segments[first])
  const to = segmentEnd(segments[segments.length - 1])
  return from && to ? { from, to } : null
}
