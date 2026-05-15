import type { ToolDefinition } from '../types.js'
import { listMonitors, readMonitor, startMonitor, stopMonitor } from '../monitor.js'

export function createMonitorTool(): ToolDefinition {
  return {
    name: 'monitor',
    description: 'Start, list, read, or stop background terminal monitor commands.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'start, list, read, or stop.' },
        command: { type: 'string', description: 'Command for start.' },
        id: { type: 'string', description: 'Monitor id for read/stop.' },
        lines: { type: 'number', description: 'Number of lines for read. Default 80.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(input, context) {
      if (input.action === 'start') {
        if (typeof input.command !== 'string') throw new Error('monitor start requires command.')
        const task = startMonitor(input.command, context.cwd)
        return `Started monitor ${task.id}: ${task.command}`
      }
      if (input.action === 'list') return listMonitors()
      if (input.action === 'read') {
        if (typeof input.id !== 'string') throw new Error('monitor read requires id.')
        return readMonitor(input.id, typeof input.lines === 'number' ? input.lines : 80)
      }
      if (input.action === 'stop') {
        if (typeof input.id !== 'string') throw new Error('monitor stop requires id.')
        return stopMonitor(input.id)
      }
      throw new Error('Unsupported monitor action. Use start, list, read, or stop.')
    },
  }
}
