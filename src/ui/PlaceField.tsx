import { useEffect, useId, useRef, useState } from 'react'
import type { Place } from '../engine/types'
import { photonProvider } from '../providers/photon'
import { region } from '../data/seq'
import { Pin } from './icons'

const geocoder = photonProvider(region.bounds)

interface Props {
  label: string
  value: Place | null
  onChange(p: Place): void
  onPickOnMap(): void
  picking: boolean
}

/** Place search box following the ARIA combobox pattern, plus a pick-on-map button. */
export function PlaceField({ label, value, onChange, onPickOnMap, picking }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const [text, setText] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Place[]>([])
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = useRef(false)

  useEffect(() => {
    if (!dirty.current) setText(value?.name ?? '')
  }, [value])

  useEffect(() => {
    if (!dirty.current) return
    const q = text.trim()
    if (q.length < 3) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await geocoder.search(q, region.centre, ctrl.signal)
        setItems(res)
        setActive(res.length ? 0 : -1)
        setOpen(true)
        setError(res.length ? '' : 'No matches')
      } catch {
        if (!ctrl.signal.aborted) setError('Search unavailable. Try pick on map.')
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, 280)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [text])

  // Short queries show nothing rather than stale matches.
  const shown = text.trim().length >= 3 ? items : []

  const choose = (p: Place) => {
    dirty.current = false
    setText(p.name)
    setOpen(false)
    setItems([])
    setError('')
    onChange(p)
  }

  return (
    <div className="place-field">
      <label htmlFor={id} className="visually-hidden">
        {label} location
      </label>
      <div className="place-input">
        <input
          id={id}
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
          placeholder="Search address or place"
          value={text}
          onChange={(e) => {
            dirty.current = true
            setText(e.target.value)
          }}
          onFocus={(e) => {
            // Select after the click lands, or the click would place the caret instead.
            const el = e.currentTarget
            requestAnimationFrame(() => el.select())
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((a) => Math.min(shown.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && open && shown[active]) {
              e.preventDefault()
              choose(shown[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
              if (dirty.current) {
                dirty.current = false
                setText(value?.name ?? '')
              }
            }
          }}
        />
        <button
          type="button"
          className={`icon-btn ${picking ? 'is-on' : ''}`}
          aria-pressed={picking}
          aria-label={picking ? `Cancel picking ${label} on map` : `Pick ${label} on map`}
          title="Pick on map"
          onClick={onPickOnMap}
        >
          <Pin />
        </button>
      </div>
      {busy && <span className="visually-hidden" aria-live="polite">Searching</span>}
      {error && (
        <p id={`${id}-err`} className="field-error" aria-live="polite">
          {error}
        </p>
      )}
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="suggestions" hidden={!open || shown.length === 0}>
        {shown.map((p, i) => (
          <li
            key={`${p.name}-${i}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(p)}
          >
            {p.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
