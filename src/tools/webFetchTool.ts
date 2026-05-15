import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ToolDefinition } from '../types.js'

export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    description: 'Fetch a URL and return text content. Use for documentation or issue pages when the user asks for external context.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP or HTTPS URL.' },
        maxBytes: { type: 'number', description: 'Maximum bytes to return. Default 60000.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async execute(input) {
      if (typeof input.url !== 'string') throw new Error('Expected url to be a string.')
      const url = new URL(input.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Unsupported URL protocol: ${url.protocol}`)
      }
      await assertPublicHttpTarget(url)
      const maxBytes = typeof input.maxBytes === 'number' ? input.maxBytes : 60_000
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal, redirect: 'error' })
      } finally {
        clearTimeout(timeout)
      }
      const text = await readLimitedText(response, maxBytes)
      const prefix = `HTTP ${response.status} ${response.statusText}\nURL: ${url.toString()}\n\n`
      return prefix + text
    },
  }
}

async function assertPublicHttpTarget(url: URL): Promise<void> {
  const hostname = url.hostname
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true })

  for (const { address } of addresses) {
    if (!isPublicAddress(address)) {
      throw new Error(`Blocked private or local web_fetch target: ${hostname}`)
    }
  }
}

function isPublicAddress(address: string): boolean {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return false
  if (address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return false
  if (address.includes(':')) return true

  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a >= 224) return false
  return true
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text()
  return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n\n[truncated]` : text
}
