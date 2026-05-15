import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMemory, initProjectMemory, renderMemory } from '../src/memory.js'
import { createCustomCommand, expandCustomCommand, findCustomCommand, listCustomCommands } from '../src/customCommands.js'
import { renderHooks, runHooks } from '../src/hooks.js'
import { buildSystemPrompt } from '../src/systemPrompt.js'

test('memory files initialize, append, render, and enter system prompt', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-memory-'))
  try {
    assert.match(await initProjectMemory(cwd), /Created/)
    assert.match(await addMemory(cwd, 'local', 'Prefer focused tests.'), /Added memory/)
    const rendered = await renderMemory(cwd)
    assert.match(rendered, /Prefer focused tests/)
    const prompt = await buildSystemPrompt(cwd)
    assert.match(prompt, /Persistent memory/)
    assert.match(prompt, /Prefer focused tests/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('custom markdown slash commands load and expand arguments', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-commands-'))
  try {
    await createCustomCommand(cwd, 'project', 'explain', 'Explain this: $ARGUMENTS')
    const commands = await listCustomCommands(cwd)
    assert.equal(commands.some((command) => command.name === 'explain'), true)
    const command = await findCustomCommand(cwd, 'explain')
    assert.ok(command)
    assert.equal(expandCustomCommand(command, ['src/index.ts']), 'Explain this: src/index.ts')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('hooks render and run configured commands', async () => {
  const output = await runHooks({
    UserPromptSubmit: [{ command: 'node -e "console.log(process.env.GXZ_HOOK_EVENT)"' }],
  }, 'UserPromptSubmit', {
    event: 'UserPromptSubmit',
    cwd: process.cwd(),
    prompt: 'hello',
  })
  assert.match(output.join('\n'), /UserPromptSubmit/)
  assert.match(renderHooks({ SessionStart: [{ command: 'echo start' }] }), /SessionStart/)
})
