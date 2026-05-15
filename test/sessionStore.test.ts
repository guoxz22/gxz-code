import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSession, createSessionStore, sanitizeId, updateSession } from '../src/sessionStore.js'

test('session store saves, lists, loads, and deletes sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gxz-sessions-'))
  try {
    const store = createSessionStore(dir)
    const session = createSession({
      id: 'demo',
      title: 'Demo',
      cwd: process.cwd(),
      provider: 'glm-openai',
      model: 'glm-5.1',
      messages: [{ role: 'user', content: 'hello' }],
    })
    await store.save(session)
    assert.equal((await store.list()).length, 1)
    assert.equal((await store.load('demo')).title, 'Demo')
    await store.save(updateSession(session, { messages: [{ role: 'user', content: 'updated' }] }))
    assert.equal((await store.load('demo')).messages[0]!.content, 'updated')
    await store.save({ ...session, id: '../escape' })
    assert.equal((await store.load('..-escape')).id, '..-escape')
    await store.delete('demo')
    await store.delete('..-escape')
    assert.equal((await store.list()).length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('session ids are filesystem safe', () => {
  assert.equal(sanitizeId('a/b c'), 'a-b-c')
})
