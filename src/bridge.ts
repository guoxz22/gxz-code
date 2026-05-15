import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { RuntimeConfig } from './config.js'
import { createProvider } from './providers/index.js'
import { runAgent } from './agent.js'
import { createAgentTools, createDefaultTools } from './tools/index.js'
import { loadPolicy } from './policy.js'
import { renderGitDiff, renderGitStatus } from './commands/gitCommands.js'
import { createSessionStore } from './sessionStore.js'
import { createDiagnosticsTool, runCodeAction } from './tools/lspTool.js'

export async function startBridge(config: RuntimeConfig, port: number): Promise<void> {
  const provider = createProvider(config)
  const tools = createAgentTools({
    provider,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  })

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {})
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, provider: config.provider, model: config.model })
        return
      }
      if (req.method === 'GET' && url.pathname === '/capabilities') {
        sendJson(res, 200, {
          provider: config.provider,
          model: config.model,
          tools: createDefaultTools().map((tool) => ({ name: tool.name, description: tool.description })),
          commands: ['prompt', 'diagnostics', 'code-action', 'status', 'diff', 'sessions'],
        })
        return
      }
      if (req.method === 'GET' && url.pathname === '/workspace') {
        sendJson(res, 200, { cwd: config.cwd, provider: config.provider, model: config.model })
        return
      }
      if (req.method === 'GET' && url.pathname === '/status') {
        sendJson(res, 200, { text: await renderGitStatus(config.cwd) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/diff') {
        sendJson(res, 200, { text: await renderGitDiff(config.cwd) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/sessions') {
        sendJson(res, 200, { sessions: await createSessionStore().list() })
        return
      }
      if (req.method === 'POST' && url.pathname === '/diagnostics') {
        const body = await readJson(req)
        const command = typeof body.command === 'string' ? body.command : undefined
        const text = await createDiagnosticsTool().execute(command ? { command } : {}, {
          cwd: config.cwd,
          allowShell: false,
          timeoutMs: config.timeoutMs,
        })
        sendJson(res, 200, { text })
        return
      }
      if (req.method === 'POST' && url.pathname === '/code-action') {
        const body = await readJson(req)
        if (typeof body.path !== 'string') throw new Error('Expected path string.')
        if (typeof body.action !== 'string') throw new Error('Expected action string.')
        sendJson(res, 200, { text: await runCodeAction(config.cwd, body.path, body.action, config.timeoutMs) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/prompt') {
        const body = await readJson(req)
        if (typeof body.prompt !== 'string') throw new Error('Expected prompt string.')
        const policy = await loadPolicy(config.cwd)
        const result = await runAgent({
          provider,
          model: config.model,
          prompt: body.prompt,
          cwd: config.cwd,
          tools,
          allowShell: config.allowShell,
          maxTurns: config.maxTurns,
          timeoutMs: config.timeoutMs,
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
          policy,
        })
        sendJson(res, 200, { text: result.text, toolCalls: result.toolCalls, usage: result.usage })
        return
      }
      sendJson(res, 404, { error: 'Not found' })
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  console.log(`GXZ-code bridge listening on http://127.0.0.1:${port}`)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'access-control-allow-origin': 'http://127.0.0.1',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json',
  })
  res.end(status === 204 ? undefined : JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}
