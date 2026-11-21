import { create } from 'zustand'
import { defaultSettings, planDay, rerank } from '../engine/planner'
import { nextWeekday } from '../engine/time'
import type { DayOption, DayPlan, LegRule, Lot, Place, PlanResult, Settings, Stop, StopParking } from '../engine/types'
import { region, presets } from '../data/seq'
import { km } from '../engine/geo'
import { getDeps, health } from './deps'

export type Status = { kind: 'idle' } | { kind: 'planning'; done: number; total: number } | { kind: 'error'; message: string } | { kind: 'done' }

interface StoredState {
  plan: DayPlan
  settings: Settings
  /** Fill times the user has reported, by lot id (HH:MM). */
  fillReports: Record<string, string>
  /** Places where you have your own parking (a work permit, a staff space). */
  myParking: SavedParking[]
}

export interface SavedParking {
  name: string
  lat: number
  lon: number
  perDay: number
}

/** Saved parking within ~250 m counts as the same place. */
export function savedParkingAt(place: Place, saved: SavedParking[]): SavedParking | undefined {
  return saved.find((p) => km(place, p) <= 0.25)
}

const STORAGE_KEY = 'parkhop:v1'

function load(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as StoredState
    if (!s.plan?.stops?.length) return null
    return s
  } catch {
    return null
  }
}

function save(s: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

let idSeq = 0
export const newId = () => `s${Date.now().toString(36)}${(idSeq++).toString(36)}`

/**
 * Parking price at a place: your own permit if you saved one there, otherwise the
 * usual all-day price for the area (CBD, a paid precinct such as a hospital or
 * uni, or free).
 */
export function defaultParkingFor(place: Place | null): StopParking | undefined {
  if (!place) return undefined
  const mine = savedParkingAt(place, useApp.getState().myParking)
  if (mine) return { perDay: mine.perDay, permit: true }
  return defaultParkingForArea(place)
}

function defaultParkingForArea(place: Place): StopParking {
  if (km(place, region.centre) < region.cityRadiusKm) return { perDay: region.cityParkingPerDay }
  const precinct = (region.precincts ?? []).find((p) => km(place, p) <= p.radiusKm)
  return { perDay: precinct ? precinct.perDay : 0 }
}

function freshDate(plan: DayPlan): DayPlan {
  const today = nextWeekday(Date.now(), region.timeZone)
  return plan.date < today ? { ...plan, date: today } : plan
}

export function lotsWithReports(fillReports: Record<string, string>): Lot[] {
  return region.lots.map((l) => (fillReports[l.id] ? { ...l, fillsByHhmm: fillReports[l.id], fillSource: 'user' as const } : l))
}

interface AppState extends StoredState {
  result: PlanResult | null
  options: DayOption[]
  status: Status
  selectedId: string | null
  pickingStopId: string | null
  focusLotId: string | null
  /** Bumped when the plan changes after a result, to flag results as stale. */
  stale: boolean
  /** The server has an Anthropic key, so the assistant can run. */
  assistantReady: boolean
  setPlan(plan: DayPlan): void
  updateStop(id: string, patch: Partial<Stop>): void
  setRule(index: number, rule: LegRule): void
  addStop(): void
  removeStop(id: string): void
  moveStop(id: string, dir: -1 | 1): void
  setSettings(patch: Partial<Settings>): void
  loadPreset(id: string): void
  plan_(): Promise<void>
  select(id: string | null): void
  setPicking(id: string | null): void
  focusLot(id: string | null): void
  reportFill(lotId: string, hhmm: string | null): void
  forgetParking(index: number): void
}

const initial = load()
const firstPlan = freshDate(initial?.plan ?? presets[0].plan)

let runToken = 0

export const useApp = create<AppState>((set, get) => {
  const persist = () => {
    const { plan, settings, fillReports, myParking } = get()
    save({ plan, settings, fillReports, myParking })
  }
  const changed = (plan: DayPlan) => {
    set({ plan, stale: get().result !== null })
    persist()
  }
  return {
    plan: firstPlan,
    settings: { ...defaultSettings, ...initial?.settings },
    fillReports: initial?.fillReports ?? {},
    myParking: initial?.myParking ?? [],
    result: null,
    options: [],
    status: { kind: 'idle' },
    selectedId: null,
    pickingStopId: null,
    focusLotId: null,
    stale: false,
    assistantReady: false,

    setPlan: (plan) => changed(plan),
    updateStop(id, patch) {
      const plan = get().plan
      const stops = plan.stops.map((s) => {
        if (s.id !== id) return s
        const next = { ...s, ...patch }
        // A newly chosen place gets the usual parking cost for its area.
        if (patch.place && !('parking' in patch)) next.parking = defaultParkingFor(patch.place)
        return next
      })
      // Remember (or forget) a permit for this place, so shifts and later plans use it.
      const stop = stops.find((s) => s.id === id)
      if ('parking' in patch && stop?.place) {
        const others = get().myParking.filter((p) => km(p, stop.place!) > 0.25)
        const myParking = patch.parking?.permit ? [...others, { name: stop.place.name, lat: stop.place.lat, lon: stop.place.lon, perDay: patch.parking.perDay }] : others
        set({ myParking })
      }
      changed({ ...plan, stops })
    },
    setRule(index, rule) {
      const plan = get().plan
      const legRules = plan.legRules.slice()
      legRules[index] = rule
      changed({ ...plan, legRules })
    },
    addStop() {
      const plan = get().plan
      const stops = plan.stops.slice()
      const at = Math.max(1, stops.length - 1)
      stops.splice(at, 0, { id: newId(), label: 'Stop', place: null, dwellMin: 10, parking: undefined })
      const legRules = plan.legRules.slice()
      legRules.splice(at - 1, 0, 'any')
      changed({ ...plan, stops, legRules })
    },
    removeStop(id) {
      const plan = get().plan
      if (plan.stops.length <= 2) return
      const idx = plan.stops.findIndex((s) => s.id === id)
      const stops = plan.stops.filter((s) => s.id !== id)
      const legRules = plan.legRules.slice()
      legRules.splice(Math.min(idx, legRules.length - 1), 1)
      changed({ ...plan, stops, legRules })
    },
    moveStop(id, dir) {
      const plan = get().plan
      const idx = plan.stops.findIndex((s) => s.id === id)
      const to = idx + dir
      if (to < 0 || to >= plan.stops.length) return
      const stops = plan.stops.slice()
      ;[stops[idx], stops[to]] = [stops[to], stops[idx]]
      changed({ ...plan, stops })
    },
    setSettings(patch) {
      const settings = { ...get().settings, ...patch }
      const onlyPriority = Object.keys(patch).length === 1 && 'priority' in patch
      set({ settings, options: rerank(get().options, settings), stale: onlyPriority ? get().stale : get().result !== null })
      persist()
    },
    loadPreset(id) {
      const p = presets.find((x) => x.id === id)
      if (!p) return
      set({ plan: freshDate(structuredClone(p.plan)), result: null, options: [], selectedId: null, stale: false, status: { kind: 'idle' } })
      persist()
      void get().plan_()
    },
    async plan_() {
      const token = ++runToken
      const { plan, settings, fillReports } = get()
      if (plan.stops.some((s) => !s.place)) {
        set({ status: { kind: 'error', message: 'Choose a place for every stop' } })
        return
      }
      set({ status: { kind: 'planning', done: 0, total: 1 } })
      try {
        const result = await planDay(plan, { ...region, lots: lotsWithReports(fillReports) }, settings, await getDeps(), {
          onProgress: (done, total) => {
            if (token === runToken) set({ status: { kind: 'planning', done, total } })
          },
        })
        if (token !== runToken) return
        const options = rerank(result.options, settings)
        set({
          result,
          options,
          stale: false,
          selectedId: options[0]?.id ?? null,
          status: options.length ? { kind: 'done' } : { kind: 'error', message: result.rejected[0]?.reason ?? 'No workable plan found' },
        })
      } catch (e) {
        if (token !== runToken) return
        set({ status: { kind: 'error', message: e instanceof Error ? e.message : 'Planning failed' } })
      }
    },
    select: (id) => set({ selectedId: id }),
    setPicking: (id) => set({ pickingStopId: id }),
    focusLot: (id) => set({ focusLotId: id }),
    reportFill(lotId, hhmm) {
      const fillReports = { ...get().fillReports }
      if (hhmm) fillReports[lotId] = hhmm
      else delete fillReports[lotId]
      set({ fillReports, stale: get().result !== null })
      persist()
    },
    forgetParking(index) {
      const gone = get().myParking[index]
      if (!gone) return
      const myParking = get().myParking.filter((_, i) => i !== index)
      // Stops at that place go back to the area's usual price.
      const plan = get().plan
      const stops = plan.stops.map((s) => (s.parking?.permit && s.place && km(s.place, gone) <= 0.25 ? { ...s, parking: defaultParkingForArea(s.place) } : s))
      set({ myParking })
      changed({ ...plan, stops })
    },
  }
})

export function selectedOption(s: Pick<AppState, 'options' | 'selectedId'>): DayOption | undefined {
  return s.options.find((o) => o.id === s.selectedId) ?? s.options[0]
}

export { region }

void health.then((h) => useApp.setState({ assistantReady: !!h?.assistant }))
