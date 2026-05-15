import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactMessages } from '../src/compact.js'
import type { ModelProvider } from '../src/types.js'

test('compactMessages replaces long history with summary system message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gxz-compact-'))
  try {
    const skillDir = join(root, '.gxz-code', 'skills', 'demo')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'keep workspace rule', 'utf8')
    await writeFile(join(skillDir, 'SKILL.md'), '---\ndescription: Demo skill\n---\n# Demo\n', 'utf8')
    const provider: ModelProvider = {
      name: 'glm-openai',
      async send(request) {
        assert.match(request.messages[1]!.content, /first/)
        assert.match(request.messages[1]!.content, /Tool calls:/)
        return { text: 'summary', toolCalls: [] }
      },
    }

    const compacted = await compactMessages({
      provider,
      model: 'glm-5.1',
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second', toolCalls: [{ id: 't1', name: 'read_file', arguments: { path: 'a' } }] },
        { role: 'user', content: 'third' },
      ],
      tools: [],
      maxOutputTokens: 4000,
      temperature: 0,
      cwd: root,
    })

    assert.equal(compacted.length, 1)
    assert.match(compacted[0]!.content, /summary/)
    assert.match(compacted[0]!.content, /keep workspace rule/)
    assert.match(compacted[0]!.content, /Demo skill/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
