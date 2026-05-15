import type { ChatMessage, ModelProvider, ToolDefinition } from './types.js'
import { loadWorkspaceInstructions } from './workspaceInstructions.js'
import { listSkills } from './skills.js'

export async function compactMessages(options: {
  provider: ModelProvider
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  maxOutputTokens: number
  temperature: number
  cwd?: string
}): Promise<ChatMessage[]> {
  if (options.messages.length <= 3) return options.messages
  const transcript = options.messages
    .map((message) => {
      const toolCalls = message.toolCalls?.length
        ? `\nTool calls: ${message.toolCalls.map((toolCall) => `${toolCall.id}:${toolCall.name} ${JSON.stringify(toolCall.arguments)}`).join('; ')}`
        : ''
      const toolResult = message.toolCallId ? `\nTool result for: ${message.toolCallId}` : ''
      return `${message.role}: ${message.content}${toolCalls}${toolResult}`
    })
    .join('\n\n')
  const response = await options.provider.send({
    model: options.model,
    tools: [],
    temperature: options.temperature,
    maxOutputTokens: Math.min(options.maxOutputTokens, 2000),
    messages: [
      {
        role: 'system',
        content: 'Summarize this coding-agent transcript into durable context. Preserve goals, decisions, files changed, tests, blockers, and user preferences. Do not invent facts.',
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
  })

  const instructions = options.cwd ? await loadWorkspaceInstructions(options.cwd) : []
  const skills = options.cwd ? await listSkills(options.cwd) : []
  const base = [
    'You are GXZ-code, a GLM-first coding agent CLI.',
    options.cwd ? `Workspace root: ${options.cwd}` : undefined,
    instructions.length ? `Workspace instructions:\n${instructions.join('\n\n---\n\n')}` : undefined,
    skills.length ? `Available local skills:\n${skills.map((skill) => `- ${skill.name}: ${skill.description ?? 'No description'}`).join('\n')}` : undefined,
    'The previous conversation was compacted. Continue from this summary:',
    response.text,
  ].filter(Boolean).join('\n\n')

  return [
    {
      role: 'system',
      content: base,
    },
  ]
}
