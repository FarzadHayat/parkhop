import type { DayPlan, Lot, Precinct, Region, TollRoad } from '../engine/types'
import precincts from './brisbane-precincts.json'
import tollData from './brisbane-tolls.json'
import calendar from './qld-school-terms.json'
import rawLots from './seq-lots.json'

// South East Queensland. Sources and caveats: docs/research.md.

/** Commuter reports (talkback radio, 2025) of lots full by about 7am. Anecdotal. */
const REPORTED_FULL: Record<string, string> = {
  Carseldine: '07:00',
  Windsor: '07:00',
}

const lots: Lot[] = (rawLots as Lot[]).map((l) => {
  const hit = Object.keys(REPORTED_FULL).find((k) => l.station.name.startsWith(k))
  return hit ? { ...l, fillsByHhmm: REPORTED_FULL[hit], fillSource: 'reported' as const } : l
})

/**
 * Toll roads, matched by the road names OSRM reports. Gateway tolls are charged
 * only on the bridges (the motorway north of the river is free), and the Logan
 * Motorway has several gantries, so we charge one typical gantry.
 */
const NAME_OVERRIDES: Record<string, string[]> = {
  'gateway-murarrie': ['Sir Leo Hielscher Bridges', 'Gateway Bridge'],
  'logan-kuraby-compton': ['Logan Motorway'],
}
const tolls: TollRoad[] = tollData.roads
  .filter((t) => !['logan-loganlea', 'logan-heathwood-paradise'].includes(t.id))
  .map((t) => ({ id: t.id, name: t.name, carPrice: t.carPrice, roadNames: NAME_OVERRIDES[t.id] ?? t.osrmNames }))

export const region: Region = {
  id: 'seq',
  name: 'South East Queensland',
  timeZone: 'Australia/Brisbane',
  currency: 'AUD',
  centre: { lat: -27.4698, lon: 153.0251 },
  bounds: [152.4, -28.3, 153.6, -26.3],
  cityRadiusKm: 2.2,
  // BCC King George Square early bird is $28, daily max $49 (2026).
  cityParkingPerDay: 28,
  farePerJourney: 0.5,
  fareNote: '50c flat fare on all TransLink services (permanent by law), except Airtrain',
  defaultFuelPrice: 1.95,
  lots,
  precincts: (precincts as Precinct[]).filter((p) => p.id !== 'cbd'),
  tolls,
  calendar: { schoolTerms: calendar.terms, publicHolidays: calendar.publicHolidays },
}

const date = '2026-11-23'

export const presets: { id: string; name: string; plan: DayPlan }[] = [
  {
    id: 'commute',
    name: 'Commute to the city',
    plan: {
      date,
      stops: [
        { id: 'home', label: 'Home', place: { name: 'Kallangur', lat: -27.2509, lon: 152.9928 }, dwellMin: 0, leaveAfterHhmm: '06:30', parking: { perDay: 0 } },
        { id: 'work', label: 'Work', place: { name: 'Queen Street Mall, Brisbane City', lat: -27.471, lon: 153.0236 }, dwellMin: 0, arriveByHhmm: '08:45', leaveAfterHhmm: '17:00', parking: { perDay: 28 } },
        { id: 'home2', label: 'Home', place: { name: 'Kallangur', lat: -27.2509, lon: 152.9928 }, dwellMin: 0, parking: { perDay: 0 } },
      ],
      legRules: ['any', 'any'],
    },
  },
  {
    id: 'school',
    name: 'School drop-off, then work',
    plan: {
      date,
      stops: [
        { id: 'home', label: 'Home', place: { name: 'Kallangur', lat: -27.2509, lon: 152.9928 }, dwellMin: 0, parking: { perDay: 0 } },
        { id: 'school', label: 'School', place: { name: 'Mango Hill State School', lat: -27.2435, lon: 153.0347 }, dwellMin: 5, arriveByHhmm: '08:20' },
        { id: 'work', label: 'Work', place: { name: 'Queen Street Mall, Brisbane City', lat: -27.471, lon: 153.0236 }, dwellMin: 0, arriveByHhmm: '09:45', leaveAfterHhmm: '17:00', parking: { perDay: 28 } },
        { id: 'home2', label: 'Home', place: { name: 'Kallangur', lat: -27.2509, lon: 152.9928 }, dwellMin: 0, parking: { perDay: 0 } },
      ],
      legRules: ['car', 'any', 'any'],
    },
  },
]
