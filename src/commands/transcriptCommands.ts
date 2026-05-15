import type { SessionRecord } from '../types.js'

export function renderTranscript(session: SessionRecord): string {
  const lines = [
    `# GXZ-code Session ${session.id}`,
    '',
    `- Title: ${session.title}`,
    `- Provider/model: ${session.provider}/${session.model}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    `- CWD: ${session.cwd}`,
    '',
  ]

  for (const message of session.messages) {
    const label = message.toolCallId ? `${message.role} ${message.toolCallId}` : message.role
    lines.push(`## ${label}`, '', message.content || '[no text]', '')
    if (message.toolCalls?.length) {
      lines.push('Tool calls:', '')
      for (const toolCall of message.toolCalls) {
        lines.push(`- ${toolCall.id}: ${toolCall.name} ${JSON.stringify(toolCall.arguments)}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function searchTranscript(session: SessionRecord, query: string): string {
  const needle = query.toLowerCase()
  const matches = session.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.content.toLowerCase().includes(needle))
    .map(({ message, index }) => {
      const preview = message.content.replace(/\s+/g, ' ').slice(0, 180)
      return `${index + 1}\t${message.role}\t${preview}`
    })

  return matches.join('\n') || '[no matches]'
}
