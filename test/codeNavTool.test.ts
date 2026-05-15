import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodeNavigationTools, outlineSource } from '../src/tools/codeNavTool.js'

test('outlineSource extracts common TypeScript symbols', () => {
  const outline = outlineSource([
    'export function alpha() {}',
    'class Beta {}',
    'export type Gamma = string',
    'const delta = () => null',
  ].join('\n'))
  assert.match(outline, /alpha/)
  assert.match(outline, /Beta/)
  assert.match(outline, /Gamma/)
  assert.match(outline, /delta/)
})

test('code navigation tools outline files and search workspace symbols', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gxz-nav-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'a.ts'), 'export function targetSymbol() {}\n', 'utf8')
    const tools = Object.fromEntries(createCodeNavigationTools().map((tool) => [tool.name, tool]))
    const context = { cwd: root, allowShell: false, timeoutMs: 1000 }
    assert.match(await tools.file_outline!.execute({ path: 'src/a.ts' }, context), /targetSymbol/)
    assert.match(await tools.workspace_symbols!.execute({ query: 'target' }, context), /src.*a\.ts/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
