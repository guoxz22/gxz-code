import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateUsage } from '../src/usage.js'

test('estimateUsage returns approximate token and cost record', () => {
  const usage = estimateUsage('glm-openai', 'glm-5.1', [{ role: 'user', content: 'hello world' }], 'response text')
  assert.equal(usage.provider, 'glm-openai')
  assert.equal(usage.model, 'glm-5.1')
  assert.ok(usage.inputTokensApprox > 0)
  assert.ok(usage.outputTokensApprox > 0)
  assert.ok(usage.estimatedCostUsd > 0)
})
