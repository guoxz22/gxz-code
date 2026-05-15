export type JsonFetch = (url: string, init: RequestInit) => Promise<Response>

export async function postJson<T>(
  fetchImpl: JsonFetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${truncate(text, 2000)}`)
  }

  if (!text) return {} as T
  return JSON.parse(text) as T
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export async function* streamServerSentEvents(response: Response): AsyncGenerator<unknown> {
  if (!response.body) return
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex >= 0) {
      const rawEvent = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      const parsed = parseSseEvent(rawEvent)
      if (parsed === '[DONE]') return
      if (parsed !== undefined) yield parsed
      separatorIndex = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  const parsed = parseSseEvent(buffer)
  if (parsed !== undefined && parsed !== '[DONE]') yield parsed
}

function parseSseEvent(rawEvent: string): unknown {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (!data) return undefined
  if (data === '[DONE]') return '[DONE]'
  return JSON.parse(data) as unknown
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
