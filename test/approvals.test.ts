import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approvalDecisionFromMemory,
  clearApprovalMemory,
  isRiskyTool,
  loadApprovalMemory,
  rememberApproval,
} from '../src/approvals.js'

test('approval memory remembers tool and shell decisions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-approvals-'))
  try {
    await rememberApproval(cwd, { toolName: 'write_file', arguments: {}, reason: 'test' }, 'allow')
    assert.equal(await approvalDecisionFromMemory(cwd, { toolName: 'write_file', arguments: {}, reason: 'test' }), true)
    await rememberApproval(cwd, { toolName: 'run_shell', arguments: { command: 'git   status' }, reason: 'test' }, 'deny')
    assert.equal(await approvalDecisionFromMemory(cwd, { toolName: 'run_shell', arguments: { command: 'git status' }, reason: 'test' }), false)
    await clearApprovalMemory(cwd)
    assert.deepEqual(await loadApprovalMemory(cwd), {})
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('isRiskyTool flags write and external tools', () => {
  assert.equal(isRiskyTool('read_file'), false)
  assert.equal(isRiskyTool('write_file'), true)
  assert.equal(isRiskyTool('web_fetch'), true)
})
