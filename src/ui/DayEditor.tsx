import { useId, useState } from 'react'
import type { LegRule, Stop } from '../engine/types'
import { useApp } from '../state/store'
import { PlaceField } from './PlaceField'
import { Car, Down, Plus, Train, Up, X } from './icons'

function TimeChip({ label, value, onChange }: { label: string; value?: string; onChange(v?: string): void }) {
  const id = useId()
  if (value === undefined) {
    return (
      <button type="button" className="chip chip-add" onClick={() => onChange(label.startsWith('Arrive') ? '09:00' : '17:00')}>
        <Plus size={14} /> {label}
      </button>
    )
  }
  return (
    <span className="chip chip-time">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="time" value={value} step={300} onChange={(e) => onChange(e.target.value || undefined)} />
      <button type="button" className="chip-x" aria-label={`Remove ${label.toLowerCase()} time`} onClick={() => onChange(undefined)}>
        <X size={14} />
      </button>
    </span>
  )
}

function ParkingField({ stop }: { stop: Stop }) {
  const id = useId()
  const updateStop = useApp((s) => s.updateStop)
  const mode = !stop.parking ? 'none' : stop.parking.permit ? 'permit' : stop.parking.perDay === 0 && !stop.parking.perHour ? 'free' : 'paid'
  return (
    <span className="chip chip-parking">
      <label htmlFor={id}>Parking</label>
      <select
        id={id}
        value={mode}
        onChange={(e) => {
          const v = e.target.value
          updateStop(stop.id, {
            parking: v === 'none' ? undefined : v === 'free' ? { perDay: 0 } : v === 'permit' ? { perDay: 0, permit: true } : { perDay: stop.parking?.perDay || 25 },
          })
        }}
      >
        <option value="none">None</option>
        <option value="free">Free</option>
        <option value="permit">My permit</option>
        <option value="paid">Paid</option>
      </select>
      {mode === 'permit' && (
        <>
          <span aria-hidden="true">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            aria-label="What your permit costs per day, dollars"
            title="What your permit costs you per day (0 if free)"
            value={stop.parking!.perDay}
            onChange={(e) => updateStop(stop.id, { parking: { perDay: Math.max(0, Number(e.target.value) || 0), permit: true } })}
          />
          <span className="muted">/day</span>
        </>
      )}
      {mode === 'paid' && (
        <>
          <span aria-hidden="true">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            aria-label="Parking cost per day, dollars"
            value={stop.parking!.perDay}
            onChange={(e) => updateStop(stop.id, { parking: { ...stop.parking!, perDay: Math.max(0, Number(e.target.value) || 0) } })}
          />
          <span className="muted">/day</span>
        </>
      )}
    </span>
  )
}

const RULES: { value: LegRule; label: string; icon?: React.ReactNode; hint: string }[] = [
  { value: 'any', label: 'Best', hint: 'Let ParkHop choose' },
  { value: 'car', label: 'Car', icon: <Car size={15} />, hint: 'Arrive with your car' },
  { value: 'transit', label: 'Transit', icon: <Train size={15} />, hint: 'No car on this leg' },
]

function RuleToggle({ index, from, to }: { index: number; from: string; to: string }) {
  const rule = useApp((s) => s.plan.legRules[index])
  const setRule = useApp((s) => s.setRule)
  const name = useId()
  return (
    <fieldset className="leg-rule">
      <legend className="visually-hidden">
        How to get from {from} to {to}
      </legend>
      <div className="segmented small">
        {RULES.map((r) => (
          <label key={r.value} title={r.hint}>
            <input type="radio" name={name} value={r.value} checked={rule === r.value} onChange={() => setRule(index, r.value)} />
            <span>
              {r.icon}
              {r.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function StopCard({ stop, index, count }: { stop: Stop; index: number; count: number }) {
  const { updateStop, removeStop, moveStop, setPicking, pickingStopId } = useApp()
  const first = index === 0
  const last = index === count - 1
  const labelId = useId()
  return (
    <div className="stop-card">
      <div className="stop-head">
        <span className="stop-num" aria-hidden="true">
          {index + 1}
        </span>
        <label htmlFor={labelId} className="visually-hidden">
          Stop {index + 1} name
        </label>
        <input id={labelId} className="stop-label" value={stop.label} onChange={(e) => updateStop(stop.id, { label: e.target.value })} />
        <div className="stop-tools">
          {!first && !last && (
            <>
              <button type="button" className="icon-btn" aria-label={`Move ${stop.label} earlier`} disabled={index <= 1} onClick={() => moveStop(stop.id, -1)}>
                <Up size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${stop.label} later`} disabled={index >= count - 2} onClick={() => moveStop(stop.id, 1)}>
                <Down size={16} />
              </button>
            </>
          )}
          {count > 2 && !first && (
            <button type="button" className="icon-btn" aria-label={`Remove ${stop.label}`} onClick={() => removeStop(stop.id)}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <PlaceField
        label={stop.label}
        value={stop.place}
        picking={pickingStopId === stop.id}
        onChange={(place) => updateStop(stop.id, { place })}
        onPickOnMap={() => setPicking(pickingStopId === stop.id ? null : stop.id)}
      />
      <div className="stop-rules">
        {!first && <TimeChip label="Arrive by" value={stop.arriveByHhmm} onChange={(v) => updateStop(stop.id, { arriveByHhmm: v })} />}
        {!last && <TimeChip label="Leave after" value={stop.leaveAfterHhmm} onChange={(v) => updateStop(stop.id, { leaveAfterHhmm: v })} />}
        {!first && !last && (
          <span className="chip">
            <label htmlFor={`${labelId}-dwell`}>Stay</label>
            <input
              id={`${labelId}-dwell`}
              type="number"
              min={0}
              step={5}
              inputMode="numeric"
              value={stop.dwellMin}
              onChange={(e) => updateStop(stop.id, { dwellMin: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span className="muted">min</span>
          </span>
        )}
        {!first && !last && <ParkingField stop={stop} />}
      </div>
    </div>
  )
}

/** One-line version of the day, shown once there are results. */
function DaySummary({ onEdit }: { onEdit(): void }) {
  const plan = useApp((s) => s.plan)
  return (
    <section aria-labelledby="day-heading">
      <h2 id="day-heading" className="visually-hidden">
        Your day
      </h2>
      <div className="day-summary">
        <ol>
          {plan.stops.map((s) => (
            <li key={s.id}>
              <strong>{s.label}</strong>
              {s.arriveByHhmm && <span className="muted"> by {s.arriveByHhmm}</span>}
              {s.leaveAfterHhmm && <span className="muted"> till {s.leaveAfterHhmm}</span>}
            </li>
          ))}
        </ol>
        <button type="button" className="btn small" onClick={onEdit}>
          Edit day
        </button>
      </div>
    </section>
  )
}

export function DayEditor() {
  const plan = useApp((s) => s.plan)
  const addStop = useApp((s) => s.addStop)
  const hasResult = useApp((s) => s.result !== null)
  const [editing, setEditing] = useState(false)
  if (hasResult && !editing) return <DaySummary onEdit={() => setEditing(true)} />
  return (
    <section aria-labelledby="day-heading" className="day-editor">
      <h2 id="day-heading" className="section-title">
        Your day
      </h2>
      <ol className="stops">
        {plan.stops.map((s, i) => (
          <li key={s.id}>
            <StopCard stop={s} index={i} count={plan.stops.length} />
            {i < plan.stops.length - 1 && <RuleToggle index={i} from={s.label} to={plan.stops[i + 1].label} />}
          </li>
        ))}
      </ol>
      <button type="button" className="btn ghost add-stop" onClick={addStop}>
        <Plus size={16} /> Add a stop
      </button>
    </section>
  )
}
