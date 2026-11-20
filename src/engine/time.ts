// Timezone helpers. All planning happens in the region's timezone, whatever
// the device's own timezone is.

const MIN = 60_000

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** Local date (YYYY-MM-DD) + local time (HH:MM) in `timeZone` -> epoch ms. */
export function localToEpoch(date: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes handle DST boundaries.
  let t = guess - tzOffsetMs(guess, timeZone)
  t = guess - tzOffsetMs(t, timeZone)
  return t
}

export function formatHhmm(epoch: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epoch))
}

/** Local hour of day (fractional) in the timezone. */
export function localHour(epoch: number, timeZone: string): number {
  const off = tzOffsetMs(epoch, timeZone)
  const local = new Date(epoch + off)
  return local.getUTCHours() + local.getUTCMinutes() / 60
}

/** 0 = Sunday ... 6 = Saturday, in the timezone. */
export function localWeekday(epoch: number, timeZone: string): number {
  const off = tzOffsetMs(epoch, timeZone)
  return new Date(epoch + off).getUTCDay()
}

export function minutes(ms: number): number {
  return ms / MIN
}

export function addMin(epoch: number, min: number): number {
  return epoch + min * MIN
}

/** Next weekday (Mon-Fri) on or after `from`, as YYYY-MM-DD in the timezone. */
export function nextWeekday(from: number, timeZone: string): string {
  let t = from
  for (let i = 0; i < 8; i++) {
    const wd = localWeekday(t, timeZone)
    if (wd >= 1 && wd <= 5) break
    t += 24 * 60 * MIN
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
}

export function isoWithOffset(epoch: number): string {
  return new Date(epoch).toISOString()
}
