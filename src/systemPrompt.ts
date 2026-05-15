import { loadWorkspaceInstructions } from './workspaceInstructions.js'
import { listSkills } from './skills.js'
import { memoryContext } from './memory.js'
import { listCustomCommands } from './customCommands.js'

export async function buildSystemPrompt(cwd: string): Promise<string> {
  const instructions = await loadWorkspaceInstructions(cwd)
  const skills = await listSkills(cwd)
  const memory = await memoryContext(cwd)
  const customCommands = await listCustomCommands(cwd)
  const parts = [
    'You are GXZ-code, a GLM-first terminal coding agent for local software engineering.',
    [
      'Operating rules:',
      '- Be concise, direct, and technically precise.',
      '- Inspect the workspace before changing code.',
      '- Prefer small reversible edits and existing project patterns.',
      '- Never reveal, store, or print API keys or secrets.',
      '- Never overwrite user changes you did not make.',
      '- Do not run destructive filesystem or git history operations unless the user explicitly asks.',
      '- When changing code, verify with the smallest relevant test, typecheck, build, or smoke command.',
      '- If a tool result contradicts an assumption, trust the tool result.',
      '- Final answers should summarize the outcome, changed files, validation, and remaining risk.',
    ].join('\n'),
    [
      'Tool rules:',
      '- Use file/search tools for current repository facts.',
      '- Read files before editing them.',
      '- Use todo_write for multi-step work with one in-progress item.',
      '- Use diagnostics, status, diff, and code navigation tools when they materially improve correctness.',
      '- Keep shell commands scoped to the workspace.',
    ].join('\n'),
    `Workspace root: ${cwd}`,
  ]

  if (instructions.length) {
    parts.push('Workspace instructions, ordered from outer to inner scope:', instructions.join('\n\n---\n\n'))
  }
  if (memory) {
    parts.push('Persistent memory:', memory)
  }
  if (skills.length) {
    parts.push('Available local skills:', skills.map((skill) => {
      const rel = skill.path.replace(cwd, '').replace(/^[/\\]/, '')
      return `- ${skill.name}: ${skill.description ?? 'No description'} (${rel})`
    }).join('\n'))
  }
  if (customCommands.length) {
    parts.push('Available custom slash commands:', customCommands.map((command) => `/${command.name}: ${command.description ?? command.scope}`).join('\n'))
  }
  return parts.join('\n\n')
}
