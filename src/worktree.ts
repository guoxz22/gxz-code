import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type WorktreeAction = 'list' | 'add' | 'remove'

export async function runWorktree(
  cwd: string,
  action: WorktreeAction,
  options: { path?: string; branch?: string; detach?: boolean; force?: boolean },
): Promise<string> {
  const args = buildWorktreeArgs(action, options)
  const result = await execFileAsync('git', args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 1_000_000,
    windowsHide: true,
    shell: false,
  })
  return [result.stdout, result.stderr].filter(Boolean).join('\n') || '[git worktree completed with no output]'
}

export function buildWorktreeArgs(
  action: WorktreeAction,
  options: { path?: string; branch?: string; detach?: boolean; force?: boolean },
): string[] {
  if (action === 'list') return ['worktree', 'list']
  if (action === 'add') {
    if (!options.path) throw new Error('worktree add requires path.')
    const args = ['worktree', 'add']
    if (options.detach) args.push('--detach')
    if (options.branch) args.push('-b', options.branch)
    args.push(options.path)
    return args
  }
  if (action === 'remove') {
    if (!options.path) throw new Error('worktree remove requires path.')
    return ['worktree', 'remove', ...(options.force ? ['--force'] : []), options.path]
  }
  throw new Error(`Unsupported worktree action: ${action}`)
}

export function parseWorktreeAction(value: string): WorktreeAction {
  if (value === 'list' || value === 'add' || value === 'remove') return value
  throw new Error('Unsupported worktree action. Use list, add, or remove.')
}
