import type { LatLon, Place, Segment, Weather } from '../engine/types'

export interface DriveRoute {
  /** Free-flow minutes (no traffic). */
  durationMin: number
  distanceKm: number
  geometry?: [number, number][]
  /** True when the router failed and this is a straight-line guess. */
  estimated?: boolean
}

export interface DriveProvider {
  route(a: LatLon, b: LatLon): Promise<DriveRoute>
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
