import type { ToolDefinition } from '../types.js'
import { parseGitHubCliAction, runGitHubCli } from '../github.js'

export function createGitHubTool(): ToolDefinition {
  return {
    name: 'github',
    description: 'Run GitHub PR/issue helpers through the local gh CLI. Write actions are dry-run unless publish=true.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'pr-view, pr-diff, pr-checks, issue-view, or issue-list.' },
        repo: { type: 'string', description: 'Optional owner/repo. Defaults to current git remote.' },
        number: { type: 'number', description: 'PR or issue number for view/diff/checks actions.' },
        limit: { type: 'number', description: 'Issue list limit. Default 20.' },
        title: { type: 'string', description: 'Issue title for issue-create.' },
        body: { type: 'string', description: 'Comment or issue body for write actions.' },
        publish: { type: 'boolean', description: 'Execute GitHub write actions. Default false returns dry-run command.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.action !== 'string') throw new Error('Expected action to be a string.')
      return runGitHubCli({
        action: parseGitHubCliAction(input.action),
        repo: typeof input.repo === 'string' ? input.repo : undefined,
        number: typeof input.number === 'number' ? input.number : undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
        title: typeof input.title === 'string' ? input.title : undefined,
        body: typeof input.body === 'string' ? input.body : undefined,
        publish: input.publish === true,
        cwd: context.cwd,
        timeoutMs: context.timeoutMs,
      })
    },
  }
}
