import type { ModelProvider, ToolDefinition } from '../types.js'
import { runAgent } from '../agent.js'

export function createSubagentTool(options: {
  provider: ModelProvider
  model: string
  tools: ToolDefinition[]
  temperature: number
  maxOutputTokens: number
}): ToolDefinition {
  return {
    name: 'subagent',
    description: 'Run a bounded read-mostly subagent for focused analysis. The subagent receives the same workspace and safe tool set.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Focused subtask prompt.' },
        maxTurns: { type: 'number', description: 'Maximum subagent turns. Default 4.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.prompt !== 'string') throw new Error('Expected prompt to be a string.')
      const maxTurns = typeof input.maxTurns === 'number' ? Math.max(1, Math.min(input.maxTurns, 8)) : 4
      const tools = options.tools.filter((tool) => tool.name !== 'subagent' && tool.name !== 'write_file' && tool.name !== 'edit_file')
      const result = await runAgent({
        provider: options.provider,
        model: options.model,
        prompt: input.prompt,
        cwd: context.cwd,
        tools,
        allowShell: false,
        maxTurns,
        timeoutMs: context.timeoutMs,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      })
      return result.text || '[subagent completed with no text response]'
    },
  }
}
