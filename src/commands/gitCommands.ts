import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function renderGitStatus(cwd: string): Promise<string> {
  return runGit(['status', '--short'], cwd)
}

export async function renderGitDiff(cwd: string): Promise<string> {
  return runGit(['diff', '--', '.'], cwd)
}

export async function createGitCommit(cwd: string, message: string): Promise<string> {
  if (!message.trim()) throw new Error('Commit message cannot be empty.')
  return runGit(['commit', '-m', message], cwd)
}

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    })
    return result.stdout || '[no output]'
  } catch (error) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      const withOutput = error as Error & { stdout?: string; stderr?: string }
      const output = [withOutput.stdout, withOutput.stderr, error.message].filter(Boolean).join('\n')
      if (/not a git repository/i.test(output)) return 'Not a git repository.'
      return [withOutput.stdout, withOutput.stderr, error.message].filter(Boolean).join('\n')
    }
    throw error
  }
}
