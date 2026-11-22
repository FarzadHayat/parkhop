// Runs the assistant's tool loop in the browser. Each turn goes through the
// ParkHop server (which holds the API key); tools run here, so the person sees
// the app change as Claude works.
import type Anthropic from '@anthropic-ai/sdk'
import { region } from '../data/seq'
import { formatHhmm } from '../engine/time'
import type { LegRule, Priority, Stop } from '../engine/types'
import { photonProvider } from '../providers/photon'
import { defaultParkingFor, newId, useApp } from '../state/store'

type Block = Anthropic.Beta.BetaContentBlock
type Msg = Anthropic.Beta.BetaMessageParam
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam

const geocoder = photonProvider(region.bounds)
const tz = region.timeZone
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/

function appState() {
  const s = useApp.getState()
  return {
    today: new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()),
    date: s.plan.date,
    stops: s.plan.stops.map((st) => ({
      label: st.label,
      place: st.place?.name ?? null,
      arrive_by: st.arriveByHhmm ?? null,
      leave_after: st.leaveAfterHhmm ?? null,
    })),
    leg_rules: s.plan.legRules,
    has_options: s.options.length > 0,
    selected_option: s.selectedId,
  }
}

interface StopInput {
  label: string
  place: string
  arrive_by: string | null
  leave_after: string | null
  stay_min: number | null
  parking: 'default' | 'none' | 'free' | 'paid' | 'permit'
  parking_per_day: number | null
}

async function setDay(input: { date: string | null; stops: StopInput[]; leg_rules: LegRule[] }) {
  if (!Array.isArray(input.stops) || input.stops.length < 2) throw new Error('Need at least two stops')
  const current = useApp.getState().plan
  const found: { label: string; place: string }[] = []
  const stops: Stop[] = []
  for (const [i, raw] of input.stops.entries()) {
    // Some providers leave out optional fields or send "" for them.
    const blank = <T,>(v: T | undefined | '') => (v === undefined || v === '' ? null : v)
    const s: StopInput = {
      ...raw,
      arrive_by: blank(raw.arrive_by),
      leave_after: blank(raw.leave_after),
      stay_min: blank(raw.stay_min),
      parking: raw.parking ?? 'default',
      parking_per_day: blank(raw.parking_per_day),
    }
    let place = null
    if (s.place.trim().toLowerCase() === 'keep') {
      const same = current.stops.find((c) => c.label.toLowerCase() === s.label.toLowerCase() && c.place)
      place = same?.place ?? (i === 0 || i === input.stops.length - 1 ? current.stops[0]?.place : null) ?? null
      if (!place) throw new Error(`No place is set for ${s.label} yet: give an address`)
    } else {
      const hits = await geocoder.search(s.place, region.centre)
      if (!hits.length) throw new Error(`Could not find "${s.place}" near Brisbane`)
      place = hits[0]
    }
    for (const t of [s.arrive_by, s.leave_after]) if (t !== null && !HHMM.test(t)) throw new Error(`Bad time "${t}", use HH:MM`)
    const middle = i > 0 && i < input.stops.length - 1
    const parking =
      s.parking === 'none'
        ? undefined
        : s.parking === 'free'
          ? { perDay: 0 }
          : s.parking === 'paid'
            ? { perDay: s.parking_per_day ?? 20 }
            : s.parking === 'permit'
              ? { perDay: s.parking_per_day ?? 0, permit: true }
              : i === 0
              ? { perDay: 0 }
              : defaultParkingFor(place)
    stops.push({
      id: newId(),
      label: s.label.slice(0, 40),
      place,
      dwellMin: s.stay_min ?? (middle ? 0 : 0),
      arriveByHhmm: i > 0 ? (s.arrive_by ?? undefined) : undefined,
      leaveAfterHhmm: i < input.stops.length - 1 ? (s.leave_after ?? undefined) : undefined,
      parking: s.stay_min !== null && s.stay_min <= 10 && middle && s.parking === 'default' ? undefined : parking,
    })
    found.push({ label: s.label, place: place.name })
  }
  const rules = stops.slice(1).map((_, i) => (['any', 'car', 'transit'].includes(input.leg_rules?.[i]) ? input.leg_rules[i] : 'any'))
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : current.date
  useApp.getState().setPlan({ date, stops, legRules: rules })
  // Remember permits the person mentioned, the same way the parking menu does.
  for (const st of stops) if (st.parking?.permit) useApp.getState().updateStop(st.id, { parking: st.parking })
  useApp.setState({ result: null, options: [], selectedId: null, stale: false, status: { kind: 'idle' } })
  return { date, stops: found }
}

function optionSummary() {
  const s = useApp.getState()
  const drive = s.options.find((o) => o.strategy === 'drive')
  return {
    options: s.options.slice(0, 6).map((o) => ({
      id: o.id,
      title: o.title,
      leave_by: formatHhmm(o.leaveBy, tz),
      cost_per_day: Number(o.costTotal.toFixed(2)),
      tolls: o.cost.tolls ? Number(o.cost.tolls.toFixed(2)) : 0,
      travel_min: Math.round(o.totalTravelMin),
      on_time_pct: Math.round(o.reliability.onTimeProb * 100),
      warnings: o.warnings
        .filter((w) => w.level !== 'info')
        .slice(0, 2)
        .map((w) => w.text),
    })),
    drive_all_the_way_cost_per_day: drive ? Number(drive.costTotal.toFixed(2)) : null,
    ruled_out: (s.result?.rejected ?? []).slice(0, 4).map((r) => r.reason),
    notes: s.result?.dataNotes ?? [],
  }
}

async function planOptions(input: { priority: Priority }) {
  const app = useApp.getState()
  if (input.priority && input.priority !== app.settings.priority) app.setSettings({ priority: input.priority })
  await useApp.getState().plan_()
  const st = useApp.getState().status
  if (st.kind === 'error') throw new Error(st.message)
  return optionSummary()
}

function selectOption(input: { option_id: string }) {
  const s = useApp.getState()
  if (!s.options.some((o) => o.id === input.option_id)) throw new Error('No option with that id')
  s.select(input.option_id)
  return { selected: input.option_id }
}

/** The key saved in Settings goes to the ParkHop server with each question. */
function keyHeaders(): Record<string, string> {
  const c = useApp.getState().assistantCreds
  return c ? { 'x-assistant-provider': c.provider, 'x-assistant-key': c.key } : {}
}

export interface AgentHooks {
  /** Tool activity to show while working, e.g. "Planning your day". */
  onActivity(text: string): void
}

const ACTIVITY: Record<string, string> = {
  set_day: 'Setting up your day',
  plan_options: 'Checking timetables and traffic',
  select_option: 'Showing the option',
}

async function runTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case 'set_day':
      return setDay(input as Parameters<typeof setDay>[0])
    case 'plan_options':
      return planOptions(input as { priority: Priority })
    case 'select_option':
      return selectOption(input as { option_id: string })
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

export class Conversation {
  private messages: Msg[] = []

  /** Send one request from the person; returns Claude's final words. */
  async ask(text: string, hooks: AgentHooks): Promise<string> {
    this.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `<app_state>${JSON.stringify(appState())}</app_state>` },
        { type: 'text', text },
      ],
    })
    for (let step = 0; step < 8; step++) {
      hooks.onActivity(step === 0 ? 'Thinking' : 'Thinking about the results')
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...keyHeaders() },
        body: JSON.stringify({ messages: this.messages }),
      })
      const body = (await r.json().catch(() => ({}))) as { content?: Block[]; stop_reason?: string; error?: string }
      if (!r.ok || !body.content) {
        this.messages.pop()
        throw new Error(body.error ?? `Assistant error ${r.status}`)
      }
      // Keep every block (including thinking) exactly as returned.
      this.messages.push({ role: 'assistant', content: body.content as Anthropic.Beta.BetaContentBlockParam[] })
      const say = body.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim()
      if (body.stop_reason === 'refusal') return 'Sorry, I can’t help with that one.'
      const uses = body.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (body.stop_reason !== 'tool_use' || !uses.length) return say || 'Done.'
      // Run tools in order (set_day must finish before plan_options), return all results together.
      const results: ToolResult[] = []
      for (const u of uses) {
        hooks.onActivity(ACTIVITY[u.name] ?? 'Working')
        try {
          const out = await runTool(u.name, u.input)
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) })
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true })
        }
      }
      this.messages.push({ role: 'user', content: results })
    }
    return 'That took too many steps. Try asking more simply.'
  }

  reset() {
    this.messages = []
  }
}
