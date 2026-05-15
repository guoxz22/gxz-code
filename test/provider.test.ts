import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenAICompatibleProvider } from '../src/providers/openaiCompatible.js'
import { createAnthropicCompatibleProvider } from '../src/providers/anthropicCompatible.js'

test('OpenAI-compatible provider posts chat completions and parses tool calls', async () => {
  let capturedUrl = ''
  let capturedBody: unknown
  const provider = createOpenAICompatibleProvider({
    name: 'glm-openai',
    baseUrl: 'https://example.test/api/coding/paas/v4',
    apiKey: 'key',
    fetchImpl: async (url, init) => {
      capturedUrl = url
      capturedBody = JSON.parse(String(init.body))
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: 'thinking',
            tool_calls: [{
              id: 'call-1',
              function: { name: 'read_file', arguments: '{"path":"package.json"}' },
            }],
          },
        }],
      }))
    },
  })

  const response = await provider.send({
    model: 'glm-5.1',
    messages: [{ role: 'user', content: 'read package' }],
    tools: [],
  })

  assert.equal(capturedUrl, 'https://example.test/api/coding/paas/v4/chat/completions')
  assert.equal((capturedBody as { model: string }).model, 'glm-5.1')
  assert.equal(response.text, 'thinking')
  assert.deepEqual(response.toolCalls[0], {
    id: 'call-1',
    name: 'read_file',
    arguments: { path: 'package.json' },
  })
})

test('Anthropic-compatible provider posts /v1/messages and parses tool use', async () => {
  let capturedUrl = ''
  const provider = createAnthropicCompatibleProvider({
    name: 'glm-anthropic',
    baseUrl: 'https://example.test/api/anthropic',
    apiKey: 'key',
    fetchImpl: async (url) => {
      capturedUrl = url
      return new Response(JSON.stringify({
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'toolu-1', name: 'list_files', input: { path: '.' } },
        ],
      }))
    },
  })

  const response = await provider.send({
    model: 'glm-4.5-air',
    messages: [{ role: 'user', content: 'list' }],
    tools: [],
  })

  assert.equal(capturedUrl, 'https://example.test/api/anthropic/v1/messages')
  assert.equal(response.text, 'ok')
  assert.deepEqual(response.toolCalls[0], {
    id: 'toolu-1',
    name: 'list_files',
    arguments: { path: '.' },
  })
})

test('OpenAI-compatible provider rejects malformed tool-call arguments', async () => {
  const provider = createOpenAICompatibleProvider({
    name: 'glm-openai',
    baseUrl: 'https://example.test/api/coding/paas/v4',
    apiKey: 'key',
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call-1',
            function: { name: 'read_file', arguments: '{bad json' },
          }],
        },
      }],
    })),
  })

  await assert.rejects(() => provider.send({
    model: 'glm-5.1',
    messages: [{ role: 'user', content: 'read' }],
    tools: [],
  }), /Malformed tool-call arguments JSON/)
})

test('OpenAI-compatible provider streams text and tool calls', async () => {
  const chunks = [
    sse({ choices: [{ delta: { content: 'hel' } }] }),
    sse({ choices: [{ delta: { content: 'lo' } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_file', arguments: '{"path"' } }] } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"README.md"}' } }] } }] }),
    'data: [DONE]\n\n',
  ]
  const provider = createOpenAICompatibleProvider({
    name: 'glm-openai',
    baseUrl: 'https://example.test/api/coding/paas/v4',
    apiKey: 'key',
    fetchImpl: async () => new Response(ReadableStream.from(chunks.map((chunk) => new TextEncoder().encode(chunk))), {
      headers: { 'content-type': 'text/event-stream' },
    }),
  })
  const deltas: string[] = []
  const response = await provider.send({
    model: 'glm-5.1',
    messages: [{ role: 'user', content: 'stream' }],
    tools: [],
    stream: true,
    onDelta: (event) => {
      if (event.type === 'text_delta') deltas.push(event.text)
    },
  })
  assert.equal(response.text, 'hello')
  assert.deepEqual(deltas, ['hel', 'lo'])
  assert.deepEqual(response.toolCalls[0], {
    id: 'call-1',
    name: 'read_file',
    arguments: { path: 'README.md' },
  })
})

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`
}
