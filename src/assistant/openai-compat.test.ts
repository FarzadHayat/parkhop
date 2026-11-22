import { describe, expect, it } from 'vitest'
import { TOOLS } from './definitions'
import { cleanSchema, fromChatResponse, toChatMessages, toChatTools } from './openai-compat'

describe('openai-compat', () => {
  it('translates a tool round trip', () => {
    const msgs = toChatMessages('sys', [
      { role: 'user', content: [{ type: 'text', text: '<app_state>{}</app_state>' }, { type: 'text', text: 'plan it' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'a1', name: 'plan_options', input: { priority: 'cheapest' }, extra_content: { google: { thought_signature: 'x' } } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a1', content: '{"ok":true}' }] },
    ])
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(msgs[1].content).toBe('<app_state>{}</app_state>\nplan it')
    expect(msgs[2].tool_calls![0]).toMatchObject({ id: 'a1', function: { name: 'plan_options', arguments: '{"priority":"cheapest"}' }, extra_content: { google: { thought_signature: 'x' } } })
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'a1', content: '{"ok":true}' })
  })

  it('marks failed tool results', () => {
    const msgs = toChatMessages('s', [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'nope', is_error: true }] }])
    expect(msgs[1].content).toBe('Error: nope')
  })

  it('makes tool schemas plain: no null unions, no additionalProperties, nullable fields optional', () => {
    const tools = toChatTools(TOOLS)
    const text = JSON.stringify(tools)
    expect(text).not.toContain('"null"')
    expect(text).not.toContain('additionalProperties')
    const setDay = tools.find((t) => t.function.name === 'set_day')!.function.parameters as {
      required: string[]
      properties: { stops: { items: { required: string[]; properties: Record<string, { type?: string }> } } }
    }
    expect(setDay.required).toEqual(['stops', 'leg_rules'])
    const stop = setDay.properties.stops.items
    expect(stop.required).toEqual(['label', 'place', 'parking'])
    expect(stop.properties.arrive_by.type).toBe('string')
    expect(stop.properties.parking.type).toBe('string')
  })

  it('keeps unions with more than one real type', () => {
    expect(cleanSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
  })

  it('reads text and tool calls from a reply', () => {
    const r = fromChatResponse({
      choices: [{ finish_reason: 'tool_calls', message: { content: 'Checking', tool_calls: [{ function: { name: 'set_day', arguments: '{"a":1}' } }, { id: 'z', function: { name: 'x', arguments: 'not json' } }] } }],
    })
    expect(r.stop_reason).toBe('tool_use')
    expect(r.content[0]).toEqual({ type: 'text', text: 'Checking' })
    expect(r.content[1]).toMatchObject({ type: 'tool_use', name: 'set_day', input: { a: 1 } })
    expect(typeof r.content[1].id).toBe('string')
    expect(r.content[2]).toMatchObject({ id: 'z', input: {} })
  })

  it('ends the turn on plain text and rejects an empty reply', () => {
    expect(fromChatResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }] }).stop_reason).toBe('end_turn')
    expect(() => fromChatResponse({})).toThrow()
  })
})
