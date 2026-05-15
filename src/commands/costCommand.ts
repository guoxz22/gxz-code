import type { SessionRecord } from '../types.js'
import { estimateUsage } from '../usage.js'

export function renderSessionCost(session: SessionRecord): string {
  const output = session.messages
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n')
  const usage = estimateUsage(session.provider, session.model, session.messages, output)
  return JSON.stringify(usage, null, 2)
}
