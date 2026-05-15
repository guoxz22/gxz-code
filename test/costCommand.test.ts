import test from 'node:test'
import assert from 'node:assert/strict'
import { renderSessionCost } from '../src/commands/costCommand.js'

test('renderSessionCost estimates saved session cost', () => {
  const output = renderSessionCost({
    id: 's',
    title: 'S',
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    cwd: process.cwd(),
    provider: 'glm-openai',
    model: 'glm-5.1',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ],
  })
  assert.match(output, /estimatedCostUsd/)
})
