import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileTools } from '../src/tools/fileTools.js'
import { resolveInside } from '../src/tools/path.js'
import { createShellTool, isReadOnlyCommand } from '../src/tools/shellTool.js'
import { createDiagnosticsTool } from '../src/tools/lspTool.js'
import { createTodoTool, readTodos } from '../src/tools/todoTool.js'
import { createWebFetchTool } from '../src/tools/webFetchTool.js'

test('file tools write, read, edit, and prevent path escape', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-tools-'))
  try {
    const tools = Object.fromEntries(createFileTools().map((tool) => [tool.name, tool]))
    const context = { cwd, allowShell: false, timeoutMs: 1000 }
    await tools.write_file!.execute({ path: 'a.txt', content: 'hello world' }, context)
    assert.equal(await tools.read_file!.execute({ path: 'a.txt' }, context), 'hello world')
    await tools.edit_file!.execute({ path: 'a.txt', oldText: 'world', newText: 'GXZ' }, context)
    assert.equal(await readFile(join(cwd, 'a.txt'), 'utf8'), 'hello GXZ')
    await assert.rejects(() => tools.read_file!.execute({ path: '../escape.txt' }, context), /escapes workspace/)
    assert.throws(() => resolveInside(cwd, join(tmpdir(), 'escape.txt')), /escapes workspace/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('diagnostics tool returns command output', async () => {
  const diagnostics = createDiagnosticsTool()
  const result = await diagnostics.execute({
    command: 'node -e "console.log(\'diag-ok\')"',
  }, { cwd: process.cwd(), allowShell: false, timeoutMs: 5000 })
  assert.match(result, /diag-ok/)
  await assert.rejects(
    () => diagnostics.execute({ command: 'node -e "require(\'fs\').rmSync(\'x\')"' }, { cwd: process.cwd(), allowShell: false, timeoutMs: 5000 }),
    /not allowed/,
  )
})

test('shell tool blocks write-like commands without allowShell', async () => {
  assert.equal(isReadOnlyCommand('git status --short'), true)
  assert.equal(isReadOnlyCommand('rm -rf dist'), false)
  assert.equal(isReadOnlyCommand('git status; rm -rf dist'), false)
  assert.equal(isReadOnlyCommand('Get-Content package.json | powershell'), false)
  assert.equal(isReadOnlyCommand('ls && rm -rf dist'), false)
  const shell = createShellTool()
  await assert.rejects(
    () => shell.execute({ command: 'rm -rf dist' }, { cwd: process.cwd(), allowShell: false, timeoutMs: 1000 }),
    /blocked/,
  )
})

test('web fetch blocks private and local targets', async () => {
  const webFetch = createWebFetchTool()
  await assert.rejects(
    () => webFetch.execute({ url: 'http://127.0.0.1:1234' }, { cwd: process.cwd(), allowShell: false, timeoutMs: 1000 }),
    /Blocked private or local/,
  )
  await assert.rejects(
    () => webFetch.execute({ url: 'http://169.254.169.254/latest/meta-data' }, { cwd: process.cwd(), allowShell: false, timeoutMs: 1000 }),
    /Blocked private or local/,
  )
})

test('todo tool writes checklist and enforces one in-progress item', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gxz-todos-'))
  try {
    const todo = createTodoTool()
    await todo.execute({
      items: [
        { content: 'inspect', status: 'completed' },
        { content: 'implement', status: 'in_progress' },
      ],
    }, { cwd, allowShell: false, timeoutMs: 1000 })
    assert.match(await readTodos(cwd), /implement/)
    await assert.rejects(
      () => todo.execute({
        items: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      }, { cwd, allowShell: false, timeoutMs: 1000 }),
      /Only one/,
    )
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
