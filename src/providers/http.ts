/** fetch JSON with a timeout and a small retry for overloaded public servers. */
export async function getJson<T>(url: string, init: RequestInit & { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 1, ...rest } = init
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const onAbort = () => ctrl.abort()
    rest.signal?.addEventListener('abort', onAbort)
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      if (rest.signal?.aborted) throw e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
      rest.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw lastErr
}

/** Run at most `n` promises at a time. */
export function limiter(n: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((r) => queue.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

/** Memoise an async function by key, sharing in-flight requests. Failures are not cached. */
export function memoAsync<A extends unknown[], T>(fn: (...a: A) => Promise<T>, key: (...a: A) => string) {
  const cache = new Map<string, Promise<T>>()
  return (...a: A): Promise<T> => {
    const k = key(...a)
    const hit = cache.get(k)
    if (hit) return hit
    const p = fn(...a).catch((e) => {
      cache.delete(k)
      throw e
    })
    cache.set(k, p)
    return p
  }
}
