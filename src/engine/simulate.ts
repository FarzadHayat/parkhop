import { lognormal, mulberry32, normal } from './rng'
import type { LegSimInput, Reliability } from './types'

const MIN = 60_000

/**
 * Run one leg once. `ready` is when you are free to leave the origin.
 * Returns the arrival time (epoch ms), or Infinity if you are stranded.
 */
export function runLeg(sim: LegSimInput, ready: number, rand: () => number): number {
  let t = Math.max(ready, sim.depart)
  if (sim.driveBeforeMin > 0) {
    t += lognormal(rand, sim.driveBeforeMin, sim.driveBeforeCv) * MIN
    if (sim.lotFullProb > 0 && rand() < sim.lotFullProb) t += sim.lotFullPenaltyMin * MIN
    t += sim.bufferAfterDriveMin * MIN
  }
  if (sim.alternatives.length) {
    // Walking to the stop varies a little too.
    const jitter = sim.walkBeforeMin > 0 ? Math.abs(normal(rand)) * Math.min(2, sim.walkBeforeMin * 0.1) * MIN : 0
    t += jitter
    const alt = sim.alternatives.find((a) => a.readyBy >= t - 15_000)
    if (!alt) return Infinity
    // Delays are skewed: usually small, sometimes large.
    const z = normal(rand)
    const delay = Math.max(-0.5, z * sim.transitDelaySdMin + (z > 1.3 ? (z - 1.3) * sim.transitDelaySdMin * 2 : 0))
    t = alt.arrive + delay * MIN
  }
  if (sim.driveAfterMin > 0) t += lognormal(rand, sim.driveAfterMin, sim.driveAfterCv) * MIN
  return t
}

export interface DaySimLeg {
  sim: LegSimInput
  /** Minutes you must spend at the leg's origin stop before leaving (dwell). */
  dwellBeforeMin: number
  /** Deadline at the leg's destination, if any. */
  deadline?: number
  destStopIndex: number
}

export function simulateDay(legs: DaySimLeg[], samples = 1500, seed = 7): Reliability {
  const rand = mulberry32(seed)
  const deadlines = legs.filter((l) => l.deadline !== undefined)
  const hits = new Map<number, number>()
  const lateness = new Map<number, number[]>()
  for (const l of deadlines) {
    hits.set(l.destStopIndex, 0)
    lateness.set(l.destStopIndex, [])
  }
  let allOk = 0
  const firstDeadline = deadlines[0]
  const hist = new Map<number, number>()

  for (let s = 0; s < samples; s++) {
    let arrive = -Infinity
    let ok = true
    for (const leg of legs) {
      const ready = arrive === -Infinity ? leg.sim.depart : arrive + leg.dwellBeforeMin * MIN
      arrive = runLeg(leg.sim, ready, rand)
      if (leg.deadline !== undefined) {
        const late = (arrive - leg.deadline) / MIN
        lateness.get(leg.destStopIndex)!.push(late)
        if (late <= 0) hits.set(leg.destStopIndex, hits.get(leg.destStopIndex)! + 1)
        else ok = false
        if (leg === firstDeadline) {
          const bin = Math.max(-30, Math.min(30, Math.floor(late / 2) * 2))
          hist.set(bin, (hist.get(bin) ?? 0) + 1)
        }
      }
      if (arrive === Infinity) {
        ok = false
        break
      }
    }
    if (ok) allOk++
  }

  const perStop = deadlines.map((l) => {
    const arr = lateness.get(l.destStopIndex)!.slice().sort((a, b) => a - b)
    const p90 = arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.9))] : 0
    return {
      stopIndex: l.destStopIndex,
      prob: (hits.get(l.destStopIndex) ?? 0) / samples,
      p90LateMin: Number.isFinite(p90) ? p90 : 999,
    }
  })

  const histogram = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([binStartMin, count]) => ({ binStartMin, count }))
  return { onTimeProb: deadlines.length ? allOk / samples : 1, perStop, histogram: firstDeadline ? histogram : undefined }
}

/** Chance a single leg, started at `ready`, arrives by `deadline`. */
export function legOnTimeProb(sim: LegSimInput, deadline: number, samples = 600, seed = 11): number {
  const rand = mulberry32(seed)
  let ok = 0
  for (let i = 0; i < samples; i++) if (runLeg(sim, sim.depart, rand) <= deadline) ok++
  return ok / samples
}
