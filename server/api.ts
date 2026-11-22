// Small server side for ParkHop, mounted into Vite (dev and preview).
// - /api/assistant: holds the AI provider key (Gemini, Groq, OpenRouter or
//   Anthropic) and forwards one assistant turn.
// - /api/transitous/*, /api/osrm/*: caching proxies, so repeat plans are
//   instant, the public servers see few requests, and a demo survives a
//   flaky network by serving the last good answer.
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { ASSISTANT_MODEL, SYSTEM_PROMPT, TOOLS } from '../src/assistant/definitions'
import { fromChatResponse, OPENAI_PROVIDERS, toChatMessages, toChatTools, type ChatResponse, type ClaudeMessage, type OpenAiProvider } from '../src/assistant/openai-compat'

const USER_AGENT = 'ParkHop/0.2 (open-source commute planner)'
const CACHE_DIR = path.resolve('.cache')

type Next = (err?: unknown) => void

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw new Error('Body too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// ---------- caching proxy ----------

interface Upstream {
  prefix: string
  origin: string
  /** Seconds a cached answer stays fresh for this request. */
  ttl(url: URL): number
}

const HOUR = 3600

const upstreams: Upstream[] = [
  {
    prefix: '/api/transitous',
    origin: 'https://api.transitous.org',
    ttl(url) {
      // Future timetables barely change; anything near now carries live delays.
      const t = Date.parse(url.searchParams.get('time') ?? '')
      if (Number.isFinite(t) && t - Date.now() > 3 * HOUR * 1000) return 24 * HOUR
      return 60
    },
  },
  { prefix: '/api/osrm', origin: 'https://router.project-osrm.org', ttl: () => 7 * 24 * HOUR },
  { prefix: '/api/valhalla', origin: 'https://valhalla1.openstreetmap.de', ttl: () => 7 * 24 * HOUR },
]

async function proxyCached(up: Upstream, req: IncomingMessage, res: ServerResponse) {
  const rest = req.url!.slice(up.prefix.length) || '/'
  const target = new URL(rest, up.origin)
  const key = createHash('sha1').update(target.toString()).digest('hex')
  const file = path.join(CACHE_DIR, up.prefix.split('/').pop()!, `${key}.json`)
  const ttl = up.ttl(target)
  let cached: string | null = null
  try {
    const s = await stat(file)
    cached = await readFile(file, 'utf8')
    if ((Date.now() - s.mtimeMs) / 1000 < ttl) return send(res, 200, cached, { 'x-cache': 'hit' })
  } catch {
    /* not cached */
  }
  try {
    const r = await fetch(target, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    const text = await r.text()
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
    return send(res, 200, text, { 'x-cache': 'miss' })
  } catch (e) {
    if (cached) return send(res, 200, cached, { 'x-cache': 'stale' })
    return send(res, 502, { error: e instanceof Error ? e.message : 'upstream failed' })
  }
}

// ---------- assistant ----------

let client: Anthropic | null = null
function anthropic(): Anthropic | null {
  if (client) return client
  // The SDK resolves credentials lazily, so check that some are configured.
  const configured = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE'].some((k) => !!process.env[k])
  if (!configured) return null
  try {
    client = new Anthropic()
    return client
  } catch {
    return null // no credentials configured
  }
}

type Backend = { kind: 'anthropic'; client: Anthropic } | { kind: 'openai'; provider: OpenAiProvider; key: string }

/** Free providers come first; ASSISTANT_PROVIDER=gemini|groq|openrouter|anthropic forces one. */
function backend(): Backend | null {
  const forced = process.env.ASSISTANT_PROVIDER?.trim().toLowerCase()
  const order = forced ? [forced] : [...OPENAI_PROVIDERS.map((p) => p.id), 'anthropic']
  for (const id of order) {
    if (id === 'anthropic') {
      const client = anthropic()
      if (client) return { kind: 'anthropic', client }
      continue
    }
    const provider = OPENAI_PROVIDERS.find((p) => p.id === id)
    const key = provider && process.env[provider.keyEnv]?.trim()
    if (provider && key) return { kind: 'openai', provider, key }
  }
  return null
}

/** A key typed into the app's Settings, sent with the question. Used first, never stored. */
function backendFromHeaders(req: IncomingMessage): Backend | null {
  const id = String(req.headers['x-assistant-provider'] ?? '').toLowerCase()
  const key = String(req.headers['x-assistant-key'] ?? '').trim()
  if (!id || !key) return null
  if (id === 'anthropic') return { kind: 'anthropic', client: new Anthropic({ apiKey: key }) }
  const provider = OPENAI_PROVIDERS.find((p) => p.id === id)
  return provider ? { kind: 'openai', provider, key } : null
}

const OFF = 'Add an assistant key in Settings to turn the assistant on.'

async function openaiTurn(b: Extract<Backend, { kind: 'openai' }>, messages: ClaudeMessage[], res: ServerResponse) {
  const { provider } = b
  let r: Response
  try {
    r = await fetch(provider.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${b.key}`, 'user-agent': USER_AGENT },
      body: JSON.stringify({
        model: process.env.ASSISTANT_MODEL?.trim() || provider.defaultModel,
        messages: toChatMessages(SYSTEM_PROMPT, messages),
        tools: toChatTools(TOOLS),
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    return send(res, 502, { error: `${provider.name} did not respond` })
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return send(res, 503, { error: `${provider.name} key rejected` })
    if (r.status === 429) return send(res, 429, { error: `${provider.name} free limit reached, try again in a minute` })
    const detail = await r.text().catch(() => '')
    let msg = ''
    try {
      // Gemini wraps its errors in an array.
      const parsed = JSON.parse(detail) as { error?: { message?: string } } | { error?: { message?: string } }[]
      msg = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message ?? ''
    } catch {
      /* not JSON */
    }
    if (/valid api key|api key not valid|invalid api key/i.test(msg)) return send(res, 503, { error: `${provider.name} key rejected` })
    return send(res, r.status >= 500 ? 502 : 400, { error: msg ? `${provider.name}: ${msg.slice(0, 200)}` : `${provider.name} error ${r.status}` })
  }
  try {
    send(res, 200, fromChatResponse((await r.json()) as ChatResponse))
  } catch (e) {
    send(res, 502, { error: e instanceof Error ? `${provider.name}: ${e.message}` : 'Assistant unavailable' })
  }
}

async function assistantTurn(req: IncomingMessage, res: ServerResponse) {
  const b = backendFromHeaders(req) ?? backend()
  if (!b) return send(res, 503, { error: OFF })
  let messages: Anthropic.Beta.BetaMessageParam[]
  try {
    const body = JSON.parse(await readBody(req)) as { messages?: Anthropic.Beta.BetaMessageParam[] }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 80) throw new Error('bad messages')
    messages = body.messages
  } catch {
    return send(res, 400, { error: 'Expected { messages: [...] }' })
  }
  if (b.kind === 'openai') return openaiTurn(b, messages as unknown as ClaudeMessage[], res)
  const c = b.client
  try {
    const response = await c.beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      // Short, chatty turns with simple tools: low effort keeps replies quick.
      output_config: { effort: 'low' },
      // If a turn is declined by a safety classifier, retry it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Cache the fixed tools + system prefix across turns.
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools: TOOLS as Anthropic.Beta.BetaTool[],
      messages,
    })
    send(res, 200, { content: response.content, stop_reason: response.stop_reason, usage: response.usage })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return send(res, 503, { error: 'Anthropic key rejected' })
    if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Assistant is busy, try again in a moment' })
    if (e instanceof Anthropic.BadRequestError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message
      return send(res, 400, { error: /credit balance/i.test(detail) ? 'The Anthropic account has no credit left. Add credit in the Anthropic Console.' : detail })
    }
    if (e instanceof Anthropic.APIError) return send(res, 502, { error: `Assistant error ${e.status ?? ''}`.trim() })
    send(res, 502, { error: 'Assistant unavailable' })
  }
}

/** Connect-style middleware for Vite's dev and preview servers. */
export function apiMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/')) return next()
    try {
      if (url === '/api/health') return send(res, 200, { proxy: true, assistant: backend() !== null })
      if (url === '/api/assistant' && req.method === 'POST') return await assistantTurn(req, res)
      for (const up of upstreams) if (url.startsWith(`${up.prefix}/`) && req.method === 'GET') return await proxyCached(up, req, res)
      send(res, 404, { error: 'Not found' })
    } catch (e) {
      next(e)
    }
  }
}
