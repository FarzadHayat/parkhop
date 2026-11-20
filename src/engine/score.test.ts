import { describe, expect, it } from 'vitest'
import { defaultSettings, scoreOf } from './planner'
import type { Priority } from './types'

describe('scoreOf', () => {
  // A cheap plan that is nearly always late must never beat a dear one that is on time.
  for (const priority of ['balanced', 'cheapest', 'fastest', 'reliable'] as Priority[]) {
    it(`ranks a usually-late option last under "${priority}"`, () => {
      const s = { ...defaultSettings, priority }
      const cheapLate = scoreOf(s, 3, 90, 0.05)
      const dearOnTime = scoreOf(s, 45, 150, 0.9)
      expect(cheapLate).toBeGreaterThan(dearOnTime)
    })
  }

  it('prefers the cheaper of two on-time options under "cheapest"', () => {
    const s = { ...defaultSettings, priority: 'cheapest' as const }
    expect(scoreOf(s, 2, 140, 0.95)).toBeLessThan(scoreOf(s, 40, 100, 0.95))
  })
})
