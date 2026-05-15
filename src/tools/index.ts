import type { ToolDefinition } from '../types.js'
import type { ModelProvider } from '../types.js'
import { createFileTools } from './fileTools.js'
import { createPatchTool } from './patchTool.js'
import { createSkillTool } from '../skills.js'
import { createShellTool } from './shellTool.js'
import { createDiagnosticsTool, createLspCodeActionTool } from './lspTool.js'
import { createCodeNavigationTools } from './codeNavTool.js'
import { createMcpTools } from './mcpTool.js'
import { createSubagentTool } from './subagentTool.js'
import { createTodoTool } from './todoTool.js'
import { createWebFetchTool } from './webFetchTool.js'
import { createGitHubTool } from './githubTool.js'
import { createMonitorTool } from './monitorTool.js'
import { createWorktreeTool } from './worktreeTool.js'

export function createDefaultTools(): ToolDefinition[] {
  return [
    ...createFileTools(),
    createPatchTool(),
    createTodoTool(),
    createSkillTool(),
    createDiagnosticsTool(),
    createLspCodeActionTool(),
    ...createCodeNavigationTools(),
    ...createMcpTools(),
    createGitHubTool(),
    createMonitorTool(),
    createWorktreeTool(),
    createShellTool(),
    createWebFetchTool(),
  ]
}

export function createAgentTools(options?: {
  provider: ModelProvider
  model: string
  temperature: number
  maxOutputTokens: number
}): ToolDefinition[] {
  const tools = createDefaultTools()
  if (!options) return tools
  return [
    ...tools,
    createSubagentTool({
      provider: options.provider,
      model: options.model,
      tools,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    }),
  ]
}
