import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export type McpServerConfig = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpConfig = {
  servers?: Record<string, McpServerConfig>
}

type PooledClient = {
  serverName: string
  client: Client
  close(): Promise<void>
}

export class McpClientPool {
  private clients = new Map<string, Promise<PooledClient>>()

  constructor(
    private readonly cwd: string,
    private readonly explicitPath?: string,
  ) {}

  async get(serverName: string): Promise<PooledClient> {
    const existing = this.clients.get(serverName)
    if (existing) return existing
    const pending = this.connect(serverName)
    pending.catch(() => this.clients.delete(serverName))
    this.clients.set(serverName, pending)
    return pending
  }

  async close(): Promise<void> {
    const clients = await Promise.all([...this.clients.values()])
    this.clients.clear()
    await Promise.allSettled(clients.map((client) => client.close()))
  }

  private async connect(serverName: string): Promise<PooledClient> {
    const config = await loadMcpConfig(this.cwd, this.explicitPath)
    const server = config.servers?.[serverName]
    if (!server) throw new Error(`MCP server not configured: ${serverName}`)
    const client = await connectMcp(serverName, server)
    return {
      serverName,
      client,
      close: () => client.close(),
    }
  }
}

export async function loadMcpConfig(cwd: string, explicitPath?: string): Promise<McpConfig> {
  const path = mcpConfigPath(cwd, explicitPath)
  if (!existsSync(path)) return {}
  const config = JSON.parse(await readFile(path, 'utf8')) as McpConfig
  return config
}

export async function saveMcpConfig(cwd: string, config: McpConfig, explicitPath?: string): Promise<string> {
  const path = mcpConfigPath(cwd, explicitPath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(normalizeMcpConfig(config), null, 2)}\n`, 'utf8')
  return path
}

export async function addMcpServer(
  cwd: string,
  name: string,
  server: McpServerConfig,
  explicitPath?: string,
): Promise<string> {
  validateMcpServerName(name)
  validateMcpServer(server)
  const config = await loadMcpConfig(cwd, explicitPath)
  const servers = { ...(config.servers ?? {}) }
  servers[name] = {
    ...(server.command ? { command: server.command } : {}),
    ...(server.args?.length ? { args: server.args } : {}),
    ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.headers && Object.keys(server.headers).length ? { headers: server.headers } : {}),
  }
  const path = await saveMcpConfig(cwd, { ...config, servers }, explicitPath)
  return `Saved MCP server ${name} to ${path}.`
}

export async function removeMcpServer(cwd: string, name: string, explicitPath?: string): Promise<string> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const servers = { ...(config.servers ?? {}) }
  if (!servers[name]) return `MCP server not configured: ${name}`
  delete servers[name]
  const path = await saveMcpConfig(cwd, { ...config, servers }, explicitPath)
  return `Removed MCP server ${name} from ${path}.`
}

export async function renderMcpServers(cwd: string, explicitPath?: string): Promise<string> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const entries = Object.entries(config.servers ?? {})
  if (!entries.length) return 'No MCP servers configured.'
  return entries.map(([name, server]) => [
    `${name}: ${server.url ?? `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}`}`,
    server.env && Object.keys(server.env).length ? `  env: ${Object.keys(server.env).join(', ')}` : undefined,
  ].filter(Boolean).join('\n')).join('\n')
}

export async function testMcpServer(cwd: string, name: string, explicitPath?: string): Promise<string> {
  const client = await connectConfiguredMcp(cwd, name, explicitPath)
  try {
    const [tools, resources, prompts] = await Promise.allSettled([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ])
    return [
      `MCP server ${name}: ok`,
      `  tools: ${settledCount(tools, 'tools')}`,
      `  resources: ${settledCount(resources, 'resources')}`,
      `  prompts: ${settledCount(prompts, 'prompts')}`,
    ].join('\n')
  } finally {
    await client.close()
  }
}

export async function listMcpTools(cwd: string, explicitPath?: string): Promise<string> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const servers = Object.entries(config.servers ?? {})
  if (!servers.length) return 'No MCP servers configured.'
  const lines: string[] = []
  for (const [name, server] of servers) {
    const client = await connectMcp(name, server)
    try {
      const tools = await client.listTools()
      lines.push(`# ${name}`)
      for (const tool of tools.tools) lines.push(`- ${tool.name}: ${tool.description ?? ''}`)
    } finally {
      await client.close()
    }
  }
  return lines.join('\n')
}

export async function listMcpResources(cwd: string, explicitPath?: string): Promise<string> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const servers = Object.entries(config.servers ?? {})
  if (!servers.length) return 'No MCP servers configured.'
  const lines: string[] = []
  for (const [name, server] of servers) {
    const client = await connectMcp(name, server)
    try {
      const resources = await client.listResources()
      lines.push(`# ${name}`)
      for (const resource of resources.resources) {
        lines.push(`- ${resource.uri}: ${resource.name}${resource.description ? ` - ${resource.description}` : ''}`)
      }
    } catch (error) {
      lines.push(`# ${name}`)
      lines.push(`resources unavailable: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await client.close()
    }
  }
  return lines.join('\n')
}

export async function listMcpPrompts(cwd: string, explicitPath?: string): Promise<string> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const servers = Object.entries(config.servers ?? {})
  if (!servers.length) return 'No MCP servers configured.'
  const lines: string[] = []
  for (const [name, server] of servers) {
    const client = await connectMcp(name, server)
    try {
      const prompts = await client.listPrompts()
      lines.push(`# ${name}`)
      for (const prompt of prompts.prompts) {
        lines.push(`- ${prompt.name}: ${prompt.description ?? ''}`)
      }
    } catch (error) {
      lines.push(`# ${name}`)
      lines.push(`prompts unavailable: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await client.close()
    }
  }
  return lines.join('\n')
}

export async function callMcpTool(
  cwd: string,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  pool?: McpClientPool,
  explicitPath?: string,
): Promise<string> {
  const pooled = pool ? await pool.get(serverName) : undefined
  const client = pooled?.client ?? await connectConfiguredMcp(cwd, serverName, explicitPath)
  try {
    const result = await client.callTool({ name: toolName, arguments: args })
    return JSON.stringify(result.content ?? result, null, 2)
  } finally {
    if (!pool) await client.close()
  }
}

export async function readMcpResource(
  cwd: string,
  serverName: string,
  uri: string,
  pool?: McpClientPool,
  explicitPath?: string,
): Promise<string> {
  const pooled = pool ? await pool.get(serverName) : undefined
  const client = pooled?.client ?? await connectConfiguredMcp(cwd, serverName, explicitPath)
  try {
    const result = await client.readResource({ uri })
    return JSON.stringify(result.contents ?? result, null, 2)
  } finally {
    if (!pool) await client.close()
  }
}

export async function getMcpPrompt(
  cwd: string,
  serverName: string,
  name: string,
  args: Record<string, unknown>,
  pool?: McpClientPool,
  explicitPath?: string,
): Promise<string> {
  const pooled = pool ? await pool.get(serverName) : undefined
  const client = pooled?.client ?? await connectConfiguredMcp(cwd, serverName, explicitPath)
  try {
    const result = await client.getPrompt({ name, arguments: stringifyPromptArgs(args) })
    return JSON.stringify(result.messages ?? result, null, 2)
  } finally {
    if (!pool) await client.close()
  }
}

async function connectMcp(name: string, server: McpServerConfig): Promise<Client> {
  const client = new Client({ name: `gxz-code-${name}`, version: '0.1.0' })
  const transport = server.url
    ? new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: server.headers ? { headers: server.headers } : undefined,
    })
    : new StdioClientTransport({
      command: server.command!,
      args: server.args ?? [],
      env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
    })
  await client.connect(transport)
  return client
}

async function connectConfiguredMcp(cwd: string, serverName: string, explicitPath?: string): Promise<Client> {
  const config = await loadMcpConfig(cwd, explicitPath)
  const server = config.servers?.[serverName]
  if (!server) throw new Error(`MCP server not configured: ${serverName}`)
  return connectMcp(serverName, server)
}

function stringifyPromptArgs(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
}

function mcpConfigPath(cwd: string, explicitPath?: string): string {
  return explicitPath ?? process.env.GXZ_MCP_CONFIG ?? resolve(cwd, '.gxz-code', 'mcp.json')
}

function normalizeMcpConfig(config: McpConfig): McpConfig {
  return {
    ...config,
    servers: Object.fromEntries(Object.entries(config.servers ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  }
}

function validateMcpServerName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error('MCP server name may only contain letters, numbers, dot, underscore, and dash.')
  }
}

function validateMcpServer(server: McpServerConfig): void {
  if (server.url) return
  if (server.command?.trim()) return
  throw new Error('MCP server must define either command or url.')
}

function settledCount(
  result: PromiseSettledResult<{ tools?: unknown[]; resources?: unknown[]; prompts?: unknown[] }>,
  key: 'tools' | 'resources' | 'prompts',
): string {
  if (result.status === 'rejected') return `unavailable (${result.reason instanceof Error ? result.reason.message : String(result.reason)})`
  return String(result.value[key]?.length ?? 0)
}
