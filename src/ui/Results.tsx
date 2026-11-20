import type { DayOption, Priority, Segment } from '../engine/types'
import { selectedOption, useApp } from '../state/store'
import { duration, money, MODE_LABEL, modeVar, pct, time } from './format'
import { ModeIcon } from './icons'

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'cheapest', label: 'Cheapest' },
  { value: 'fastest', label: 'Fastest' },
  { value: 'reliable', label: 'On time' },
]

export function PriorityBar() {
  const priority = useApp((s) => s.settings.priority)
  const setSettings = useApp((s) => s.setSettings)
  return (
    <fieldset className="priority">
      <legend className="visually-hidden">Rank options by</legend>
      <div className="segmented">
        {PRIORITIES.map((p) => (
          <label key={p.value}>
            <input type="radio" name="priority" value={p.value} checked={priority === p.value} onChange={() => setSettings({ priority: p.value })} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** One leg as a proportional strip of coloured mode segments. */
export function LegStrip({ segments, start, end }: { segments: Segment[]; start: number; end: number }) {
  const span = Math.max(1, end - start)
  return (
    <div className="strip" aria-hidden="true">
      {segments.map((s, i) => {
        const w = ((s.end - s.start) / span) * 100
        if (w <= 0) return null
        return (
          <span key={i} className={`strip-seg m-${s.mode}`} style={{ width: `${w}%`, background: modeVar(s.mode) }} title={`${MODE_LABEL[s.mode]} ${Math.round((s.end - s.start) / 60000)} min`}>
            {w > 9 && s.mode !== 'wait' && s.mode !== 'park' && <ModeIcon mode={s.mode} size={13} />}
          </span>
        )
      })}
    </div>
  )
}

function legSummary(o: DayOption): string {
  return o.legs
    .map((l) => {
      const modes = [...new Set(l.segments.map((s) => s.mode).filter((m) => m !== 'walk' && m !== 'wait' && m !== 'park'))]
      return modes.map((m) => MODE_LABEL[m]).join(' + ') || 'Walk'
    })
    .join(', then ')
}

function OptionCard({ o, rank, driveCost }: { o: DayOption; rank: number; driveCost?: number }) {
  const selected = useApp((s) => selectedOption(s)?.id === o.id)
  const select = useApp((s) => s.select)
  const saves = driveCost !== undefined && o.strategy !== 'drive' ? (driveCost - o.costTotal) * 5 : undefined
  const caution = o.warnings.find((w) => w.level !== 'info')
  const late = o.reliability.onTimeProb < 0.5
  return (
    <button type="button" className={`option-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={() => select(o.id)}>
      <span className="option-top">
        <span className="option-title">
          {rank === 0 && <span className="badge best">Best match</span>}
          {o.title}
        </span>
        <span className="option-cost">
          {money(o.costTotal, 2)}
          <span className="muted">/day</span>
        </span>
      </span>
      <span className="option-stats">
        <span>
          <span className="muted">Leave</span> <strong>{time(o.leaveBy)}</strong>
        </span>
        <span>
          <span className="muted">Travel</span> <strong>{duration(o.totalTravelMin)}</strong>
        </span>
        <span className={late ? 'bad' : o.reliability.onTimeProb < 0.85 ? 'warn' : 'good'}>
          <strong>{pct(o.reliability.onTimeProb)}</strong> <span className="muted">on time</span>
        </span>
      </span>
      <span className="option-legs">
        {o.legs.map((l) => (
          <LegStrip key={l.legIndex} segments={l.segments} start={l.depart} end={l.arrive} />
        ))}
      </span>
      <span className="visually-hidden">{legSummary(o)}.</span>
      {saves !== undefined && saves > 1 && <span className="saves">Saves {money(saves, 0)} a week vs driving</span>}
      {caution && <span className="option-warn">{caution.text}</span>}
    </button>
  )
}

/** Scatter of cost against travel time: the trade-off at a glance. Cards below carry the same data for screen readers. */
export function TradeoffChart() {
  const options = useApp((s) => s.options)
  const sel = useApp((s) => selectedOption(s))
  const select = useApp((s) => s.select)
  if (options.length < 2) return null
  const W = 340
  const H = 170
  const pad = { l: 44, r: 14, t: 14, b: 30 }
  const xs = options.map((o) => o.totalTravelMin)
  const ys = options.map((o) => o.costTotal)
  const xMin = Math.min(...xs) * 0.92
  const xMax = Math.max(...xs) * 1.05
  const yMax = Math.max(5, Math.max(...ys) * 1.12)
  const x = (v: number) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r)
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b)
  const yTicks = [0, yMax / 2, yMax].map((v) => Math.round(v))
  return (
    <figure className="tradeoff">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cost per day against total travel time for each option">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="tick">
              ${t}
            </text>
          </g>
        ))}
        <text x={(W + pad.l) / 2} y={H - 6} textAnchor="middle" className="tick">
          Travel time in the day (min) →
        </text>
        {[xMin, (xMin + xMax) / 2, xMax].map((t) => (
          <text key={t} x={x(t)} y={H - pad.b + 14} textAnchor="middle" className="tick">
            {Math.round(t)}
          </text>
        ))}
        {options.map((o) => {
          const cx = x(o.totalTravelMin)
          const cy = y(o.costTotal)
          const on = sel?.id === o.id
          const r = on ? 8 : 6
          const shape =
            o.strategy === 'drive' ? (
              <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={2} />
            ) : o.strategy === 'transit' ? (
              <path d={`M${cx} ${cy - r - 1} L${cx + r + 1} ${cy + r} L${cx - r - 1} ${cy + r} Z`} />
            ) : (
              <circle cx={cx} cy={cy} r={r} />
            )
          return (
            <g key={o.id} className={`pt s-${o.strategy} ${on ? 'on' : ''}`} onClick={() => select(o.id)}>
              <title>
                {o.title}: {money(o.costTotal, 2)}, {duration(o.totalTravelMin)}, {pct(o.reliability.onTimeProb)} on time
              </title>
              {shape}
            </g>
          )
        })}
      </svg>
      <figcaption className="legend">
        <span>
          <i className="lg s-parkride" /> Park & ride
        </span>
        <span>
          <i className="lg s-drive" /> Drive
        </span>
        <span>
          <i className="lg s-transit" /> Transit
        </span>
        <span className="muted">Lower left is better</span>
      </figcaption>
    </figure>
  )
}

export function OptionList() {
  const options = useApp((s) => s.options)
  const drive = options.find((o) => o.strategy === 'drive')
  return (
    <ul className="options" aria-label="Commute options">
      {options.map((o, i) => (
        <li key={o.id}>
          <OptionCard o={o} rank={i} driveCost={drive?.costTotal} />
        </li>
      ))}
    </ul>
  )
}
