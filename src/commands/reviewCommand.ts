import { renderGitDiff } from './gitCommands.js'

export async function buildReviewPrompt(cwd: string): Promise<string> {
  const diff = await renderGitDiff(cwd)
  return [
    'Review the following workspace diff. Prioritize bugs, regressions, security issues, and missing tests.',
    'Return findings first, ordered by severity with file references when possible.',
    '',
    diff,
  ].join('\n')
}
