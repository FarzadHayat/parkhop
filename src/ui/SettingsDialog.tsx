import { forwardRef, useId, useState } from 'react'
import { PROVIDER_CHOICES, type ProviderId } from '../assistant/credentials'
import { defaultSettings } from '../engine/planner'
import type { Settings } from '../engine/types'
import { region, useApp } from '../state/store'

type NumKey = { [K in keyof Settings]-?: Settings[K] extends number ? K : never }[keyof Settings]

const FIELDS: { key: NumKey; label: string; unit: string; step: number; min: number; max: number }[] = [
  { key: 'fuelLPer100km', label: 'Fuel use', unit: 'L/100 km', step: 0.1, min: 0, max: 30 },
  { key: 'fuelPricePerL', label: 'Fuel price', unit: '$/L', step: 0.01, min: 0, max: 5 },
  { key: 'wearPerKm', label: 'Wear and servicing', unit: '$/km', step: 0.01, min: 0, max: 1 },
  { key: 'valuePerHour', label: 'Your time is worth', unit: '$/hour', step: 1, min: 0, max: 200 },
  { key: 'parkToPlatformMin', label: 'Park and get out', unit: 'min', step: 1, min: 0, max: 20 },
  { key: 'maxWalkMin', label: 'Longest walk', unit: 'min', step: 1, min: 3, max: 30 },
]

function AssistantKey() {
  const creds = useApp((s) => s.assistantCreds)
  const server = useApp((s) => s.server)
  const setCreds = useApp((s) => s.setAssistantCreds)
  const [provider, setProvider] = useState<ProviderId>(creds?.provider ?? 'gemini')
  const [key, setKey] = useState('')
  const statusId = useId()
  const choice = PROVIDER_CHOICES.find((p) => p.id === provider)!
  const save = () => {
    if (!key.trim()) return
    setCreds({ provider, key: key.trim() })
    setKey('')
  }
  const saved = creds && PROVIDER_CHOICES.find((p) => p.id === creds.provider)!.name
  return (
    <section className="about" aria-labelledby="assistant-heading">
      <h3 id="assistant-heading">Assistant</h3>
      <p className="fine" id={statusId} aria-live="polite">
        {!server.up
          ? 'The assistant needs the ParkHop server, which is not running here.'
          : creds
            ? `On, using your ${saved} key saved in this browser.`
            : server.assistant
              ? 'On, using the key set on the server. Add your own below to override it.'
              : 'Off. Add a key to turn it on.'}
      </p>
      <div className="settings-grid">
        <label className="setting">
          <span>Provider</span>
          <span className="setting-input">
            <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {PROVIDER_CHOICES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="setting">
          <span>API key</span>
          <span className="setting-input">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={creds?.provider === provider ? 'Saved (paste to replace)' : 'Paste key'}
              aria-describedby={statusId}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
            />
          </span>
        </label>
      </div>
      <div className="key-actions">
        <button type="button" className="btn small" disabled={!key.trim()} onClick={save}>
          Save key
        </button>
        {creds && (
          <button type="button" className="btn small ghost" onClick={() => setCreds(null)}>
            Remove saved key
          </button>
        )}
      </div>
      <p className="fine">
        <a href={choice.keyUrl} target="_blank" rel="noreferrer">
          Get a {choice.id === 'anthropic' ? '' : 'free '}{choice.name.split(' ')[0]} key
        </a>
        . The key stays in this browser and goes only to your ParkHop server, which passes it on to the provider and does not keep it.
      </p>
    </section>
  )
}

export const SettingsDialog = forwardRef<HTMLDialogElement>(function SettingsDialog(_, ref) {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const myParking = useApp((s) => s.myParking)
  const forgetParking = useApp((s) => s.forgetParking)
  return (
    <dialog ref={ref} className="settings" aria-labelledby="settings-title" {...({ closedby: 'any' } as object)}>
      <form method="dialog">
        <header className="dialog-head">
          <h2 id="settings-title">Settings</h2>
          <button className="btn small ghost" value="close" aria-label="Close settings">
            Done
          </button>
        </header>
        <div className="settings-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="setting">
              <span>{f.label}</span>
              <span className="setting-input">
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={settings[f.key]}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setSettings({ [f.key]: Math.min(f.max, Math.max(f.min, v)) } as Partial<Settings>)
                  }}
                />
                <span className="muted">{f.unit}</span>
              </span>
            </label>
          ))}
          <label className="setting">
            <span>Leave-by times aim for</span>
            <span className="setting-input">
              <select value={settings.onTimeTarget} onChange={(e) => setSettings({ onTimeTarget: Number(e.target.value) })}>
                <option value={0.8}>4 in 5 days on time</option>
                <option value={0.9}>9 in 10 days on time</option>
                <option value={0.95}>19 in 20 days on time</option>
              </select>
            </span>
          </label>
          <label className="setting">
            <span>Avoid toll roads</span>
            <span className="setting-input">
              <input type="checkbox" className="switch" checked={!!settings.avoidTolls} onChange={(e) => setSettings({ avoidTolls: e.target.checked })} />
            </span>
          </label>
          <label className="setting">
            <span>Leave fuel out of costs</span>
            <span className="setting-input">
              <input type="checkbox" className="switch" checked={!!settings.ignoreFuel} onChange={(e) => setSettings({ ignoreFuel: e.target.checked })} />
            </span>
          </label>
          <label className="setting">
            <span>Leave car wear out of costs</span>
            <span className="setting-input">
              <input type="checkbox" className="switch" checked={!!settings.ignoreWear} onChange={(e) => setSettings({ ignoreWear: e.target.checked })} />
            </span>
          </label>
        </div>
        <button type="button" className="btn ghost small" onClick={() => setSettings({ ...defaultSettings, priority: settings.priority })}>
          Reset to defaults
        </button>
        <section className="about">
          <h3>Your parking</h3>
          {myParking.length === 0 ? (
            <p className="fine">Set a stop's parking to "My permit" and ParkHop remembers it for that place.</p>
          ) : (
            <ul className="my-parking">
              {myParking.map((p, i) => (
                <li key={`${p.lat},${p.lon}`}>
                  <span>
                    {p.name} · {p.perDay ? `$${p.perDay}/day` : 'free'}
                  </span>
                  <button type="button" className="btn small ghost" onClick={() => forgetParking(i)} aria-label={`Forget parking permit at ${p.name}`}>
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <AssistantKey />
        <section className="about">
          <h3>Where the numbers come from</h3>
          <ul>
            <li>Timetables and live delays: Transitous (TransLink GTFS and GTFS-RT).</li>
            <li>Road routes: OSRM on OpenStreetMap (Valhalla when avoiding tolls), scaled by a typical weekday traffic profile. Not live traffic.</li>
            <li>Park 'n' ride lots: OpenStreetMap. Fill times are estimates unless you report them.</li>
            <li>Weather: Open-Meteo. Rain adds drive time and flags long walks.</li>
            <li>Fares: {region.fareNote}.</li>
          </ul>
          <p className="fine">Your stops and settings stay on this device.</p>
        </section>
      </form>
    </dialog>
  )
})
