import { describe, expect, it } from 'vitest'
import { formatHhmm, localHour, localToEpoch, localWeekday, nextWeekday } from './time'

const BNE = 'Australia/Brisbane'
const SYD = 'Australia/Sydney'

describe('localToEpoch / formatHhmm', () => {
  it('maps Brisbane local time to UTC+10', () => {
    expect(localToEpoch('2026-11-23', '08:00', BNE)).toBe(Date.UTC(2026, 10, 22, 22, 0))
  })

  it('round trips in Brisbane for every hour', () => {
    for (let h = 0; h < 24; h++) {
      const hhmm = `${String(h).padStart(2, '0')}:30`
      expect(formatHhmm(localToEpoch('2026-06-10', hhmm, BNE), BNE)).toBe(hhmm)
    }
  })

  it('uses UTC+11 in Sydney during daylight saving', () => {
    expect(localToEpoch('2026-11-23', '08:00', SYD)).toBe(Date.UTC(2026, 10, 22, 21, 0))
  })

  it('uses UTC+10 in Sydney outside daylight saving', () => {
    expect(localToEpoch('2026-06-10', '08:00', SYD)).toBe(Date.UTC(2026, 5, 9, 22, 0))
  })

  it('round trips in Sydney on a DST date', () => {
    for (const hhmm of ['00:15', '06:45', '12:00', '17:30', '23:59']) {
      expect(formatHhmm(localToEpoch('2026-11-23', hhmm, SYD), SYD)).toBe(hhmm)
    }
  })

  it('handles the day DST starts (2026-10-04 in Sydney)', () => {
    const before = localToEpoch('2026-10-04', '01:00', SYD)
    const after = localToEpoch('2026-10-04', '04:00', SYD)
    // 01:00 AEST to 04:00 AEDT is only 2 real hours.
    expect((after - before) / 3600_000).toBe(2)
    expect(formatHhmm(after, SYD)).toBe('04:00')
  })

  it('reports local hour and weekday in the zone, not the device zone', () => {
    const t = localToEpoch('2026-11-23', '08:30', BNE) // Monday
    expect(localHour(t, BNE)).toBe(8.5)
    expect(localWeekday(t, BNE)).toBe(1)
  })
})

describe('nextWeekday', () => {
  it('keeps a weekday', () => {
    expect(nextWeekday(localToEpoch('2026-11-23', '09:00', BNE), BNE)).toBe('2026-11-23') // Monday
  })

  it('skips Saturday and Sunday to Monday', () => {
    expect(nextWeekday(localToEpoch('2026-11-21', '09:00', BNE), BNE)).toBe('2026-11-23') // Saturday
    expect(nextWeekday(localToEpoch('2026-11-22', '09:00', BNE), BNE)).toBe('2026-11-23') // Sunday
  })

  it('treats Friday as a weekday', () => {
    expect(nextWeekday(localToEpoch('2026-11-20', '23:00', BNE), BNE)).toBe('2026-11-20')
  })
})
