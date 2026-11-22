import { beforeAll, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('sessionStorage', storage)
// A running server with no key of its own.
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ proxy: true, assistant: false }), { status: 200 })))

let store: typeof import('./store')
beforeAll(async () => {
  store = await import('./store')
  await new Promise((r) => setTimeout(r, 0))
})

describe('assistant key from Settings', () => {
  it('turns the assistant on when you save a key, and off when you remove it', () => {
    const { useApp } = store
    expect(useApp.getState().assistantReady).toBe(false)
    useApp.getState().setAssistantCreds({ provider: 'gemini', key: 'abc' })
    expect(useApp.getState().assistantReady).toBe(true)
    expect(mem.get('parkhop:assistant')).toContain('gemini')
    useApp.getState().setAssistantCreds(null)
    expect(useApp.getState().assistantReady).toBe(false)
    expect(mem.has('parkhop:assistant')).toBe(false)
  })

  it('sends the saved key with each question', async () => {
    const { useApp } = store
    const { Conversation } = await import('../assistant/agent')
    useApp.getState().setAssistantCreds({ provider: 'groq', key: 'k-123' })
    const calls: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init)
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' }), { status: 200 })
      }),
    )
    expect(await new Conversation().ask('hello', { onActivity: () => {} })).toBe('Hi')
    expect(calls[0].headers).toMatchObject({ 'x-assistant-provider': 'groq', 'x-assistant-key': 'k-123' })
  })
})
