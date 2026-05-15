import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export type CustomCommand = {
  name: string
  scope: 'user' | 'project'
  path: string
  description?: string
  content: string
}

export async function listCustomCommands(cwd: string): Promise<CustomCommand[]> {
  const dirs = commandDirs(cwd)
  const commands: CustomCommand[] = []
  for (const dir of dirs) {
    if (!existsSync(dir.path)) continue
    const files = (await readdir(dir.path)).filter((file) => file.endsWith('.md'))
    for (const file of files) {
      const path = join(dir.path, file)
      const content = await readFile(path, 'utf8')
      commands.push({
        name: basename(file, '.md'),
        scope: dir.scope,
        path,
        description: firstDescriptionLine(content),
        content,
      })
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope))
}

export async function findCustomCommand(cwd: string, name: string): Promise<CustomCommand | undefined> {
  const commands = await listCustomCommands(cwd)
  return commands.find((command) => command.name === name)
}

export function renderCustomCommands(commands: CustomCommand[]): string {
  if (!commands.length) return 'No custom commands found.'
  return commands.map((command) => `/${command.name}\t${command.scope}\t${command.description ?? ''}\t${command.path}`).join('\n')
}

export function expandCustomCommand(command: CustomCommand, args: string[]): string {
  const argumentsText = args.join(' ')
  return command.content
    .replaceAll('$ARGUMENTS', argumentsText)
    .replaceAll('{{arguments}}', argumentsText)
    .trim()
}

export async function createCustomCommand(cwd: string, scope: 'user' | 'project', name: string, content?: string): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error('Command name may only contain letters, numbers, dot, underscore, and dash.')
  const dir = commandDirs(cwd).find((candidate) => candidate.scope === scope)!.path
  const path = join(dir, `${name}.md`)
  if (existsSync(path)) return `Command already exists: ${path}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content ?? [
    `# ${name}`,
    '',
    'Describe what this command should do.',
    '',
    'User arguments: $ARGUMENTS',
    '',
  ].join('\n'), 'utf8')
  return `Created ${path}`
}

function commandDirs(cwd: string): Array<{ scope: 'user' | 'project'; path: string }> {
  return [
    { scope: 'user', path: join(homedir(), '.gxz-code', 'commands') },
    { scope: 'project', path: resolve(cwd, '.gxz-code', 'commands') },
  ]
}

function firstDescriptionLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'))
}
