import { useId } from 'react'
import { useApp } from '../state/store'
import { useShifts, weekTotals, type ShiftPlan } from '../state/shifts'
import { duration, money, pct, time, tz } from './format'
import { Alert } from './icons'
import { LegStrip } from './Results'

const dayName = (epoch: number) => new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(epoch))

function ShiftCard({ sp, onOpen }: { sp: ShiftPlan; onOpen(): void }) {
  const { shift, best } = sp
  const late = time(shift.finish) >= '21:00'
  return (
    <li className={`shift-card ${sp.flags.some((f) => f.level !== 'info') ? 'is-risky' : ''}`}>
      <div className="shift-head">
        <span className="shift-day">{dayName(shift.start)}</span>
        <span className="shift-time">
          {time(shift.start)}–{time(shift.finish)}
          {late && <span className="badge late">Late finish</span>}
        </span>
      </div>
      <p className="shift-where muted">
        {shift.team ? `${shift.team} · ` : ''}
        {shift.place.name}
      </p>
      {sp.status === 'waiting' && <p className="muted">Waiting…</p>}
      {sp.status === 'planning' && (
        <p className="muted" aria-live="polite">
          Checking timetables…
        </p>
      )}
      {sp.status === 'error' && <p className="bad">{sp.error}</p>}
      {sp.status === 'done' && !best && <p className="bad">{sp.error}</p>}
      {best && (
        <>
          <p className="shift-verdict">
            <strong>{best.title}</strong>
            <span>
              Leave {time(best.leaveBy)} · {money(best.costTotal, 2)} · {duration(best.totalTravelMin)} · {pct(best.reliability.onTimeProb)} on time
            </span>
          </p>
          <span className="option-legs">
            {best.legs.map((l) => (
              <LegStrip key={l.legIndex} segments={l.segments} start={l.depart} end={l.arrive} />
            ))}
          </span>
        </>
      )}
      {sp.flags.length > 0 && (
        <ul className="shift-flags">
          {sp.flags.map((f, i) => (
            <li key={i} className={`w-${f.level}`}>
              <Alert size={14} />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      {sp.status === 'done' && (
        <button type="button" className="btn small" onClick={onOpen}>
          See this day
        </button>
      )}
    </li>
  )
}

export function Shifts({ onOpenDay }: { onOpenDay(): void }) {
  const { roster, plans, loading, error, token, setToken, loadDemo, loadTanda, planAll } = useShifts()
  const setPlan = useApp((s) => s.setPlan)
  const run = useApp((s) => s.plan_)
  const tokenId = useId()
  const totals = weekTotals(plans)

  const open = (sp: ShiftPlan) => {
    setPlan(sp.plan)
    onOpenDay()
    void run()
  }

  return (
    <section aria-labelledby="shifts-heading" className="shifts">
      <h2 id="shifts-heading" className="section-title">
        Your shifts
      </h2>
      {!roster && (
        <div className="tanda-connect">
          <p>Plan the commute for every rostered shift this week, and see which ones public transport can't cover.</p>
          <form
            className="token-row"
            onSubmit={(e) => {
              e.preventDefault()
              void loadTanda()
            }}
          >
            <label htmlFor={tokenId} className="visually-hidden">
              Tanda access token
            </label>
            <input id={tokenId} type="password" autoComplete="off" placeholder="Tanda access token" value={token} onChange={(e) => setToken(e.target.value)} />
            <button type="submit" className="btn small" disabled={loading}>
              Connect Tanda
            </button>
          </form>
          <button type="button" className="btn ghost small" onClick={loadDemo}>
            Use a demo roster
          </button>
        </div>
      )}
      {error && (
        <p className="bad" role="alert">
          {error}
        </p>
      )}
      {roster && (
        <>
          <div className="roster-head">
            <span>
              {roster.personName ?? 'Your roster'} · {roster.shifts.length} shifts {roster.source === 'demo' && <span className="badge">Demo</span>}
            </span>
            <button type="button" className="btn small primary-lite" onClick={() => void planAll()} disabled={loading} aria-busy={loading}>
              {loading ? 'Planning…' : plans.length ? 'Plan again' : 'Plan my week'}
            </button>
          </div>
          {totals.shifts > 0 && (
            <div className="tiles week-tiles" aria-live="polite">
              <div className="tile">
                <span className="tile-k">This week</span>
                <span className="tile-v">{money(totals.best, 2)}</span>
              </div>
              <div className="tile">
                <span className="tile-k">Driving every shift</span>
                <span className="tile-v">{money(totals.drive, 2)}</span>
              </div>
              <div className="tile">
                <span className="tile-k">Saved</span>
                <span className="tile-v good">{money(totals.saving, 0)}</span>
              </div>
              <div className="tile">
                <span className="tile-k">Shifts to watch</span>
                <span className={`tile-v ${totals.risky ? 'warn' : ''}`}>{totals.risky}</span>
              </div>
            </div>
          )}
          <ol className="shift-list">
            {(plans.length ? plans : roster.shifts.map((shift) => ({ shift, status: 'idle', flags: [] }) as unknown as ShiftPlan)).map((sp) => (
              <ShiftCard key={sp.shift.id} sp={sp} onOpen={() => open(sp)} />
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
