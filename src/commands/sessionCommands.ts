import type { SessionRecord } from '../types.js'

export function renderSessions(sessions: SessionRecord[]): string {
  if (!sessions.length) return 'No saved sessions.'
  return sessions.map((session) => {
    const count = session.messages.length
    return `${session.id}\t${session.updatedAt}\t${session.provider}/${session.model}\t${count} messages\t${session.title}`
  }).join('\n')
}

export function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ')
  if (!trimmed) return 'GXZ-code session'
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}
