/** Small seeded PRNG so simulations are repeatable (same inputs, same numbers). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Log-normal sample with the given mean and coefficient of variation. Right-skewed like real travel times. */
export function lognormal(rand: () => number, mean: number, cv: number): number {
  if (mean <= 0) return 0
  if (cv <= 0) return mean
  const s2 = Math.log(1 + cv * cv)
  const mu = Math.log(mean) - s2 / 2
  return Math.exp(mu + Math.sqrt(s2) * normal(rand))
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
