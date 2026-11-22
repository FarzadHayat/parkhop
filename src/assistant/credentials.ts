// The assistant key you type into Settings. It lives only in this browser and
// is sent to your own ParkHop server with each question, which passes it on to
// the provider and keeps nothing.
import { OPENAI_PROVIDERS } from './openai-compat'

export type ProviderId = (typeof OPENAI_PROVIDERS)[number]['id'] | 'anthropic'

export interface Credentials {
  provider: ProviderId
  key: string
}

export const PROVIDER_CHOICES: { id: ProviderId; name: string; keyUrl: string }[] = [
  ...OPENAI_PROVIDERS.map((p) => ({ id: p.id, name: `${p.name} (free tier)`, keyUrl: p.keyUrl })),
  { id: 'anthropic', name: 'Claude (paid)', keyUrl: 'https://console.anthropic.com/settings/keys' },
]

const STORAGE_KEY = 'parkhop:assistant'

export function loadCredentials(): Credentials | null {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Credentials | null
    if (c && typeof c.key === 'string' && c.key && PROVIDER_CHOICES.some((p) => p.id === c.provider)) return c
  } catch {
    /* storage unavailable or corrupt */
  }
  return null
}

export function saveCredentials(c: Credentials | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable: the key just won't be remembered */
  }
}
