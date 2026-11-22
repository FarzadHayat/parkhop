// Live check against the real public APIs. Run with: pnpm smoke
import { describe, expect, it } from 'vitest'
import { defaultSettings, planDay } from '../src/engine/planner'
import { formatHhmm } from '../src/engine/time'
import { osrmProvider } from '../src/providers/osrm'
import { transitousProvider } from '../src/providers/transitous'
import { openMeteoProvider } from '../src/providers/weather'
import { presets, region } from '../src/data/seq'

const live = process.env.LIVE === '1'

describe.skipIf(!live)('live planner', () => {
  for (const p of presets) {
    it(`plans "${p.name}"`, async () => {
      const deps = { drive: osrmProvider(), transit: transitousProvider(undefined, { 'User-Agent': 'ParkHop/0.1 (open-source commute planner prototype)' }), weather: openMeteoProvider() }
      const res = await planDay(p.plan, region, defaultSettings, deps)
      const tz = region.timeZone
      for (const o of res.options) {
        console.log(
          `${o.title.padEnd(48)} leave ${formatHhmm(o.leaveBy, tz)}  $${o.costTotal.toFixed(2)}  ${Math.round(o.totalTravelMin)} min  on-time ${Math.round(o.reliability.onTimeProb * 100)}%`,
        )
        for (const l of o.legs)
          console.log(
            `    ${l.kind.padEnd(9)} ${formatHhmm(l.depart, tz)}-${formatHhmm(l.arrive, tz)} ${l.segments.map((s) => s.mode + (s.route ? `(${s.route})` : '')).join(' > ')}`,
          )
        for (const w of o.warnings) console.log(`    ! ${w.level}: ${w.text}`)
      }
      console.log('rejected:', res.rejected.map((r) => r.reason))
      console.log('notes:', res.dataNotes)
      expect(res.options.length).toBeGreaterThan(0)
    }, 180_000)
  }
})
