import { afterEach, describe, expect, it, vi } from 'vitest'
import { valhallaTollFree } from './valhalla'

afterEach(() => vi.unstubAllGlobals())

const a = { lat: -27.5, lon: 152.975 }
const b = { lat: -27.478, lon: 153.018 }

describe('valhallaTollFree', () => {
  it('turns a toll-free trip into a drive route with road names', async () => {
    let url = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        url = u
        return new Response(
          JSON.stringify({ trip: { summary: { length: 9.5, time: 720 }, legs: [{ shape: '', maneuvers: [{ street_names: ['Moggill Road'] }, { street_names: ['Moggill Road', 'Victoria Bridge'] }, {}] }] } }),
          { status: 200 },
        )
      }),
    )
    const r = await valhallaTollFree('https://example.test')(a, b)
    expect(r).toMatchObject({ durationMin: 12, distanceKm: 9.5, roadNames: ['Moggill Road', 'Victoria Bridge'] })
    expect(decodeURIComponent(url)).toContain('"use_tolls":0')
  })

  it('returns null when the server fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await valhallaTollFree('https://example.test')({ ...a, lat: -27.6 }, b)).toBeNull()
  })
})
