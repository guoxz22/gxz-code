import test from 'node:test'
import assert from 'node:assert/strict'
import { applyEffortPreset, effortOverrides, inferEffortLevel, parseEffortLevel, renderEffort } from '../src/effort.js'
import type { RuntimeConfig } from '../src/config.js'

const baseConfig: RuntimeConfig = {
  provider: 'glm-openai',
  model: 'glm-5.1',
  baseUrl: 'https://example.test',
  cwd: process.cwd(),
  maxTurns: 12,
  timeoutMs: 1000,
  allowShell: false,
  requireApproval: false,
  temperature: 0.2,
  maxOutputTokens: 4096,
}

test('effort presets map levels to runtime config', () => {
  const high = applyEffortPreset(baseConfig, 'high')
  assert.equal(high.maxTurns, 20)
  assert.equal(high.maxOutputTokens, 8192)
  assert.equal(high.temperature, 0.2)
  assert.equal(inferEffortLevel(high), 'high')
})

test('effortOverrides supports CLI parsing', () => {
  assert.deepEqual(effortOverrides(parseEffortLevel('xhigh')), {
    maxTurns: 30,
    maxOutputTokens: 12000,
    temperature: 0.1,
  })
  assert.throws(() => parseEffortLevel('huge'), /Unsupported effort/)
})

test('renderEffort shows current and available presets', () => {
  const rendered = renderEffort(baseConfig)
  assert.match(rendered, /Current effort: medium/)
  assert.match(rendered, /xhigh/)
})
