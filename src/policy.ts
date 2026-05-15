import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ToolCall } from './types.js'
import { hasShellMetacharacters, normalizeShellCommand } from './tools/shellTool.js'

export type PermissionPolicy = {
  allowTools?: string[]
  denyTools?: string[]
  allowShellCommands?: string[]
  denyShellCommands?: string[]
}

export async function loadPolicy(cwd: string, explicitPath?: string): Promise<PermissionPolicy> {
  const path = explicitPath ?? process.env.GXZ_POLICY ?? resolve(cwd, '.gxz-code', 'policy.json')
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as PermissionPolicy
  validatePolicy(parsed)
  return parsed
}

export function enforcePolicy(policy: PermissionPolicy, toolCall: ToolCall): void {
  if (policy.denyTools?.includes(toolCall.name)) {
    throw new Error(`Tool denied by policy: ${toolCall.name}`)
  }

  if (policy.allowTools?.length && !policy.allowTools.includes(toolCall.name)) {
    throw new Error(`Tool is not in policy allowTools: ${toolCall.name}`)
  }

  if (toolCall.name === 'run_shell') {
    const command = typeof toolCall.arguments.command === 'string' ? normalizeShellCommand(toolCall.arguments.command) : ''
    if (!command) throw new Error('Shell command policy check failed: missing command.')
    if (hasShellMetacharacters(command)) throw new Error(`Shell command contains disallowed composition syntax: ${command}`)
    if (matchesAny(command, policy.denyShellCommands)) {
      throw new Error(`Shell command denied by policy: ${command}`)
    }
    if (policy.allowShellCommands?.length && !matchesAny(command, policy.allowShellCommands)) {
      throw new Error(`Shell command is not allowed by policy: ${command}`)
    }
  }
}

function validatePolicy(policy: PermissionPolicy): void {
  for (const key of ['allowTools', 'denyTools', 'allowShellCommands', 'denyShellCommands'] as const) {
    const value = policy[key]
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
      throw new Error(`Policy field ${key} must be an array of strings.`)
    }
  }
}

function matchesAny(value: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false
  return patterns.some((pattern) => value.toLowerCase() === normalizeShellCommand(pattern).toLowerCase())
}
