import { describe, expect, it } from 'vitest'
import type { Segment } from '../engine/types'
import { driveLinks, segmentEnd, transitLink, transitSpan } from './navigate'

const seg = (mode: Segment['mode'], geometry?: [number, number][]): Segment => ({ mode, fromName: 'a', toName: 'b', start: 0, end: 1, geometry })

describe('navigation links', () => {
  it('builds driving links for Google Maps, Apple Maps and Waze', () => {
    const links = driveLinks({ lat: -27.2509, lon: 152.9928 })
    expect(links.map((l) => l.app)).toEqual(['Google Maps', 'Apple Maps', 'Waze'])
    expect(links[0].href).toBe('https://www.google.com/maps/dir/?api=1&destination=-27.250900,152.992800&travelmode=driving')
    expect(links[1].href).toContain('daddr=-27.250900,152.992800')
    expect(links[2].href).toBe('https://waze.com/ul?ll=-27.250900,152.992800&navigate=yes')
  })

  it('reads a segment end from its line, as lat and lon', () => {
    expect(segmentEnd(seg('drive', [[153, -27], [153.1, -27.1]]))).toEqual({ lat: -27.1, lon: 153.1 })
    expect(segmentEnd(seg('drive'))).toBeNull()
  })

  it('finds the public transport part of a park and ride leg', () => {
    const span = transitSpan([seg('drive', [[1, 1], [2, 2]]), seg('park'), seg('walk', [[3, 3], [4, 4]]), seg('rail', [[4, 4], [5, 5]]), seg('walk', [[5, 5], [6, 6]])])
    expect(span).toEqual({ from: { lat: 3, lon: 3 }, to: { lat: 6, lon: 6 } })
    expect(transitLink(span!.from, span!.to).href).toContain('travelmode=transit')
  })

  it('has no transit part on a drive-only leg', () => {
    expect(transitSpan([seg('drive', [[1, 1], [2, 2]])])).toBeNull()
  })
})
