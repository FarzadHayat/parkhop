import type { LatLon } from '../engine/types'
import { getJson } from './http'
import type { GeocodeProvider } from './types'

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    housenumber?: string
    street?: string
    suburb?: string
    district?: string
    city?: string
    state?: string
  }
}

function label(p: PhotonFeature['properties']): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const head = p.name || street
  const area = p.suburb || p.district || p.city
  return [head, area && area !== head ? area : undefined].filter(Boolean).join(', ') || 'Pinned place'
}

/** Photon (komoot) geocoder over OpenStreetMap. Free, keyless, fair use. */
export function photonProvider(bbox?: [number, number, number, number]): GeocodeProvider {
  return {
    async search(text, near: LatLon, signal) {
      const q = new URLSearchParams({ q: text, lat: String(near.lat), lon: String(near.lon), limit: '6', lang: 'en' })
      if (bbox) q.set('bbox', bbox.join(','))
      const r = await getJson<{ features: PhotonFeature[] }>(`https://photon.komoot.io/api/?${q}`, {
        signal,
        timeoutMs: 8000,
        retries: 0,
      })
      const seen = new Set<string>()
      return r.features
        .map((f) => ({ name: label(f.properties), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
        .filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    },
    async reverse(at) {
      try {
        const r = await getJson<{ features: PhotonFeature[] }>(
          `https://photon.komoot.io/reverse?lat=${at.lat}&lon=${at.lon}&lang=en`,
          { timeoutMs: 6000, retries: 0 },
        )
        const f = r.features[0]
        return f ? { name: label(f.properties), lat: at.lat, lon: at.lon } : null
      } catch {
        return null
      }
    },
  }
}
