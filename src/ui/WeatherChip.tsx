import { localToEpoch } from '../engine/time'
import { useApp } from '../state/store'
import { tz } from './format'
import { Rain, Sun } from './icons'

/** Morning peak weather for the travel day, when a forecast exists. */
export function WeatherChip() {
  const weather = useApp((s) => s.result?.weather)
  const date = useApp((s) => s.plan.date)
  if (!weather) return null
  const from = localToEpoch(date, '06:00', tz)
  const to = localToEpoch(date, '19:00', tz)
  const hours = weather.hourly.filter((h) => h.time >= from && h.time <= to)
  if (!hours.length) return null
  const wet = hours.filter((h) => h.precipMm >= 0.5 || h.precipProb >= 60)
  const maxT = Math.round(Math.max(...hours.map((h) => h.tempC)))
  const text = wet.length ? `Rain likely` : 'Dry'
  return (
    <span className="weather-chip" title={`${text}, up to ${maxT}°C`}>
      {wet.length ? <Rain size={16} /> : <Sun size={16} />}
      <span>
        {text} · {maxT}°
      </span>
    </span>
  )
}
