import type { ModelProvider, TeamResult, TeamRole, TeamTask, ToolDefinition } from './types.js'
import { runAgent } from './agent.js'

export type TeamPlan = {
  tasks: TeamTask[]
}

export type RunTeamOptions = {
  provider: ModelProvider
  model: string
  cwd: string
  tools: ToolDefinition[]
  plan: TeamPlan
  allowShell: boolean
  timeoutMs: number
  temperature: number
  maxOutputTokens: number
  concurrency?: number
}

export async function runTeam(options: RunTeamOptions): Promise<TeamResult[]> {
  validateTeamPlan(options.plan)
  const remaining = new Map(options.plan.tasks.map((task) => [task.id, task]))
  const results = new Map<string, TeamResult>()
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6))

  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((task) => (task.dependsOn ?? []).every((dependency) => results.has(dependency)))
      .slice(0, concurrency)
    if (!ready.length) throw new Error('Team plan has unresolved or cyclic dependencies.')

    const batch = await Promise.all(ready.map((task) => runTeamTask(options, task, results)))
    for (const result of batch) {
      results.set(result.task.id, result)
      remaining.delete(result.task.id)
    }
  }

  return options.plan.tasks.map((task) => results.get(task.id)!)
}

export function parseTeamPlan(value: string): TeamPlan {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Team plan must be a JSON object.')
  const tasks = (parsed as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) throw new Error('Team plan must contain tasks array.')
  return {
    tasks: tasks.map((rawTask, index) => parseTask(rawTask, index)),
  }
}

export function buildDefaultTeamPlan(goal: string): TeamPlan {
  if (!goal.trim()) throw new Error('Team goal cannot be empty.')
  return {
    tasks: [
      {
        id: 'explore',
        role: 'explore',
        prompt: `Map the current repository context needed for this goal:\n${goal}`,
        maxTurns: 4,
      },
      {
        id: 'plan',
        role: 'planner',
        prompt: `Create a concise implementation and validation plan for this goal:\n${goal}`,
        dependsOn: ['explore'],
        maxTurns: 3,
      },
      {
        id: 'execute',
        role: 'executor',
        prompt: `Implement the planned local changes for this goal:\n${goal}`,
        dependsOn: ['plan'],
        maxTurns: 8,
      },
      {
        id: 'verify',
        role: 'verifier',
        prompt: `Verify the result for this goal, run safe checks, and report remaining risk:\n${goal}`,
        dependsOn: ['execute'],
        maxTurns: 4,
      },
    ],
  }
}

export function renderTeamResults(results: TeamResult[], json = false): string {
  if (json) return JSON.stringify(results, null, 2)
  return results.map((result) => [
    `# ${result.task.id} (${result.task.role}) - ${result.status}`,
    result.error ? `Error: ${result.error}` : result.text.trim() || '[no text]',
  ].join('\n')).join('\n\n')
}

async function runTeamTask(
  options: RunTeamOptions,
  task: TeamTask,
  priorResults: Map<string, TeamResult>,
): Promise<TeamResult> {
  const dependencyContext = (task.dependsOn ?? [])
    .map((dependency) => priorResults.get(dependency))
    .filter((result): result is TeamResult => Boolean(result))
    .map((result) => `## ${result.task.id} (${result.status})\n${result.text}`)
    .join('\n\n')
  const prompt = [
    roleInstruction(task.role),
    'You are one lane in a coordinated GXZ-code team run. Stay inside the assigned task and report concrete findings or changes.',
    task.writeScope?.length ? `Write scope: ${task.writeScope.join(', ')}` : 'Default to read-only unless the task explicitly asks for edits.',
    dependencyContext ? `Dependency results:\n${dependencyContext}` : '',
    `Task:\n${task.prompt}`,
  ].filter(Boolean).join('\n\n')

  try {
    const result = await runAgent({
      provider: options.provider,
      model: options.model,
      prompt,
      cwd: options.cwd,
      tools: toolsForRole(options.tools, task.role, task.writeScope),
      allowShell: options.allowShell,
      maxTurns: task.maxTurns ?? 4,
      timeoutMs: options.timeoutMs,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
    })
    return { task, status: 'completed', text: result.text }
  } catch (error) {
    return { task, status: 'failed', text: '', error: error instanceof Error ? error.message : String(error) }
  }
}

function roleInstruction(role: TeamRole): string {
  switch (role) {
    case 'explore':
      return 'Role: explorer. Map files, symbols, dependencies, and evidence. Do not edit.'
    case 'planner':
      return 'Role: planner. Produce a concise execution plan, risks, and validation strategy. Do not edit.'
    case 'executor':
      return 'Role: executor. Implement the assigned slice only and verify it locally where possible.'
    case 'verifier':
      return 'Role: verifier. Check completion claims, run safe validation, and report blocking gaps. Do not edit unless explicitly tasked.'
    case 'reviewer':
      return 'Role: reviewer. Prioritize bugs, regressions, and missing tests. Findings first.'
  }
}

function toolsForRole(tools: ToolDefinition[], role: TeamRole, writeScope?: string[]): ToolDefinition[] {
  const readOnly = role === 'explore' || role === 'planner' || role === 'reviewer' || role === 'verifier'
  if (!readOnly || writeScope?.length) return tools.filter((tool) => tool.name !== 'subagent')
  return tools.filter((tool) => !['write_file', 'edit_file', 'shell', 'subagent'].includes(tool.name))
}

function validateTeamPlan(plan: TeamPlan): void {
  if (!plan.tasks.length) throw new Error('Team plan must contain at least one task.')
  const ids = new Set<string>()
  for (const task of plan.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate team task id: ${task.id}`)
    ids.add(task.id)
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for task ${task.id}`)
    }
  }
}

function parseTask(rawTask: unknown, index: number): TeamTask {
  if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) throw new Error(`Task ${index} must be an object.`)
  const task = rawTask as Record<string, unknown>
  if (typeof task.id !== 'string' || !task.id.trim()) throw new Error(`Task ${index} requires string id.`)
  if (!isTeamRole(task.role)) throw new Error(`Task ${task.id} has invalid role.`)
  if (typeof task.prompt !== 'string' || !task.prompt.trim()) throw new Error(`Task ${task.id} requires prompt.`)
  return {
    id: task.id,
    role: task.role,
    prompt: task.prompt,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : undefined,
    maxTurns: typeof task.maxTurns === 'number' ? task.maxTurns : undefined,
    writeScope: Array.isArray(task.writeScope) ? task.writeScope.map(String) : undefined,
  }
}

function isTeamRole(value: unknown): value is TeamRole {
  return value === 'explore' || value === 'planner' || value === 'executor' || value === 'verifier' || value === 'reviewer'
}
