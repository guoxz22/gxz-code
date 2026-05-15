import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type MemoryFile = {
  scope: 'user' | 'project' | 'local'
  path: string
  exists: boolean
  content?: string
}

export async function loadMemoryFiles(cwd: string): Promise<MemoryFile[]> {
  const files = memoryPaths(cwd)
  return Promise.all(files.map(async (file) => ({
    ...file,
    exists: existsSync(file.path),
    content: existsSync(file.path) ? await readFile(file.path, 'utf8') : undefined,
  })))
}

export async function renderMemory(cwd: string, scope?: string): Promise<string> {
  const files = await loadMemoryFiles(cwd)
  const filtered = scope ? files.filter((file) => file.scope === scope) : files
  if (!filtered.length) return `Unknown memory scope: ${scope}`
  return filtered.map((file) => [
    `# ${file.scope} memory`,
    file.path,
    file.exists ? file.content?.trim() || '[empty]' : '[missing]',
  ].join('\n')).join('\n\n')
}

export async function addMemory(cwd: string, scope: string, content: string): Promise<string> {
  const target = memoryPathForScope(cwd, scope)
  if (!target) throw new Error(`Unknown memory scope: ${scope}`)
  await mkdir(dirname(target), { recursive: true })
  const line = `\n- ${content.trim()}\n`
  await appendFile(target, line, 'utf8')
  return `Added memory to ${target}`
}

export async function initProjectMemory(cwd: string): Promise<string> {
  const path = resolve(cwd, 'GXZ.md')
  if (existsSync(path)) return `Project memory already exists: ${path}`
  await writeFile(path, [
    '# GXZ Project Memory',
    '',
    '- Project-specific instructions for GXZ-code.',
    '- Keep entries concise and actionable.',
    '',
  ].join('\n'), 'utf8')
  return `Created ${path}`
}

export async function memoryContext(cwd: string): Promise<string> {
  const files = await loadMemoryFiles(cwd)
  const loaded = files.filter((file) => file.exists && file.content?.trim())
  if (!loaded.length) return ''
  return loaded.map((file) => `# ${file.scope} memory (${file.path})\n${file.content}`).join('\n\n---\n\n')
}

function memoryPaths(cwd: string): Array<Omit<MemoryFile, 'exists' | 'content'>> {
  return [
    { scope: 'user', path: join(homedir(), '.gxz-code', 'GXZ.md') },
    { scope: 'project', path: resolve(cwd, 'GXZ.md') },
    { scope: 'local', path: resolve(cwd, '.gxz-code', 'memory.md') },
  ]
}

function memoryPathForScope(cwd: string, scope: string): string | undefined {
  return memoryPaths(cwd).find((file) => file.scope === scope)?.path
}
