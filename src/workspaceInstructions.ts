import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'

const INSTRUCTION_FILES = ['AGENTS.md', 'GXZ.md', 'CLAUDE.md']

export async function loadWorkspaceInstructions(cwd: string): Promise<string[]> {
  const dirs = ancestorDirs(resolve(cwd))
  const instructions: string[] = []
  for (const dir of dirs) {
    for (const file of INSTRUCTION_FILES) {
      const path = join(dir, file)
      if (existsSync(path)) {
        const content = await readFile(path, 'utf8')
        instructions.push(`# ${path}\n${content}`)
      }
    }
  }
  return instructions
}

function ancestorDirs(cwd: string): string[] {
  const root = parse(cwd).root
  const dirs: string[] = []
  let current = cwd
  while (true) {
    dirs.unshift(current)
    if (current === root) break
    current = dirname(current)
  }
  return dirs
}
