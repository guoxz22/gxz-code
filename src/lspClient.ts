import { readFile, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveInside } from './tools/path.js'

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export type LspClientOptions = {
  command: string
  args?: string[]
  cwd: string
  timeoutMs: number
}

export class LspClient {
  private child?: ChildProcessWithoutNullStreams
  private nextId = 1
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, PendingRequest>()

  constructor(private readonly options: LspClientOptions) {}

  start(): void {
    if (this.child) return
    this.child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      windowsHide: true,
      shell: false,
    })
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.stderr.on('data', () => undefined)
    this.child.on('error', (error) => this.rejectAll(error))
    this.child.on('exit', (code) => {
      if (this.pending.size) this.rejectAll(new Error(`LSP server exited with code ${code ?? 'unknown'}.`))
    })
  }

  async request(method: string, params: unknown): Promise<unknown> {
    this.start()
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method}`))
      }, this.options.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    this.write(payload)
    return promise
  }

  notify(method: string, params: unknown): void {
    this.start()
    this.write({ jsonrpc: '2.0', method, params })
  }

  async close(): Promise<void> {
    if (!this.child) return
    const child = this.child
    try {
      await this.request('shutdown', null).catch(() => undefined)
      this.notify('exit', null)
    } finally {
      if (child.exitCode === null) child.kill()
      await waitForExit(child, 1000)
      this.child = undefined
    }
  }

  private write(payload: unknown): void {
    if (!this.child) throw new Error('LSP client has not been started.')
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    this.child.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`)
    this.child.stdin.write(body)
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) throw new Error('LSP response missing Content-Length.')
      const length = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (this.buffer.byteLength < bodyEnd) return
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.subarray(bodyEnd)
      this.handleMessage(JSON.parse(body) as Record<string, unknown>)
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(JSON.stringify(message.error)))
      return
    }
    pending.resolve(message.result)
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

export async function runLspCodeActions(
  cwd: string,
  relativePath: string,
  command: string | undefined,
  args: string[] | undefined,
  timeoutMs: number,
): Promise<string> {
  if (!command) {
    return 'Real LSP actions require GXZ_LSP_COMMAND, for example: GXZ_LSP_COMMAND=typescript-language-server GXZ_LSP_ARGS=\'["--stdio"]\'.'
  }
  const absolute = resolveInside(cwd, relativePath)
  const text = await readFile(absolute, 'utf8')
  const uri = pathToFileURL(absolute).toString()
  const client = new LspClient({ command, args, cwd, timeoutMs })
  try {
    await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(cwd).toString(),
      capabilities: {},
    })
    client.notify('initialized', {})
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForPath(relativePath),
        version: 1,
        text,
      },
    })
    const lineCount = text.split(/\r?\n/).length
    const result = await client.request('textDocument/codeAction', {
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: Math.max(0, lineCount - 1), character: 0 },
      },
      context: { diagnostics: [] },
    })
    return JSON.stringify(result ?? [], null, 2)
  } finally {
    await client.close()
  }
}

export async function runLspHoverOrReferences(
  cwd: string,
  relativePath: string,
  action: 'hover' | 'references',
  line: number,
  character: number,
  command: string | undefined,
  args: string[] | undefined,
  timeoutMs: number,
): Promise<string> {
  if (!command) {
    return 'Real LSP hover/references require GXZ_LSP_COMMAND, for example: GXZ_LSP_COMMAND=typescript-language-server GXZ_LSP_ARGS=\'["--stdio"]\'.'
  }
  const absolute = resolveInside(cwd, relativePath)
  const text = await readFile(absolute, 'utf8')
  const uri = pathToFileURL(absolute).toString()
  const client = new LspClient({ command, args, cwd, timeoutMs })
  try {
    await client.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(cwd).toString(),
      capabilities: {},
    })
    client.notify('initialized', {})
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: languageIdForPath(relativePath),
        version: 1,
        text,
      },
    })
    const method = action === 'hover' ? 'textDocument/hover' : 'textDocument/references'
    const params = {
      textDocument: { uri },
      position: { line, character },
      ...(action === 'references' ? { context: { includeDeclaration: true } } : {}),
    }
    const result = await client.request(method, params)
    return JSON.stringify(result ?? null, null, 2)
  } finally {
    await client.close()
  }
}

export type WorkspaceEdit = {
  changes?: Record<string, Array<{
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    newText: string
  }>>
}

export async function applyWorkspaceEdit(cwd: string, edit: WorkspaceEdit): Promise<string> {
  const changes = Object.entries(edit.changes ?? {})
  if (!changes.length) return 'Workspace edit has no changes.'
  const touched: string[] = []
  for (const [uri, edits] of changes) {
    const path = fileURLToPath(uri)
    resolveInside(cwd, path)
    let content = await readFile(path, 'utf8')
    const sorted = [...edits].sort((a, b) => positionOffset(content, b.range.start) - positionOffset(content, a.range.start))
    for (const textEdit of sorted) {
      const start = positionOffset(content, textEdit.range.start)
      const end = positionOffset(content, textEdit.range.end)
      content = `${content.slice(0, start)}${textEdit.newText}${content.slice(end)}`
    }
    await writeFile(path, content, 'utf8')
    touched.push(path)
  }
  return `Applied workspace edit to ${touched.length} file(s):\n${touched.join('\n')}`
}

export function parseLspArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('GXZ_LSP_ARGS must be a JSON string array.')
  }
  return parsed
}

function languageIdForPath(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  return 'plaintext'
}

function positionOffset(content: string, position: { line: number; character: number }): number {
  const lines = content.split('\n')
  let offset = 0
  for (let index = 0; index < position.line; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset + position.character
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
