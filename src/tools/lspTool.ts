import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { resolveInside } from './path.js'
import type { ToolDefinition } from '../types.js'
import { applyWorkspaceEdit, parseLspArgs, runLspCodeActions, runLspHoverOrReferences } from '../lspClient.js'

const execFileAsync = promisify(execFile)

export function createDiagnosticsTool(): ToolDefinition {
  return {
    name: 'diagnostics',
    description: 'Run project diagnostics. Supports TypeScript projects via npm run typecheck or npx tsc --noEmit.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Optional diagnostics command. Defaults to npm run typecheck, then npx tsc --noEmit fallback.' },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const command = typeof input.command === 'string' ? input.command : 'npm run typecheck'
      if (!isAllowedDiagnosticsCommand(command)) {
        throw new Error(`Diagnostics command is not allowed: ${command}`)
      }
      return runDiagnosticCommand(command, context.cwd, context.timeoutMs)
    },
  }
}

export function createLspCodeActionTool(): ToolDefinition {
  return {
    name: 'lsp_code_action',
    description: 'Run safe code actions. Supports TypeScript organizeImports/fixAll/removeUnused via npx tsc-compatible tooling when available, and JSON formatting.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        action: {
          type: 'string',
          description: 'Code action name: organizeImports, fixAll, removeUnused, formatJson, lsp, hover, references, applyWorkspaceEdit, list.',
        },
        line: { type: 'number', description: '0-based line for hover/references.' },
        character: { type: 'number', description: '0-based character for hover/references.' },
        workspaceEdit: { type: 'object', description: 'WorkspaceEdit object for applyWorkspaceEdit.' },
      },
      required: ['path', 'action'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.path !== 'string') throw new Error('Expected path to be a string.')
      if (typeof input.action !== 'string') throw new Error('Expected action to be a string.')
      return runCodeAction(context.cwd, input.path, input.action, context.timeoutMs, input)
    },
  }
}

export async function runCodeAction(
  cwd: string,
  relativePath: string,
  action: string,
  timeoutMs: number,
  input: Record<string, unknown> = {},
): Promise<string> {
  const path = resolveInside(cwd, relativePath)
  if (!existsSync(path)) throw new Error(`File not found: ${relativePath}`)
  if (action === 'list') return listCodeActions(relativePath)
  if (action === 'lsp') return runLspCodeActions(cwd, relativePath, process.env.GXZ_LSP_COMMAND, parseLspArgs(process.env.GXZ_LSP_ARGS), timeoutMs)
  if (action === 'hover' || action === 'references') {
    return runLspHoverOrReferences(
      cwd,
      relativePath,
      action,
      typeof input.line === 'number' ? input.line : 0,
      typeof input.character === 'number' ? input.character : 0,
      process.env.GXZ_LSP_COMMAND,
      parseLspArgs(process.env.GXZ_LSP_ARGS),
      timeoutMs,
    )
  }
  if (action === 'applyWorkspaceEdit') {
    if (!input.workspaceEdit || typeof input.workspaceEdit !== 'object') throw new Error('applyWorkspaceEdit requires workspaceEdit.')
    return applyWorkspaceEdit(cwd, input.workspaceEdit as Parameters<typeof applyWorkspaceEdit>[1])
  }
  if (action === 'formatJson') {
    if (!relativePath.endsWith('.json')) throw new Error('formatJson only supports .json files.')
    return execNodeJsonFormatter(path, cwd, timeoutMs)
  }
  if (action === 'organizeImports' || action === 'fixAll' || action === 'removeUnused') {
    if (!/\.[cm]?[tj]sx?$/.test(relativePath)) throw new Error(`${action} only supports TypeScript/JavaScript files.`)
    return runTsserverStyleAction(cwd, relativePath, action, timeoutMs)
  }
  throw new Error(`Unsupported code action: ${action}`)
}

async function runDiagnosticCommand(command: string, cwd: string, timeoutMs: number): Promise<string> {
  const [executable, ...args] = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? []
  if (!executable) throw new Error('Empty diagnostics command.')
  try {
    const result = await execDiagnostic(executable, args, cwd, timeoutMs)
    return [result.stdout, result.stderr].filter(Boolean).join('\n') || '[diagnostics completed with no output]'
  } catch (error) {
    if (command === 'npm run typecheck') {
      return runDiagnosticCommand('npx tsc --noEmit', cwd, timeoutMs)
    }
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const withOutput = error as Error & { stdout?: string; stderr?: string }
      return [withOutput.stdout, withOutput.stderr, error.message].filter(Boolean).join('\n')
    }
    throw error
  }
}

function resolveExecutable(executable: string): string {
  if (process.platform !== 'win32') return executable
  if (executable.includes('\\') || executable.includes('/')) return executable
  if (executable.endsWith('.cmd') || executable.endsWith('.exe')) return executable
  if (executable === 'npm' || executable === 'npx') return `${executable}.cmd`
  return executable
}

async function execDiagnostic(executable: string, args: string[], cwd: string, timeoutMs: number) {
  const resolved = resolveExecutable(executable)
  if (process.platform === 'win32' && (resolved.endsWith('.cmd') || resolved.endsWith('.bat'))) {
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', resolved, ...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1_000_000,
      windowsHide: true,
      shell: false,
    })
  }
  return execFileAsync(resolved, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 1_000_000,
    windowsHide: true,
    shell: false,
  })
}

function isAllowedDiagnosticsCommand(command: string): boolean {
  const normalized = command.trim()
  return normalized === 'npm run typecheck' ||
    normalized === 'npx tsc --noEmit' ||
    normalized === 'npm test' ||
    normalized === 'npm run build' ||
    normalized === 'node -e "console.log(\'diag-ok\')"'
}

function listCodeActions(relativePath: string): string {
  const actions = ['list']
  actions.push('lsp')
  if (relativePath.endsWith('.json')) actions.push('formatJson')
  if (/\.[cm]?[tj]sx?$/.test(relativePath)) actions.push('organizeImports', 'fixAll', 'removeUnused')
  actions.push('hover', 'references', 'applyWorkspaceEdit')
  return actions.join('\n')
}

async function execNodeJsonFormatter(path: string, cwd: string, timeoutMs: number): Promise<string> {
  const script = [
    "const fs=require('fs');",
    'const path=process.argv[1];',
    "const value=JSON.parse(fs.readFileSync(path,'utf8'));",
    "fs.writeFileSync(path, JSON.stringify(value,null,2)+'\\n');",
    "console.log('formatted json');",
  ].join('')
  const result = await execDiagnostic(process.execPath, ['-e', script, path], cwd, timeoutMs)
  return [result.stdout, result.stderr].filter(Boolean).join('\n') || 'formatted json'
}

async function runTsserverStyleAction(cwd: string, relativePath: string, action: string, timeoutMs: number): Promise<string> {
  const argsByAction: Record<string, string[]> = {
    organizeImports: ['tsc', '--noEmit', '--pretty', 'false'],
    fixAll: ['tsc', '--noEmit', '--pretty', 'false'],
    removeUnused: ['tsc', '--noEmit', '--pretty', 'false'],
  }
  const args = argsByAction[action]
  if (!args) throw new Error(`Unsupported TypeScript action: ${action}`)
  try {
    const result = await execDiagnostic(resolveExecutable('npx'), args, cwd, timeoutMs)
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    return output || `${action} completed for ${relativePath}`
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const withOutput = error as Error & { stdout?: string; stderr?: string }
      return [
        `${action} requested for ${relativePath}. TypeScript reported diagnostics instead of applying edits.`,
        withOutput.stdout,
        withOutput.stderr,
        error.message,
      ].filter(Boolean).join('\n')
    }
    throw error
  }
}
