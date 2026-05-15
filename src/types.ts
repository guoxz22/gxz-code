export type ProviderName = 'glm-openai' | 'glm-anthropic' | 'openai' | 'anthropic'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ChatMessage = {
  role: ChatRole
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export type ToolJsonSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type ToolDefinition = {
  name: string
  description: string
  parameters: ToolJsonSchema
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<string>
}

export type ToolExecutionContext = {
  cwd: string
  allowShell: boolean
  timeoutMs: number
  approve?: (request: ApprovalRequest) => Promise<boolean>
}

export type ApprovalRequest = {
  toolName: string
  arguments: Record<string, unknown>
  reason: string
}

export type ModelRequest = {
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  temperature?: number
  maxOutputTokens?: number
  stream?: boolean
  signal?: AbortSignal
  onDelta?: (event: ModelStreamEvent) => void
}

export type ModelResponse = {
  text: string
  toolCalls: ToolCall[]
  raw?: unknown
}

export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; id: string; name?: string; argumentsDelta?: string }
  | { type: 'done' }

export type ModelProvider = {
  name: ProviderName
  send(request: ModelRequest): Promise<ModelResponse>
}

export type AgentResult = {
  text: string
  turns: number
  toolCalls: ToolCall[]
  messages: ChatMessage[]
  usage?: UsageRecord
}

export type UsageRecord = {
  provider: ProviderName
  model: string
  inputTokensApprox: number
  outputTokensApprox: number
  estimatedCostUsd: number
}

export type TeamRole = 'explore' | 'planner' | 'executor' | 'verifier' | 'reviewer'

export type TeamTask = {
  id: string
  role: TeamRole
  prompt: string
  dependsOn?: string[]
  maxTurns?: number
  writeScope?: string[]
}

export type TeamResult = {
  task: TeamTask
  status: 'completed' | 'failed' | 'skipped'
  text: string
  error?: string
}

export type SessionRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  cwd: string
  provider: ProviderName
  model: string
  messages: ChatMessage[]
}
