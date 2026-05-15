import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { buildWorktreeArgs, parseWorktreeAction } from '../src/worktree.js'
import { clearMonitorsForTests, listMonitors, readMonitor, startMonitor, stopMonitor } from '../src/monitor.js'

test('monitor starts, reads, lists, and stops background commands', async () => {
  clearMonitorsForTests()
  const task = startMonitor('node -e "console.log(\'hello-monitor\')"', process.cwd())
  await delay(300)
  assert.match(listMonitors(), new RegExp(task.id))
  assert.match(readMonitor(task.id), /hello-monitor/)
  assert.match(stopMonitor(task.id), /Stopped monitor/)
  clearMonitorsForTests()
})

test('worktree argument builder keeps operations explicit', () => {
  assert.deepEqual(buildWorktreeArgs('list', {}), ['worktree', 'list'])
  assert.deepEqual(buildWorktreeArgs('add', { path: '../feature', branch: 'feature/test' }), ['worktree', 'add', '-b', 'feature/test', '../feature'])
  assert.deepEqual(buildWorktreeArgs('remove', { path: '../feature', force: true }), ['worktree', 'remove', '--force', '../feature'])
  assert.equal(parseWorktreeAction('list'), 'list')
  assert.throws(() => parseWorktreeAction('delete'), /Unsupported worktree/)
})
