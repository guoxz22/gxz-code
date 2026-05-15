import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMcpServer, loadMcpConfig, removeMcpServer, renderMcpServers } from '../src/mcp.js'

test('MCP servers can be added, rendered, and removed from local config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-mcp-'))
  try {
    const added = await addMcpServer(cwd, 'docs', {
      command: 'node',
      args: ['server.js'],
      env: { DOCS_ROOT: 'docs' },
    })
    assert.match(added, /Saved MCP server docs/)

    const config = await loadMcpConfig(cwd)
    assert.deepEqual(config.servers?.docs, {
      command: 'node',
      args: ['server.js'],
      env: { DOCS_ROOT: 'docs' },
    })

    const rendered = await renderMcpServers(cwd)
    assert.match(rendered, /docs: node server\.js/)
    assert.match(rendered, /env: DOCS_ROOT/)

    const file = await readFile(join(cwd, '.gxz-code', 'mcp.json'), 'utf8')
    assert.match(file, /"docs"/)

    const removed = await removeMcpServer(cwd, 'docs')
    assert.match(removed, /Removed MCP server docs/)
    assert.equal((await renderMcpServers(cwd)), 'No MCP servers configured.')

    await addMcpServer(cwd, 'http-docs', {
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer test' },
    })
    const httpConfig = await loadMcpConfig(cwd)
    assert.equal(httpConfig.servers?.['http-docs']?.url, 'http://localhost:3000/mcp')
    assert.equal(httpConfig.servers?.['http-docs']?.headers?.Authorization, 'Bearer test')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
