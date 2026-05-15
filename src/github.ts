import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitHubReadAction = 'pr-view' | 'pr-diff' | 'pr-checks' | 'issue-view' | 'issue-list'
export type GitHubWriteAction = 'pr-comment' | 'issue-comment' | 'issue-create'
export type GitHubCliAction = GitHubReadAction | GitHubWriteAction

export type GitHubCliOptions = {
  action: GitHubCliAction
  repo?: string
  number?: number
  limit?: number
  title?: string
  body?: string
  publish?: boolean
  cwd: string
  timeoutMs: number
}

export async function runGitHubCli(options: GitHubCliOptions): Promise<string> {
  const args = buildGitHubCliArgs(options)
  if (isGitHubWriteAction(options.action) && !options.publish) {
    return [
      'GitHub write dry-run. Add --publish to execute:',
      `gh ${args.map(shellQuote).join(' ')}`,
    ].join('\n')
  }
  try {
    const result = await execFileAsync('gh', args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 2_000_000,
      windowsHide: true,
      shell: false,
    })
    return [result.stdout, result.stderr].filter(Boolean).join('\n') || '[gh completed with no output]'
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('GitHub CLI `gh` was not found. Install gh or use existing /pr API helpers.')
    }
    throw error
  }
}

export function buildGitHubCliArgs(options: Omit<GitHubCliOptions, 'cwd' | 'timeoutMs'>): string[] {
  const repoArgs = options.repo ? ['--repo', options.repo] : []
  switch (options.action) {
    case 'pr-view':
      return ['pr', 'view', requiredNumber(options), '--json', 'number,title,state,author,url,body,headRefName,baseRefName', ...repoArgs]
    case 'pr-diff':
      return ['pr', 'diff', requiredNumber(options), ...repoArgs]
    case 'pr-checks':
      return ['pr', 'checks', requiredNumber(options), ...repoArgs]
    case 'issue-view':
      return ['issue', 'view', requiredNumber(options), '--json', 'number,title,state,author,url,body', ...repoArgs]
    case 'issue-list':
      return ['issue', 'list', '--limit', String(options.limit ?? 20), '--json', 'number,title,state,author,url', ...repoArgs]
    case 'pr-comment':
      return ['pr', 'comment', requiredNumber(options), '--body', requiredBody(options), ...repoArgs]
    case 'issue-comment':
      return ['issue', 'comment', requiredNumber(options), '--body', requiredBody(options), ...repoArgs]
    case 'issue-create':
      return ['issue', 'create', '--title', requiredTitle(options), '--body', requiredBody(options), ...repoArgs]
  }
}

export function parseGitHubCliAction(value: string): GitHubCliAction {
  if (
    value === 'pr-view' ||
    value === 'pr-diff' ||
    value === 'pr-checks' ||
    value === 'issue-view' ||
    value === 'issue-list' ||
    value === 'pr-comment' ||
    value === 'issue-comment' ||
    value === 'issue-create'
  ) return value
  throw new Error('Unsupported GitHub action. Use pr-view, pr-diff, pr-checks, issue-view, issue-list, pr-comment, issue-comment, or issue-create.')
}

export function isGitHubWriteAction(action: GitHubCliAction): action is GitHubWriteAction {
  return action === 'pr-comment' || action === 'issue-comment' || action === 'issue-create'
}

function requiredNumber(options: Pick<GitHubCliOptions, 'action' | 'number'>): string {
  if (!Number.isInteger(options.number) || Number(options.number) <= 0) {
    throw new Error(`${options.action} requires a positive --number.`)
  }
  return String(options.number)
}

function requiredBody(options: Pick<GitHubCliOptions, 'action' | 'body'>): string {
  if (!options.body?.trim()) throw new Error(`${options.action} requires --body.`)
  return options.body
}

function requiredTitle(options: Pick<GitHubCliOptions, 'action' | 'title'>): string {
  if (!options.title?.trim()) throw new Error(`${options.action} requires --title.`)
  return options.title
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._=:/-]+$/.test(value)) return value
  return JSON.stringify(value)
}
