import type { ToolDefinition } from '../types.js'
import { parseWorktreeAction, runWorktree } from '../worktree.js'

export function createWorktreeTool(): ToolDefinition {
  return {
    name: 'worktree',
    description: 'Manage git worktrees for isolated local changes. Supports list, add, and remove.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list, add, or remove.' },
        path: { type: 'string', description: 'Worktree path for add/remove.' },
        branch: { type: 'string', description: 'Branch name for add -b.' },
        detach: { type: 'boolean', description: 'Use git worktree add --detach.' },
        force: { type: 'boolean', description: 'Use --force for remove. Default false.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.action !== 'string') throw new Error('Expected action to be a string.')
      return runWorktree(context.cwd, parseWorktreeAction(input.action), {
        path: typeof input.path === 'string' ? input.path : undefined,
        branch: typeof input.branch === 'string' ? input.branch : undefined,
        detach: input.detach === true,
        force: input.force === true,
      })
    },
  }
}
