import { readFile, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { ToolDefinition } from '../types.js'
import { resolveInside } from './path.js'

export function createPatchTool(): ToolDefinition {
  return {
    name: 'patch_file',
    description: 'Preview or apply an exact text replacement as a unified diff. Defaults to preview; set apply=true to write.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        oldText: { type: 'string', description: 'Exact text to replace.' },
        newText: { type: 'string', description: 'Replacement text.' },
        replaceAll: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
        apply: { type: 'boolean', description: 'Write the patch. Default false previews only.' },
      },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const path = requireString(input.path, 'path')
      const oldText = requireString(input.oldText, 'oldText')
      const newText = requireString(input.newText, 'newText')
      const replaceAll = input.replaceAll === true
      const shouldApply = input.apply === true
      const absolute = resolveInside(context.cwd, path)
      const original = await readFile(absolute, 'utf8')
      const occurrences = countOccurrences(original, oldText)
      if (!occurrences) throw new Error(`oldText was not found in ${path}.`)
      const updated = replaceAll ? original.split(oldText).join(newText) : original.replace(oldText, newText)
      const diff = unifiedDiff(relative(context.cwd, absolute), original, updated)
      if (shouldApply) {
        await writeFile(absolute, updated, 'utf8')
      }
      return [
        shouldApply ? `Applied patch to ${path}.` : `Preview patch for ${path}.`,
        `occurrences=${occurrences} replaceAll=${replaceAll}`,
        diff,
      ].join('\n')
    },
  }
}

export function unifiedDiff(path: string, original: string, updated: string, contextLines = 3): string {
  if (original === updated) return '[no changes]'
  const oldLines = original.split('\n')
  const newLines = updated.split('\n')
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix + prefix < oldLines.length &&
    suffix + prefix < newLines.length &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const oldStart = Math.max(0, prefix - contextLines)
  const newStart = Math.max(0, prefix - contextLines)
  const oldEnd = Math.min(oldLines.length, oldLines.length - suffix + contextLines)
  const newEnd = Math.min(newLines.length, newLines.length - suffix + contextLines)
  const changedOldStart = prefix
  const changedOldEnd = oldLines.length - suffix
  const changedNewStart = prefix
  const changedNewEnd = newLines.length - suffix

  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart + 1},${oldEnd - oldStart} +${newStart + 1},${newEnd - newStart} @@`,
  ]

  for (let index = oldStart; index < changedOldStart; index += 1) lines.push(` ${oldLines[index] ?? ''}`)
  for (let index = changedOldStart; index < changedOldEnd; index += 1) lines.push(`-${oldLines[index] ?? ''}`)
  for (let index = changedNewStart; index < changedNewEnd; index += 1) lines.push(`+${newLines[index] ?? ''}`)
  for (let index = changedOldEnd; index < oldEnd; index += 1) lines.push(` ${oldLines[index] ?? ''}`)
  return lines.join('\n')
}

function countOccurrences(value: string, search: string): number {
  if (!search) throw new Error('oldText cannot be empty.')
  let count = 0
  let index = 0
  while (true) {
    const next = value.indexOf(search, index)
    if (next === -1) return count
    count += 1
    index = next + search.length
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${name} to be a string.`)
  return value
}
