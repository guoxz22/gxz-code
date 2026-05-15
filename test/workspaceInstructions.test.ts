import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWorkspaceInstructions } from '../src/workspaceInstructions.js'

test('loads workspace instructions from ancestors outer-to-inner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gxz-instructions-'))
  try {
    const child = join(root, 'child')
    await mkdir(child)
    await writeFile(join(root, 'AGENTS.md'), 'root rules', 'utf8')
    await writeFile(join(child, 'GXZ.md'), 'child rules', 'utf8')
    const instructions = await loadWorkspaceInstructions(child)
    assert.equal(instructions.length, 2)
    assert.match(instructions[0]!, /root rules/)
    assert.match(instructions[1]!, /child rules/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
