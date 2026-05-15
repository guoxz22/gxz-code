import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { ToolDefinition } from '../types.js'
import { resolveInside } from './path.js'

const textDecoder = new TextDecoder('utf8', { fatal: false })

export function createFileTools(): ToolDefinition[] {
  return [readFileTool, writeFileTool, editFileTool, listFilesTool, searchTextTool]
}

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      maxBytes: { type: 'number', description: 'Maximum bytes to return. Default 60000.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const path = requireString(input.path, 'path')
    const maxBytes = typeof input.maxBytes === 'number' ? input.maxBytes : 60_000
    const absolute = resolveInside(context.cwd, path)
    const bytes = await readFile(absolute)
    const sliced = bytes.byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes
    const suffix = bytes.byteLength > maxBytes ? `\n\n[truncated ${bytes.byteLength - maxBytes} bytes]` : ''
    return textDecoder.decode(sliced) + suffix
  },
}

const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Create or overwrite a UTF-8 text file inside the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      content: { type: 'string', description: 'Complete file content.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const path = requireString(input.path, 'path')
    const content = requireString(input.content, 'content')
    const absolute = resolveInside(context.cwd, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    return `Wrote ${content.length} characters to ${relative(context.cwd, absolute)}.`
  },
}

const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace text in a UTF-8 file. Fails if oldText is not found.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      oldText: { type: 'string', description: 'Exact text to replace.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const path = requireString(input.path, 'path')
    const oldText = requireString(input.oldText, 'oldText')
    const newText = requireString(input.newText, 'newText')
    const replaceAll = input.replaceAll === true
    const absolute = resolveInside(context.cwd, path)
    const original = await readFile(absolute, 'utf8')
    if (!original.includes(oldText)) {
      throw new Error(`oldText was not found in ${path}.`)
    }
    const updated = replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText)
    await writeFile(absolute, updated, 'utf8')
    return `Edited ${relative(context.cwd, absolute)} (${replaceAll ? 'all matches' : 'first match'}).`
  },
}

const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description: 'List files under a workspace directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory. Default ".".' },
      maxEntries: { type: 'number', description: 'Maximum entries. Default 200.' },
    },
    additionalProperties: false,
  },
  async execute(input, context) {
    const path = typeof input.path === 'string' ? input.path : '.'
    const maxEntries = typeof input.maxEntries === 'number' ? input.maxEntries : 200
    const absolute = resolveInside(context.cwd, path)
    const entries: string[] = []
    await walk(absolute, context.cwd, entries, maxEntries)
    return entries.join('\n') || '[no files]'
  },
}

const searchTextTool: ToolDefinition = {
  name: 'search_text',
  description: 'Search text files under the workspace for a literal string or JavaScript regular expression.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
      path: { type: 'string', description: 'Workspace-relative directory. Default ".".' },
      regex: { type: 'boolean', description: 'Treat query as JavaScript regex. Default false.' },
      maxMatches: { type: 'number', description: 'Maximum matches. Default 100.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(input, context) {
    const query = requireString(input.query, 'query')
    const path = typeof input.path === 'string' ? input.path : '.'
    const regex = input.regex === true ? new RegExp(query, 'i') : null
    const maxMatches = typeof input.maxMatches === 'number' ? input.maxMatches : 100
    const root = resolveInside(context.cwd, path)
    const files: string[] = []
    await walk(root, context.cwd, files, 10_000)
    const matches: string[] = []
    for (const relPath of files) {
      if (matches.length >= maxMatches) break
      const absolute = resolveInside(context.cwd, relPath)
      if (await isLikelyBinary(absolute)) continue
      const content = await readFile(absolute, 'utf8').catch(() => '')
      const lines = content.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (matches.length >= maxMatches) return
        const hit = regex ? regex.test(line) : line.toLowerCase().includes(query.toLowerCase())
        if (hit) matches.push(`${relPath}:${index + 1}: ${line}`)
      })
    }
    return matches.join('\n') || '[no matches]'
  },
}

async function walk(root: string, cwd: string, output: string[], maxEntries: number): Promise<void> {
  if (output.length >= maxEntries) return
  const info = await stat(root)
  if (info.isFile()) {
    output.push(relative(cwd, root) || '.')
    return
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (output.length >= maxEntries) return
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      await walk(absolute, cwd, output, maxEntries)
    } else if (entry.isFile()) {
      output.push(relative(cwd, absolute))
    }
  }
}

async function isLikelyBinary(path: string): Promise<boolean> {
  const bytes = await readFile(path).catch(() => Buffer.alloc(0))
  const sample = bytes.subarray(0, 512)
  return sample.includes(0)
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${name} to be a string.`)
  return value
}
