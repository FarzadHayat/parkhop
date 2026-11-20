import { beforeAll, describe, expect, it, vi } from 'vitest'

// The agent imports the app stores, which touch browser storage and fetch at load.
const store = new Map<string, string>()
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
vi.stubGlobal('localStorage', storage)
vi.stubGlobal('sessionStorage', storage)

type Reply = { content: unknown[]; stop_reason: string }
let replies: Reply[] = []
let bodies: { messages: { role: string; content: unknown }[] }[] = []

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: { body?: string }) => {
    if (url === '/api/assistant') {
      bodies.push(JSON.parse(init!.body!))
      const next = replies.shift()!
      return new Response(JSON.stringify(next), { status: 200 })
    }
    if (url === '/api/health') return new Response(JSON.stringify({ proxy: false, assistant: true }), { status: 200 })
    return new Response('{}', { status: 404 })
  }),
)

let Conversation: typeof import('./agent').Conversation
beforeAll(async () => {
  ;({ Conversation } = await import('./agent'))
})

const hooks = { onActivity: () => {}, onShowShifts: () => {} }

describe('assistant tool loop', () => {
  it('runs tools, returns errors as tool results, and echoes assistant content unchanged', async () => {
    bodies = []
    const toolTurn = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'select_option', input: { option_id: 'nope' } },
    ]
    replies = [
      { content: toolTurn, stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Pick another one.' }], stop_reason: 'end_turn' },
    ]
    const c = new Conversation()
    const answer = await c.ask('show me option nope', hooks)
    expect(answer).toBe('Pick another one.')
    expect(bodies).toHaveLength(2)
    const second = bodies[1].messages
    // user (app state + question), assistant (echoed exactly), user (tool results)
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second[1].content).toEqual(toolTurn)
    const results = second[2].content as { type: string; tool_use_id: string; is_error?: boolean }[]
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', is_error: true })
    // The first user turn carries the app state for Claude.
    const first = bodies[0].messages[0].content as { type: string; text: string }[]
    expect(first[0].text).toContain('<app_state>')
  })

  it('handles a refusal without running tools', async () => {
    replies = [{ content: [], stop_reason: 'refusal' }]
    const c = new Conversation()
    expect(await c.ask('something odd', hooks)).toMatch(/can’t help/)
  })

  it('surfaces server errors and drops the failed question from history', async () => {
    const f = vi.mocked(fetch)
    f.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'Assistant is off' }), { status: 503 }))
    const c = new Conversation()
    await expect(c.ask('hello', hooks)).rejects.toThrow('Assistant is off')
    // A retry starts clean: one user message only.
    bodies = []
    replies = [{ content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' }]
    await c.ask('hello again', hooks)
    expect(bodies[0].messages).toHaveLength(1)
  })
})
