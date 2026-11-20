import { localToEpoch } from '../engine/time'
import type { LatLon, Weather } from '../engine/types'
import { getJson } from './http'
import type { WeatherProvider } from './types'

interface OpenMeteo {
  hourly: {
    time: string[]
    precipitation: number[]
    precipitation_probability: number[]
    temperature_2m: number[]
    weather_code: number[]
  }
}

/** Open-Meteo hourly forecast, free and keyless, up to 16 days ahead. */
export function openMeteoProvider(): WeatherProvider {
  const cache = new Map<string, Promise<Weather | undefined>>()
  return {
    forecast(at: LatLon, timeZone: string) {
      const key = `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`
      let p = cache.get(key)
      if (!p) {
        const q = new URLSearchParams({
          latitude: at.lat.toFixed(3),
          longitude: at.lon.toFixed(3),
          hourly: 'precipitation,precipitation_probability,temperature_2m,weather_code',
          timezone: timeZone,
          forecast_days: '16',
        })
        p = getJson<OpenMeteo>(`https://api.open-meteo.com/v1/forecast?${q}`, { timeoutMs: 10_000 })
          .then((r) => ({
            hourly: r.hourly.time.map((t, i) => ({
              time: localToEpoch(t.slice(0, 10), t.slice(11, 16), timeZone),
              precipMm: r.hourly.precipitation[i] ?? 0,
              precipProb: r.hourly.precipitation_probability[i] ?? 0,
              tempC: r.hourly.temperature_2m[i] ?? 0,
              code: r.hourly.weather_code[i] ?? 0,
            })),
          }))
          .catch(() => {
            cache.delete(key)
            return undefined
          })
        cache.set(key, p)
      }
      return p
    },
  }
}
