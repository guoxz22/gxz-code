const vscode = require('vscode')

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gxzCode.ask', ask),
    vscode.commands.registerCommand('gxzCode.explainSelection', explainSelection),
    vscode.commands.registerCommand('gxzCode.reviewFile', reviewFile),
    vscode.commands.registerCommand('gxzCode.diagnostics', diagnostics),
    vscode.commands.registerCommand('gxzCode.codeAction', codeAction),
  )
}

async function ask() {
  const prompt = await vscode.window.showInputBox({ prompt: 'Ask GXZ-code' })
  if (!prompt) return
  await showResponse('GXZ Code', post('/prompt', { prompt }))
}

async function explainSelection() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const selection = editor.document.getText(editor.selection)
  if (!selection.trim()) {
    vscode.window.showWarningMessage('Select code to explain.')
    return
  }
  await showResponse('GXZ Code Selection', post('/prompt', {
    prompt: `Explain this code from ${editor.document.fileName}:\n\n${selection}`,
  }))
}

async function reviewFile() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const text = editor.document.getText()
  await showResponse('GXZ Code Review', post('/prompt', {
    prompt: `Review this file for bugs, regressions, and missing tests: ${editor.document.fileName}\n\n${text}`,
  }))
}

async function diagnostics() {
  await showResponse('GXZ Diagnostics', post('/diagnostics', {}))
}

async function codeAction() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const action = await vscode.window.showQuickPick(['list', 'formatJson', 'organizeImports', 'fixAll', 'removeUnused'], {
    placeHolder: 'GXZ-code action',
  })
  if (!action) return
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const path = workspace
    ? vscode.workspace.asRelativePath(editor.document.uri, false)
    : editor.document.fileName
  await showResponse('GXZ Code Action', post('/code-action', { path, action }))
}

async function showResponse(title, responsePromise) {
  try {
    const response = await responsePromise
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: response.text ?? JSON.stringify(response, null, 2),
    })
    await vscode.window.showTextDocument(doc, { preview: false })
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
  }
}

async function post(path, body) {
  const baseUrl = vscode.workspace.getConfiguration('gxzCode').get('bridgeUrl')
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`GXZ-code bridge HTTP ${response.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

module.exports = { activate }
