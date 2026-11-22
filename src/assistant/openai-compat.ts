// Lets the assistant run on any provider that speaks the OpenAI chat format
// (Gemini, Groq, OpenRouter). The browser keeps one message format (Claude's
// content blocks); this file translates it on the server, so the tool loop in
// agent.ts does not care which provider answers.
// Keep this file free of browser and Node imports so it can be tested anywhere.
import type { ToolDef } from './definitions'

export interface OpenAiProvider {
  id: 'gemini' | 'groq' | 'openrouter'
  name: string
  url: string
  keyEnv: string
  /** Where to get a key. */
  keyUrl: string
  defaultModel: string
}

export const OPENAI_PROVIDERS: OpenAiProvider[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-flash-latest',
  },
  {
    id: 'groq',
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    defaultModel: 'openai/gpt-oss-120b',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    // OpenRouter's free router picks a free model that supports tool calling.
    defaultModel: 'openrouter/free',
  },
]

type Block = { type: string; [k: string]: unknown }
export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | Block[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  /** Gemini 3 asks for this to be sent back unchanged. */
  extra_content?: unknown
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const textOf = (blocks: Block[]) =>
  blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')

export function toChatMessages(system: string, messages: ClaudeMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    if (m.role === 'assistant') {
      const calls: ToolCall[] = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: String(b.id),
          type: 'function',
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
          ...(b.extra_content ? { extra_content: b.extra_content } : {}),
        }))
      out.push({ role: 'assistant', content: textOf(blocks) || null, ...(calls.length ? { tool_calls: calls } : {}) })
      continue
    }
    // Tool results must directly follow the assistant message that asked for them.
    for (const b of blocks.filter((x) => x.type === 'tool_result')) {
      const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
      out.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: b.is_error ? `Error: ${body}` : body })
    }
    const text = textOf(blocks)
    if (text) out.push({ role: 'user', content: text })
  }
  return out
}

/** Plain JSON Schema that every provider accepts: no null unions, no additionalProperties. */
export function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema)
  if (!s || typeof s !== 'object') return s
  const o = s as Record<string, unknown>
  const isNull = (x: unknown) => !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'null'
  if (Array.isArray(o.anyOf) && o.anyOf.some(isNull)) {
    const rest = o.anyOf.filter((x) => !isNull(x))
    if (rest.length === 1) {
      const { anyOf: _drop, ...others } = o
      return cleanSchema({ ...(rest[0] as object), ...others })
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (k === 'additionalProperties') continue
    out[k] = cleanSchema(v)
  }
  const props = o.properties as Record<string, unknown> | undefined
  if (props && Array.isArray(o.required)) {
    // A field that could be null becomes optional instead.
    const nullable = Object.entries(props)
      .filter(([, v]) => Array.isArray((v as { anyOf?: unknown[] }).anyOf) && (v as { anyOf: unknown[] }).anyOf.some(isNull))
      .map(([k]) => k)
    out.required = (o.required as string[]).filter((k) => !nullable.includes(k))
  }
  if (Array.isArray(out.enum) && !out.type) out.type = 'string'
  return out
}

export function toChatTools(tools: ToolDef[]) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: cleanSchema(t.input_schema) } }))
}

export interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: Partial<ToolCall>[] }; finish_reason?: string }[]
}

/** Turns a chat completion back into Claude-style content blocks. */
export function fromChatResponse(json: ChatResponse): { content: Block[]; stop_reason: string } {
  const choice = json.choices?.[0]
  const msg = choice?.message
  if (!msg) throw new Error('Empty reply from the assistant')
  const content: Block[] = []
  if (msg.content?.trim()) content.push({ type: 'text', text: msg.content.trim() })
  for (const [i, tc] of (msg.tool_calls ?? []).entries()) {
    let input: unknown = {}
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
    } catch {
      /* the tool will report the missing fields */
    }
    content.push({
      type: 'tool_use',
      id: tc.id || `call_${Date.now().toString(36)}_${i}`,
      name: tc.function?.name ?? '',
      input,
      ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
    })
  }
  const usedTools = content.some((b) => b.type === 'tool_use')
  return { content, stop_reason: usedTools ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn' }
}
