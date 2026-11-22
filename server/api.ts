// Mounts ParkHop's API (handler.ts) into Vite's dev and preview servers,
// caching proxied answers as files under .cache.
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { handleApi, type ApiCache } from './handler'

const CACHE_DIR = path.resolve('.cache')

type Next = (err?: unknown) => void

function cacheFile(bucket: string, url: string) {
  return path.join(CACHE_DIR, bucket, `${createHash('sha1').update(url).digest('hex')}.json`)
}

const fileCache: ApiCache = {
  async get(bucket, url) {
    const file = cacheFile(bucket, url)
    try {
      const s = await stat(file)
      return { text: await readFile(file, 'utf8'), age: (Date.now() - s.mtimeMs) / 1000 }
    } catch {
      return null // not cached
    }
  },
  async put(bucket, url, text) {
    const file = cacheFile(bucket, url)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  },
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    // Node needs this to stream a request body.
    duplex: hasBody ? 'half' : undefined,
  })
}

/** Connect-style middleware for Vite's dev and preview servers. */
export function apiMiddleware() {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (!(req.url ?? '').startsWith('/api/')) return next()
    try {
      const r = await handleApi(toRequest(req), process.env, fileCache)
      if (!r) return next()
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      next(e)
    }
  }
}
