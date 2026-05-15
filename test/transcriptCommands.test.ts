import test from 'node:test'
import assert from 'node:assert/strict'
import { renderTranscript, searchTranscript } from '../src/commands/transcriptCommands.js'
import type { SessionRecord } from '../src/types.js'

const session: SessionRecord = {
  id: 'demo',
  title: 'Demo',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:01.000Z',
  cwd: '/tmp/demo',
  provider: 'glm-openai',
  model: 'glm-5.1',
  messages: [
    { role: 'user', content: 'Find payment bug' },
    { role: 'assistant', content: 'I found the payment bug.' },
  ],
}

test('renders transcript as markdown', () => {
  const transcript = renderTranscript(session)
  assert.match(transcript, /GXZ-code Session demo/)
  assert.match(transcript, /payment bug/)
})

test('searches transcript messages', () => {
  assert.match(searchTranscript(session, 'payment'), /user/)
  assert.equal(searchTranscript(session, 'missing'), '[no matches]')
})
