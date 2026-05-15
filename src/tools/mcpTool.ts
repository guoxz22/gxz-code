import type { ToolDefinition } from '../types.js'
import { callMcpTool, getMcpPrompt, McpClientPool, readMcpResource } from '../mcp.js'

export function createMcpTools(): ToolDefinition[] {
  const pools = new Map<string, McpClientPool>()
  const poolFor = (cwd: string): McpClientPool => {
    const existing = pools.get(cwd)
    if (existing) return existing
    const pool = new McpClientPool(cwd)
    pools.set(cwd, pool)
    return pool
  }
  return [
    createMcpCallTool(poolFor),
    createMcpReadResourceTool(poolFor),
    createMcpGetPromptTool(poolFor),
  ]
}

export function createMcpTool(): ToolDefinition {
  const pools = new Map<string, McpClientPool>()
  const poolFor = (cwd: string): McpClientPool => {
    const existing = pools.get(cwd)
    if (existing) return existing
    const pool = new McpClientPool(cwd)
    pools.set(cwd, pool)
    return pool
  }
  return createMcpCallTool(poolFor)
}

function createMcpCallTool(poolFor: (cwd: string) => McpClientPool): ToolDefinition {
  return {
    name: 'mcp_call_tool',
    description: 'Call a configured MCP server tool from .gxz-code/mcp.json.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Configured MCP server name.' },
        tool: { type: 'string', description: 'MCP tool name.' },
        arguments: { type: 'object', description: 'MCP tool arguments.' },
      },
      required: ['server', 'tool'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.server !== 'string') throw new Error('Expected server to be a string.')
      if (typeof input.tool !== 'string') throw new Error('Expected tool to be a string.')
      const args = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
        ? input.arguments as Record<string, unknown>
        : {}
      return callMcpTool(context.cwd, input.server, input.tool, args, poolFor(context.cwd))
    },
  }
}

function createMcpReadResourceTool(poolFor: (cwd: string) => McpClientPool): ToolDefinition {
  return {
    name: 'mcp_read_resource',
    description: 'Read a resource from a configured MCP server.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Configured MCP server name.' },
        uri: { type: 'string', description: 'MCP resource URI.' },
      },
      required: ['server', 'uri'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.server !== 'string') throw new Error('Expected server to be a string.')
      if (typeof input.uri !== 'string') throw new Error('Expected uri to be a string.')
      return readMcpResource(context.cwd, input.server, input.uri, poolFor(context.cwd))
    },
  }
}

function createMcpGetPromptTool(poolFor: (cwd: string) => McpClientPool): ToolDefinition {
  return {
    name: 'mcp_get_prompt',
    description: 'Get a prompt from a configured MCP server.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Configured MCP server name.' },
        prompt: { type: 'string', description: 'MCP prompt name.' },
        arguments: { type: 'object', description: 'Prompt arguments.' },
      },
      required: ['server', 'prompt'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.server !== 'string') throw new Error('Expected server to be a string.')
      if (typeof input.prompt !== 'string') throw new Error('Expected prompt to be a string.')
      const args = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
        ? input.arguments as Record<string, unknown>
        : {}
      return getMcpPrompt(context.cwd, input.server, input.prompt, args, poolFor(context.cwd))
    },
  }
}
