import type { LatLon, Place, Segment, Weather } from '../engine/types'

export interface DriveRoute {
  /** Free-flow minutes (no traffic). */
  durationMin: number
  distanceKm: number
  geometry?: [number, number][]
  /** Names of the roads used, for toll detection. */
  roadNames?: string[]
  /** True when the router failed and this is a straight-line guess. */
  estimated?: boolean
  /** Other routes the router found (e.g. one that avoids a toll road). */
  alternatives?: DriveRoute[]
}

export interface DriveProvider {
  route(a: LatLon, b: LatLon): Promise<DriveRoute>
  /** A route that avoids toll roads, when the main router did not offer one. Null if none. */
  tollFree?(a: LatLon, b: LatLon): Promise<DriveRoute | null>
}

export interface TransitQuery {
  from: LatLon
  to: LatLon
  /** Departure time, or arrival time when arriveBy. */
  time: number
  arriveBy: boolean
  windowMin: number
  maxWalkMin: number
}

export interface TransitItinerary {
  start: number
  end: number
  transfers: number
  segments: Segment[]
}

export interface TransitProvider {
  plan(q: TransitQuery): Promise<TransitItinerary[]>
}

export interface WeatherProvider {
  forecast(at: LatLon, timeZone: string): Promise<Weather | undefined>
}

export interface GeocodeProvider {
  search(text: string, near: LatLon, signal?: AbortSignal): Promise<Place[]>
  reverse(at: LatLon): Promise<Place | null>
}
