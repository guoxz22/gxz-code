import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export type MonitorTask = {
  id: string
  command: string
  cwd: string
  startedAt: string
  exitCode?: number | null
  output: string[]
  child: ChildProcessWithoutNullStreams
}

const tasks = new Map<string, MonitorTask>()

export function startMonitor(command: string, cwd: string, maxLines = 200): MonitorTask {
  if (!command.trim()) throw new Error('Monitor command cannot be empty.')
  const child = spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command], {
    cwd,
    windowsHide: true,
  })
  const task: MonitorTask = {
    id: randomUUID().slice(0, 8),
    command,
    cwd,
    startedAt: new Date().toISOString(),
    output: [],
    child,
  }
  const push = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      task.output.push(line)
    }
    if (task.output.length > maxLines) task.output.splice(0, task.output.length - maxLines)
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('exit', (code) => {
    task.exitCode = code
  })
  tasks.set(task.id, task)
  return task
}

export function listMonitors(): string {
  if (!tasks.size) return 'No monitor tasks.'
  return [...tasks.values()].map((task) =>
    `${task.id}\t${monitorStatus(task)}\t${task.command}\tstarted=${task.startedAt}`
  ).join('\n')
}

export function readMonitor(id: string, lines = 80): string {
  const task = tasks.get(id)
  if (!task) return `Monitor not found: ${id}`
  const output = task.output.slice(-lines).join('\n')
  return [
    `${task.id}\t${monitorStatus(task)}\t${task.command}`,
    output || '[no output yet]',
  ].join('\n')
}

export function stopMonitor(id: string): string {
  const task = tasks.get(id)
  if (!task) return `Monitor not found: ${id}`
  if (task.exitCode === undefined) task.child.kill()
  tasks.delete(id)
  return `Stopped monitor ${id}.`
}

export function clearMonitorsForTests(): void {
  for (const task of tasks.values()) {
    if (task.exitCode === undefined) task.child.kill()
  }
  tasks.clear()
}

function monitorStatus(task: MonitorTask): string {
  return task.exitCode === undefined ? 'running' : `exit=${task.exitCode}`
}
