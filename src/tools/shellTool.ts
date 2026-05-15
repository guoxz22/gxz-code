import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolDefinition } from '../types.js'

const execFileAsync = promisify(execFile)

type ParsedCommand = {
  executable: string
  args: string[]
  normalized: string
}

const READ_ONLY_EXECUTABLES = new Set([
  'dir',
  'ls',
  'pwd',
  'cd',
  'echo',
  'type',
  'cat',
  'get-childitem',
  'get-content',
  'select-string',
  'rg',
  'findstr',
])

const READ_ONLY_SUBCOMMANDS = new Map<string, Set<string>>([
  ['git', new Set(['status', 'diff', 'log', 'show'])],
  ['npm', new Set(['test'])],
  ['node', new Set(['--test'])],
])

const READ_ONLY_MULTI_ARG_PREFIXES = [
  ['npm', 'run', 'build'],
  ['npm', 'run', 'typecheck'],
]

const SHELL_METACHAR_PATTERN = /[;&|<>`$()\r\n]/

export function createShellTool(): ToolDefinition {
  return {
    name: 'run_shell',
    description: 'Run a shell command in the workspace. Write-like commands require the CLI --allow-shell flag.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run.' },
        timeoutMs: { type: 'number', description: 'Timeout in milliseconds. Default comes from config.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.command !== 'string') throw new Error('Expected command to be a string.')
      const command = input.command.trim()
      const timeout = typeof input.timeoutMs === 'number' ? input.timeoutMs : context.timeoutMs
      if (!context.allowShell) {
        const parsed = parseReadOnlyCommand(command)
        if (!parsed) throw new Error(`Shell command blocked because --allow-shell was not set: ${command}`)
        const result = await execFileAsync(parsed.executable, parsed.args, {
          cwd: context.cwd,
          timeout,
          maxBuffer: 1_000_000,
          windowsHide: true,
          shell: false,
        })
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
        return output || '[command completed with no output]'
      }

      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      const args = process.platform === 'win32'
        ? ['-NoProfile', '-NonInteractive', '-Command', command]
        : ['-lc', command]
      const result = await execFileAsync(shell, args, {
        cwd: context.cwd,
        timeout,
        maxBuffer: 1_000_000,
        windowsHide: true,
      })
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return output || '[command completed with no output]'
    },
  }
}

export function isReadOnlyCommand(command: string): boolean {
  return parseReadOnlyCommand(command) !== null
}

export function normalizeShellCommand(command: string): string {
  return tokenizeCommand(command).join(' ')
}

export function hasShellMetacharacters(command: string): boolean {
  return SHELL_METACHAR_PATTERN.test(command)
}

export function parseReadOnlyCommand(command: string): ParsedCommand | null {
  if (hasShellMetacharacters(command)) return null
  const tokens = tokenizeCommand(command)
  if (!tokens.length) return null

  const executable = tokens[0]!
  const executableKey = executable.toLowerCase()
  const args = tokens.slice(1)

  if (READ_ONLY_EXECUTABLES.has(executableKey)) {
    return { executable, args, normalized: tokens.join(' ') }
  }

  const subcommands = READ_ONLY_SUBCOMMANDS.get(executableKey)
  if (subcommands?.has((args[0] ?? '').toLowerCase())) {
    return { executable, args, normalized: tokens.join(' ') }
  }

  if (READ_ONLY_MULTI_ARG_PREFIXES.some((prefix) => prefix.every((part, index) => tokens[index]?.toLowerCase() === part))) {
    return { executable, args, normalized: tokens.join(' ') }
  }

  return null
}

function tokenizeCommand(command: string): string[] {
  const trimmed = command.trim()
  if (!trimmed) return []
  const tokens = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return tokens.map((token) => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1)
    }
    return token
  })
}
