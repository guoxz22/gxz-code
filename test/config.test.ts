import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_GLM_OPENAI_BASE_URL, loadConfig, redactedConfig } from '../src/config.js'

test('defaults to GLM OpenAI-compatible coding endpoint', () => {
  const config = loadConfig({ cwd: process.cwd() }, {})
  assert.equal(config.provider, 'glm-openai')
  assert.equal(config.model, 'glm-5.1')
  assert.equal(config.baseUrl, DEFAULT_GLM_OPENAI_BASE_URL)
})

test('uses GLM API key aliases without exposing secret in redacted config', () => {
  const config = loadConfig({ cwd: process.cwd() }, { BIGMODEL_API_KEY: 'secret-value' })
  assert.equal(config.apiKey, 'secret-value')
  assert.equal(redactedConfig(config).apiKey, '<set>')
  assert.equal(JSON.stringify(redactedConfig(config)).includes('secret-value'), false)
})
