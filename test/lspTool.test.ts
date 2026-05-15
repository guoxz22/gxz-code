import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLspCodeActionTool, runCodeAction } from '../src/tools/lspTool.js'

test('runCodeAction lists actions and formats JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gxz-code-action-'))
  try {
    await writeFile(join(root, 'a.json'), '{"b":1,"a":2}', 'utf8')
    assert.match(await runCodeAction(root, 'a.json', 'list', 1000), /formatJson/)
    assert.match(await createLspCodeActionTool().execute({
      path: 'a.json',
      action: 'formatJson',
    }, { cwd: root, allowShell: false, timeoutMs: 5000 }), /formatted json/)
    assert.equal(await readFile(join(root, 'a.json'), 'utf8'), '{\n  "b": 1,\n  "a": 2\n}\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runCodeAction rejects unsupported actions', async () => {
  await assert.rejects(() => runCodeAction(process.cwd(), 'package.json', 'deleteEverything', 1000), /Unsupported/)
})
