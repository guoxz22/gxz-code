import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import type { ToolDefinition } from '../types.js'
import { resolveInside } from './path.js'

type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

export function createTodoTool(): ToolDefinition {
  return {
    name: 'todo_write',
    description: 'Create or update the task checklist for the current coding job. Use exactly one in_progress item when work remains.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Todo items with content and status.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
          },
        },
        path: {
          type: 'string',
          description: 'Workspace-relative todo path. Default .gxz-code/todos.md.',
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const items = parseItems(input.items)
      const inProgressCount = items.filter((item) => item.status === 'in_progress').length
      if (inProgressCount > 1) throw new Error('Only one todo item may be in_progress.')
      const target = resolveInside(context.cwd, typeof input.path === 'string' ? input.path : '.gxz-code/todos.md')
      await mkdir(dirname(target), { recursive: true })
      const content = renderTodos(items)
      await writeFile(target, content, 'utf8')
      return `Updated ${relative(context.cwd, target)} with ${items.length} todo items.`
    },
  }
}

export async function readTodos(cwd: string, path = '.gxz-code/todos.md'): Promise<string> {
  const target = resolveInside(cwd, path)
  if (!existsSync(target)) return ''
  return readFile(target, 'utf8')
}

function parseItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) throw new Error('Expected items to be an array.')
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Expected each todo item to be an object.')
    const record = item as Record<string, unknown>
    if (typeof record.content !== 'string') throw new Error('Expected todo content to be a string.')
    if (record.status !== 'pending' && record.status !== 'in_progress' && record.status !== 'completed') {
      throw new Error('Expected todo status to be pending, in_progress, or completed.')
    }
    return {
      content: record.content,
      status: record.status,
    }
  })
}

function renderTodos(items: TodoItem[]): string {
  const lines = ['# GXZ-code Todos', '']
  for (const item of items) {
    const marker = item.status === 'completed' ? 'x' : ' '
    const suffix = item.status === 'in_progress' ? ' _(in progress)_' : ''
    lines.push(`- [${marker}] ${item.content}${suffix}`)
  }
  lines.push('')
  return lines.join('\n')
}
