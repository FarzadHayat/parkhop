// Core domain types for the commute planner. Times are epoch milliseconds
// unless named `*Hhmm` (local wall-clock "HH:MM" in the region's timezone).

export interface LatLon {
  lat: number
  lon: number
}

export interface Place extends LatLon {
  name: string
}

/** What the user requires of one leg (stop i -> stop i+1). */
export type LegRule =
  | 'any' // let the planner choose
  | 'car' // arrive with your own car (drive this leg, fetching the car first if it is parked elsewhere)
  | 'transit' // no car on this leg

export interface StopParking {
  /** Daily cost of leaving the car at this stop. */
  perDay: number
  /** Optional hourly rate; the charge is min(hours * perHour, perDay). */
  perHour?: number
  /** Longest legal stay in minutes (time-limited street parking). */
  maxStayMin?: number
  /** You hold a permit or staff space here, so the price is yours, not the area's. */
  permit?: boolean
}

export interface Stop {
  id: string
  label: string
  place: Place | null
  /** Must arrive at this stop by this local time. */
  arriveByHhmm?: string
  /** Leave this stop no earlier than this local time. */
  leaveAfterHhmm?: string
  /** Minimum minutes spent at the stop (e.g. 5 for a school drop-off). */
  dwellMin: number
  /** Cost to park here. Undefined means you cannot leave the car here. */
  parking?: StopParking
}

export interface DayPlan {
  /** Local date, YYYY-MM-DD. */
  date: string
  stops: Stop[]
  /** One rule per leg; length is stops.length - 1. */
  legRules: LegRule[]
}

export type TransitMode = 'rail' | 'bus' | 'tram' | 'ferry' | 'metro'

export interface Station {
  name: string
  lat: number
  lon: number
  modes: TransitMode[]
}

/** pnr = signed park 'n' ride; carpark = other public car park; street = kerbside parking. */
export type ParkingKind = 'pnr' | 'carpark' | 'street'

export interface Lot extends LatLon {
  id: string
  name: string
  /** Defaults to 'pnr'. */
  kind?: ParkingKind
  /** False when nobody has mapped the time limit: tell people to check the signs. */
  stayKnown?: boolean
  /** False when the price is a guess. */
  feeKnown?: boolean
  /** Extra minutes to find a space (kerbside parking means circling). */
  extraParkMin?: number
  capacity?: number
  /** Daily fee; 0 for free. */
  perDay: number
  /** Longest legal stay in hours. Undefined = no limit. */
  maxStayHours?: number
  /** Local opening hours, undefined = 24h. */
  opensHhmm?: string
  closesHhmm?: string
  /** Typical weekday time the lot is full, local. Undefined = rarely fills. */
  fillsByHhmm?: string
  fillSource: 'reported' | 'estimated' | 'user' | 'unknown'
  station: Station
  /** Where the record came from, for attribution. */
  source: string
  notes?: string
}

export interface Region {
  id: string
  name: string
  timeZone: string
  currency: string
  centre: LatLon
  /** Map bounds [west, south, east, north]. */
  bounds: [number, number, number, number]
  /** Radius around the centre that counts as paid city parking. */
  cityRadiusKm: number
  /** Typical all-day city parking cost (early bird or daily max). */
  cityParkingPerDay: number
  /** Public transport fare per one-way journey. */
  farePerJourney: number
  fareNote: string
  defaultFuelPrice: number
  lots: Lot[]
  /** Paid-parking areas outside the city centre (hospitals, universities, inner suburbs). */
  precincts?: Precinct[]
  /** Toll roads, matched by road name on the driving route. */
  tolls?: TollRoad[]
  /** School terms and public holidays, for the traffic model. */
  calendar?: TravelCalendar
}

export interface Precinct extends LatLon {
  id: string
  name: string
  radiusKm: number
  perDay: number
  confidence: 'high' | 'medium' | 'low'
}

export interface TollRoad {
  id: string
  name: string
  roadNames: string[]
  carPrice: number
}

export interface TravelCalendar {
  /** Inclusive local date ranges (YYYY-MM-DD) when schools are open. */
  schoolTerms: { start: string; end: string }[]
  publicHolidays: string[]
}

export interface Settings {
  fuelLPer100km: number
  fuelPricePerL: number
  /** Extra running cost per km (tyres, servicing). */
  wearPerKm: number
  /** How much an hour of your time is worth, for the balanced ranking. */
  valuePerHour: number
  /** Chance of being on time you want the leave-by time to guarantee. */
  onTimeTarget: number
  /** Minutes to park and walk from the car to the platform. */
  parkToPlatformMin: number
  maxWalkMin: number
  priority: Priority
  /** Never take a toll road when the router offers a toll-free route. */
  avoidTolls?: boolean
  /** Leave fuel out of car costs (someone else pays, or you do not count it). */
  ignoreFuel?: boolean
  /** Leave wear and servicing out of car costs. */
  ignoreWear?: boolean
}

export type Priority = 'balanced' | 'cheapest' | 'fastest' | 'reliable'

export type SegmentMode = 'drive' | 'walk' | 'wait' | 'park' | TransitMode

export interface Segment {
  mode: SegmentMode
  fromName: string
  toName: string
  start: number
  end: number
  distanceM?: number
  /** [lon, lat] pairs. */
  geometry?: [number, number][]
  route?: string
  headsign?: string
  colour?: string
  realtime?: boolean
  delayMin?: number
  /** Minutes between services on this route around this time. */
  headwayMin?: number
  alerts?: string[]
  /** Extra detail to show with the step, e.g. a toll road used. */
  note?: string
}

export interface CostBreakdown {
  fuel: number
  wear: number
  parking: number
  fares: number
  tolls?: number
}

export type LegKind = 'drive' | 'transit' | 'parkride' | 'retrieve'

/** Where the car is: with you at a stop, at a lot, or at a stop you left. */
export type CarLocation = { kind: 'stop'; stopIndex: number } | { kind: 'lot'; lotId: string }

export interface TransitAlternative {
  /** Time you must be at the boarding point (start of first transit-related walk). */
  readyBy: number
  /** First vehicle departure. */
  board: number
  arrive: number
  /** Index into the itinerary list for display. */
  index: number
  mainMode: TransitMode
}

export interface LegPlan {
  legIndex: number
  kind: LegKind
  lotId?: string
  segments: Segment[]
  depart: number
  arrive: number
  cost: CostBreakdown
  driveKm: number
  /** Inputs the reliability simulation needs. */
  sim: LegSimInput
  warnings: Warning[]
}

export interface LegSimInput {
  /** Planned departure from the origin. */
  depart: number
  /** Driving portion before transit (or the whole leg for drive). Minutes, mean. */
  driveBeforeMin: number
  driveBeforeCv: number
  /** Fixed buffer after the drive (park and walk to platform). */
  bufferAfterDriveMin: number
  /** Probability the lot is full at arrival, and the minutes lost if so. */
  lotFullProb: number
  lotFullPenaltyMin: number
  /** Transit alternatives sorted by readiness time; empty for drive-only legs. */
  alternatives: TransitAlternative[]
  /** Walking/driving after transit (retrieve legs drive after). Minutes. */
  driveAfterMin: number
  driveAfterCv: number
  /** Minutes from transit start of the walk to the station when there is no drive before (transit-only legs). */
  walkBeforeMin: number
  transitDelaySdMin: number
}

export type WarningLevel = 'info' | 'caution' | 'blocker'

export interface Warning {
  level: WarningLevel
  text: string
}

export interface Reliability {
  /** Chance every arrive-by deadline in the day is met. */
  onTimeProb: number
  /** Per stop index with a deadline: chance of making it. */
  perStop: { stopIndex: number; prob: number; p90LateMin: number }[]
  /** Arrival histogram (minutes relative to deadline) for the first deadline. */
  histogram?: { binStartMin: number; count: number }[]
}

export interface DayOption {
  id: string
  title: string
  strategy: 'parkride' | 'drive' | 'transit' | 'mixed'
  legs: LegPlan[]
  lotIds: string[]
  leaveBy: number
  totalTravelMin: number
  /** Expected minutes lost hunting for parking when the lot is full. Counts against the option. */
  parkingHassleMin?: number
  cost: CostBreakdown
  costTotal: number
  reliability: Reliability
  warnings: Warning[]
  score: number
  feasible: boolean
}

export interface Weather {
  /** Hourly precipitation mm keyed by local hour start (epoch ms). */
  hourly: { time: number; precipMm: number; precipProb: number; tempC: number; code: number }[]
}

export interface PlanResult {
  options: DayOption[]
  /** Options that failed, with the reason, so the UI can explain. */
  rejected: { title: string; reason: string }[]
  candidateLotIds: string[]
  weather?: Weather
  dataNotes: string[]
}
