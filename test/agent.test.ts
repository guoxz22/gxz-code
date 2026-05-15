import test from 'node:test'
import assert from 'node:assert/strict'
import { runAgent } from '../src/agent.js'
import type { ModelProvider, ModelRequest, ModelResponse } from '../src/types.js'

test('agent executes model-requested tool and returns final answer', async () => {
  const calls: ModelRequest[] = []
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(request): Promise<ModelResponse> {
      calls.push(request)
      if (calls.length === 1) {
        return {
          text: '',
          toolCalls: [{ id: 'call-1', name: 'fake_tool', arguments: { value: 'abc' } }],
        }
      }
      return { text: 'done', toolCalls: [] }
    },
  }

  const result = await runAgent({
    provider,
    model: 'glm-5.1',
    prompt: 'use tool',
    cwd: process.cwd(),
    allowShell: false,
    maxTurns: 3,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
    tools: [{
      name: 'fake_tool',
      description: 'fake',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      async execute(input) {
        return `tool:${String(input.value)}`
      },
    }],
  })

  assert.equal(result.text, 'done')
  assert.equal(result.toolCalls.length, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[1]!.messages.at(-1)?.content, 'tool:abc')
  assert.equal(result.usage?.model, 'glm-5.1')
  assert.ok((result.usage?.inputTokensApprox ?? 0) > 0)
})

test('agent preserves prior conversation history', async () => {
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(request): Promise<ModelResponse> {
      assert.equal(request.messages[1]!.content, 'earlier')
      assert.equal(request.messages.at(-1)!.content, 'next')
      return { text: 'continued', toolCalls: [] }
    },
  }

  const result = await runAgent({
    provider,
    model: 'glm-5.1',
    prompt: 'next',
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
    ],
    cwd: process.cwd(),
    allowShell: false,
    maxTurns: 1,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
    tools: [],
  })

  assert.equal(result.text, 'continued')
})

test('agent enforces permission policy before tool execution', async () => {
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(): Promise<ModelResponse> {
      return {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'write_file', arguments: { path: 'x', content: 'y' } }],
      }
    },
  }

  await assert.rejects(() => runAgent({
    provider,
    model: 'glm-5.1',
    prompt: 'write',
    cwd: process.cwd(),
    allowShell: false,
    maxTurns: 1,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
    policy: { denyTools: ['write_file'] },
    tools: [{
      name: 'write_file',
      description: 'fake',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      async execute() {
        return 'should not run'
      },
    }],
  }), /denied/)
})

test('agent asks for approval before executing tools when configured', async () => {
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(request): Promise<ModelResponse> {
      if (request.messages.some((message) => message.role === 'tool')) {
        return { text: 'done', toolCalls: [] }
      }
      return {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'fake_tool', arguments: { value: 'abc' } }],
      }
    },
  }
  let approvals = 0
  let executions = 0
  const result = await runAgent({
    provider,
    model: 'glm-5.1',
    prompt: 'approve',
    cwd: process.cwd(),
    allowShell: false,
    maxTurns: 3,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
    approve: async () => {
      approvals += 1
      return true
    },
    tools: [{
      name: 'fake_tool',
      description: 'fake',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      async execute() {
        executions += 1
        return 'approved'
      },
    }],
  })

  assert.equal(result.text, 'done')
  assert.equal(approvals, 1)
  assert.equal(executions, 1)
})

test('agent reports rejected approvals as tool results without executing tool', async () => {
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(request): Promise<ModelResponse> {
      if (request.messages.some((message) => message.role === 'tool')) {
        assert.match(request.messages.at(-1)!.content, /rejected/)
        return { text: 'stopped', toolCalls: [] }
      }
      return {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'fake_tool', arguments: {} }],
      }
    },
  }
  let executions = 0
  const result = await runAgent({
    provider,
    model: 'glm-5.1',
    prompt: 'reject',
    cwd: process.cwd(),
    allowShell: false,
    maxTurns: 3,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
    approve: async () => false,
    tools: [{
      name: 'fake_tool',
      description: 'fake',
      parameters: { type: 'object', properties: {}, additionalProperties: true },
      async execute() {
        executions += 1
        return 'should not run'
      },
    }],
  })

  assert.equal(result.text, 'stopped')
  assert.equal(executions, 0)
})
