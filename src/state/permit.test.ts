import { beforeAll, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('sessionStorage', storage)
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))

let store: typeof import('./store')
beforeAll(async () => {
  store = await import('./store')
})

// RBWH sits in the Herston paid precinct, so without a permit parking there costs money.
const rbwh = { name: 'Royal Brisbane and Women’s Hospital', lat: -27.4486, lon: 153.0283 }

describe('parking permits', () => {
  it('uses the area price until you say you have a permit, then remembers it', () => {
    const { useApp, defaultParkingFor } = store
    expect(defaultParkingFor(rbwh)!.perDay).toBeGreaterThan(0)

    const plan = useApp.getState().plan
    const work = plan.stops[1]
    useApp.getState().updateStop(work.id, { place: rbwh })
    expect(useApp.getState().plan.stops[1].parking!.perDay).toBeGreaterThan(0)

    useApp.getState().updateStop(work.id, { parking: { perDay: 0, permit: true } })
    expect(useApp.getState().myParking).toHaveLength(1)

    // A later plan (e.g. a Tanda shift) to the same place, 100 m away, gets the permit.
    const nearby = { name: 'RBWH entrance', lat: rbwh.lat + 0.0008, lon: rbwh.lon }
    expect(defaultParkingFor(nearby)).toEqual({ perDay: 0, permit: true })
    // And it survives a reload.
    expect(mem.get('parkhop:v1')).toContain('myParking')
  })

  it('forgetting a permit puts the area price back on stops there', () => {
    const { useApp, defaultParkingFor } = store
    useApp.getState().forgetParking(0)
    expect(useApp.getState().myParking).toHaveLength(0)
    expect(useApp.getState().plan.stops[1].parking!.permit).toBeFalsy()
    expect(useApp.getState().plan.stops[1].parking!.perDay).toBeGreaterThan(0)
    expect(defaultParkingFor(rbwh)!.permit).toBeFalsy()
  })

  it('choosing plain Free does not save a permit', () => {
    const { useApp } = store
    const work = useApp.getState().plan.stops[1]
    useApp.getState().updateStop(work.id, { parking: { perDay: 0 } })
    expect(useApp.getState().myParking).toHaveLength(0)
  })
})
