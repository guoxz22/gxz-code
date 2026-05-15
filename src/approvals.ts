import { createInterface } from 'node:readline/promises'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import type { ApprovalRequest } from './types.js'
import { normalizeShellCommand } from './tools/shellTool.js'

export type ApprovalMemory = {
  allowTools?: string[]
  denyTools?: string[]
  allowShellCommands?: string[]
  denyShellCommands?: string[]
}

export async function askApproval(request: ApprovalRequest): Promise<boolean> {
  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(
      `Approve ${request.toolName}? ${request.reason}\n${JSON.stringify(request.arguments, null, 2)}\n[y/N] `,
    )
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

export async function loadApprovalMemory(cwd: string): Promise<ApprovalMemory> {
  const path = approvalMemoryPath(cwd)
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ApprovalMemory
  return normalizeApprovalMemory(parsed)
}

export async function saveApprovalMemory(cwd: string, memory: ApprovalMemory): Promise<void> {
  const path = approvalMemoryPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalizeApprovalMemory(memory), null, 2)}\n`, 'utf8')
}

export async function rememberApproval(
  cwd: string,
  request: ApprovalRequest,
  decision: 'allow' | 'deny',
): Promise<void> {
  const memory = await loadApprovalMemory(cwd)
  const toolList = decision === 'allow' ? 'allowTools' : 'denyTools'
  const shellList = decision === 'allow' ? 'allowShellCommands' : 'denyShellCommands'
  addUnique(memory, toolList, request.toolName)
  const shellCommand = shellCommandFromApproval(request)
  if (shellCommand) addUnique(memory, shellList, shellCommand)
  await saveApprovalMemory(cwd, memory)
}

export async function clearApprovalMemory(cwd: string): Promise<void> {
  await saveApprovalMemory(cwd, {})
}

export async function approvalDecisionFromMemory(
  cwd: string,
  request: ApprovalRequest,
): Promise<boolean | undefined> {
  const memory = await loadApprovalMemory(cwd)
  const shellCommand = shellCommandFromApproval(request)
  if (memory.denyTools?.includes(request.toolName)) return false
  if (shellCommand && memory.denyShellCommands?.includes(shellCommand)) return false
  if (memory.allowTools?.includes(request.toolName)) return true
  if (shellCommand && memory.allowShellCommands?.includes(shellCommand)) return true
  return undefined
}

export function renderApprovalMemory(memory: ApprovalMemory): string {
  const normalized = normalizeApprovalMemory(memory)
  return [
    'Approval memory:',
    `  allowTools: ${normalized.allowTools?.join(', ') || '-'}`,
    `  denyTools: ${normalized.denyTools?.join(', ') || '-'}`,
    `  allowShellCommands: ${normalized.allowShellCommands?.join('; ') || '-'}`,
    `  denyShellCommands: ${normalized.denyShellCommands?.join('; ') || '-'}`,
  ].join('\n')
}

export function isRiskyTool(toolName: string): boolean {
  return [
    'write_file',
    'edit_file',
    'patch_file',
    'run_shell',
    'web_fetch',
    'github',
    'monitor',
    'worktree',
    'mcp_call_tool',
    'mcp_read_resource',
    'mcp_get_prompt',
    'lsp_code_action',
    'subagent',
  ].includes(toolName)
}

function approvalMemoryPath(cwd: string): string {
  return resolve(cwd, '.gxz-code', 'approvals.json')
}

function normalizeApprovalMemory(memory: ApprovalMemory): ApprovalMemory {
  const normalized: ApprovalMemory = {}
  const allowTools = sortedUnique(memory.allowTools)
  const denyTools = sortedUnique(memory.denyTools)
  const allowShellCommands = sortedUnique(memory.allowShellCommands?.map(normalizeShellCommand))
  const denyShellCommands = sortedUnique(memory.denyShellCommands?.map(normalizeShellCommand))
  if (allowTools) normalized.allowTools = allowTools
  if (denyTools) normalized.denyTools = denyTools
  if (allowShellCommands) normalized.allowShellCommands = allowShellCommands
  if (denyShellCommands) normalized.denyShellCommands = denyShellCommands
  return normalized
}

function sortedUnique(values: string[] | undefined): string[] | undefined {
  const output = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
  return output.length ? output : undefined
}

function addUnique(memory: ApprovalMemory, key: keyof ApprovalMemory, value: string): void {
  const next = new Set(memory[key] ?? [])
  next.add(value)
  memory[key] = [...next]
}

function shellCommandFromApproval(request: ApprovalRequest): string | undefined {
  if (request.toolName !== 'run_shell') return undefined
  return typeof request.arguments.command === 'string' ? normalizeShellCommand(request.arguments.command) : undefined
}
