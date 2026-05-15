import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyWorkspaceEdit, parseLspArgs, runLspCodeActions, runLspHoverOrReferences } from '../src/lspClient.js'

test('runLspCodeActions speaks JSON-RPC LSP over stdio', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-lsp-'))
  try {
    const server = join(cwd, 'fake-lsp.mjs')
    const source = join(cwd, 'demo.ts')
    await writeFile(source, 'const x = 1\n', 'utf8')
    await writeFile(server, fakeLspServerSource(), 'utf8')

    const result = await runLspCodeActions(cwd, 'demo.ts', process.execPath, [server], 5000)
    assert.match(result, /Fake action/)
    assert.match(result, /quickfix/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runLspHoverOrReferences speaks hover request over stdio', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-lsp-hover-'))
  try {
    const server = join(cwd, 'fake-lsp.mjs')
    const source = join(cwd, 'demo.ts')
    await writeFile(source, 'const x = 1\n', 'utf8')
    await writeFile(server, fakeLspServerSource(), 'utf8')

    const result = await runLspHoverOrReferences(cwd, 'demo.ts', 'hover', 0, 6, process.execPath, [server], 5000)
    assert.match(result, /Fake hover/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('applyWorkspaceEdit applies simple text edits', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-lsp-edit-'))
  try {
    const source = join(cwd, 'demo.ts')
    await writeFile(source, 'const x = 1\n', 'utf8')
    const result = await applyWorkspaceEdit(cwd, {
      changes: {
        [`file:///${source.replaceAll('\\', '/')}`]: [
          {
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
            newText: 'value',
          },
        ],
      },
    })
    assert.match(result, /Applied workspace edit/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runLspCodeActions explains missing server configuration', async () => {
  const result = await runLspCodeActions(process.cwd(), 'package.json', undefined, undefined, 1000)
  assert.match(result, /GXZ_LSP_COMMAND/)
})

test('parseLspArgs validates JSON string arrays', () => {
  assert.deepEqual(parseLspArgs('["--stdio"]'), ['--stdio'])
  assert.throws(() => parseLspArgs('{"bad":true}'), /JSON string array/)
})

function fakeLspServerSource(): string {
  return `
let buffer = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const length = Number(header.match(/Content-Length: *([0-9]+)/i)[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.byteLength < bodyEnd) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString('utf8'));
    buffer = buffer.subarray(bodyEnd);
    handle(message);
  }
});
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write('Content-Length: ' + body.byteLength + '\\r\\n\\r\\n');
  process.stdout.write(body);
}
function handle(message) {
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { codeActionProvider: true } } });
  if (message.method === 'textDocument/codeAction') send({ jsonrpc: '2.0', id: message.id, result: [{ title: 'Fake action', kind: 'quickfix' }] });
  if (message.method === 'textDocument/hover') send({ jsonrpc: '2.0', id: message.id, result: { contents: { kind: 'markdown', value: 'Fake hover' } } });
  if (message.method === 'shutdown') send({ jsonrpc: '2.0', id: message.id, result: null });
  if (message.method === 'exit') process.exit(0);
}
`
}
