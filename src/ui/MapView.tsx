import type { FeatureCollection } from 'geojson'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import type { SegmentMode } from '../engine/types'
import { photonProvider } from '../providers/photon'
import { region, selectedOption, useApp } from '../state/store'

maplibregl.setWorkerUrl(workerUrl)

const geocoder = photonProvider(region.bounds)

const MODE_HEX: Record<'light' | 'dark', Record<SegmentMode, string>> = {
  light: { drive: '#c2410c', walk: '#57534e', wait: '#a8a29e', park: '#a16207', rail: '#1d4ed8', metro: '#be185d', bus: '#047857', tram: '#7c3aed', ferry: '#0e7490' },
  dark: { drive: '#fb923c', walk: '#d6d3d1', wait: '#78716c', park: '#facc15', rail: '#60a5fa', metro: '#f472b6', bus: '#34d399', tram: '#a78bfa', ferry: '#22d3ee' },
}

function scheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const styleUrl = (s: 'light' | 'dark') => `https://tiles.openfreemap.org/styles/${s === 'dark' ? 'dark' : 'positron'}`

type FC = FeatureCollection

function lotsGeo(candidates: Set<string>, used: Set<string>): FC {
  return {
    type: 'FeatureCollection',
    features: region.lots.map((l) => {
      const mins = l.fillsByHhmm ? Number(l.fillsByHhmm.slice(0, 2)) * 60 + Number(l.fillsByHhmm.slice(3)) : 24 * 60
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
        properties: {
          id: l.id,
          name: l.name,
          fills: l.fillsByHhmm ?? 'rarely',
          // 0 = fills very early, 1 = mid, 2 = later
          tier: mins < 7 * 60 + 20 ? 0 : mins < 7 * 60 + 50 ? 1 : 2,
          street: l.kind === 'street' || l.kind === 'carpark' ? 1 : 0,
          cand: candidates.has(l.id) ? 1 : 0,
          used: used.has(l.id) ? 1 : 0,
        },
      }
    }),
  }
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])
  const syncLayers = useRef<(force?: boolean) => void>(() => {})
  const [ready, setReady] = useState(0)
  const [mode, setMode] = useState(scheme())
  const plan = useApp((s) => s.plan)
  const result = useApp((s) => s.result)
  const option = useApp((s) => selectedOption(s))
  const picking = useApp((s) => s.pickingStopId)
  const [lotPopup, setLotPopup] = useState<{ name: string; fills: string } | null>(null)
  // Refit when the layout flips between phone (bottom sheet) and desktop (side panel).
  const [layoutKey, setLayoutKey] = useState(() => window.matchMedia('(max-width: 899px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const on = () => setLayoutKey(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // Follow the system colour scheme.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const on = () => setMode(scheme())
    mq?.addEventListener('change', on)
    return () => mq?.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current,
      style: styleUrl(mode),
      bounds: [
        [152.85, -27.6],
        [153.15, -27.2],
      ],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    m.touchZoomRotate.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: false } }), 'top-right')
    map.current = m
    m.on('style.load', () => {
      // A new style wipes our sources and layers: put them back.
      syncLayers.current(true)
      setReady((n) => n + 1)
    })
    m.on('click', 'lots', (e) => {
      const f = e.features?.[0]
      if (!f || useApp.getState().pickingStopId) return
      setLotPopup({ name: String(f.properties.name), fills: String(f.properties.fills) })
    })
    m.on('mouseenter', 'lots', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'lots', () => (m.getCanvas().style.cursor = ''))
    return () => {
      m.remove()
      map.current = null
    }
    // the map is created once; style switches happen below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    m.setStyle(styleUrl(mode), { diff: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Layers: lots, route segments. Kept in a ref so the style.load handler can rerun it.
  syncLayers.current = (force = false) => {
    const m = map.current
    if (!m || (!force && !m.isStyleLoaded())) return
    const hex = MODE_HEX[mode]
    const used = new Set(option?.lotIds ?? [])
    const cands = new Set(result?.candidateLotIds ?? [])
    const lots = lotsGeo(cands, used)
    const route: FC = {
      type: 'FeatureCollection',
      features: (option?.legs ?? []).flatMap((l) =>
        l.segments
          .filter((s) => s.geometry && s.geometry.length > 1)
          .map((s) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: s.geometry! }, properties: { mode: s.mode, color: hex[s.mode] } })),
      ),
    }
    const src = (id: string, data: FC) => {
      const s = m.getSource(id) as GeoJSONSource | undefined
      if (s) s.setData(data)
      else m.addSource(id, { type: 'geojson', data })
    }
    src('lots', lots)
    src('route', route)
    if (!m.getLayer('route-casing')) {
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['!=', ['get', 'mode'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': mode === 'dark' ? '#0c0a09' : '#ffffff', 'line-width': 8 } })
      m.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['!=', ['get', 'mode'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } })
      m.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['==', ['get', 'mode'], 'walk'], layout: { 'line-cap': 'round' }, paint: { 'line-color': hex.walk, 'line-width': 3, 'line-dasharray': [0.5, 2] } })
      m.addLayer({
        id: 'lots',
        type: 'circle',
        source: 'lots',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'used'], 1], 9, ['==', ['get', 'cand'], 1], 6, ['==', ['get', 'street'], 1], 2.5, 4],
          'circle-color': ['match', ['get', 'tier'], 0, '#dc2626', 1, '#d97706', '#16a34a'],
          'circle-opacity': ['case', ['==', ['get', 'cand'], 1], 1, 0.55],
          'circle-stroke-width': ['case', ['==', ['get', 'used'], 1], 3, ['==', ['get', 'street'], 1], 0, 1],
          'circle-stroke-color': mode === 'dark' ? '#fafaf9' : '#1c1917',
        },
      })
      m.addLayer({
        id: 'lots-label',
        type: 'symbol',
        source: 'lots',
        filter: ['==', ['get', 'used'], 1],
        layout: { 'text-field': 'P', 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
      })
    } else {
      m.setPaintProperty('route-walk', 'line-color', hex.walk)
    }
  }
  useEffect(() => {
    syncLayers.current()
  }, [ready, option, result, mode])

  // Stop markers.
  useEffect(() => {
    const m = map.current
    if (!m) return
    markers.current.forEach((mk) => mk.remove())
    markers.current = []
    const seen: { lat: number; lon: number }[] = []
    plan.stops.forEach((s, i) => {
      if (!s.place) return
      if (seen.some((p) => Math.abs(p.lat - s.place!.lat) < 1e-4 && Math.abs(p.lon - s.place!.lon) < 1e-4)) return
      seen.push(s.place)
      const div = document.createElement('div')
      div.className = 'stop-marker'
      div.textContent = String(i + 1)
      div.setAttribute('aria-hidden', 'true')
      markers.current.push(new maplibregl.Marker({ element: div }).setLngLat([s.place.lon, s.place.lat]).addTo(m))
    })
  }, [plan.stops, ready])

  // Fit to the selected option, or to the stops.
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const pts: [number, number][] = []
    for (const l of option?.legs ?? []) for (const s of l.segments) for (const c of s.geometry ?? []) pts.push(c)
    for (const s of plan.stops) if (s.place) pts.push([s.place.lon, s.place.lat])
    if (pts.length < 2) return
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    pts.forEach((p) => b.extend(p))
    const narrow = window.matchMedia('(max-width: 899px)').matches
    m.fitBounds(b, {
      padding: narrow ? { top: 60, bottom: Math.round(window.innerHeight * 0.45), left: 30, right: 30 } : { top: 60, bottom: 60, left: 470, right: 60 },
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600,
      maxZoom: 14,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option?.id, ready, layoutKey])

  // Pick a place by clicking the map.
  useEffect(() => {
    const m = map.current
    if (!m || !picking) return
    m.getCanvas().style.cursor = 'crosshair'
    const onClick = async (e: maplibregl.MapMouseEvent) => {
      const at = { lat: e.lngLat.lat, lon: e.lngLat.lng }
      const named = await geocoder.reverse(at)
      const { updateStop, setPicking } = useApp.getState()
      updateStop(picking, { place: named ?? { ...at, name: `Pinned ${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}` } })
      setPicking(null)
    }
    m.once('click', onClick)
    return () => {
      m.off('click', onClick)
      m.getCanvas().style.cursor = ''
    }
  }, [picking])

  const pickingStop = plan.stops.find((s) => s.id === picking)
  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="region" aria-label="Map of your trip and park 'n' ride lots" />
      {pickingStop && (
        <div className="map-banner" role="status">
          Tap the map to set {pickingStop.label}
          <button type="button" className="btn small" onClick={() => useApp.getState().setPicking(null)}>
            Cancel
          </button>
        </div>
      )}
      {lotPopup && !pickingStop && (
        <div className="map-banner lot-pop" role="status">
          <span>
            <strong>{lotPopup.name}</strong> · usually full by {lotPopup.fills}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setLotPopup(null)}>
            ×
          </button>
        </div>
      )}
      <div className="map-key" aria-hidden="true">
        <span>
          <i style={{ background: '#dc2626' }} />
          full before 7:20
        </span>
        <span>
          <i style={{ background: '#d97706' }} />
          by 7:50
        </span>
        <span>
          <i style={{ background: '#16a34a' }} />
          later
        </span>
        <span>
          <i className="small-dot" />
          small dots: street or other parking
        </span>
      </div>
    </div>
  )
}
