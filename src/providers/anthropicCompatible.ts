import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderName,
  ToolCall,
  ToolDefinition,
} from '../types.js'
import { joinUrl, postJson, streamServerSentEvents, type JsonFetch } from './http.js'

type AnthropicProviderOptions = {
  name: ProviderName
  baseUrl: string
  apiKey?: string
  fetchImpl?: JsonFetch
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[]
}

type AnthropicStreamEvent =
  | { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type?: string; text?: string; partial_json?: string } }
  | { type: 'message_stop' }

export function createAnthropicCompatibleProvider(options: AnthropicProviderOptions): ModelProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    name: options.name,
    async send(request: ModelRequest): Promise<ModelResponse> {
      if (!options.apiKey) {
        throw new Error(`Missing API key for provider ${options.name}. Set GLM_API_KEY/BIGMODEL_API_KEY or provider-specific key.`)
      }

      const { system, messages } = toAnthropicMessages(request.messages)
      const body = {
        model: request.model,
        system,
        messages,
        tools: request.tools.map(toAnthropicTool),
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        stream: Boolean(request.stream),
      }

      if (request.stream) {
        return sendStreamingAnthropic(fetchImpl, options, body, request)
      }

      const response = await postJson<AnthropicMessageResponse>(
        fetchImpl,
        joinUrl(options.baseUrl, '/v1/messages'),
        {
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
        request.signal,
      )

      return parseAnthropicResponse(response)
    },
  }
}

async function sendStreamingAnthropic(
  fetchImpl: JsonFetch,
  options: AnthropicProviderOptions,
  body: Record<string, unknown>,
  request: ModelRequest,
): Promise<ModelResponse> {
  const response = await fetchImpl(joinUrl(options.baseUrl, '/v1/messages'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: request.signal,
  })
  const errorText = response.ok ? '' : await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${joinUrl(options.baseUrl, '/v1/messages')}: ${errorText}`)

  let text = ''
  const partialToolCalls = new Map<number, { id: string; name: string; argumentsText: string }>()
  for await (const rawEvent of streamServerSentEvents(response)) {
    const event = rawEvent as AnthropicStreamEvent
    if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
      partialToolCalls.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        argumentsText: JSON.stringify(event.content_block.input ?? {}),
      })
    }
    if (event.type !== 'content_block_delta') continue
    if (event.delta.text) {
      text += event.delta.text
      request.onDelta?.({ type: 'text_delta', text: event.delta.text })
    }
    if (event.delta.partial_json !== undefined) {
      const current = partialToolCalls.get(event.index) ?? { id: `tool-${event.index}`, name: '', argumentsText: '' }
      current.argumentsText += event.delta.partial_json
      partialToolCalls.set(event.index, current)
      request.onDelta?.({ type: 'tool_call_delta', id: current.id, argumentsDelta: event.delta.partial_json })
    }
  }
  request.onDelta?.({ type: 'done' })
  return {
    text,
    toolCalls: [...partialToolCalls.values()]
      .filter((toolCall) => toolCall.name)
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        arguments: parseJsonObject(toolCall.argumentsText || '{}'),
      })),
  }
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string
  messages: Array<Record<string, unknown>>
} {
  const systemParts: string[] = []
  const output: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }

    if (message.role === 'tool') {
      output.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      })
      continue
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: AnthropicContentBlock[] = []
      if (message.content) content.push({ type: 'text', text: message.content })
      for (const toolCall of message.toolCalls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        })
      }
      output.push({ role: 'assistant', content })
      continue
    }

    output.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    })
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: output,
  }
}

function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }
}

function parseAnthropicResponse(response: AnthropicMessageResponse): ModelResponse {
  const blocks = response.content ?? []
  const text = blocks
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('')
  const toolCalls: ToolCall[] = blocks
    .filter((block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input ?? {},
    }))

  return { text, toolCalls, raw: response }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool-call arguments must be a JSON object.')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`Malformed tool-call arguments JSON: ${value}`)
  }
}
