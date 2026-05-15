import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitCommandLine, renderTuiContext, renderTuiHeader, renderTuiDashboard, slashSuggestions, recordTuiInputHistory, tuiHistoryEntry, filterHistory, isAffirmative } from '../src/tui.js'
import type { RuntimeConfig } from '../src/config.js'

test('splitCommandLine preserves quoted slash command arguments', () => {
  assert.deepEqual(splitCommandLine('resume "my session"'), ['resume', 'my session'])
  assert.deepEqual(splitCommandLine("mcp call docs search '{\"q\":\"x\"}'"), ['mcp', 'call', 'docs', 'search', '{"q":"x"}'])
})

test('renderTuiContext reports session, model, messages, tokens, and approval mode', () => {
  const config: RuntimeConfig = {
    provider: 'glm-openai',
    model: 'glm-5.1',
    baseUrl: 'https://example.test',
    cwd: process.cwd(),
    maxTurns: 12,
    timeoutMs: 1000,
    allowShell: false,
    requireApproval: false,
    temperature: 0,
    maxOutputTokens: 1000,
  }
  const rendered = renderTuiContext({
    config,
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ],
    tools: [],
    approvalMode: 'risky',
  })
  assert.match(rendered, /glm-openai\/glm-5\.1/)
  assert.match(rendered, /messages: 2/)
  assert.match(rendered, /approval mode: risky/)
})

test('renderTuiDashboard shows full-screen style status panel', () => {
  const config: RuntimeConfig = {
    provider: 'glm-openai',
    model: 'glm-5.1',
    baseUrl: 'https://example.test',
    cwd: 'D:\\repo',
    maxTurns: 12,
    timeoutMs: 1000,
    allowShell: false,
    requireApproval: false,
    temperature: 0,
    maxOutputTokens: 1000,
  }
  const rendered = renderTuiDashboard({
    config,
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} }, execute: async () => '' }],
    approvalMode: 'risky',
  })
  assert.match(rendered, /GXZ COMMAND CENTER/)
  assert.match(rendered, /glm-openai\/glm-5\.1/)
  assert.match(rendered, /\/patch/)
})

test('renderTuiHeader shows fox banner and session metadata', () => {
  const config: RuntimeConfig = {
    provider: 'glm-openai',
    model: 'glm-5.1',
    baseUrl: 'https://example.test',
    cwd: 'D:\\repo',
    maxTurns: 12,
    timeoutMs: 1000,
    allowShell: false,
    requireApproval: false,
    temperature: 0,
    maxOutputTokens: 1000,
  }
  const rendered = renderTuiHeader(config, 'session-1', 'risky')
  assert.match(rendered, /██████████/)
  assert.match(rendered, /████████/)
  assert.match(rendered, /██\s+██/)
  assert.doesNotMatch(rendered, /FFFFFFFFFF/)
  assert.doesNotMatch(rendered, /\/\\\s+\/\\/)
  assert.doesNotMatch(rendered, /\.-----------\./)
  assert.match(rendered, /GXZ-code/)
  assert.match(rendered, /glm-openai\/glm-5\.1/)
  assert.match(rendered, /session session-1/)
  assert.match(rendered, /approval risky/)
})

test('renderTuiHeader can colorize for real TTY output', () => {
  const config: RuntimeConfig = {
    provider: 'glm-openai',
    model: 'glm-5.1',
    baseUrl: 'https://example.test',
    cwd: 'D:\\repo',
    maxTurns: 12,
    timeoutMs: 1000,
    allowShell: false,
    requireApproval: false,
    temperature: 0,
    maxOutputTokens: 1000,
  }
  assert.match(renderTuiHeader(config, undefined, 'risky', true), /\x1b\[38;5;124m/)
})

test('slashSuggestions filters built-in commands by prefix', async () => {
  const resumeCommands = await slashSuggestions(process.cwd(), '/r')
  assert.ok(resumeCommands.some((suggestion) => suggestion.command === '/resume'))
  assert.ok(resumeCommands.some((suggestion) => suggestion.command === '/review'))

  const modelCommands = await slashSuggestions(process.cwd(), '/m')
  assert.ok(modelCommands.some((suggestion) => suggestion.command === '/model'))
  assert.ok(modelCommands.some((suggestion) => suggestion.command === '/memory'))
  assert.ok(modelCommands.some((suggestion) => suggestion.command === '/mcp'))

  const effortCommands = await slashSuggestions(process.cwd(), '/eff')
  assert.ok(effortCommands.some((suggestion) => suggestion.command === '/effort'))
  assert.ok(effortCommands.some((suggestion) => suggestion.command === '/effect'))
})

test('slashSuggestions includes project custom commands and hides after arguments', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-tui-'))
  try {
    const commandDir = join(cwd, '.gxz-code', 'commands')
    await mkdir(commandDir, { recursive: true })
    await writeFile(join(commandDir, 'custom-local.md'), '# custom-local\n\nRun the local custom command.\n', 'utf8')

    const customCommands = await slashSuggestions(cwd, '/custom')
    assert.ok(customCommands.some((suggestion) => suggestion.command === '/custom-local'))

    const afterArguments = await slashSuggestions(cwd, '/custom-local now')
    assert.equal(afterArguments.length, 0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('TUI input history records non-empty unique trailing entries', () => {
  const history: string[] = []
  recordTuiInputHistory(history, 'first')
  recordTuiInputHistory(history, 'first')
  recordTuiInputHistory(history, 'second')
  recordTuiInputHistory(history, '   ')
  assert.deepEqual(history, ['first', 'second'])
  assert.equal(tuiHistoryEntry(history, 0), 'first')
  assert.equal(tuiHistoryEntry(history, 99), '')
})

test('filterHistory returns newest matching entries first', () => {
  const history = ['read package', 'run tests', 'read src']
  assert.deepEqual(filterHistory(history, 'read'), ['read src', 'read package'])
  assert.deepEqual(filterHistory(history, ''), ['read src', 'run tests', 'read package'])
})

test('isAffirmative accepts explicit patch approval answers', () => {
  assert.equal(isAffirmative('y'), true)
  assert.equal(isAffirmative('apply'), true)
  assert.equal(isAffirmative('no'), false)
  assert.equal(isAffirmative(''), false)
})
