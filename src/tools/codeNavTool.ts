import { readFile } from 'node:fs/promises'
import type { ToolDefinition } from '../types.js'
import { resolveInside } from './path.js'

export function createCodeNavigationTools(): ToolDefinition[] {
  return [outlineTool, symbolSearchTool]
}

const outlineTool: ToolDefinition = {
  name: 'file_outline',
  description: 'Return a lightweight outline of functions, classes, interfaces, and exported symbols in a source file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative source file path.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(input, context) {
    if (typeof input.path !== 'string') throw new Error('Expected path to be a string.')
    const absolute = resolveInside(context.cwd, input.path)
    const content = await readFile(absolute, 'utf8')
    return outlineSource(content)
  },
}

const symbolSearchTool: ToolDefinition = {
  name: 'workspace_symbols',
  description: 'Search workspace files for symbol declarations by name using lightweight TypeScript/JavaScript patterns.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol name or substring.' },
      maxMatches: { type: 'number', description: 'Maximum matches. Default 100.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(input, context) {
    if (typeof input.query !== 'string') throw new Error('Expected query to be a string.')
    const maxMatches = typeof input.maxMatches === 'number' ? input.maxMatches : 100
    const { createFileTools } = await import('./fileTools.js')
    const listFiles = createFileTools().find((tool) => tool.name === 'list_files')!
    const fileList = await listFiles.execute({ path: '.', maxEntries: 10_000 }, context)
    const matches: string[] = []
    for (const rel of fileList.split(/\r?\n/)) {
      if (matches.length >= maxMatches) break
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue
      const content = await readFile(resolveInside(context.cwd, rel), 'utf8').catch(() => '')
      const outline = outlineSource(content)
      for (const line of outline.split(/\r?\n/)) {
        if (line.toLowerCase().includes(input.query.toLowerCase())) {
          matches.push(`${rel}: ${line}`)
          if (matches.length >= maxMatches) break
        }
      }
    }
    return matches.join('\n') || '[no symbols found]'
  },
}

export function outlineSource(content: string): string {
  const lines = content.split(/\r?\n/)
  const matches: string[] = []
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/,
    /\bclass\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/,
    /\binterface\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+type\s+([A-Za-z_$][\w$]*)/,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)/,
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  ]
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern)
      if (match?.[1]) {
        matches.push(`${index + 1}: ${match[1]}`)
        break
      }
    }
  })
  return matches.join('\n') || '[no outline symbols found]'
}
