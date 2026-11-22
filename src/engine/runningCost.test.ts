import { describe, expect, it } from 'vitest'
import { carRunningCost, defaultSettings } from './planner'

describe('carRunningCost', () => {
  const s = { ...defaultSettings, fuelLPer100km: 10, fuelPricePerL: 2, wearPerKm: 0.1 }

  it('counts fuel and wear by default', () => {
    expect(carRunningCost(50, s)).toEqual({ fuel: 10, wear: 5 })
  })

  it('leaves fuel out when asked', () => {
    expect(carRunningCost(50, { ...s, ignoreFuel: true })).toEqual({ fuel: 0, wear: 5 })
  })

  it('leaves wear out when asked', () => {
    expect(carRunningCost(50, { ...s, ignoreWear: true })).toEqual({ fuel: 10, wear: 0 })
  })
})
