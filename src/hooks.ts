import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'

export type HookCommand = {
  command: string
  timeoutMs?: number
}

export type HookConfig = Partial<Record<HookEvent, HookCommand[]>>

export type HookPayload = {
  event: HookEvent
  cwd: string
  [key: string]: unknown
}

export async function loadHooks(cwd: string, explicitPath?: string): Promise<HookConfig> {
  const path = explicitPath ?? process.env.GXZ_HOOKS ?? resolve(cwd, '.gxz-code', 'hooks.json')
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(await readFile(path, 'utf8')) as HookConfig
  validateHooks(parsed)
  return parsed
}

export async function runHooks(config: HookConfig | undefined, event: HookEvent, payload: HookPayload): Promise<string[]> {
  const commands = config?.[event] ?? []
  const results: string[] = []
  for (const hook of commands) {
    results.push(await runHookCommand(hook, payload))
  }
  return results
}

export function renderHooks(config: HookConfig): string {
  const entries = Object.entries(config)
  if (!entries.length) return 'No hooks configured.'
  return entries.flatMap(([event, hooks]) => [
    `# ${event}`,
    ...(hooks ?? []).map((hook) => `- ${hook.command}`),
  ]).join('\n')
}

function validateHooks(config: HookConfig): void {
  for (const [event, hooks] of Object.entries(config)) {
    if (!isHookEvent(event)) throw new Error(`Unknown hook event: ${event}`)
    if (!Array.isArray(hooks) || hooks.some((hook) => !hook || typeof hook.command !== 'string')) {
      throw new Error(`Hook event ${event} must be an array of { command } objects.`)
    }
  }
}

function isHookEvent(value: string): value is HookEvent {
  return ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact'].includes(value)
}

async function runHookCommand(hook: HookCommand, payload: HookPayload): Promise<string> {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', hook.command]
    : ['-lc', hook.command]
  const result = await execFileAsync(shell, args, {
    cwd: payload.cwd,
    env: {
      ...process.env,
      GXZ_HOOK_EVENT: payload.event,
      GXZ_HOOK_PAYLOAD: JSON.stringify(payload),
    },
    timeout: hook.timeoutMs ?? 30_000,
    maxBuffer: 1_000_000,
    windowsHide: true,
  })
  return [result.stdout, result.stderr].filter(Boolean).join('\n') || '[hook completed with no output]'
}
