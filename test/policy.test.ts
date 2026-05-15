import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enforcePolicy, loadPolicy } from '../src/policy.js'

test('policy enforces tool and shell command rules', () => {
  assert.doesNotThrow(() => enforcePolicy({ allowTools: ['read_file'] }, {
    id: '1',
    name: 'read_file',
    arguments: { path: 'package.json' },
  }))
  assert.throws(() => enforcePolicy({ denyTools: ['write_file'] }, {
    id: '2',
    name: 'write_file',
    arguments: { path: 'x', content: 'y' },
  }), /denied/)
  assert.throws(() => enforcePolicy({ allowShellCommands: ['git status'] }, {
    id: '3',
    name: 'run_shell',
    arguments: { command: 'rm -rf dist' },
  }), /not allowed/)
  assert.throws(() => enforcePolicy({ allowShellCommands: ['git status'] }, {
    id: '4',
    name: 'run_shell',
    arguments: { command: 'git status; rm -rf dist' },
  }), /disallowed composition/)
  assert.throws(() => enforcePolicy({ denyShellCommands: ['rm -rf dist'] }, {
    id: '5',
    name: 'run_shell',
    arguments: { command: '  rm -rf dist  ' },
  }), /denied/)
})

test('policy loads from JSON file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gxz-policy-'))
  try {
    const path = join(dir, 'policy.json')
    await writeFile(path, JSON.stringify({ denyTools: ['web_fetch'] }), 'utf8')
    assert.deepEqual(await loadPolicy(dir, path), { denyTools: ['web_fetch'] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
