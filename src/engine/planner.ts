import type { DriveProvider, DriveRoute, TransitItinerary, TransitProvider, WeatherProvider } from '../providers/types'
import { km, shortlistLots } from './geo'
import { checkLotStay, lotFullProbability, stopParkingCost } from './parking'
import { legOnTimeProb, simulateDay } from './simulate'
import { formatHhmm, localToEpoch } from './time'
import { rainAt, trafficAt } from './traffic'
import type {
  CarLocation,
  CostBreakdown,
  DayOption,
  DayPlan,
  LatLon,
  LegKind,
  LegPlan,
  LegSimInput,
  Lot,
  PlanResult,
  Region,
  Segment,
  Settings,
  Stop,
  TransitAlternative,
  TransitMode,
  Warning,
  Weather,
} from './types'

const MIN = 60_000
/** Stops this short count as a drop-off: you can stop briefly without paid parking. */
export const DROP_OFF_MAX_MIN = 10

export interface PlannerDeps {
  drive: DriveProvider
  transit: TransitProvider
  weather?: WeatherProvider
}

export const defaultSettings: Settings = {
  fuelLPer100km: 8.5,
  fuelPricePerL: 1.95,
  wearPerKm: 0.06,
  valuePerHour: 20,
  onTimeTarget: 0.9,
  parkToPlatformMin: 3,
  maxWalkMin: 15,
  priority: 'balanced',
}

// ---------- small maths helpers ----------

function erf(x: number): number {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

/** P(X <= x) for a log-normal with the given mean and coefficient of variation. */
export function lognormalCdf(x: number, mean: number, cv: number): number {
  if (x <= 0) return 0
  const s2 = Math.log(1 + cv * cv)
  const mu = Math.log(mean) - s2 / 2
  return 0.5 * (1 + erf((Math.log(x) - mu) / Math.sqrt(2 * s2)))
}

function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export function samePlace(a: LatLon | null, b: LatLon | null): boolean {
  return !!a && !!b && km(a, b) < 0.25
}

function zeroCost(): CostBreakdown {
  return { fuel: 0, wear: 0, parking: 0, fares: 0 }
}

export function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return { fuel: a.fuel + b.fuel, wear: a.wear + b.wear, parking: a.parking + b.parking, fares: a.fares + b.fares }
}

export function costTotal(c: CostBreakdown): number {
  return c.fuel + c.wear + c.parking + c.fares
}

function driveCost(kmDriven: number, s: Settings): CostBreakdown {
  return { fuel: (kmDriven * s.fuelLPer100km * s.fuelPricePerL) / 100, wear: kmDriven * s.wearPerKm, parking: 0, fares: 0 }
}

const DELAY_SD: Record<TransitMode, number> = { rail: 1.6, metro: 1.2, tram: 1.8, ferry: 2, bus: 2.8 }

function mainMode(it: TransitItinerary): TransitMode {
  let best: Segment | undefined
  for (const s of it.segments) {
    if (s.mode === 'walk' || s.mode === 'drive' || s.mode === 'wait' || s.mode === 'park') continue
    if (!best || s.end - s.start > best.end - best.start) best = s
  }
  return (best?.mode as TransitMode) ?? 'bus'
}

function toAlternatives(its: TransitItinerary[]): TransitAlternative[] {
  const alts = its
    .map((it, index) => {
      const firstRide = it.segments.find((s) => s.mode !== 'walk')
      return { readyBy: it.start, board: firstRide?.start ?? it.start, arrive: it.end, index, mainMode: mainMode(it) }
    })
    .sort((a, b) => a.readyBy - b.readyBy || a.arrive - b.arrive)
  // Drop alternatives dominated by one you could catch at the same time or later.
  const kept: TransitAlternative[] = []
  for (let i = 0; i < alts.length; i++) {
    const later = alts.slice(i + 1)
    if (later.some((b) => b.readyBy >= alts[i].readyBy && b.arrive <= alts[i].arrive)) continue
    kept.push(alts[i])
  }
  return kept
}

/** Add two synthetic "next service" entries after the last known one, spaced by the headway. */
function withTail(alts: TransitAlternative[]): { alts: TransitAlternative[]; headwayMin: number } {
  if (!alts.length) return { alts, headwayMin: NaN }
  const gaps = alts.slice(1).map((a, i) => (a.board - alts[i].board) / MIN).filter((g) => g > 0.5)
  const headwayMin = Math.max(4, Math.min(60, median(gaps) || 20))
  const last = alts[alts.length - 1]
  const tail = [1, 2].map((k) => ({
    ...last,
    readyBy: last.readyBy + k * headwayMin * MIN,
    board: last.board + k * headwayMin * MIN,
    arrive: last.arrive + k * headwayMin * MIN,
    index: -1,
  }))
  return { alts: [...alts, ...tail], headwayMin }
}

function stamp(segments: Segment[], headwayMin: number): Segment[] {
  return segments.map((s) => (s.mode === 'walk' || s.mode === 'drive' ? s : { ...s, headwayMin: Math.round(headwayMin) }))
}

// ---------- the planner ----------

interface Ctx {
  plan: DayPlan
  region: Region
  settings: Settings
  deps: PlannerDeps
  weather?: Weather
  lots: Map<string, Lot>
  tz: string
}

type LegResult = { ok: true; leg: LegPlan } | { ok: false; reason: string }

function deadlineOf(ctx: Ctx, legIndex: number): number | undefined {
  const s = ctx.plan.stops[legIndex + 1]
  return s.arriveByHhmm ? localToEpoch(ctx.plan.date, s.arriveByHhmm, ctx.tz) : undefined
}

function leaveAfterOf(ctx: Ctx, stopIndex: number): number | undefined {
  const s = ctx.plan.stops[stopIndex]
  return s.leaveAfterHhmm ? localToEpoch(ctx.plan.date, s.leaveAfterHhmm, ctx.tz) : undefined
}

function driveAt(ctx: Ctx, r: DriveRoute, from: LatLon, to: LatLon, depart: number) {
  const t = trafficAt(depart, from, to, ctx.region.centre, ctx.tz, ctx.weather)
  return { min: r.durationMin * t.factor + 1, cv: t.cv, label: t.label, rain: t.rain }
}

/** Latest departure that still arrives by `deadline` with the target probability. */
function latestDriveDepart(ctx: Ctx, r: DriveRoute, from: LatLon, to: LatLon, deadline: number, extraMin: number): number {
  const target = ctx.settings.onTimeTarget
  const minMin = Math.ceil(r.durationMin)
  for (let back = minMin; back <= minMin * 4 + 60; back++) {
    const dep = deadline - back * MIN
    const d = driveAt(ctx, r, from, to, dep)
    if (lognormalCdf(back - extraMin, d.min, d.cv) >= target) return dep
  }
  return deadline - (minMin * 4 + 60) * MIN
}

function driveSegment(fromName: string, toName: string, start: number, min: number, r: DriveRoute): Segment {
  return {
    mode: 'drive',
    fromName,
    toName,
    start,
    end: start + min * MIN,
    distanceM: r.distanceKm * 1000,
    geometry: r.geometry,
  }
}

function rainWarnings(ctx: Ctx, segs: Segment[]): Warning[] {
  const out: Warning[] = []
  for (const s of segs) {
    if (s.mode !== 'walk') continue
    const mins = (s.end - s.start) / MIN
    if (mins < 6) continue
    const r = rainAt(ctx.weather, s.start)
    if (r.mm >= 0.5 || r.prob >= 60) {
      out.push({ level: 'info', text: `Rain likely around ${formatHhmm(s.start, ctx.tz)}: ${Math.round(mins)} min walk${s.toName ? ` to ${s.toName}` : ''}` })
      break
    }
  }
  return out
}

function alertWarnings(segs: Segment[]): Warning[] {
  const out: Warning[] = []
  for (const s of segs) {
    for (const a of s.alerts ?? []) out.push({ level: a === 'Cancelled' ? 'blocker' : 'caution', text: `${s.route ?? 'Service'}: ${a}` })
    if (s.delayMin && s.delayMin >= 3) out.push({ level: 'caution', text: `${s.route ?? 'Service'} running ${s.delayMin} min late` })
  }
  return out
}

function backupFor(ctx: Ctx, lot: Lot): { lot?: Lot; penaltyMin: number } {
  let best: Lot | undefined
  let bestKm = Infinity
  for (const other of ctx.region.lots) {
    if (other.id === lot.id) continue
    const d = km(lot, other)
    if (d < bestKm && d < 8) {
      best = other
      bestKm = d
    }
  }
  // If the backup tends to fill at the same time, budget for a second miss too.
  const sameFill = best?.fillsByHhmm && lot.fillsByHhmm && best.fillsByHhmm <= lot.fillsByHhmm ? 8 : 0
  return best ? { lot: best, penaltyMin: Math.min(30, 4 + bestKm * 2.2 + sameFill) } : { penaltyMin: 20 }
}

/**
 * Pick the latest plan whose simulated on-time chance meets the target. `make`
 * builds the leg for one transit alternative (latest first).
 */
function chooseForDeadline(
  ctx: Ctx,
  alts: TransitAlternative[],
  deadline: number,
  ready: number | null,
  make: (alt: TransitAlternative) => { depart: number; sim: LegSimInput } | null,
): { alt: TransitAlternative; depart: number; sim: LegSimInput; prob: number } | null {
  let best: { alt: TransitAlternative; depart: number; sim: LegSimInput; prob: number } | null = null
  const real = alts.filter((a) => a.index >= 0 && a.arrive <= deadline)
  for (let k = real.length - 1; k >= 0; k--) {
    const built = make(real[k])
    if (!built) continue
    if (ready !== null && built.depart < ready - 30_000) continue
    const prob = legOnTimeProb(built.sim, deadline)
    if (!best || prob > best.prob + 0.02) best = { alt: real[k], ...built, prob }
    if (prob >= ctx.settings.onTimeTarget) return { alt: real[k], ...built, prob }
  }
  return best
}

async function transitQuery(ctx: Ctx, from: LatLon, to: LatLon, opts: { arriveBy: number } | { departAfter: number }) {
  const bucket = 10 * MIN
  if ('arriveBy' in opts) {
    return ctx.deps.transit.plan({ from, to, time: opts.arriveBy, arriveBy: true, windowMin: 80, maxWalkMin: ctx.settings.maxWalkMin })
  }
  const t = Math.floor(opts.departAfter / bucket) * bucket
  return ctx.deps.transit.plan({ from, to, time: t, arriveBy: false, windowMin: 60, maxWalkMin: ctx.settings.maxWalkMin })
}

function carryWarnings(ctx: Ctx, segs: Segment[]): Warning[] {
  return [...alertWarnings(segs), ...rainWarnings(ctx, segs)]
}

function lateWarning(deadline: number | undefined, prob: number | undefined, stop: Stop): Warning[] {
  if (deadline === undefined || prob === undefined) return []
  if (prob < 0.5) return [{ level: 'caution', text: `Likely late to ${stop.label} (${Math.round(prob * 100)}% on time)` }]
  return []
}

async function planDriveLeg(ctx: Ctx, i: number, ready: number | null, leaveNow = false): Promise<LegResult> {
  const A = ctx.plan.stops[i]
  const B = ctx.plan.stops[i + 1]
  const r = await ctx.deps.drive.route(A.place!, B.place!)
  const D = deadlineOf(ctx, i)
  const after = leaveAfterOf(ctx, i)
  const destParkMin = B.parking && B.dwellMin > DROP_OFF_MAX_MIN ? (km(B.place!, ctx.region.centre) < ctx.region.cityRadiusKm ? 6 : 2) : 0
  let depart: number
  if (D !== undefined && !(leaveNow && ready !== null)) {
    depart = latestDriveDepart(ctx, r, A.place!, B.place!, D, destParkMin)
    if (ready !== null && depart < ready) depart = ready
  } else {
    depart = Math.max(ready ?? -Infinity, after ?? -Infinity)
    if (!Number.isFinite(depart)) depart = localToEpoch(ctx.plan.date, '07:30', ctx.tz)
  }
  const d = driveAt(ctx, r, A.place!, B.place!, depart)
  const segs: Segment[] = [driveSegment(A.label, B.label, depart, d.min, r)]
  if (destParkMin) segs.push({ mode: 'park', fromName: 'Park', toName: B.label, start: segs[0].end, end: segs[0].end + destParkMin * MIN })
  const arrive = segs[segs.length - 1].end
  const sim: LegSimInput = {
    depart,
    driveBeforeMin: d.min,
    driveBeforeCv: d.cv,
    bufferAfterDriveMin: destParkMin,
    lotFullProb: 0,
    lotFullPenaltyMin: 0,
    alternatives: [],
    driveAfterMin: 0,
    driveAfterCv: 0,
    walkBeforeMin: 0,
    transitDelaySdMin: 0,
  }
  const warnings: Warning[] = []
  if (r.estimated) warnings.push({ level: 'info', text: 'Road router unavailable: drive time is a straight-line estimate' })
  if (d.label === 'heavy') warnings.push({ level: 'info', text: `Heavy traffic expected around ${formatHhmm(depart, ctx.tz)}` })
  const prob = D !== undefined ? legOnTimeProb(sim, D) : undefined
  warnings.push(...lateWarning(D, prob, B))
  return {
    ok: true,
    leg: { legIndex: i, kind: 'drive', segments: segs, depart, arrive, cost: driveCost(r.distanceKm, ctx.settings), driveKm: r.distanceKm, sim, warnings },
  }
}

async function planTransitLeg(ctx: Ctx, i: number, ready: number | null): Promise<LegResult> {
  const A = ctx.plan.stops[i]
  const B = ctx.plan.stops[i + 1]
  const D = deadlineOf(ctx, i)
  const after = leaveAfterOf(ctx, i)
  const start = Math.max(ready ?? -Infinity, after ?? -Infinity)
  let its: TransitItinerary[]
  try {
    its =
      D !== undefined
        ? await transitQuery(ctx, A.place!, B.place!, { arriveBy: D })
        : await transitQuery(ctx, A.place!, B.place!, { departAfter: Number.isFinite(start) ? start : localToEpoch(ctx.plan.date, '07:30', ctx.tz) })
  } catch {
    return { ok: false, reason: 'Public transport planner did not respond' }
  }
  if (!its.length) return { ok: false, reason: `No public transport from ${A.label} to ${B.label} at that time` }
  let { alts, headwayMin } = withTail(toAlternatives(its))
  const simFor = (alt: TransitAlternative): LegSimInput => {
    const it = its[alt.index]
    const firstWalk = it.segments[0]?.mode === 'walk' ? (it.segments[0].end - it.segments[0].start) / MIN : 0
    return {
      depart: alt.readyBy,
      driveBeforeMin: 0,
      driveBeforeCv: 0,
      bufferAfterDriveMin: 0,
      lotFullProb: 0,
      lotFullPenaltyMin: 0,
      alternatives: alts,
      driveAfterMin: 0,
      driveAfterCv: 0,
      walkBeforeMin: firstWalk,
      transitDelaySdMin: DELAY_SD[alt.mainMode],
    }
  }
  let chosen: TransitAlternative | undefined
  let prob: number | undefined
  if (D !== undefined) {
    const c = chooseForDeadline(ctx, alts, D, Number.isFinite(start) ? start : null, (alt) => ({ depart: alt.readyBy, sim: simFor(alt) }))
    if (c) {
      chosen = c.alt
      prob = c.prob
    }
  }
  if (!chosen) chosen = alts.find((a) => a.index >= 0 && (!Number.isFinite(start) || a.readyBy >= start))
  if (!chosen && D !== undefined && Number.isFinite(start)) {
    // Can't make the deadline: show the earliest you could arrive instead.
    its = await transitQuery(ctx, A.place!, B.place!, { departAfter: start }).catch(() => [])
    ;({ alts, headwayMin } = withTail(toAlternatives(its)))
    chosen = alts.find((a) => a.index >= 0 && a.readyBy >= start)
  }
  if (!chosen) return { ok: false, reason: `No public transport from ${A.label} to ${B.label} after ${formatHhmm(start, ctx.tz)}` }
  const it = its[chosen.index]
  const segs = stamp(it.segments, headwayMin)
  const sim = simFor(chosen)
  if (prob === undefined && D !== undefined) prob = legOnTimeProb(sim, D)
  return {
    ok: true,
    leg: {
      legIndex: i,
      kind: 'transit',
      segments: segs,
      depart: it.start,
      arrive: it.end,
      cost: { ...zeroCost(), fares: ctx.region.farePerJourney },
      driveKm: 0,
      sim,
      warnings: [...carryWarnings(ctx, segs), ...lateWarning(D, prob, B)],
    },
  }
}

async function planParkRideLeg(ctx: Ctx, i: number, lot: Lot, ready: number | null, leaveNow = false): Promise<LegResult> {
  const A = ctx.plan.stops[i]
  const B = ctx.plan.stops[i + 1]
  const D = deadlineOf(ctx, i)
  const after = leaveAfterOf(ctx, i)
  const start = Math.max(ready ?? -Infinity, after ?? -Infinity)
  const r = await ctx.deps.drive.route(A.place!, lot)
  const buffer = ctx.settings.parkToPlatformMin
  const backup = backupFor(ctx, lot)

  let its: TransitItinerary[]
  try {
    if (D !== undefined) its = await transitQuery(ctx, lot, B.place!, { arriveBy: D })
    else {
      const s0 = Number.isFinite(start) ? start : localToEpoch(ctx.plan.date, '07:00', ctx.tz)
      const atLot = s0 + (driveAt(ctx, r, A.place!, lot, s0).min + buffer) * MIN
      its = await transitQuery(ctx, lot, B.place!, { departAfter: atLot })
    }
  } catch {
    return { ok: false, reason: 'Public transport planner did not respond' }
  }
  if (!its.length) return { ok: false, reason: `No service from ${lot.station.name} to ${B.label}` }
  let { alts, headwayMin } = withTail(toAlternatives(its))

  const build = (alt: TransitAlternative | null, departFixed?: number) => {
    let dep = departFixed ?? alt!.readyBy - (buffer + r.durationMin * 1.3) * MIN
    let d = driveAt(ctx, r, A.place!, lot, dep)
    if (departFixed === undefined) {
      for (let k = 0; k < 2; k++) {
        dep = alt!.readyBy - (buffer + d.min) * MIN
        d = driveAt(ctx, r, A.place!, lot, dep)
      }
      dep = Math.floor(dep / MIN) * MIN
    }
    const atLot = dep + d.min * MIN
    const pFull = lotFullProbability(lot, atLot, ctx.plan.date, ctx.tz)
    const sim: LegSimInput = {
      depart: dep,
      driveBeforeMin: d.min,
      driveBeforeCv: d.cv,
      bufferAfterDriveMin: buffer,
      lotFullProb: pFull,
      lotFullPenaltyMin: backup.penaltyMin,
      alternatives: alts,
      driveAfterMin: 0,
      driveAfterCv: 0,
      walkBeforeMin: 0,
      transitDelaySdMin: DELAY_SD[alt?.mainMode ?? 'rail'],
    }
    return { depart: dep, sim, d, atLot, pFull }
  }

  let chosen: TransitAlternative | undefined
  let built: ReturnType<typeof build> | undefined
  let prob: number | undefined
  if (D !== undefined && !(leaveNow && Number.isFinite(start))) {
    const c = chooseForDeadline(ctx, alts, D, Number.isFinite(start) ? start : null, (alt) => {
      const b = build(alt)
      return { depart: b.depart, sim: b.sim }
    })
    if (c) {
      chosen = c.alt
      built = build(c.alt)
      prob = c.prob
    }
  }
  if (!chosen) {
    const dep = Number.isFinite(start) ? start : localToEpoch(ctx.plan.date, '07:00', ctx.tz)
    let pre = build(null, dep)
    const readyAt = pre.atLot + buffer * MIN
    chosen = alts.find((a) => a.index >= 0 && a.readyBy >= readyAt)
    if (!chosen && D !== undefined) {
      its = await transitQuery(ctx, lot, B.place!, { departAfter: readyAt }).catch(() => [])
      ;({ alts, headwayMin } = withTail(toAlternatives(its)))
      chosen = alts.find((a) => a.index >= 0 && a.readyBy >= readyAt)
      pre = build(null, dep)
    }
    if (!chosen) return { ok: false, reason: `No service from ${lot.station.name} in time` }
    built = { ...pre, sim: { ...pre.sim, transitDelaySdMin: DELAY_SD[chosen.mainMode] } }
    if (D !== undefined) prob = legOnTimeProb(built.sim, D)
  }

  const it = its[chosen.index]
  const drive = driveSegment(A.label, lot.name, built!.depart, built!.d.min, r)
  const park: Segment = { mode: 'park', fromName: lot.name, toName: lot.station.name, start: drive.end, end: drive.end + buffer * MIN }
  const segs: Segment[] = [drive, park]
  if (it.start > park.end + MIN) segs.push({ mode: 'wait', fromName: lot.name, toName: '', start: park.end, end: it.start })
  segs.push(...stamp(it.segments, headwayMin))

  const warnings: Warning[] = []
  if (built!.pFull >= 0.2) {
    warnings.push({
      level: built!.pFull >= 0.5 ? 'caution' : 'info',
      text: `${lot.name} is often full by ${lot.fillsByHhmm}; you arrive ~${formatHhmm(built!.atLot, ctx.tz)} (${Math.round(built!.pFull * 100)}% chance full)${backup.lot ? `. Backup: ${backup.lot.name}, +${Math.round(backup.penaltyMin)} min` : ''}`,
    })
  }
  if (r.estimated) warnings.push({ level: 'info', text: 'Road router unavailable: drive time is a straight-line estimate' })
  warnings.push(...carryWarnings(ctx, segs), ...lateWarning(D, prob, B))

  const cost = driveCost(r.distanceKm, ctx.settings)
  cost.fares = ctx.region.farePerJourney
  return {
    ok: true,
    leg: { legIndex: i, kind: 'parkride', lotId: lot.id, segments: segs, depart: built!.depart, arrive: it.end, cost, driveKm: r.distanceKm, sim: built!.sim, warnings },
  }
}

async function planRetrieveLeg(ctx: Ctx, i: number, carAt: { place: LatLon; name: string; lotId?: string }, ready: number | null): Promise<LegResult> {
  const A = ctx.plan.stops[i]
  const B = ctx.plan.stops[i + 1]
  const D = deadlineOf(ctx, i)
  const after = leaveAfterOf(ctx, i)
  const start = Math.max(ready ?? -Infinity, after ?? -Infinity)
  const r = await ctx.deps.drive.route(carAt.place, B.place!)
  const unpark = 3
  let its: TransitItinerary[]
  try {
    if (D !== undefined) {
      const est = driveAt(ctx, r, carAt.place, B.place!, D - r.durationMin * 1.5 * MIN)
      its = await transitQuery(ctx, A.place!, carAt.place, { arriveBy: Math.floor((D - (est.min * 1.15 + unpark) * MIN) / (5 * MIN)) * 5 * MIN })
    } else {
      its = await transitQuery(ctx, A.place!, carAt.place, { departAfter: Number.isFinite(start) ? start : localToEpoch(ctx.plan.date, '17:00', ctx.tz) })
    }
  } catch {
    return { ok: false, reason: 'Public transport planner did not respond' }
  }
  if (!its.length) return { ok: false, reason: `No public transport back to ${carAt.name}` }
  let { alts, headwayMin } = withTail(toAlternatives(its))

  const simFor = (alt: TransitAlternative): { sim: LegSimInput; d: ReturnType<typeof driveAt> } => {
    const d = driveAt(ctx, r, carAt.place, B.place!, alt.arrive)
    const it = its[alt.index]
    const firstWalk = it.segments[0]?.mode === 'walk' ? (it.segments[0].end - it.segments[0].start) / MIN : 0
    return {
      d,
      sim: {
        depart: alt.readyBy,
        driveBeforeMin: 0,
        driveBeforeCv: 0,
        bufferAfterDriveMin: 0,
        lotFullProb: 0,
        lotFullPenaltyMin: 0,
        alternatives: alts,
        driveAfterMin: d.min + unpark,
        driveAfterCv: d.cv,
        walkBeforeMin: firstWalk,
        transitDelaySdMin: DELAY_SD[alt.mainMode],
      },
    }
  }

  let chosen: TransitAlternative | undefined
  let prob: number | undefined
  if (D !== undefined) {
    // The deadline applies after the drive, so evaluate candidates on the full leg.
    const real = alts.filter((a) => a.index >= 0 && (!Number.isFinite(start) || a.readyBy >= start))
    for (let k = real.length - 1; k >= 0; k--) {
      const p = legOnTimeProb(simFor(real[k]).sim, D)
      if (prob === undefined || p > prob + 0.02) {
        chosen = real[k]
        prob = p
      }
      if (p >= ctx.settings.onTimeTarget) {
        chosen = real[k]
        prob = p
        break
      }
    }
  }
  if (!chosen) chosen = alts.find((a) => a.index >= 0 && (!Number.isFinite(start) || a.readyBy >= start))
  if (!chosen && D !== undefined && Number.isFinite(start)) {
    its = await transitQuery(ctx, A.place!, carAt.place, { departAfter: start }).catch(() => [])
    ;({ alts, headwayMin } = withTail(toAlternatives(its)))
    chosen = alts.find((a) => a.index >= 0 && a.readyBy >= start)
    if (chosen) prob = legOnTimeProb(simFor(chosen).sim, D)
  }
  if (!chosen) return { ok: false, reason: `No public transport back to ${carAt.name} in time` }
  const it = its[chosen.index]
  const { sim, d } = simFor(chosen)
  const segs: Segment[] = stamp(it.segments, headwayMin)
  const unparkSeg: Segment = { mode: 'park', fromName: carAt.name, toName: 'Car', start: it.end, end: it.end + unpark * MIN }
  const drive = driveSegment(carAt.name, B.label, unparkSeg.end, d.min, r)
  segs.push(unparkSeg, drive)
  const cost = driveCost(r.distanceKm, ctx.settings)
  cost.fares = ctx.region.farePerJourney
  return {
    ok: true,
    leg: {
      legIndex: i,
      kind: 'retrieve',
      lotId: carAt.lotId,
      segments: segs,
      depart: it.start,
      arrive: drive.end,
      cost,
      driveKm: r.distanceKm,
      sim,
      warnings: [...carryWarnings(ctx, segs), ...lateWarning(D, prob, B)],
    },
  }
}

// ---------- combining legs into whole days ----------

interface State {
  i: number
  car: CarLocation
  /** When the car arrived where it is now (null = at home since before the day). */
  carSince: number | null
  ready: number | null
  legs: LegPlan[]
  extraCost: CostBreakdown
  notes: Warning[]
}

function carPlace(ctx: Ctx, car: CarLocation): { place: LatLon; name: string; lotId?: string } {
  if (car.kind === 'lot') {
    const lot = ctx.lots.get(car.lotId)!
    return { place: lot, name: lot.name, lotId: lot.id }
  }
  const s = ctx.plan.stops[car.stopIndex]
  return { place: s.place!, name: s.label }
}

function carWithMe(ctx: Ctx, car: CarLocation, stopIndex: number): boolean {
  return car.kind === 'stop' && samePlace(ctx.plan.stops[car.stopIndex].place, ctx.plan.stops[stopIndex].place)
}

/** Settle the cost of the car having stood somewhere from `since` to `until`. Null = not allowed. */
function settleParking(ctx: Ctx, car: CarLocation, since: number | null, until: number): { cost: number } | { reason: string } {
  if (car.kind === 'lot') {
    const lot = ctx.lots.get(car.lotId)!
    if (since !== null) {
      const check = checkLotStay(lot, since, until, ctx.plan.date, ctx.tz)
      if (!check.ok) return { reason: check.reason }
    }
    return { cost: lot.perDay }
  }
  if (since === null) return { cost: 0 }
  const stop = ctx.plan.stops[car.stopIndex]
  const mins = (until - since) / MIN
  if (car.stopIndex === 0 || samePlace(stop.place, ctx.plan.stops[0].place)) return { cost: 0 }
  if (mins <= DROP_OFF_MAX_MIN + 0.5) return { cost: 0 }
  const c = stopParkingCost(stop.parking, mins)
  if (c === null) {
    return { reason: stop.parking?.maxStayMin ? `Parking at ${stop.label} is limited to ${stop.parking.maxStayMin} min` : `No parking at ${stop.label}` }
  }
  return { cost: c }
}

export interface PlanOptions {
  onProgress?: (done: number, total: number) => void
  lotsPerLeg?: number
}

export async function planDay(plan: DayPlan, region: Region, settings: Settings, deps: PlannerDeps, opts: PlanOptions = {}): Promise<PlanResult> {
  const stops = plan.stops
  if (stops.length < 2 || stops.some((s) => !s.place)) throw new Error('Every stop needs a place')
  const tz = region.timeZone
  const weather = deps.weather ? await deps.weather.forecast(stops[0].place!, tz).catch(() => undefined) : undefined
  const ctx: Ctx = { plan, region, settings, deps, weather, tz, lots: new Map(region.lots.map((l) => [l.id, l])) }
  const n = stops.length - 1
  const lotsPerLeg = opts.lotsPerLeg ?? 4
  const candidates: Lot[][] = []
  for (let i = 0; i < n; i++) {
    candidates.push(plan.legRules[i] === 'any' ? shortlistLots(stops[i].place!, stops[i + 1].place!, region.lots, lotsPerLeg).map((c) => c.lot) : [])
  }

  let total = 0
  let done = 0
  const memo = new Map<string, Promise<LegResult>>()
  const legFor = (key: string, make: () => Promise<LegResult>) => {
    let p = memo.get(key)
    if (!p) {
      total++
      opts.onProgress?.(done, total)
      p = make().then(
        (r) => {
          done++
          opts.onProgress?.(done, total)
          return r
        },
        (e) => {
          done++
          opts.onProgress?.(done, total)
          return { ok: false, reason: e instanceof Error ? e.message : 'Unknown error' } as LegResult
        },
      )
      memo.set(key, p)
    }
    return p
  }
  const rb = (ready: number | null) => (ready === null ? 'free' : String(Math.floor(ready / (5 * MIN))))

  const finished: State[] = []
  const rejected = new Map<string, string>()

  async function expand(st: State): Promise<void> {
    if (st.i === n) {
      const roundTrip = samePlace(stops[0].place, stops[n].place)
      if (carWithMe(ctx, st.car, n) || (st.car.kind === 'stop' && st.car.stopIndex === 0)) {
        finished.push(st)
        return
      }
      if (roundTrip) {
        const where = carPlace(ctx, st.car).name
        rejected.set(`end:${where}`, `Car would be left at ${where} overnight`)
        return
      }
      // One-way plan: the car stays where it is; charge a day of parking there.
      const settle = settleParking(ctx, st.car, st.carSince, st.carSince ?? 0)
      if ('reason' in settle) {
        rejected.set(`end:${settle.reason}`, settle.reason)
        return
      }
      finished.push({
        ...st,
        extraCost: addCost(st.extraCost, { ...zeroCost(), parking: settle.cost }),
        notes: [...st.notes, { level: 'info', text: `Return trip not planned: your car stays at ${carPlace(ctx, st.car).name}` }],
      })
      return
    }

    const i = st.i
    const rule = plan.legRules[i]
    const withMe = carWithMe(ctx, st.car, i)
    const tasks: Promise<void>[] = []
    const next = (leg: LegPlan, car: CarLocation, carSince: number | null, extra: CostBreakdown, notes: Warning[] = []) => {
      const dwell = stops[i + 1].dwellMin
      const after = leaveAfterOf(ctx, i + 1)
      const ready = Math.max(leg.arrive + dwell * MIN, after ?? -Infinity)
      return expand({
        i: i + 1,
        car,
        carSince,
        ready,
        legs: [...st.legs, leg],
        extraCost: addCost(st.extraCost, extra),
        notes: [...st.notes, ...notes],
      })
    }
    const reject = (title: string, reason: string): void => {
      rejected.set(`${title}:${reason}`, reason)
    }

    if (withMe) {
      // At a drop-off with nowhere to park you drive straight on, even if that means arriving early.
      const leaveNow = st.carSince !== null && !samePlace(stops[i].place, stops[0].place) && !stops[i].parking
      const ln = leaveNow ? ':now' : ''
      // Leaving a stop by car settles any parking there.
      const settleOnLeave = (depart: number) => settleParking(ctx, st.car, st.carSince, depart)
      if (rule === 'any' || rule === 'car') {
        tasks.push(
          legFor(`drive:${i}:${rb(st.ready)}${ln}`, () => planDriveLeg(ctx, i, st.ready, leaveNow)).then((r) => {
            if (!r.ok) return reject('Drive', r.reason)
            const s = settleOnLeave(r.leg.depart)
            if ('reason' in s) return reject('Drive', s.reason)
            return next(r.leg, { kind: 'stop', stopIndex: i + 1 }, r.leg.arrive, { ...zeroCost(), parking: s.cost })
          }),
        )
      }
      if (rule === 'any') {
        for (const lot of candidates[i]) {
          tasks.push(
            legFor(`pr:${i}:${lot.id}:${rb(st.ready)}${ln}`, () => planParkRideLeg(ctx, i, lot, st.ready, leaveNow)).then((r) => {
              if (!r.ok) return reject(lot.name, r.reason)
              const s = settleOnLeave(r.leg.depart)
              if ('reason' in s) return reject(lot.name, s.reason)
              const atLot = r.leg.segments[0].end
              return next(r.leg, { kind: 'lot', lotId: lot.id }, atLot, { ...zeroCost(), parking: s.cost })
            }),
          )
        }
      }
      if (rule === 'any' || rule === 'transit') {
        // Leave the car here and take transit. Only sensible if the car may stay.
        tasks.push(
          legFor(`tr:${i}:${rb(st.ready)}`, () => planTransitLeg(ctx, i, st.ready)).then((r) => {
            if (!r.ok) return reject('Public transport', r.reason)
            if (st.carSince !== null && !samePlace(stops[i].place, stops[0].place) && !stops[i].parking) {
              return reject('Public transport', `Car can't stay at ${stops[i].label}`)
            }
            return next(r.leg, st.car, st.carSince, zeroCost())
          }),
        )
      }
    } else {
      const carAt = carPlace(ctx, st.car)
      const carGoesToNext = st.car.kind === 'stop' && samePlace(stops[st.car.stopIndex].place, stops[i + 1].place)
      if (rule === 'any' || rule === 'transit' || (rule === 'car' && carGoesToNext)) {
        tasks.push(
          legFor(`tr:${i}:${rb(st.ready)}`, () => planTransitLeg(ctx, i, st.ready)).then((r) => {
            if (!r.ok) return reject('Public transport', r.reason)
            return next(r.leg, st.car, st.carSince, zeroCost())
          }),
        )
      }
      if ((rule === 'any' || rule === 'car') && !carGoesToNext) {
        const key = st.car.kind === 'lot' ? st.car.lotId : `s${st.car.stopIndex}`
        tasks.push(
          legFor(`rt:${i}:${key}:${rb(st.ready)}`, () => planRetrieveLeg(ctx, i, carAt, st.ready)).then((r) => {
            if (!r.ok) return reject(carAt.name, r.reason)
            // You reach the car when the transit part ends.
            const reachCar = r.leg.segments.find((s) => s.mode === 'park')?.start ?? r.leg.depart
            const s = settleParking(ctx, st.car, st.carSince, reachCar)
            if ('reason' in s) return reject(carAt.name, s.reason)
            return next(r.leg, { kind: 'stop', stopIndex: i + 1 }, r.leg.arrive, { ...zeroCost(), parking: s.cost })
          }),
        )
      }
    }
    await Promise.all(tasks)
  }

  const after0 = leaveAfterOf(ctx, 0)
  await expand({ i: 0, car: { kind: 'stop', stopIndex: 0 }, carSince: null, ready: after0 ?? null, legs: [], extraCost: zeroCost(), notes: [] })

  const options = finished.map((st) => buildOption(ctx, st))
  const seen = new Map<string, DayOption>()
  for (const o of options) {
    const sig = o.legs.map((l) => `${l.kind}:${l.lotId ?? ''}`).join('|')
    const prev = seen.get(sig)
    if (!prev || o.score < prev.score) seen.set(sig, o)
  }
  const ranked = [...seen.values()].sort((a, b) => a.score - b.score)
  // Always keep the plain baselines for comparison, even if they rank low.
  const top = ranked.slice(0, 6)
  for (const strat of ['drive', 'transit'] as const) {
    const best = ranked.find((o) => o.strategy === strat)
    if (best && !top.includes(best)) top.push(best)
  }

  const dataNotes: string[] = []
  if (!weather) dataNotes.push('Weather forecast unavailable')
  if (options.some((o) => o.legs.some((l) => l.warnings.some((w) => w.text.startsWith('Road router unavailable'))))) {
    dataNotes.push('Some drive times are straight-line estimates')
  }

  return {
    options: top,
    rejected: [...rejected.values()]
      .filter((r) => !r.endsWith('overnight') || !top.length)
      .slice(0, 12).map((reason) => ({ title: reason.split(':')[0], reason })),
    candidateLotIds: [...new Set(candidates.flat().map((l) => l.id))],
    weather,
    dataNotes,
  }
}

function classify(ctx: Ctx, legs: LegPlan[]): { strategy: DayOption['strategy']; title: string; lotIds: string[] } {
  const kinds = new Set<LegKind>(legs.map((l) => l.kind))
  const lotIds = [...new Set(legs.map((l) => l.lotId).filter((x): x is string => !!x))]
  if (kinds.size === 1 && kinds.has('drive')) return { strategy: 'drive', title: 'Drive all the way', lotIds }
  if (kinds.size === 1 && kinds.has('transit')) return { strategy: 'transit', title: 'Public transport only', lotIds }
  if (lotIds.length) {
    const names = lotIds.map((id) => ctx.lots.get(id)!.name)
    return { strategy: 'parkride', title: `Park & ride at ${names.join(' + ')}`, lotIds }
  }
  return { strategy: 'mixed', title: 'Drive some legs, ride others', lotIds }
}

/**
 * Lower is better. Being late more often than not is a dealbreaker whatever the
 * priority, so those options always sort below ones that usually make it.
 */
export function scoreOf(s: Settings, costTotalValue: number, travelMin: number, onTime: number): number {
  const late = 1 - onTime
  const h = travelMin / 60
  const dealbreaker = onTime < 0.5 ? 1e4 : 0
  switch (s.priority) {
    case 'cheapest':
      return dealbreaker + costTotalValue + h * 0.5 + late * 20
    case 'fastest':
      return dealbreaker + travelMin + late * 60
    case 'reliable':
      return dealbreaker + late * 1000 + costTotalValue * 0.2 + h * 2
    default:
      // Late to work costs about four hours of your time.
      return dealbreaker + costTotalValue + s.valuePerHour * h + late * s.valuePerHour * 4
  }
}

function buildOption(ctx: Ctx, st: State): DayOption {
  const legs = st.legs
  const cost = legs.reduce((acc, l) => addCost(acc, l.cost), st.extraCost)
  const total = costTotal(cost)
  const travelMin = legs.reduce((acc, l) => acc + (l.arrive - l.depart) / MIN, 0)
  const reliability = simulateDay(
    legs.map((l, k) => ({
      sim: l.sim,
      dwellBeforeMin: k === 0 ? 0 : ctx.plan.stops[l.legIndex].dwellMin,
      deadline: deadlineOf(ctx, l.legIndex),
      destStopIndex: l.legIndex + 1,
    })),
  )
  const cls = classify(ctx, legs)
  const warnings: Warning[] = []
  const seen = new Set<string>()
  for (const w of [...st.notes, ...legs.flatMap((l) => l.warnings)]) {
    if (seen.has(w.text)) continue
    seen.add(w.text)
    warnings.push(w)
  }
  for (let k = 1; k < legs.length; k++) {
    const gap = (legs[k].depart - legs[k - 1].arrive) / MIN - ctx.plan.stops[legs[k].legIndex].dwellMin
    if (gap < -1) warnings.push({ level: 'caution', text: `Tight: ${ctx.plan.stops[legs[k].legIndex].label} needs ${Math.round(-gap)} more min than you have` })
  }
  const blockers = warnings.some((w) => w.level === 'blocker')
  return {
    id: legs.map((l) => `${l.kind}${l.lotId ? `@${l.lotId}` : ''}`).join('-'),
    title: cls.title,
    strategy: cls.strategy,
    legs,
    lotIds: cls.lotIds,
    leaveBy: legs[0].depart,
    totalTravelMin: travelMin,
    cost,
    costTotal: total,
    reliability,
    warnings,
    score: scoreOf(ctx.settings, total, travelMin, reliability.onTimeProb) + (blockers ? 1e6 : 0),
    feasible: !blockers,
  }
}

/** Re-rank already planned options under a new priority without new network calls. */
export function rerank(options: DayOption[], settings: Settings): DayOption[] {
  return options
    .map((o) => ({ ...o, score: scoreOf(settings, o.costTotal, o.totalTravelMin, o.reliability.onTimeProb) + (o.feasible ? 0 : 1e6) }))
    .sort((a, b) => a.score - b.score)
}
