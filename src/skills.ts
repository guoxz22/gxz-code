import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ToolDefinition } from './types.js'
import { resolveInside } from './tools/path.js'

export type SkillInfo = {
  name: string
  path: string
  description?: string
}

export async function listSkills(cwd: string): Promise<SkillInfo[]> {
  const roots = [resolve(cwd, '.gxz-code', 'skills'), resolve(cwd, 'skills')]
  const output: SkillInfo[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(root, entry.name, 'SKILL.md')
      if (!existsSync(skillPath)) continue
      const content = await readFile(skillPath, 'utf8')
      output.push({
        name: entry.name,
        path: skillPath,
        description: parseDescription(content),
      })
    }
  }
  return output.sort((a, b) => a.name.localeCompare(b.name))
}

export function createSkillTool(): ToolDefinition {
  return {
    name: 'read_skill',
    description: 'Read a local GXZ-code skill from .gxz-code/skills or skills. Use after listing skills in the prompt context.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to SKILL.md.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (typeof input.path !== 'string') throw new Error('Expected path to be a string.')
      const path = resolveInside(context.cwd, input.path)
      return readFile(path, 'utf8')
    },
  }
}

function parseDescription(content: string): string | undefined {
  const match = content.match(/^description:\s*(.+)$/m)
  return match?.[1]?.trim()
}
