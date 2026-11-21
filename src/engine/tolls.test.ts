import { describe, expect, it } from 'vitest'
import { pickRoute } from './planner'
import type { TollRoad } from './types'
import type { DriveRoute } from '../providers/types'

const tolls: TollRoad[] = [{ id: 'm7', name: 'AirportlinkM7', roadNames: ['Airport Link'], carPrice: 7.16 }]
const viaToll: DriveRoute = { durationMin: 25, distanceKm: 29, roadNames: ['Gympie Road', 'Airport Link'] }
const free: DriveRoute = { durationMin: 40, distanceKm: 28, roadNames: ['Gympie Road', 'Lutwyche Road'] }
const withAlt: DriveRoute = { ...viaToll, alternatives: [free] }

describe('pickRoute', () => {
  it('takes the toll road when the time saved is worth more than the toll', () => {
    // 15 min saved at $40/h = $10 > $7.16
    expect(pickRoute(withAlt, tolls, 40)).toBe(withAlt)
  })

  it('takes the free road when the time saved is worth less than the toll', () => {
    // 15 min at $20/h = $5 < $7.16
    expect(pickRoute(withAlt, tolls, 20)).toBe(free)
  })

  it('always takes the toll-free route when avoiding tolls, even if slower and time is valuable', () => {
    expect(pickRoute(withAlt, tolls, 200, true)).toBe(free)
  })

  it('falls back to the toll road when it is the only route', () => {
    expect(pickRoute(viaToll, tolls, 20, true)).toBe(viaToll)
  })
})
