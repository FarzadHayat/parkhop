// ParkHop's small API, written against the Fetch API so it runs in both
// Vite (dev and preview, see api.ts) and Cloudflare Pages Functions
// (see functions/api/[[path]].ts).
// - /api/assistant: holds the AI provider key (Gemini, Groq, OpenRouter or
//   Anthropic) and forwards one assistant turn.
// - /api/transitous/*, /api/osrm/*, /api/valhalla/*: caching proxies, so
//   repeat plans are instant, the public servers see few requests, and a demo
//   survives a flaky network by serving the last good answer.
import Anthropic from '@anthropic-ai/sdk'
import { ASSISTANT_MODEL, SYSTEM_PROMPT, TOOLS } from '../src/assistant/definitions'
import { fromChatResponse, OPENAI_PROVIDERS, toChatMessages, toChatTools, type ChatResponse, type ClaudeMessage, type OpenAiProvider } from '../src/assistant/openai-compat'

const USER_AGENT = 'ParkHop/0.2 (open-source commute planner)'

/** Server settings: provider keys and assistant overrides. */
export type ApiEnv = Record<string, string | undefined>

/** Where proxied answers are kept. `age` is in seconds. */
export interface ApiCache {
  get(bucket: string, url: string): Promise<{ text: string; age: number } | null>
  put(bucket: string, url: string, text: string): Promise<void>
}

function send(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
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

async function proxyCached(up: Upstream, pathAndQuery: string, cache: ApiCache): Promise<Response> {
  const rest = pathAndQuery.slice(up.prefix.length) || '/'
  const target = new URL(rest, up.origin)
  const bucket = up.prefix.split('/').pop()!
  const ttl = up.ttl(target)
  const cached = await cache.get(bucket, target.toString()).catch(() => null)
  if (cached && cached.age < ttl) return send(200, cached.text, { 'x-cache': 'hit' })
  try {
    const r = await fetch(target, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    const text = await r.text()
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    await cache.put(bucket, target.toString(), text).catch(() => {})
    return send(200, text, { 'x-cache': 'miss' })
  } catch (e) {
    if (cached) return send(200, cached.text, { 'x-cache': 'stale' })
    return send(502, { error: e instanceof Error ? e.message : 'upstream failed' })
  }
}

// ---------- assistant ----------

type Backend = { kind: 'anthropic'; client: Anthropic } | { kind: 'openai'; provider: OpenAiProvider; key: string }

function anthropic(env: ApiEnv): Anthropic | null {
  // The SDK resolves credentials lazily, so check that some are configured.
  if (env.ANTHROPIC_API_KEY) return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  // Token and profile logins only exist under Node, where the SDK reads them from process.env.
  if (!env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_PROFILE) return null
  try {
    return new Anthropic()
  } catch {
    return null // no credentials configured
  }
}

/** Free providers come first; ASSISTANT_PROVIDER=gemini|groq|openrouter|anthropic forces one. */
function backend(env: ApiEnv): Backend | null {
  const forced = env.ASSISTANT_PROVIDER?.trim().toLowerCase()
  const order = forced ? [forced] : [...OPENAI_PROVIDERS.map((p) => p.id), 'anthropic']
  for (const id of order) {
    if (id === 'anthropic') {
      const client = anthropic(env)
      if (client) return { kind: 'anthropic', client }
      continue
    }
    const provider = OPENAI_PROVIDERS.find((p) => p.id === id)
    const key = provider && env[provider.keyEnv]?.trim()
    if (provider && key) return { kind: 'openai', provider, key }
  }
  return null
}

/** A key typed into the app's Settings, sent with the question. Used first, never stored. */
function backendFromHeaders(req: Request): Backend | null {
  const id = (req.headers.get('x-assistant-provider') ?? '').toLowerCase()
  const key = (req.headers.get('x-assistant-key') ?? '').trim()
  if (!id || !key) return null
  if (id === 'anthropic') return { kind: 'anthropic', client: new Anthropic({ apiKey: key }) }
  const provider = OPENAI_PROVIDERS.find((p) => p.id === id)
  return provider ? { kind: 'openai', provider, key } : null
}

const OFF = 'Add an assistant key in Settings to turn the assistant on.'

async function openaiTurn(b: Extract<Backend, { kind: 'openai' }>, messages: ClaudeMessage[], env: ApiEnv): Promise<Response> {
  const { provider } = b
  let r: Response
  try {
    r = await fetch(provider.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${b.key}`, 'user-agent': USER_AGENT },
      body: JSON.stringify({
        model: env.ASSISTANT_MODEL?.trim() || provider.defaultModel,
        messages: toChatMessages(SYSTEM_PROMPT, messages),
        tools: toChatTools(TOOLS),
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    return send(502, { error: `${provider.name} did not respond` })
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return send(503, { error: `${provider.name} key rejected` })
    if (r.status === 429) return send(429, { error: `${provider.name} free limit reached, try again in a minute` })
    const detail = await r.text().catch(() => '')
    let msg = ''
    try {
      // Gemini wraps its errors in an array.
      const parsed = JSON.parse(detail) as { error?: { message?: string } } | { error?: { message?: string } }[]
      msg = (Array.isArray(parsed) ? parsed[0] : parsed)?.error?.message ?? ''
    } catch {
      /* not JSON */
    }
    if (/valid api key|api key not valid|invalid api key/i.test(msg)) return send(503, { error: `${provider.name} key rejected` })
    return send(r.status >= 500 ? 502 : 400, { error: msg ? `${provider.name}: ${msg.slice(0, 200)}` : `${provider.name} error ${r.status}` })
  }
  try {
    return send(200, fromChatResponse((await r.json()) as ChatResponse))
  } catch (e) {
    return send(502, { error: e instanceof Error ? `${provider.name}: ${e.message}` : 'Assistant unavailable' })
  }
}

async function assistantTurn(req: Request, env: ApiEnv): Promise<Response> {
  const b = backendFromHeaders(req) ?? backend(env)
  if (!b) return send(503, { error: OFF })
  let messages: Anthropic.Beta.BetaMessageParam[]
  try {
    const raw = await req.text()
    if (raw.length > 2_000_000) throw new Error('Body too large')
    const body = JSON.parse(raw) as { messages?: Anthropic.Beta.BetaMessageParam[] }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 80) throw new Error('bad messages')
    messages = body.messages
  } catch {
    return send(400, { error: 'Expected { messages: [...] }' })
  }
  if (b.kind === 'openai') return openaiTurn(b, messages as unknown as ClaudeMessage[], env)
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
    return send(200, { content: response.content, stop_reason: response.stop_reason, usage: response.usage })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return send(503, { error: 'Anthropic key rejected' })
    if (e instanceof Anthropic.RateLimitError) return send(429, { error: 'Assistant is busy, try again in a moment' })
    if (e instanceof Anthropic.BadRequestError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message ?? e.message
      return send(400, { error: /credit balance/i.test(detail) ? 'The Anthropic account has no credit left. Add credit in the Anthropic Console.' : detail })
    }
    if (e instanceof Anthropic.APIError) return send(502, { error: `Assistant error ${e.status ?? ''}`.trim() })
    return send(502, { error: 'Assistant unavailable' })
  }
}

/** Answers an /api/* request, or returns null for anything else. */
export async function handleApi(req: Request, env: ApiEnv, cache: ApiCache): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/')) return null
  const pathAndQuery = url.pathname + url.search
  if (pathAndQuery === '/api/health') return send(200, { proxy: true, assistant: backend(env) !== null })
  if (pathAndQuery === '/api/assistant' && req.method === 'POST') return assistantTurn(req, env)
  for (const up of upstreams) if (url.pathname.startsWith(`${up.prefix}/`) && req.method === 'GET') return proxyCached(up, pathAndQuery, cache)
  return send(404, { error: 'Not found' })
}
