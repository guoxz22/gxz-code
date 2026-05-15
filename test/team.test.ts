import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDefaultTeamPlan, parseTeamPlan, renderTeamResults, runTeam } from '../src/team.js'
import type { ModelProvider } from '../src/types.js'

test('buildDefaultTeamPlan creates dependent team lanes', () => {
  const plan = buildDefaultTeamPlan('ship feature')
  assert.deepEqual(plan.tasks.map((task) => task.id), ['explore', 'plan', 'execute', 'verify'])
  assert.deepEqual(plan.tasks[1]!.dependsOn, ['explore'])
})

test('parseTeamPlan validates explicit team plans', () => {
  const plan = parseTeamPlan(JSON.stringify({
    tasks: [
      { id: 'a', role: 'explore', prompt: 'inspect' },
      { id: 'b', role: 'verifier', prompt: 'check', dependsOn: ['a'] },
    ],
  }))
  assert.equal(plan.tasks.length, 2)
  assert.throws(() => parseTeamPlan('{"tasks":[{"id":"x","role":"bad","prompt":"p"}]}'), /invalid role/)
})

test('runTeam executes dependency batches and renders results', async () => {
  const seen: string[] = []
  const provider: ModelProvider = {
    name: 'glm-openai',
    async send(request) {
      seen.push(request.messages.at(-1)?.content ?? '')
      return { text: `done ${seen.length}`, toolCalls: [] }
    },
  }
  const results = await runTeam({
    provider,
    model: 'glm-5.1',
    cwd: process.cwd(),
    tools: [],
    plan: parseTeamPlan(JSON.stringify({
      tasks: [
        { id: 'a', role: 'explore', prompt: 'inspect' },
        { id: 'b', role: 'planner', prompt: 'plan', dependsOn: ['a'] },
      ],
    })),
    allowShell: false,
    timeoutMs: 1000,
    temperature: 0,
    maxOutputTokens: 1000,
  })
  assert.equal(results.length, 2)
  assert.match(seen[1]!, /Dependency results/)
  assert.match(renderTeamResults(results), /# a \(explore\) - completed/)
})
