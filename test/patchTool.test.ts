import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPatchTool, unifiedDiff } from '../src/tools/patchTool.js'

test('unifiedDiff renders focused preview', () => {
  const diff = unifiedDiff('demo.txt', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
  assert.match(diff, /--- a\/demo\.txt/)
  assert.match(diff, /-two/)
  assert.match(diff, /\+TWO/)
})

test('patch_file previews by default and applies only when requested', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-patch-'))
  try {
    const path = join(cwd, 'file.txt')
    await writeFile(path, 'alpha\nbeta\n', 'utf8')
    const tool = createPatchTool()

    const preview = await tool.execute({
      path: 'file.txt',
      oldText: 'beta',
      newText: 'BETA',
    }, { cwd, allowShell: false, timeoutMs: 1000 })
    assert.match(preview, /Preview patch/)
    assert.equal(await readFile(path, 'utf8'), 'alpha\nbeta\n')

    const applied = await tool.execute({
      path: 'file.txt',
      oldText: 'beta',
      newText: 'BETA',
      apply: true,
    }, { cwd, allowShell: false, timeoutMs: 1000 })
    assert.match(applied, /Applied patch/)
    assert.equal(await readFile(path, 'utf8'), 'alpha\nBETA\n')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
