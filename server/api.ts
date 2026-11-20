// Small server side for ParkHop, mounted into Vite (dev and preview).
// - /api/assistant: holds the Anthropic key and forwards one assistant turn.
// - /api/transitous/*, /api/osrm/*: caching proxies, so repeat plans are
//   instant, the public servers see few requests, and a demo survives a
//   flaky network by serving the last good answer.
// - /api/tanda/*: forwards Tanda API calls with the person's own token
//   (Tanda does not allow browser calls from other sites).
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { ASSISTANT_MODEL, SYSTEM_PROMPT, TOOLS } from '../src/assistant/definitions'

const USER_AGENT = 'ParkHop/0.2 (open-source commute planner, hackathon prototype)'
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

// ---------- Tanda ----------

async function proxyTanda(req: IncomingMessage, res: ServerResponse) {
  const token = req.headers['x-tanda-token']
  if (typeof token !== 'string' || !token) return send(res, 401, { error: 'Missing Tanda token' })
  const rest = req.url!.slice('/api/tanda'.length)
  // Read-only: only the endpoints ParkHop needs.
  if (!/^\/(users\/me|schedules|locations|departments|rosters\/current)(\?|$)/.test(rest)) return send(res, 403, { error: 'Endpoint not allowed' })
  try {
    const r = await fetch(`https://my.tanda.co/api/v2${rest}`, {
      headers: { authorization: `bearer ${token}`, accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    })
    send(res, r.status, await r.text())
  } catch {
    send(res, 502, { error: 'Tanda did not respond' })
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

async function assistantTurn(req: IncomingMessage, res: ServerResponse) {
  const c = anthropic()
  if (!c) return send(res, 503, { error: 'Assistant is off: set ANTHROPIC_API_KEY in .env.local and restart.' })
  let messages: Anthropic.Beta.BetaMessageParam[]
  try {
    const body = JSON.parse(await readBody(req)) as { messages?: Anthropic.Beta.BetaMessageParam[] }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 80) throw new Error('bad messages')
    messages = body.messages
  } catch {
    return send(res, 400, { error: 'Expected { messages: [...] }' })
  }
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
    if (e instanceof Anthropic.BadRequestError) return send(res, 400, { error: e.message })
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
      if (url === '/api/health') return send(res, 200, { proxy: true, assistant: anthropic() !== null })
      if (url === '/api/assistant' && req.method === 'POST') return await assistantTurn(req, res)
      if (url.startsWith('/api/tanda/') && req.method === 'GET') return await proxyTanda(req, res)
      for (const up of upstreams) if (url.startsWith(`${up.prefix}/`) && req.method === 'GET') return await proxyCached(up, req, res)
      send(res, 404, { error: 'Not found' })
    } catch (e) {
      next(e)
    }
  }
}
