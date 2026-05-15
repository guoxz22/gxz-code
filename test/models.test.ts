import test from 'node:test'
import assert from 'node:assert/strict'
import { renderModelChoices, selectModel } from '../src/models.js'
import type { RuntimeConfig } from '../src/config.js'

const baseConfig: RuntimeConfig = {
  provider: 'glm-openai',
  model: 'glm-5.1',
  baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  cwd: process.cwd(),
  maxTurns: 12,
  timeoutMs: 1000,
  allowShell: false,
  requireApproval: false,
  temperature: 0.2,
  maxOutputTokens: 4096,
}

test('selectModel maps Claude aliases to Anthropic provider', () => {
  const selected = selectModel(baseConfig, 'sonnet', {})
  assert.equal(selected.config.provider, 'anthropic')
  assert.equal(selected.config.model, 'claude-sonnet-4-6')
  assert.match(selected.note ?? '', /ANTHROPIC_API_KEY/)
})

test('selectModel maps GLM aliases to GLM provider', () => {
  const selected = selectModel(baseConfig, 'turbo', { GLM_API_KEY: 'secret' })
  assert.equal(selected.config.provider, 'glm-openai')
  assert.equal(selected.config.model, 'glm-5-turbo')
  assert.equal(selected.config.apiKey, 'secret')
})

test('selectModel supports provider prefixes and raw model inference', () => {
  assert.equal(selectModel(baseConfig, 'anthropic:haiku', {}).config.model, 'claude-haiku-4-5')
  assert.equal(selectModel(baseConfig, 'openai:gpt-4.1', {}).config.provider, 'openai')
  assert.equal(selectModel(baseConfig, 'claude-custom-model', {}).config.provider, 'anthropic')
})

test('renderModelChoices documents GLM and Claude aliases', () => {
  const rendered = renderModelChoices(baseConfig)
  assert.match(rendered, /turbo/)
  assert.match(rendered, /sonnet/)
  assert.match(rendered, /anthropic:sonnet/)
})
