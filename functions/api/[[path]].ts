// Cloudflare Pages Function: serves ParkHop's API (server/handler.ts) on the
// deployed site. Proxied answers are kept in Cloudflare's edge cache.
import { handleApi, type ApiCache, type ApiEnv } from '../../server/handler'

// The Workers cache, which plain Node types do not describe.
interface EdgeCache {
  match(key: string): Promise<Response | undefined>
  put(key: string, res: Response): Promise<void>
}
declare const caches: { default: EdgeCache }

interface Context {
  request: Request
  env: ApiEnv
  waitUntil(p: Promise<unknown>): void
}

// Keep entries a week so a stale answer can still cover an upstream outage.
const KEEP_SECONDS = 7 * 24 * 3600

function edgeCache(waitUntil: Context['waitUntil']): ApiCache {
  const key = (bucket: string, url: string) => `https://parkhop-cache.internal/${bucket}?u=${encodeURIComponent(url)}`
  return {
    async get(bucket, url) {
      const hit = await caches.default.match(key(bucket, url))
      if (!hit) return null
      const stored = Number(hit.headers.get('x-stored-at'))
      return { text: await hit.text(), age: Number.isFinite(stored) ? (Date.now() - stored) / 1000 : Infinity }
    },
    async put(bucket, url, text) {
      const res = new Response(text, {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_SECONDS}`, 'x-stored-at': String(Date.now()) },
      })
      waitUntil(caches.default.put(key(bucket, url), res))
    },
  }
}

export async function onRequest(ctx: Context): Promise<Response> {
  const res = await handleApi(ctx.request, ctx.env, edgeCache((p) => ctx.waitUntil(p)))
  return res ?? new Response('Not found', { status: 404 })
}
