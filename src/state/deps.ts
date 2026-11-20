import type { PlannerDeps } from '../engine/planner'
import { osrmProvider } from '../providers/osrm'
import { transitousProvider } from '../providers/transitous'
import { openMeteoProvider } from '../providers/weather'

export interface Health {
  /** The ParkHop server is running: use its caching proxies. */
  proxy: boolean
  /** An Anthropic key is configured on the server. */
  assistant: boolean
}

const weather = openMeteoProvider()
const direct: PlannerDeps = { drive: osrmProvider(), transit: transitousProvider(), weather }
const proxied: PlannerDeps = { drive: osrmProvider('/api/osrm'), transit: transitousProvider('/api/transitous'), weather }

let current = direct

/** Resolves once we know whether the ParkHop server is there. A static host falls back to calling the public APIs directly. */
export const health: Promise<Health | null> = fetch('/api/health', { signal: AbortSignal.timeout(3000) })
  .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
  .catch(() => null)
  .then((h) => {
    if (h?.proxy) current = proxied
    return h
  })

export async function getDeps(): Promise<PlannerDeps> {
  await health
  return current
}
