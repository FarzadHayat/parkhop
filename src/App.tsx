import { useEffect, useRef, useState } from 'react'
import { presets } from './data/seq'
import { useApp } from './state/store'
import { DayEditor } from './ui/DayEditor'
import { dayLabel } from './ui/format'
import { Gear } from './ui/icons'
import { MapView } from './ui/MapView'
import { OptionDetail, RuledOut } from './ui/OptionDetail'
import { OptionList, PriorityBar, TradeoffChart } from './ui/Results'
import { AssistantBar } from './ui/AssistantBar'
import { SettingsDialog } from './ui/SettingsDialog'
import { WeatherChip } from './ui/WeatherChip'

type Sheet = 'peek' | 'half' | 'full'
const ORDER: Sheet[] = ['peek', 'half', 'full']
const NO_NOTES: string[] = []

/** Bottom sheet on phones: drag the handle, or tap / arrow keys to step between sizes. */
function useSheet() {
  const [sheet, setSheet] = useState<Sheet>('half')
  const [dragPx, setDragPx] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number } | null>(null)
  const panel = useRef<HTMLElement>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!panel.current) return
    start.current = { y: e.clientY, h: panel.current.getBoundingClientRect().height }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const dy = start.current.y - e.clientY
    if (Math.abs(dy) > 6) setDragPx(Math.max(90, Math.min(window.innerHeight - 56, start.current.h + dy)))
  }
  /** Returns true if the pointer dragged (so it was not a tap). */
  const endDrag = () => {
    if (!start.current) return false
    const moved = dragPx !== null
    if (moved) {
      const frac = dragPx! / window.innerHeight
      setSheet(frac < 0.3 ? 'peek' : frac < 0.72 ? 'half' : 'full')
    }
    start.current = null
    setDragPx(null)
    return moved
  }
  return { sheet, setSheet, dragPx, onPointerDown, onPointerMove, endDrag, panel }
}

function PlanButton() {
  const status = useApp((s) => s.status)
  const stale = useApp((s) => s.stale)
  const hasResult = useApp((s) => s.result !== null)
  const run = useApp((s) => s.plan_)
  const busy = status.kind === 'planning'
  const label = busy ? 'Checking routes…' : hasResult && stale ? 'Update options' : hasResult ? 'Plan again' : 'Find my best options'
  return (
    <div className="plan-bar">
      <button type="button" className={`btn primary ${hasResult && !stale && !busy ? 'quiet' : ''}`} onClick={() => run()} disabled={busy} aria-busy={busy}>
        {label}
      </button>
      <div className="plan-status" aria-live="polite">
        {busy && (
          <>
            <progress max={Math.max(1, status.total)} value={status.done} aria-label="Planning progress" />
            <span className="muted">
              {status.done}/{status.total} routes
            </span>
          </>
        )}
        {status.kind === 'error' && <span className="bad">{status.message}</span>}
        {stale && !busy && hasResult && <span className="muted">Your day changed since these options.</span>}
      </div>
    </div>
  )
}

export default function App() {
  const settingsRef = useRef<HTMLDialogElement>(null)
  const date = useApp((s) => s.plan.date)
  const setPlan = useApp((s) => s.setPlan)
  const loadPreset = useApp((s) => s.loadPreset)
  const options = useApp((s) => s.options)
  const notes = useApp((s) => s.result?.dataNotes) ?? NO_NOTES
  const run = useApp((s) => s.plan_)
  const { sheet, setSheet, dragPx, onPointerDown, onPointerMove, endDrag, panel } = useSheet()

  // Plan once on first open so there is something to look at.
  useEffect(() => {
    void run()
  }, [run])

  const step = (d: 1 | -1) => setSheet(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(sheet) + d))])

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          ParkHop
        </h1>
        <label className="date-field">
          <span className="visually-hidden">Travel date</span>
          <input type="date" value={date} onChange={(e) => e.target.value && setPlan({ ...useApp.getState().plan, date: e.target.value })} />
          <span className="date-label" aria-hidden="true">
            {dayLabel(date)}
          </span>
        </label>
        <WeatherChip />
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => settingsRef.current?.showModal()}>
          <Gear />
        </button>
      </header>

      <MapView />

      <aside
        ref={panel}
        className={`panel sheet-${sheet} ${dragPx !== null ? 'dragging' : ''}`}
        style={dragPx !== null ? { height: dragPx } : undefined}
        aria-label="Trip planner"
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={sheet === 'full' ? 'Shrink panel' : 'Expand panel'}
          aria-expanded={sheet !== 'peek'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            if (!endDrag()) setSheet(ORDER[(ORDER.indexOf(sheet) + 1) % ORDER.length])
          }}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              step(1)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              step(-1)
            }
          }}
          onClick={(e) => {
            // Keyboard activation (Enter/Space) arrives as a click with no pointer.
            if (e.detail === 0) setSheet(ORDER[(ORDER.indexOf(sheet) + 1) % ORDER.length])
          }}
        >
          <span aria-hidden="true" />
        </button>
        <div className="panel-scroll">
          <AssistantBar />
          <div>
            <nav className="presets" aria-label="Example days">
              {presets.map((p) => (
                <button key={p.id} type="button" className="chip" onClick={() => loadPreset(p.id)}>
                  {p.name}
                </button>
              ))}
            </nav>
            <DayEditor />
            <PlanButton />
            {options.length > 0 && (
              <section aria-labelledby="options-heading" className="results">
                <div className="results-head">
                  <h2 id="options-heading" className="section-title">
                    Options
                  </h2>
                  <PriorityBar />
                </div>
                <TradeoffChart />
                <OptionList />
                <OptionDetail />
                <RuledOut />
                {notes.length > 0 && <p className="fine">{notes.join(' · ')}</p>}
              </section>
            )}
          </div>
          <p className="fine attribution">
            Estimates, not guarantees. Timetables via Transitous, routes via OSRM, maps © OpenStreetMap contributors and OpenFreeMap, weather by Open-Meteo.
          </p>
        </div>
      </aside>
      <SettingsDialog ref={settingsRef} />
    </div>
  )
}
