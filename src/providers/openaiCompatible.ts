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

type OpenAIProviderOptions = {
  name: ProviderName
  baseUrl: string
  apiKey?: string
  fetchImpl?: JsonFetch
}

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAIChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

export function createOpenAICompatibleProvider(options: OpenAIProviderOptions): ModelProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  return {
    name: options.name,
    async send(request: ModelRequest): Promise<ModelResponse> {
      if (!options.apiKey) {
        throw new Error(`Missing API key for provider ${options.name}. Set GLM_API_KEY/BIGMODEL_API_KEY or provider-specific key.`)
      }

      const body = {
        model: request.model,
        messages: toOpenAIMessages(request.messages),
        tools: request.tools.map(toOpenAITool),
        tool_choice: request.tools.length ? 'auto' : undefined,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: Boolean(request.stream),
      }

      if (request.stream) {
        return sendStreamingOpenAI(fetchImpl, options, body, request)
      }

      const response = await postJson<OpenAIChatResponse>(
        fetchImpl,
        joinUrl(options.baseUrl, '/chat/completions'),
        { authorization: `Bearer ${options.apiKey}` },
        body,
        request.signal,
      )

      const message = response.choices?.[0]?.message
      return {
        text: message?.content ?? '',
        toolCalls: parseToolCalls(message?.tool_calls ?? []),
        raw: response,
      }
    },
  }
}

async function sendStreamingOpenAI(
  fetchImpl: JsonFetch,
  options: OpenAIProviderOptions,
  body: Record<string, unknown>,
  request: ModelRequest,
): Promise<ModelResponse> {
  const response = await fetchImpl(joinUrl(options.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: request.signal,
  })
  const errorText = response.ok ? '' : await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${joinUrl(options.baseUrl, '/chat/completions')}: ${errorText}`)

  let text = ''
  const partialToolCalls = new Map<number, { id: string; name: string; argumentsText: string }>()
  for await (const event of streamServerSentEvents(response)) {
    const chunk = event as OpenAIChatStreamChunk
    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue
    if (delta.content) {
      text += delta.content
      request.onDelta?.({ type: 'text_delta', text: delta.content })
    }
    for (const rawToolCall of delta.tool_calls ?? []) {
      const index = rawToolCall.index ?? partialToolCalls.size
      const current = partialToolCalls.get(index) ?? {
        id: rawToolCall.id ?? `tool-${index}`,
        name: '',
        argumentsText: '',
      }
      if (rawToolCall.id) current.id = rawToolCall.id
      if (rawToolCall.function?.name) current.name += rawToolCall.function.name
      if (rawToolCall.function?.arguments) current.argumentsText += rawToolCall.function.arguments
      partialToolCalls.set(index, current)
      request.onDelta?.({
        type: 'tool_call_delta',
        id: current.id,
        name: rawToolCall.function?.name,
        argumentsDelta: rawToolCall.function?.arguments,
      })
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

function toOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      }
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        })),
      }
    }
    return {
      role: message.role,
      content: message.content,
    }
  })
}

function toOpenAITool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function parseToolCalls(rawToolCalls: NonNullable<OpenAIChatResponse['choices']>[number]['message'] extends infer M
  ? M extends { tool_calls?: infer T }
    ? NonNullable<T>
    : never
  : never): ToolCall[] {
  return rawToolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? `tool-${index}`,
    name: toolCall.function?.name ?? '',
    arguments: parseJsonObject(toolCall.function?.arguments ?? '{}'),
  })).filter((toolCall) => toolCall.name)
}

export function parseJsonObject(value: string): Record<string, unknown> {
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
