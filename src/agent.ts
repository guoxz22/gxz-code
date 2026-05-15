import type { AgentResult, ApprovalRequest, ChatMessage, ModelProvider, ToolCall, ToolDefinition, ToolExecutionContext } from './types.js'
import { enforcePolicy, type PermissionPolicy } from './policy.js'
import { estimateUsage } from './usage.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { runHooks, type HookConfig } from './hooks.js'

export type RunAgentOptions = {
  provider: ModelProvider
  model: string
  prompt: string
  messages?: ChatMessage[]
  cwd: string
  tools: ToolDefinition[]
  allowShell: boolean
  maxTurns: number
  timeoutMs: number
  temperature: number
  maxOutputTokens: number
  policy?: PermissionPolicy
  approve?: (request: ApprovalRequest) => Promise<boolean>
  stream?: boolean
  hooks?: HookConfig
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

export type AgentEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'assistant_delta'; text: string }
  | { type: 'tool_start'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCall: ToolCall; result: string }
  | { type: 'tool_error'; toolCall: ToolCall; error: string }

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const messages: ChatMessage[] = options.messages?.length
    ? cloneMessages(options.messages)
    : [{ role: 'system', content: await buildSystemPrompt(options.cwd) }]
  messages.push({ role: 'user', content: options.prompt })
  await runHooks(options.hooks, 'UserPromptSubmit', {
    event: 'UserPromptSubmit',
    cwd: options.cwd,
    prompt: options.prompt,
  })
  const allToolCalls: ToolCall[] = []
  let finalText = ''

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    throwIfAborted(options.signal)
    const response = await options.provider.send({
      model: options.model,
      messages: cloneMessages(messages),
      tools: options.tools,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      stream: options.stream,
      signal: options.signal,
      onDelta: options.stream
        ? (event) => {
          if (event.type === 'text_delta') options.onEvent?.({ type: 'assistant_delta', text: event.text })
        }
        : undefined,
    })

    if (response.text) {
      finalText += response.text
      if (!options.stream) options.onEvent?.({ type: 'assistant_text', text: response.text })
    }

    if (!response.toolCalls.length) {
      messages.push({ role: 'assistant', content: response.text })
      return {
        text: finalText,
        turns: turn,
        toolCalls: allToolCalls,
        messages,
        usage: estimateUsage(options.provider.name, options.model, messages, finalText),
      }
    }

    messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    })

    for (const toolCall of response.toolCalls) {
      throwIfAborted(options.signal)
      allToolCalls.push(toolCall)
      if (options.policy) enforcePolicy(options.policy, toolCall)
      options.onEvent?.({ type: 'tool_start', toolCall })
      const result = await executeToolCall(toolCall, options.tools, {
        cwd: options.cwd,
        allowShell: options.allowShell,
        timeoutMs: options.timeoutMs,
        approve: options.approve,
      }, options.onEvent, options.hooks)
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: result,
      })
    }
  }

  throw new Error(`Agent stopped after maxTurns=${options.maxTurns} before the model produced a final answer.`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Agent run aborted.')
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      arguments: { ...toolCall.arguments },
    })),
  }))
}

async function executeToolCall(
  toolCall: ToolCall,
  tools: ToolDefinition[],
  context: ToolExecutionContext,
  onEvent?: (event: AgentEvent) => void,
  hooks?: HookConfig,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === toolCall.name)
  if (!tool) {
    const error = `Unknown tool: ${toolCall.name}`
    onEvent?.({ type: 'tool_error', toolCall, error })
    return error
  }

  try {
    if (context.approve) {
      const approved = await context.approve({
        toolName: tool.name,
        arguments: toolCall.arguments,
        reason: 'Model requested tool execution.',
      })
      if (!approved) return `Tool ${tool.name} was rejected by user approval.`
    }
    await runHooks(hooks, 'PreToolUse', {
      event: 'PreToolUse',
      cwd: context.cwd,
      toolName: tool.name,
      arguments: toolCall.arguments,
    })
    const result = await tool.execute(toolCall.arguments, context)
    await runHooks(hooks, 'PostToolUse', {
      event: 'PostToolUse',
      cwd: context.cwd,
      toolName: tool.name,
      arguments: toolCall.arguments,
      result,
    })
    onEvent?.({ type: 'tool_result', toolCall, result })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onEvent?.({ type: 'tool_error', toolCall, error: message })
    return `Tool ${tool.name} failed: ${message}`
  }
}
