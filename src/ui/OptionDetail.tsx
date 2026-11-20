import { useId, useState } from 'react'
import { costTotal } from '../engine/planner'
import { localToEpoch } from '../engine/time'
import type { DayOption, LegPlan, Lot, Segment } from '../engine/types'
import { region, selectedOption, useApp } from '../state/store'
import { duration, money, MODE_LABEL, modeVar, pct, time, tz } from './format'
import { Alert, Info, ModeIcon } from './icons'

const lotById = (id: string) => region.lots.find((l) => l.id === id)

function stepText(s: Segment, leg: LegPlan, toLabel: string, lot?: Lot): string {
  const mins = Math.round((s.end - s.start) / 60000)
  switch (s.mode) {
    case 'drive':
      return `Drive ${s.distanceM ? `${(s.distanceM / 1000).toFixed(0)} km ` : ''}to ${s.toName}${s.note ? `, ${s.note}` : ''}`
    case 'park':
      if (leg.kind === 'retrieve') return `Back to your car at ${s.fromName}`
      return lot ? `Park at ${lot.name}, head to ${lot.station.name}` : `Park near ${s.toName}`
    case 'wait':
      return `${mins} min spare before your service`
    case 'walk':
      return `Walk ${mins} min to ${s.toName || toLabel}`
    default: {
      const head = s.headsign ? ` towards ${s.headsign}` : ''
      const every = s.headwayMin ? ` · about every ${s.headwayMin} min` : ''
      // Rail route ids like "RPIP" mean nothing to riders; bus numbers do.
      const route = s.route && !(s.mode === 'rail' && /^[A-Z]{4}$/.test(s.route)) ? ` ${s.route}` : ''
      return `${MODE_LABEL[s.mode]}${route}${head} to ${s.toName}${every}`
    }
  }
}

function LegSteps({ leg }: { leg: LegPlan }) {
  const plan = useApp((s) => s.plan)
  const from = plan.stops[leg.legIndex]
  const to = plan.stops[leg.legIndex + 1]
  const lot = leg.lotId ? lotById(leg.lotId) : undefined
  const deadline = to.arriveByHhmm ? localToEpoch(plan.date, to.arriveByHhmm, tz) : undefined
  return (
    <section className="leg" aria-label={`${from.label} to ${to.label}`}>
      <h3 className="leg-title">
        {from.label} → {to.label}
        <span className="muted">
          {' '}
          {time(leg.depart)}–{time(leg.arrive)}
          {deadline !== undefined && ` · due ${to.arriveByHhmm}`}
        </span>
      </h3>
      <ol className="steps">
        {leg.segments.map((s, i) => (
          <li key={i} className={`step m-${s.mode}`} style={{ ['--c' as string]: modeVar(s.mode) }}>
            <span className="step-time">{time(s.start)}</span>
            <span className="step-dot" aria-hidden="true">
              <ModeIcon mode={s.mode} size={14} />
            </span>
            <span className="step-text">
              {stepText(s, leg, to.label, lot)}
              {s.realtime && s.delayMin !== undefined && (
                <span className={`rt ${s.delayMin >= 3 ? 'late' : ''}`}>{s.delayMin > 0 ? ` ${s.delayMin} min late (live)` : ' on time (live)'}</span>
              )}
            </span>
          </li>
        ))}
        <li className="step step-end">
          <span className="step-time">{time(leg.arrive)}</span>
          <span className="step-dot" aria-hidden="true" />
          <span className="step-text">
            Arrive {to.label}
            {deadline !== undefined && (
              <span className={leg.arrive <= deadline ? 'good' : 'bad'}>
                {' '}
                ({leg.arrive <= deadline ? `${Math.round((deadline - leg.arrive) / 60000)} min early` : `${Math.round((leg.arrive - deadline) / 60000)} min late`})
              </span>
            )}
          </span>
        </li>
      </ol>
    </section>
  )
}

function LotCard({ lot }: { lot: Lot }) {
  const reportFill = useApp((s) => s.reportFill)
  const reported = useApp((s) => s.fillReports[lot.id])
  const [v, setV] = useState(reported ?? '07:30')
  const id = useId()
  const source = { reported: 'commuter reports', estimated: 'estimate', user: 'your report', unknown: 'unknown' }[reported ? 'user' : lot.fillSource]
  return (
    <section className="lot-card" aria-label={lot.name}>
      <h3>
        {lot.name} <span className="badge">{lot.kind === 'street' ? 'Street parking' : lot.kind === 'carpark' ? 'Public car park' : "Park 'n' ride"}</span>
      </h3>
      {lot.notes && <p className="fine">{lot.notes}</p>}
      {lot.stayKnown === false && <p className="fine warn">Time limits here are not confirmed. Check the signs before leaving your car all day.</p>}
      <dl className="facts">
        <div>
          <dt>Station</dt>
          <dd>{lot.station.name}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>
            {lot.perDay ? `${money(lot.perDay)}/day` : 'Free'}
            {lot.feeKnown === false && <span className="muted"> (estimate)</span>}
          </dd>
        </div>
        <div>
          <dt>Spaces</dt>
          <dd>{lot.capacity ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Full by</dt>
          <dd>
            {reported ?? lot.fillsByHhmm ?? 'Rarely full'} <span className="muted">({source})</span>
          </dd>
        </div>
      </dl>
      <form
        className="report"
        onSubmit={(e) => {
          e.preventDefault()
          reportFill(lot.id, v)
        }}
      >
        <label htmlFor={id}>Found it full at</label>
        <input id={id} type="time" value={v} step={300} onChange={(e) => setV(e.target.value)} />
        <button type="submit" className="btn small">
          Save
        </button>
        {reported && (
          <button type="button" className="btn small ghost" onClick={() => reportFill(lot.id, null)}>
            Clear
          </button>
        )}
      </form>
      <p className="fine">Map data © OpenStreetMap contributors. Rules and hours at the lot override this.</p>
    </section>
  )
}

function ArrivalChart({ o }: { o: DayOption }) {
  const h = o.reliability.histogram
  const first = o.reliability.perStop[0]
  const plan = useApp((s) => s.plan)
  if (!h?.length || !first) return null
  const max = Math.max(...h.map((b) => b.count))
  const bins: number[] = []
  for (let b = -30; b <= 30; b += 2) bins.push(b)
  const W = 320
  const H = 90
  const bw = W / bins.length
  const zeroX = (bins.indexOf(0) / bins.length) * W
  const stop = plan.stops[first.stopIndex]
  const p90 = first.p90LateMin
  return (
    <figure className="arrival">
      <figcaption>
        <strong>{stop.label}</strong>: on time {pct(first.prob)} of days.{' '}
        {p90 <= 0 ? `9 in 10 days you're at least ${Math.round(-p90)} min early.` : p90 > 300 ? 'Some days there is no service to catch.' : `9 in 10 days you're no more than ${Math.round(p90)} min late.`}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 18}`} aria-hidden="true">
        {bins.map((b, i) => {
          const c = h.find((x) => x.binStartMin === b)?.count ?? 0
          const bh = (c / max) * H
          return <rect key={b} x={i * bw + 1} y={H - bh} width={bw - 2} height={bh} className={b >= 0 ? 'late' : 'early'} rx={1.5} />
        })}
        <line x1={zeroX} x2={zeroX} y1={0} y2={H} className="deadline" />
        <text x={zeroX} y={H + 14} textAnchor="middle" className="tick">
          due {stop.arriveByHhmm}
        </text>
        <text x={2} y={H + 14} className="tick">
          30 min early
        </text>
        <text x={W - 2} y={H + 14} textAnchor="end" className="tick">
          30+ late
        </text>
      </svg>
    </figure>
  )
}

export function OptionDetail() {
  const o = useApp((s) => selectedOption(s))
  const options = useApp((s) => s.options)
  if (!o) return null
  const drive = options.find((x) => x.strategy === 'drive')
  const c = o.cost
  const lots = o.lotIds.map(lotById).filter((l): l is Lot => !!l)
  return (
    <article className="detail" aria-labelledby="detail-title">
      <h2 id="detail-title" className="section-title">
        {o.title}
      </h2>
      <div className="tiles">
        <div className="tile">
          <span className="tile-k">Leave by</span>
          <span className="tile-v">{time(o.leaveBy)}</span>
        </div>
        <div className="tile">
          <span className="tile-k">Per day</span>
          <span className="tile-v">{money(costTotal(c), 2)}</span>
        </div>
        <div className="tile">
          <span className="tile-k">Travel</span>
          <span className="tile-v">{duration(o.totalTravelMin)}</span>
        </div>
        <div className="tile">
          <span className="tile-k">On time</span>
          <span className="tile-v">{pct(o.reliability.onTimeProb)}</span>
        </div>
      </div>
      <p className="cost-line">
        Fuel {money(c.fuel, 2)} · Car wear {money(c.wear, 2)} · Parking {money(c.parking, 2)} · Fares {money(c.fares, 2)}
        {c.tolls ? ` · Tolls ${money(c.tolls, 2)}` : ''}
        {drive && drive.id !== o.id && (
          <>
            <br />
            <strong>{drive.costTotal - o.costTotal >= 0 ? `${money((drive.costTotal - o.costTotal) * 230, 0)} a year cheaper` : `${money((o.costTotal - drive.costTotal) * 230, 0)} a year dearer`}</strong> than driving
            ({Math.round(o.totalTravelMin - drive.totalTravelMin) >= 0 ? '+' : ''}
            {Math.round(o.totalTravelMin - drive.totalTravelMin)} min a day)
          </>
        )}
      </p>
      {o.warnings.length > 0 && (
        <ul className="warnings">
          {o.warnings.map((w, i) => (
            <li key={i} className={`w-${w.level}`}>
              {w.level === 'info' ? <Info size={16} /> : <Alert size={16} />}
              <span>
                <span className="visually-hidden">{w.level === 'info' ? 'Note: ' : 'Warning: '}</span>
                {w.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ArrivalChart o={o} />
      {o.legs.map((l) => (
        <LegSteps key={l.legIndex} leg={l} />
      ))}
      {lots.map((l) => (
        <LotCard key={l.id} lot={l} />
      ))}
    </article>
  )
}

export function RuledOut() {
  const result = useApp((s) => s.result)
  if (!result?.rejected.length) return null
  return (
    <details className="ruled-out">
      <summary>Ruled out ({result.rejected.length})</summary>
      <ul>
        {result.rejected.map((r, i) => (
          <li key={i}>{r.reason}</li>
        ))}
      </ul>
    </details>
  )
}
