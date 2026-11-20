import { create } from 'zustand'
import { planDay, rerank } from '../engine/planner'
import { formatHhmm, nextWeekday } from '../engine/time'
import type { DayOption, DayPlan, Place, Warning } from '../engine/types'
import { region } from '../data/seq'
import { demoRoster, loadTandaRoster, type Roster, type Shift } from '../tanda/roster'
import { getDeps } from './deps'
import { defaultParkingFor, lotsWithReports, newId, useApp } from './store'

export interface ShiftPlan {
  shift: Shift
  plan: DayPlan
  status: 'waiting' | 'planning' | 'done' | 'error'
  best?: DayOption
  drive?: DayOption
  transit?: DayOption
  flags: Warning[]
  error?: string
}

const tz = region.timeZone
const localDate = (epoch: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch))

/** Home -> work (arrive 10 min early) -> home after the shift. */
export function dayPlanForShift(shift: Shift, home: Place): DayPlan {
  const arrive = formatHhmm(shift.start - 10 * 60_000, tz)
  const sameDay = localDate(shift.finish) === localDate(shift.start)
  const leave = sameDay ? formatHhmm(shift.finish, tz) : '23:59'
  return {
    date: localDate(shift.start),
    stops: [
      { id: newId(), label: 'Home', place: home, dwellMin: 0, parking: { perDay: 0 } },
      {
        id: newId(),
        label: shift.team ? `Work · ${shift.team}` : 'Work',
        place: shift.place,
        dwellMin: 0,
        arriveByHhmm: arrive,
        leaveAfterHhmm: leave,
        parking: defaultParkingFor(shift.place),
      },
      { id: newId(), label: 'Home', place: home, dwellMin: 0, parking: { perDay: 0 } },
    ],
    legRules: ['any', 'any'],
  }
}

function flagsFor(sp: ShiftPlan): Warning[] {
  const flags: Warning[] = []
  if (!sp.transit) flags.push({ level: 'caution', text: 'Public transport alone cannot cover this shift both ways' })
  if (sp.best?.strategy === 'drive') flags.push({ level: 'caution', text: 'Driving is the only reliable way for this shift' })
  for (const w of sp.best?.warnings ?? []) if (w.level !== 'info' && flags.length < 3) flags.push(w)
  if (sp.best && sp.best.reliability.onTimeProb < 0.8)
    flags.push({ level: 'caution', text: `Only ${Math.round(sp.best.reliability.onTimeProb * 100)}% on time even with the best option` })
  return flags
}

interface ShiftState {
  roster: Roster | null
  plans: ShiftPlan[]
  loading: boolean
  error: string | null
  /** Tanda token, this tab only. */
  token: string
  setToken(t: string): void
  loadDemo(): void
  loadTanda(): Promise<void>
  planAll(): Promise<void>
}

export const useShifts = create<ShiftState>((set, get) => ({
  roster: null,
  plans: [],
  loading: false,
  error: null,
  token: (() => {
    try {
      return sessionStorage.getItem('parkhop:tanda') ?? ''
    } catch {
      return ''
    }
  })(),
  setToken(token) {
    set({ token })
    try {
      sessionStorage.setItem('parkhop:tanda', token)
    } catch {
      /* private mode: keep it in memory only */
    }
  },
  loadDemo() {
    const roster = demoRoster(nextWeekday(Date.now() + 86_400_000, tz))
    // Use the home the person already set, if any.
    const home = useApp.getState().plan.stops[0]?.place ?? roster.home
    set({ roster: { ...roster, home }, plans: [], error: null })
  },
  async loadTanda() {
    const { token } = get()
    if (!token.trim()) return set({ error: 'Paste a Tanda access token first' })
    set({ loading: true, error: null })
    try {
      const roster = await loadTandaRoster(token.trim())
      const home = roster.home ?? useApp.getState().plan.stops[0]?.place ?? null
      set({ roster: { ...roster, home }, plans: [], loading: false })
      if (!roster.shifts.length) set({ error: 'No published shifts in the next 7 days' })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Could not load the roster' })
    }
  },
  async planAll() {
    const { roster } = get()
    if (!roster?.home) return set({ error: 'Set your home first (stop 1 in Your day)' })
    const app = useApp.getState()
    const plans: ShiftPlan[] = roster.shifts.map((shift) => ({ shift, plan: dayPlanForShift(shift, roster.home!), status: 'waiting', flags: [] }))
    set({ plans, loading: true, error: null })
    const deps = await getDeps()
    const regionWithReports = { ...region, lots: lotsWithReports(app.fillReports) }
    // One shift at a time: kind to the free timetable server, and results stream in.
    for (let i = 0; i < plans.length; i++) {
      set({ plans: get().plans.map((p, k) => (k === i ? { ...p, status: 'planning' } : p)) })
      try {
        const res = await planDay(plans[i].plan, regionWithReports, app.settings, deps, { lotsPerLeg: 3 })
        const ranked = rerank(res.options, app.settings)
        const sp: ShiftPlan = {
          ...plans[i],
          status: 'done',
          best: ranked[0],
          drive: ranked.find((o) => o.strategy === 'drive'),
          transit: ranked.find((o) => o.strategy === 'transit'),
          flags: [],
        }
        sp.flags = flagsFor(sp)
        if (!sp.best) sp.error = res.rejected[0]?.reason ?? 'No workable plan'
        set({ plans: get().plans.map((p, k) => (k === i ? sp : p)) })
      } catch (e) {
        set({ plans: get().plans.map((p, k) => (k === i ? { ...p, status: 'error', error: e instanceof Error ? e.message : 'Failed' } : p)) })
      }
    }
    set({ loading: false })
  },
}))

/** Week totals: what the recommended plans cost against driving every shift. */
export function weekTotals(plans: ShiftPlan[]) {
  const done = plans.filter((p) => p.status === 'done' && p.best)
  const best = done.reduce((s, p) => s + p.best!.costTotal, 0)
  const drive = done.reduce((s, p) => s + (p.drive?.costTotal ?? p.best!.costTotal), 0)
  const risky = done.filter((p) => p.flags.some((f) => f.level !== 'info')).length
  return { shifts: done.length, best, drive, saving: drive - best, risky }
}
