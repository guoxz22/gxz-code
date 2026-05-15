import { emitKeypressEvents } from 'node:readline'
import { createInterface, type Interface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  apiKeyForProvider,
  defaultBaseUrl,
  defaultModelForProvider,
  loadConfig,
  parseProvider,
  type RuntimeConfig,
} from './config.js'
import { createProvider } from './providers/index.js'
import { runAgent, type AgentEvent } from './agent.js'
import { createAgentTools, createDefaultTools } from './tools/index.js'
import { loadPolicy, type PermissionPolicy } from './policy.js'
import { createSession, createSessionStore, updateSession } from './sessionStore.js'
import { renderSessions, titleFromPrompt } from './commands/sessionCommands.js'
import { renderConfig } from './commands/configCommand.js'
import { renderDoctor } from './commands/doctorCommand.js'
import { renderSessionCost } from './commands/costCommand.js'
import { renderGitDiff, renderGitStatus } from './commands/gitCommands.js'
import { initWorkspace } from './commands/initCommand.js'
import { buildReviewPrompt } from './commands/reviewCommand.js'
import { compactMessages } from './compact.js'
import { listSkills } from './skills.js'
import { addMemory, initProjectMemory, renderMemory } from './memory.js'
import { createCustomCommand, expandCustomCommand, findCustomCommand, listCustomCommands, renderCustomCommands } from './customCommands.js'
import { loadHooks, renderHooks, runHooks, type HookConfig } from './hooks.js'
import {
  addMcpServer,
  callMcpTool,
  getMcpPrompt,
  listMcpPrompts,
  listMcpResources,
  listMcpTools,
  readMcpResource,
  removeMcpServer,
  renderMcpServers,
  testMcpServer,
} from './mcp.js'
import { createDiagnosticsTool, runCodeAction } from './tools/lspTool.js'
import { createPatchTool } from './tools/patchTool.js'
import { buildDefaultTeamPlan, renderTeamResults, runTeam } from './team.js'
import { buildLocalPrReview, defaultPrToken, fetchPrSummary, parsePrPlatform, publishPrComment } from './pr.js'
import { estimateUsage } from './usage.js'
import { applyEffortPreset, parseEffortLevel, renderEffort } from './effort.js'
import { isGitHubWriteAction, parseGitHubCliAction, runGitHubCli } from './github.js'
import { renderModelChoices, selectModel } from './models.js'
import { listMonitors, readMonitor, startMonitor, stopMonitor } from './monitor.js'
import { parseWorktreeAction, runWorktree } from './worktree.js'
import {
  approvalDecisionFromMemory,
  clearApprovalMemory,
  isRiskyTool,
  loadApprovalMemory,
  rememberApproval,
  renderApprovalMemory,
  saveApprovalMemory,
  type ApprovalMemory,
} from './approvals.js'
import type { ApprovalRequest, ChatMessage, ModelProvider, SessionRecord, ToolCall, ToolDefinition, UsageRecord } from './types.js'

export type TuiOptions = {
  config: RuntimeConfig
  sessionId?: string
  resume?: boolean
  policy?: PermissionPolicy
}

type ApprovalMode = 'off' | 'risky' | 'all'

export type SlashSuggestion = {
  command: string
  usage: string
  description: string
}

const tuiInputHistory: string[] = []

type TuiContext = {
  config: RuntimeConfig
  session?: SessionRecord
  messages: ChatMessage[]
  tools: ToolDefinition[]
  approvalMode: ApprovalMode
  lastUsage?: UsageRecord
}

export async function runTui(options: TuiOptions): Promise<void> {
  let activeConfig: RuntimeConfig = { ...options.config }
  let provider: ModelProvider = createProvider(activeConfig)
  let tools = createAgentTools({
    provider,
    model: activeConfig.model,
    temperature: activeConfig.temperature,
    maxOutputTokens: activeConfig.maxOutputTokens,
  })
  const policy = options.policy ?? await loadPolicy(activeConfig.cwd)
  const hooks = await loadHooks(activeConfig.cwd)
  const store = createSessionStore()
  const rl = createInterface({ input, output })
  let session: SessionRecord | undefined = options.resume && options.sessionId ? await store.load(options.sessionId) : undefined
  let activeSessionId = session?.id ?? options.sessionId
  let messages: ChatMessage[] = session?.messages ?? []
  let lastUsage: UsageRecord | undefined
  let approvalMode: ApprovalMode = activeConfig.requireApproval ? 'all' : 'risky'

  const rebuildProvider = (): void => {
    provider = createProvider(activeConfig)
    tools = createAgentTools({
      provider,
      model: activeConfig.model,
      temperature: activeConfig.temperature,
      maxOutputTokens: activeConfig.maxOutputTokens,
    })
  }

  const saveActiveSession = async (titlePrompt?: string): Promise<void> => {
    session = session
      ? updateSession(session, { messages, provider: activeConfig.provider, model: activeConfig.model, cwd: activeConfig.cwd })
      : createSession({
        id: activeSessionId,
        title: titleFromPrompt(titlePrompt ?? 'GXZ-code session'),
        cwd: activeConfig.cwd,
        provider: activeConfig.provider,
        model: activeConfig.model,
        messages,
      })
    activeSessionId = session.id
    await store.save(session)
  }

  const approve = async (request: ApprovalRequest): Promise<boolean> => {
    if (approvalMode === 'off') return true
    const remembered = await approvalDecisionFromMemory(activeConfig.cwd, request)
    if (remembered !== undefined) return remembered
    if (approvalMode === 'risky' && !isRiskyTool(request.toolName)) return true
    return askTuiApproval(rl, activeConfig.cwd, request)
  }

  renderHeader(activeConfig, activeSessionId, approvalMode)
  await runHooks(hooks, 'SessionStart', { event: 'SessionStart', cwd: activeConfig.cwd, sessionId: activeSessionId })
  let activeAbort: AbortController | undefined
  const onSigint = (): void => {
    if (activeAbort) {
      activeAbort.abort()
      process.stderr.write('\n[interrupted] Current model run was aborted. Session is still open.\n')
      return
    }
    rl.close()
  }
  process.on('SIGINT', onSigint)
  try {
    while (true) {
      const line = await readTuiLine(rl, '\nGXZ > ', activeConfig.cwd)
      if (line === undefined) break
      const trimmed = line.trim()
      if (!trimmed) continue

  if (trimmed.startsWith('/')) {
        const result = await handleTuiCommand({
          line: trimmed,
          rl,
          store,
          getContext: () => ({ config: activeConfig, session, messages, tools, approvalMode, lastUsage }),
          setMessages: async (next) => {
            messages = next
            if (session) await saveActiveSession()
          },
          setSession: (nextSession) => {
            session = nextSession
            activeSessionId = nextSession?.id
            messages = nextSession?.messages ?? messages
          },
          setConfig: (nextConfig) => {
            activeConfig = nextConfig
            rebuildProvider()
          },
          setApprovalMode: (nextMode) => {
            approvalMode = nextMode
          },
          saveActiveSession,
          provider: () => provider,
          tools: () => tools,
        policy,
        hooks,
      })
        if (result === 'exit') break
        continue
      }

      const renderer = createTuiRenderer()
      activeAbort = new AbortController()
      const result = await runAgent({
        provider,
        model: activeConfig.model,
        prompt: line,
        messages,
        cwd: activeConfig.cwd,
        tools,
        allowShell: activeConfig.allowShell,
        maxTurns: activeConfig.maxTurns,
        timeoutMs: activeConfig.timeoutMs,
        temperature: activeConfig.temperature,
        maxOutputTokens: activeConfig.maxOutputTokens,
        policy,
        approve,
        stream: true,
        signal: activeAbort.signal,
        onEvent: renderer,
      }).catch((error: unknown) => {
        if (activeAbort?.signal.aborted) {
          console.error('[interrupted] No response was saved for the aborted prompt.')
          return undefined
        }
        throw error
      }).finally(() => {
        activeAbort = undefined
      })
      if (!result) continue
      messages = result.messages
      lastUsage = result.usage
      await saveActiveSession(line)
      if (!result.text.trim()) console.log('[completed with no text response]')
      if (result.usage) {
        console.error(`[usage] input~${result.usage.inputTokensApprox} output~${result.usage.outputTokensApprox} cost~$${result.usage.estimatedCostUsd.toFixed(6)}`)
      }
    }
  } finally {
    process.off('SIGINT', onSigint)
    await runHooks(hooks, 'SessionEnd', { event: 'SessionEnd', cwd: activeConfig.cwd, sessionId: activeSessionId })
    rl.close()
  }
}

async function questionOrExit(rl: Interface, query: string): Promise<string | undefined> {
  try {
    return await rl.question(query)
  } catch (error) {
    if (error instanceof Error && /readline was closed/i.test(error.message)) return undefined
    throw error
  }
}

export async function readTuiLine(rl: Interface, query: string, cwd: string): Promise<string | undefined> {
  if (!input.isTTY || !output.isTTY) return questionOrExit(rl, query)
  return readTuiLineInteractive(query, await slashSuggestions(cwd))
}

type TuiCommandOptions = {
  line: string
  rl: Interface
  store: ReturnType<typeof createSessionStore>
  getContext(): TuiContext
  setMessages(messages: ChatMessage[]): Promise<void>
  setSession(session: SessionRecord | undefined): void
  setConfig(config: RuntimeConfig): void
  setApprovalMode(mode: ApprovalMode): void
  saveActiveSession(titlePrompt?: string): Promise<void>
  provider(): ModelProvider
  tools(): ToolDefinition[]
  policy: PermissionPolicy
  hooks: HookConfig
}

async function handleTuiCommand(options: TuiCommandOptions): Promise<'handled' | 'exit'> {
  const [rawCommand, ...args] = splitCommandLine(options.line.slice(1))
  const command = rawCommand?.toLowerCase()
  const context = options.getContext()

  if (command?.startsWith('mcp:')) {
    console.log(await runMcpPromptShortcut(context.config.cwd, command, args))
    return 'handled'
  }

  switch (command) {
    case 'exit':
    case 'quit':
      return 'exit'
    case 'help':
      console.log(tuiHelpText())
      return 'handled'
    case 'clear':
      await options.setMessages([])
      console.log('Context cleared.')
      return 'handled'
    case 'history':
      console.log(renderMessageHistory(context.messages))
      return 'handled'
    case 'context':
      console.log(renderTuiContext(context))
      return 'handled'
    case 'dashboard':
    case 'home':
      if (output.isTTY) output.write('\x1b[2J\x1b[H')
      console.log(renderTuiDashboard(context))
      return 'handled'
    case 'config':
      console.log(renderConfig(context.config))
      return 'handled'
    case 'settings':
      console.log(await runSettingsCommand(context.config, args, options.setConfig))
      return 'handled'
    case 'init':
      console.log(await initWorkspace(context.config.cwd))
      console.log(await initProjectMemory(context.config.cwd))
      return 'handled'
    case 'memory':
      console.log(await runMemoryCommand(context.config.cwd, args))
      return 'handled'
    case 'commands':
      console.log(await runCommandsCommand(context.config.cwd, args))
      return 'handled'
    case 'hooks':
      console.log(renderHooks(await loadHooks(context.config.cwd)))
      return 'handled'
    case 'model':
      console.log(handleModelCommand(context.config, args, options.setConfig))
      return 'handled'
    case 'provider':
      console.log(handleProviderCommand(context.config, args, options.setConfig))
      return 'handled'
    case 'effort':
    case 'effect':
      console.log(handleEffortCommand(context.config, args, options.setConfig))
      return 'handled'
    case 'tools':
      console.log(context.tools.map((tool) => `${tool.name}: ${tool.description}`).join('\n'))
      return 'handled'
    case 'skills': {
      const skills = await listSkills(context.config.cwd)
      console.log(skills.length ? skills.map((skill) => `${skill.name}\t${skill.description ?? ''}\t${skill.path}`).join('\n') : 'No skills found.')
      return 'handled'
    }
    case 'doctor':
      console.log(await renderDoctor(context.config))
      return 'handled'
    case 'compact': {
      await runHooks(options.hooks, 'PreCompact', { event: 'PreCompact', cwd: context.config.cwd, messages: context.messages.length })
      const compacted = await compactMessages({
        provider: options.provider(),
        model: context.config.model,
        messages: context.messages,
        tools: options.tools(),
        maxOutputTokens: context.config.maxOutputTokens,
        temperature: context.config.temperature,
        cwd: context.config.cwd,
      })
      await options.setMessages(compacted)
      await runHooks(options.hooks, 'PostCompact', { event: 'PostCompact', cwd: context.config.cwd, messages: compacted.length })
      console.log(`Compacted context to ${compacted.length} message.`)
      return 'handled'
    }
    case 'save': {
      const id = args.join(' ').trim()
      if (id) {
        const next = createSession({
          id,
          title: context.session?.title ?? `Saved chat ${id}`,
          cwd: context.config.cwd,
          provider: context.config.provider,
          model: context.config.model,
          messages: context.messages,
        })
        options.setSession(next)
      }
      await options.saveActiveSession(id || context.session?.title)
      console.log(`Saved session ${options.getContext().session?.id ?? id}`)
      return 'handled'
    }
    case 'sessions':
      console.log(renderSessions(await options.store.list()))
      return 'handled'
    case 'resume': {
      const id = args.join(' ').trim()
      const session = id ? await options.store.load(id) : (await options.store.list())[0]
      if (!session) {
        console.log('No saved sessions.')
        return 'handled'
      }
      options.setSession(session)
      const nextConfig = {
        ...context.config,
        provider: session.provider,
        model: session.model,
        baseUrl: defaultBaseUrl(session.provider),
        apiKey: apiKeyForProvider(session.provider),
      }
      options.setConfig(nextConfig)
      console.log(`Resumed session ${session.id}: ${session.title}`)
      return 'handled'
    }
    case 'cost': {
      const id = args.join(' ').trim()
      const session = id
        ? await options.store.load(id)
        : context.session ?? createSession({
          cwd: context.config.cwd,
          provider: context.config.provider,
          model: context.config.model,
          messages: context.messages,
        })
      console.log(renderSessionCost(session))
      return 'handled'
    }
    case 'status':
      console.log(await renderGitStatus(context.config.cwd))
      return 'handled'
    case 'diff':
      console.log(await renderGitDiff(context.config.cwd))
      return 'handled'
    case 'diagnostics': {
      const diagnosticCommand = args.join(' ').trim()
      console.log(await createDiagnosticsTool().execute(
        diagnosticCommand ? { command: diagnosticCommand } : {},
        { cwd: context.config.cwd, allowShell: false, timeoutMs: context.config.timeoutMs },
      ))
      return 'handled'
    }
    case 'mcp':
      console.log(await runTuiMcpCommand(context.config.cwd, args))
      return 'handled'
    case 'code-action': {
      if (args.length < 2) {
        console.log('Usage: /code-action <path> <action>')
        return 'handled'
      }
      console.log(await runCodeAction(context.config.cwd, args[0]!, args[1]!, context.config.timeoutMs))
      return 'handled'
    }
    case 'patch': {
      const [path, oldText, newText, maybeApply] = args
      if (!path || oldText === undefined || newText === undefined) {
        console.log('Usage: /patch <path> <oldText> <newText> [--apply]')
        return 'handled'
      }
      const patchTool = createPatchTool()
      const preview = await patchTool.execute({
        path,
        oldText,
        newText,
        apply: false,
      }, { cwd: context.config.cwd, allowShell: false, timeoutMs: context.config.timeoutMs })
      console.log(preview)
      if (maybeApply === '--apply') {
        console.log(await patchTool.execute({
          path,
          oldText,
          newText,
          apply: true,
        }, { cwd: context.config.cwd, allowShell: false, timeoutMs: context.config.timeoutMs }))
        return 'handled'
      }
      const answer = await options.rl.question('Apply this patch? [y/N] ')
      if (!isAffirmative(answer)) {
        console.log('Patch not applied.')
        return 'handled'
      }
      console.log(await patchTool.execute({
        path,
        oldText,
        newText,
        apply: true,
      }, { cwd: context.config.cwd, allowShell: false, timeoutMs: context.config.timeoutMs }))
      return 'handled'
    }
    case 'review': {
      const reviewPrompt = await buildReviewPrompt(context.config.cwd)
      if (hasNoReviewableDiff(reviewPrompt)) {
        console.log('No reviewable git diff found. Run /status or make changes in a git repository first.')
        return 'handled'
      }
      const result = await runAgent({
        provider: options.provider(),
        model: context.config.model,
        prompt: reviewPrompt,
        cwd: context.config.cwd,
        tools: [],
        allowShell: context.config.allowShell,
        maxTurns: 1,
        timeoutMs: context.config.timeoutMs,
        temperature: context.config.temperature,
        maxOutputTokens: context.config.maxOutputTokens,
        policy: options.policy,
        hooks: options.hooks,
        stream: true,
        signal: AbortSignal.timeout(context.config.timeoutMs),
        onEvent: createTuiRenderer(),
      })
      console.log(result.text ? '' : '[completed with no text response]')
      return 'handled'
    }
    case 'team': {
      const goal = args.join(' ').trim()
      if (!goal) {
        console.log('Usage: /team <goal>')
        return 'handled'
      }
      const results = await runTeam({
        provider: options.provider(),
        model: context.config.model,
        cwd: context.config.cwd,
        tools: options.tools(),
        plan: buildDefaultTeamPlan(goal),
        allowShell: context.config.allowShell,
        timeoutMs: context.config.timeoutMs,
        temperature: context.config.temperature,
        maxOutputTokens: context.config.maxOutputTokens,
      })
      console.log(renderTeamResults(results))
      return 'handled'
    }
    case 'pr':
      console.log(await runTuiPrCommand(context.config.cwd, args))
      return 'handled'
    case 'github':
    case 'gh':
      console.log(await runTuiGitHubCommand(context.config.cwd, context.config.timeoutMs, args))
      return 'handled'
    case 'monitor':
      console.log(runTuiMonitorCommand(context.config.cwd, args))
      return 'handled'
    case 'worktree':
      console.log(await runTuiWorktreeCommand(context.config.cwd, args).catch((error: unknown) =>
        `Worktree command failed: ${error instanceof Error ? error.message : String(error)}`
      ))
      return 'handled'
    case 'permissions':
    case 'approval':
    case 'approvals':
      console.log(await runPermissionsCommand(context.config.cwd, context.approvalMode, args, options.setApprovalMode))
      return 'handled'
    default:
      if (command) {
        const custom = await findCustomCommand(context.config.cwd, command)
        if (custom) {
          const prompt = expandCustomCommand(custom, args)
          const result = await runAgent({
            provider: options.provider(),
            model: context.config.model,
            prompt,
            messages: context.messages,
            cwd: context.config.cwd,
            tools: options.tools(),
            allowShell: context.config.allowShell,
            maxTurns: context.config.maxTurns,
            timeoutMs: context.config.timeoutMs,
            temperature: context.config.temperature,
            maxOutputTokens: context.config.maxOutputTokens,
            policy: options.policy,
            hooks: options.hooks,
            stream: true,
            signal: AbortSignal.timeout(context.config.timeoutMs),
            onEvent: createTuiRenderer(),
          })
          await options.setMessages(result.messages)
          return 'handled'
        }
      }
      console.log(`Unknown slash command: /${command ?? ''}. Use /help.`)
      return 'handled'
  }
}

function hasNoReviewableDiff(reviewPrompt: string): boolean {
  return reviewPrompt.includes('Not a git repository.') || reviewPrompt.trim().endsWith('[no output]')
}

export function createTuiRenderer(): (event: AgentEvent) => void {
  const activeTools = new Map<string, ToolCall>()
  let printedAssistantPrefix = false
  return (event) => {
    if (event.type === 'assistant_delta') {
      if (!printedAssistantPrefix) {
        process.stdout.write('\nAssistant\n')
        printedAssistantPrefix = true
      }
      process.stdout.write(event.text)
      return
    }
    if (event.type === 'assistant_text') {
      if (!printedAssistantPrefix) process.stdout.write('\nAssistant\n')
      process.stdout.write(event.text.endsWith('\n') ? event.text : `${event.text}\n`)
      printedAssistantPrefix = true
      return
    }
    if (event.type === 'tool_start') {
      activeTools.set(event.toolCall.id, event.toolCall)
      process.stderr.write(`\n[tool:start] ${event.toolCall.name} ${formatToolArgs(event.toolCall.arguments)}\n`)
      return
    }
    if (event.type === 'tool_result') {
      activeTools.delete(event.toolCall.id)
      process.stderr.write(`[tool:done] ${event.toolCall.name} ${event.result.length} chars\n`)
      return
    }
    if (event.type === 'tool_error') {
      activeTools.delete(event.toolCall.id)
      process.stderr.write(`[tool:error] ${event.toolCall.name} ${event.error}\n`)
    }
  }
}

export function renderTuiContext(context: TuiContext): string {
  const usage = context.lastUsage ?? estimateUsage(context.config.provider, context.config.model, context.messages, '')
  const roles = roleCounts(context.messages)
  return [
    'Context:',
    `  provider/model: ${context.config.provider}/${context.config.model}`,
    `  cwd: ${context.config.cwd}`,
    `  session: ${context.session ? `${context.session.id} (${context.session.title})` : '-'}`,
    `  messages: ${context.messages.length} (${Object.entries(roles).map(([role, count]) => `${role}:${count}`).join(', ') || '-'})`,
    `  tokens approx: input~${usage.inputTokensApprox} output~${usage.outputTokensApprox}`,
    `  cost approx: $${usage.estimatedCostUsd.toFixed(6)}`,
    `  tools: ${context.tools.length}`,
    `  approval mode: ${context.approvalMode}`,
  ].join('\n')
}

export function renderTuiDashboard(context: TuiContext): string {
  const usage = context.lastUsage ?? estimateUsage(context.config.provider, context.config.model, context.messages, '')
  const session = context.session ? `${context.session.id} (${context.session.title})` : '<auto>'
  const commands = '/help  /model  /effort  /mcp  /patch  /github  /code-action  /review'
  const rows = [
    ['Model', `${context.config.provider}/${context.config.model}`],
    ['Workspace', context.config.cwd],
    ['Session', session],
    ['Context', `${context.messages.length} messages, input~${usage.inputTokensApprox}, output~${usage.outputTokensApprox}`],
    ['Tools', `${context.tools.length} available`],
    ['Approval', context.approvalMode],
    ['Commands', commands],
  ]
  const width = 86
  const border = `+${'-'.repeat(width - 2)}+`
  const title = centerText('GXZ COMMAND CENTER', width - 2)
  return [
    border,
    `|${title}|`,
    border,
    ...rows.flatMap(([label, value]) => wrapDashboardValue(label, value, width)),
    border,
  ].join('\n')
}

function wrapDashboardValue(label: string, value: string, width: number): string[] {
  const labelWidth = 12
  const contentWidth = width - labelWidth - 7
  const chunks = wrapText(value, contentWidth)
  return chunks.map((chunk, index) => {
    const left = index === 0 ? label.padEnd(labelWidth) : ''.padEnd(labelWidth)
    return `|  ${left} | ${chunk.padEnd(contentWidth)} |`
  })
}

function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
    } else if ((current.length + word.length + 1) <= width) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function centerText(value: string, width: number): string {
  const left = Math.max(0, Math.floor((width - value.length) / 2))
  return `${' '.repeat(left)}${value}`.padEnd(width)
}

export function splitCommandLine(value: string): string[] {
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1)
    }
    return part
  }) ?? []
}

export function recordTuiInputHistory(history: string[], value: string, maxEntries = 200): void {
  const trimmed = value.trim()
  if (!trimmed) return
  if (history.at(-1) === value) return
  history.push(value)
  if (history.length > maxEntries) history.splice(0, history.length - maxEntries)
}

export function tuiHistoryEntry(history: string[], index: number): string {
  if (index < 0 || index >= history.length) return ''
  return history[index] ?? ''
}

export function filterHistory(history: string[], query: string): string[] {
  const normalized = query.trim().toLowerCase()
  const entries = [...history].reverse()
  if (!normalized) return entries
  return entries.filter((entry) => entry.toLowerCase().includes(normalized))
}

function renderHeader(config: RuntimeConfig, sessionId: string | undefined, approvalMode: ApprovalMode): void {
  console.log(renderTuiHeader(config, sessionId, approvalMode, output.isTTY))
}

export function renderTuiHeader(
  config: RuntimeConfig,
  sessionId: string | undefined,
  approvalMode: ApprovalMode,
  color = false,
): string {
  const paint = ansiPalette(color)
  const wordmark = [
    '  ██████████     ████████      ██      ██',
    '  ██            ██      ██      ██    ██ ',
    '  ████████      ██      ██        ████   ',
    '  ██            ██      ██        ████   ',
    '  ██            ██      ██      ██    ██ ',
    '  ██             ████████      ██      ██',
  ].map((line) => `${paint.fox}${line}${paint.reset}`)

  const title = [
    `${paint.title}GXZ-code${paint.reset}`,
    `${paint.dim}GLM-first local coding agent for terminal work${paint.reset}`,
  ]

  const details = [
    `${paint.label}model   ${paint.reset}${config.provider}/${config.model}`,
    `${paint.label}cwd     ${paint.reset}${config.cwd}`,
    `${paint.label}session ${paint.reset}${sessionId ?? '<auto>'}`,
    `${paint.label}approval${paint.reset} ${approvalMode}`,
  ]

  return [
    ...wordmark,
    '',
    '============================================================',
    ...title,
    '============================================================',
    '',
    ...details,
    '',
    `${paint.dim}Try:${paint.reset} /help  /context  /resume  /model  /effort  /permissions  /exit`,
  ].join('\n')
}

function ansiPalette(enabled: boolean): { fox: string; title: string; label: string; dim: string; reset: string } {
  if (!enabled) return { fox: '', title: '', label: '', dim: '', reset: '' }
  return {
    fox: '\x1b[38;5;124m',
    title: '\x1b[1;38;5;214m',
    label: '\x1b[38;5;110m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
  }
}

function tuiHelpText(): string {
  return [
    'TUI commands:',
    '  /help                         Show commands',
    '  /context                      Show session, token, tool, and approval context',
    '  /dashboard                    Show full-screen style local status panel',
    '  /history                      Show message role counts',
    '  /clear                        Clear current context',
    '  /sessions                     List saved sessions',
    '  /resume [session-id]          Resume a session; latest when id is omitted',
    '  /save [session-id]            Save current session',
    '  /cost [session-id]            Show approximate session cost',
    '  /model [name]                 Show or switch model',
    '  /provider [name]              Show or switch provider',
    '  /effort [low|medium|high|xhigh] Show or set local reasoning preset',
    '  /effect [low|medium|high|xhigh] Alias for /effort',
    '  /config                       Show effective config',
    '  /settings [get|set|list]       Inspect or update local non-secret settings',
    '  /init                         Create GXZ local files and project memory',
    '  /memory [show|add|init]        Manage persistent memory',
    '  /commands [list|new]           Manage custom markdown slash commands',
    '  /hooks                        Show configured local hooks',
    '  /tools                        List tools',
    '  /skills                       List local skills',
    '  /doctor                       Run environment diagnostics',
    '  /compact                      Compact current context through the model',
    '  /status                       Show git status',
    '  /diff                         Show git diff',
    '  /diagnostics [command]        Run diagnostics',
    '  /mcp [list|add|remove|test|tools|resources|prompts] Manage MCP stdio/HTTP servers and surfaces',
    '  /mcp call <server> <tool> [json]',
    '  /mcp read-resource <server> <uri>',
    '  /mcp get-prompt <server> <prompt> [json]',
    '  /code-action <path> <action>  Run LSP-style action',
    '  /patch <path> <old> <new> [--apply] Preview or apply exact text patch',
    '  /review                       Review current diff through the model',
    '  /team <goal>                  Run explore/plan/execute/verify team flow',
    '  /pr [platform repo number]    Show local PR prompt or fetch PR/MR summary',
    '  /github <action> [repo] [number] Read GitHub via gh CLI',
    '  /monitor [start|list|read|stop] Background command monitors',
    '  /worktree [list|add|remove]    Manage git worktrees',
    '  /permissions [off|risky|all|clear|allow-tool|deny-tool|allow-shell|deny-shell]',
    '  /exit                         Quit',
  ].join('\n')
}

export async function slashSuggestions(cwd: string, line = '/'): Promise<SlashSuggestion[]> {
  const customCommands = await listCustomCommands(cwd).catch(() => [])
  const mcpPromptCommands = await mcpPromptSuggestions(cwd).catch(() => [])
  return matchingSlashSuggestions([
    ...BUILT_IN_SLASH_COMMANDS,
    ...mcpPromptCommands,
    ...customCommands.map((command): SlashSuggestion => ({
      command: `/${command.name}`,
      usage: `/${command.name} [args]`,
      description: command.description ?? `${command.scope} custom command`,
    })),
  ], line)
}

async function mcpPromptSuggestions(cwd: string): Promise<SlashSuggestion[]> {
  const rendered = await listMcpPrompts(cwd)
  if (rendered === 'No MCP servers configured.') return []
  const suggestions: SlashSuggestion[] = []
  let server = ''
  for (const line of rendered.split(/\r?\n/)) {
    if (line.startsWith('# ')) {
      server = line.slice(2).trim()
      continue
    }
    const match = line.match(/^- ([^:]+):/)
    if (server && match?.[1]) {
      suggestions.push({
        command: `/mcp:${server}:${match[1]}`,
        usage: `/mcp:${server}:${match[1]} [json]`,
        description: `MCP prompt from ${server}`,
      })
    }
  }
  return suggestions
}

function matchingSlashSuggestions(commands: SlashSuggestion[], line: string): SlashSuggestion[] {
  const trimmedStart = line.trimStart()
  const firstToken = trimmedStart.split(/\s+/)[0] ?? ''
  const hasArguments = /\s/.test(trimmedStart.slice(firstToken.length))
  const prefix = firstToken.startsWith('/') && !hasArguments ? firstToken.toLowerCase() : ''
  if (!prefix) return []
  return commands
    .filter((command) => command.command.toLowerCase().startsWith(prefix))
    .sort((a, b) => scoreSuggestion(prefix, a.command) - scoreSuggestion(prefix, b.command) || a.command.localeCompare(b.command))
}

const BUILT_IN_SLASH_COMMANDS: SlashSuggestion[] = [
  { command: '/help', usage: '/help', description: 'Show commands' },
  { command: '/context', usage: '/context', description: 'Show session, token, tool, and approval context' },
  { command: '/dashboard', usage: '/dashboard', description: 'Show local status panel' },
  { command: '/home', usage: '/home', description: 'Alias for /dashboard' },
  { command: '/history', usage: '/history', description: 'Show message role counts' },
  { command: '/clear', usage: '/clear', description: 'Clear current context' },
  { command: '/sessions', usage: '/sessions', description: 'List saved sessions' },
  { command: '/resume', usage: '/resume [session-id]', description: 'Resume a saved session' },
  { command: '/save', usage: '/save [session-id]', description: 'Save current session' },
  { command: '/cost', usage: '/cost [session-id]', description: 'Show approximate cost' },
  { command: '/model', usage: '/model [name]', description: 'Show or switch model' },
  { command: '/provider', usage: '/provider [name]', description: 'Show or switch provider' },
  { command: '/effort', usage: '/effort [low|medium|high|xhigh]', description: 'Show or set local reasoning preset' },
  { command: '/effect', usage: '/effect [low|medium|high|xhigh]', description: 'Alias for /effort' },
  { command: '/config', usage: '/config', description: 'Show effective config' },
  { command: '/settings', usage: '/settings [list|get|set]', description: 'Inspect or update runtime settings' },
  { command: '/init', usage: '/init', description: 'Create GXZ local files and project memory' },
  { command: '/memory', usage: '/memory [show|add|init]', description: 'Manage persistent memory' },
  { command: '/commands', usage: '/commands [list|new]', description: 'Manage custom slash commands' },
  { command: '/hooks', usage: '/hooks', description: 'Show configured local hooks' },
  { command: '/tools', usage: '/tools', description: 'List model tools' },
  { command: '/skills', usage: '/skills', description: 'List local skills' },
  { command: '/doctor', usage: '/doctor', description: 'Run environment diagnostics' },
  { command: '/compact', usage: '/compact', description: 'Compact current context' },
  { command: '/status', usage: '/status', description: 'Show git status' },
  { command: '/diff', usage: '/diff', description: 'Show git diff' },
  { command: '/diagnostics', usage: '/diagnostics [command]', description: 'Run diagnostics' },
  { command: '/mcp', usage: '/mcp [list|add|remove|test|tools|resources|prompts|call|read-resource|get-prompt]', description: 'Manage and use MCP servers' },
  { command: '/code-action', usage: '/code-action <path> <action>', description: 'Run LSP-style action' },
  { command: '/patch', usage: '/patch <path> <old> <new> [--apply]', description: 'Preview or apply exact text patch' },
  { command: '/review', usage: '/review', description: 'Review current git diff' },
  { command: '/team', usage: '/team <goal>', description: 'Run team flow' },
  { command: '/pr', usage: '/pr [github|gitlab repo number]', description: 'PR/MR helpers' },
  { command: '/github', usage: '/github <pr-view|pr-diff|pr-checks|issue-view|issue-list> [repo] [number]', description: 'Read GitHub via gh CLI' },
  { command: '/gh', usage: '/gh <action> [repo] [number]', description: 'Alias for /github' },
  { command: '/monitor', usage: '/monitor [start|list|read|stop]', description: 'Background command monitors' },
  { command: '/worktree', usage: '/worktree [list|add|remove]', description: 'Manage git worktrees' },
  { command: '/permissions', usage: '/permissions [off|risky|all|clear|allow-tool|deny-tool|allow-shell|deny-shell]', description: 'Manage approvals' },
  { command: '/approval', usage: '/approval', description: 'Alias for /permissions' },
  { command: '/approvals', usage: '/approvals', description: 'Alias for /permissions' },
  { command: '/exit', usage: '/exit', description: 'Quit' },
  { command: '/quit', usage: '/quit', description: 'Quit' },
]

function scoreSuggestion(prefix: string, command: string): number {
  if (command.toLowerCase() === prefix) return 0
  if (command.toLowerCase().startsWith(prefix)) return 1
  return 2
}

async function readTuiLineInteractive(query: string, allCommands: SlashSuggestion[]): Promise<string | undefined> {
  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()

  const promptLine = query.split(/\r?\n/).at(-1) ?? query
  let line = ''
  let selected = 0
  let suggestions: SlashSuggestion[] = []
  let historyIndex = tuiInputHistory.length
  let searchMode = false
  let searchQuery = ''
  let searchSelected = 0
  let searchResults: string[] = []

  const updateSuggestions = (): void => {
    if (searchMode) {
      suggestions = []
      return
    }
    suggestions = line.includes('\n') ? [] : matchingSlashSuggestions(allCommands, line).slice(0, 8)
    selected = Math.min(selected, Math.max(0, suggestions.length - 1))
  }

  const render = (): void => {
    updateSuggestions()
    const renderedLine = searchMode ? `history search: ${searchQuery}` : renderInputLine(line)
    output.write('\x1b[?25l')
    output.write(`\r\x1b[2K${promptLine}${renderedLine}`)
    output.write('\x1b[J')
    if (searchMode) {
      searchResults = filterHistory(tuiInputHistory, searchQuery).slice(0, 8)
      searchSelected = Math.min(searchSelected, Math.max(0, searchResults.length - 1))
      if (searchResults.length) {
        output.write('\n')
        for (const [index, entry] of searchResults.entries()) {
          const marker = index === searchSelected ? '>' : ' '
          output.write(`${marker} ${renderInputLine(entry).slice(0, 78)}\n`)
        }
        output.write(`\x1b[${searchResults.length + 1}A`)
        output.write(`\x1b[${promptLine.length + renderedLine.length + 1}G`)
      }
      output.write('\x1b[?25h')
      return
    }
    if (suggestions.length) {
      output.write('\n')
      for (const [index, suggestion] of suggestions.entries()) {
        const marker = index === selected ? '>' : ' '
        output.write(`${marker} ${suggestion.usage.padEnd(36)} ${suggestion.description}\n`)
      }
      output.write(`\x1b[${suggestions.length + 1}A`)
      output.write(`\x1b[${promptLine.length + renderedLine.length + 1}G`)
    }
    output.write('\x1b[?25h')
  }

  const finish = (value: string | undefined, resolve: (value: string | undefined) => void): void => {
    if (value !== undefined) recordTuiInputHistory(tuiInputHistory, value)
    output.write(`\r\x1b[2K${promptLine}${renderInputLine(value ?? '')}\x1b[J\n`)
    input.setRawMode(false)
    input.off('keypress', onKeypress)
    resolve(value)
  }

  let resolveLine!: (value: string | undefined) => void
  const promise = new Promise<string | undefined>((resolve) => {
    resolveLine = resolve
  })

  const onKeypress = (_chunk: string, key: { name?: string; sequence?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }): void => {
    if (key.ctrl && key.name === 'c') {
      finish(undefined, resolveLine)
      return
    }
    if (key.name === 'escape') {
      searchMode = false
      searchQuery = ''
      searchSelected = 0
      render()
      return
    }
    if (key.name === 'return') {
      if (searchMode) {
        line = searchResults[searchSelected] ?? line
        searchMode = false
        searchQuery = ''
        searchSelected = 0
        render()
        return
      }
      if (key.shift) {
        line += '\n'
        selected = 0
        render()
        return
      }
      if (suggestions.length && line.trim() && !line.trim().includes(' ')) {
        line = suggestions[selected]?.command ?? line
      }
      finish(line, resolveLine)
      return
    }
    if (key.ctrl && key.name === 'j') {
      line += '\n'
      selected = 0
      render()
      return
    }
    if (key.ctrl && key.name === 'r') {
      searchMode = true
      searchQuery = ''
      searchSelected = 0
      render()
      return
    }
    if (key.name === 'tab') {
      if (suggestions.length) {
        line = `${suggestions[selected]?.command ?? line} `
        selected = 0
        render()
      }
      return
    }
    if (key.name === 'up') {
      if (searchMode) {
        if (searchResults.length) searchSelected = (searchSelected - 1 + searchResults.length) % searchResults.length
        render()
        return
      }
      if (suggestions.length) {
        selected = (selected - 1 + suggestions.length) % suggestions.length
        render()
      } else if (tuiInputHistory.length) {
        historyIndex = Math.max(0, historyIndex - 1)
        line = tuiHistoryEntry(tuiInputHistory, historyIndex)
        render()
      }
      return
    }
    if (key.name === 'down') {
      if (searchMode) {
        if (searchResults.length) searchSelected = (searchSelected + 1) % searchResults.length
        render()
        return
      }
      if (suggestions.length) {
        selected = (selected + 1) % suggestions.length
        render()
      } else if (tuiInputHistory.length) {
        historyIndex = Math.min(tuiInputHistory.length, historyIndex + 1)
        line = tuiHistoryEntry(tuiInputHistory, historyIndex)
        render()
      }
      return
    }
    if (key.name === 'backspace') {
      if (searchMode) {
        searchQuery = searchQuery.slice(0, -1)
        searchSelected = 0
        render()
        return
      }
      line = line.slice(0, -1)
      selected = 0
      render()
      return
    }
    if (key.ctrl && key.name === 'u') {
      line = ''
      selected = 0
      render()
      return
    }
    const sequence = key.sequence ?? ''
    if (!key.ctrl && !key.meta && sequence && sequence >= ' ' && sequence !== '\x7f') {
      if (searchMode) {
        searchQuery += sequence
        searchSelected = 0
        render()
        return
      }
      line += sequence
      selected = 0
      render()
    }
  }

  input.on('keypress', onKeypress)
  output.write(query)
  render()
  return promise
}

function renderInputLine(value: string): string {
  return value.replaceAll('\n', '\\n')
}

async function runMemoryCommand(cwd: string, args: string[]): Promise<string> {
  const action = args[0] ?? 'show'
  if (action === 'show' || action === 'list') return renderMemory(cwd, args[1])
  if (action === 'init') return initProjectMemory(cwd)
  if (action === 'add') {
    const scope = args[1] ?? 'local'
    const content = args.slice(2).join(' ')
    if (!content.trim()) return 'Usage: /memory add [user|project|local] <text>'
    return addMemory(cwd, scope, content)
  }
  return 'Usage: /memory [show [user|project|local]|add [user|project|local] <text>|init]'
}

async function runCommandsCommand(cwd: string, args: string[]): Promise<string> {
  const action = args[0] ?? 'list'
  if (action === 'list') return renderCustomCommands(await listCustomCommands(cwd))
  if (action === 'new') {
    const scope = args[1] === 'user' ? 'user' : 'project'
    const name = args[1] === 'user' || args[1] === 'project' ? args[2] : args[1]
    if (!name) return 'Usage: /commands new [user|project] <name>'
    return createCustomCommand(cwd, scope, name)
  }
  return 'Usage: /commands [list|new [user|project] <name>]'
}

async function runSettingsCommand(
  config: RuntimeConfig,
  args: string[],
  setConfig: (config: RuntimeConfig) => void,
): Promise<string> {
  const action = args[0] ?? 'list'
  if (action === 'list') return renderConfig(config)
  if (action === 'get') {
    const key = args[1]
    if (!key) return 'Usage: /settings get <key>'
    return `${key}: ${String((config as unknown as Record<string, unknown>)[key] ?? '')}`
  }
  if (action === 'set') {
    const key = args[1]
    const value = args.slice(2).join(' ')
    if (!key || !value) return 'Usage: /settings set <key> <value>'
    const next = { ...config }
    switch (key) {
      case 'model':
        next.model = value
        break
      case 'provider':
        next.provider = parseProvider(value)
        next.model = defaultModelForProvider(next.provider)
        next.baseUrl = defaultBaseUrl(next.provider)
        next.apiKey = apiKeyForProvider(next.provider)
        break
      case 'baseUrl':
        next.baseUrl = value
        break
      case 'maxTurns':
      case 'timeoutMs':
      case 'maxOutputTokens':
        next[key] = Number(value)
        break
      case 'temperature':
        next.temperature = Number(value)
        break
      case 'allowShell':
      case 'requireApproval':
        next[key] = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
        break
      default:
        return `Unsupported setting: ${key}`
    }
    setConfig(next)
    return `Updated ${key}. Runtime setting changed for this TUI session.`
  }
  return 'Usage: /settings [list|get <key>|set <key> <value>]'
}

function renderMessageHistory(messages: ChatMessage[]): string {
  const roles = roleCounts(messages)
  return [
    `${messages.length} messages in context.`,
    Object.entries(roles).map(([role, count]) => `${role}: ${count}`).join('\n'),
  ].filter(Boolean).join('\n')
}

function roleCounts(messages: ChatMessage[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const message of messages) counts[message.role] = (counts[message.role] ?? 0) + 1
  return counts
}

function handleModelCommand(
  config: RuntimeConfig,
  args: string[],
  setConfig: (config: RuntimeConfig) => void,
): string {
  const model = args.join(' ').trim()
  if (!model) return renderModelChoices(config)
  const selection = selectModel(config, model)
  setConfig(selection.config)
  return [
    `Switched model to ${selection.config.provider}/${selection.config.model}`,
    selection.note,
  ].filter(Boolean).join('\n')
}

function handleProviderCommand(
  config: RuntimeConfig,
  args: string[],
  setConfig: (config: RuntimeConfig) => void,
): string {
  const providerName = args.join(' ').trim()
  if (!providerName) return `${config.provider}/${config.model}`
  const provider = parseProvider(providerName)
  const model = defaultModelForProvider(provider)
  setConfig({
    ...config,
    provider,
    model,
    baseUrl: defaultBaseUrl(provider),
    apiKey: apiKeyForProvider(provider),
  })
  return `Switched provider to ${provider}/${model}`
}

function handleEffortCommand(
  config: RuntimeConfig,
  args: string[],
  setConfig: (config: RuntimeConfig) => void,
): string {
  const level = args.join(' ').trim()
  if (!level) return renderEffort(config)
  const next = applyEffortPreset(config, parseEffortLevel(level))
  setConfig(next)
  return [
    `Effort set to ${level}.`,
    `maxTurns=${next.maxTurns} maxOutputTokens=${next.maxOutputTokens} temperature=${next.temperature}`,
  ].join('\n')
}

async function runTuiMcpCommand(cwd: string, args: string[]): Promise<string> {
  const action = args[0] ?? 'tools'
  if (action === 'list' || action === 'servers') return renderMcpServers(cwd)
  if (action === 'add') {
    const [, name, commandOrUrl, argsJson = '[]', envJson = '{}'] = args
    if (!name || !commandOrUrl) return 'Usage: /mcp add <name> <command|http-url> [args-json-array|headers-json-object] [env-json-object]'
    if (/^https?:\/\//i.test(commandOrUrl)) {
      return addMcpServer(cwd, name, {
        url: commandOrUrl,
        headers: argsJson === '[]' ? undefined : parseStringRecord(argsJson),
      })
    }
    return addMcpServer(cwd, name, {
      command: commandOrUrl,
      args: parseJsonArray(argsJson),
      env: parseStringRecord(envJson),
    })
  }
  if (action === 'remove') {
    const [, name] = args
    if (!name) return 'Usage: /mcp remove <name>'
    return removeMcpServer(cwd, name)
  }
  if (action === 'test') {
    const [, name] = args
    if (!name) return 'Usage: /mcp test <name>'
    return testMcpServer(cwd, name)
  }
  if (action === 'tools') return listMcpTools(cwd)
  if (action === 'resources') return listMcpResources(cwd)
  if (action === 'prompts') return listMcpPrompts(cwd)
  if (action === 'call') {
    const [, server, tool, json = '{}'] = args
    if (!server || !tool) return 'Usage: /mcp call <server> <tool> [json]'
    return callMcpTool(cwd, server, tool, parseJsonObject(json))
  }
  if (action === 'read-resource') {
    const [, server, uri] = args
    if (!server || !uri) return 'Usage: /mcp read-resource <server> <uri>'
    return readMcpResource(cwd, server, uri)
  }
  if (action === 'get-prompt') {
    const [, server, prompt, json = '{}'] = args
    if (!server || !prompt) return 'Usage: /mcp get-prompt <server> <prompt> [json]'
    return getMcpPrompt(cwd, server, prompt, parseJsonObject(json))
  }
  return `Unknown MCP action: ${action}`
}

async function runMcpPromptShortcut(cwd: string, command: string, args: string[]): Promise<string> {
  const [, server, prompt] = command.split(':')
  if (!server || !prompt) return 'Usage: /mcp:<server>:<prompt> [json]'
  const json = args.join(' ').trim() || '{}'
  return getMcpPrompt(cwd, server, prompt, parseJsonObject(json))
}

async function runTuiPrCommand(cwd: string, args: string[]): Promise<string> {
  if (!args.length) return buildLocalPrReview(cwd)
  if (args[0] === 'comment') {
    const [, platformRaw, repo, numberRaw, ...bodyParts] = args
    if (!platformRaw || !repo || !numberRaw || !bodyParts.length) {
      return 'Usage: /pr comment <github|gitlab> <repo> <number> <body>'
    }
    const platform = parsePrPlatform(platformRaw)
    return publishPrComment({
      platform,
      repo,
      number: Number(numberRaw),
      token: defaultPrToken(platform),
      body: bodyParts.join(' '),
      dryRun: true,
    })
  }
  const [platformRaw, repo, numberRaw] = args
  if (!platformRaw || !repo || !numberRaw) return 'Usage: /pr <github|gitlab> <repo> <number>'
  const platform = parsePrPlatform(platformRaw)
  return JSON.stringify(await fetchPrSummary({
    platform,
    repo,
    number: Number(numberRaw),
    token: defaultPrToken(platform),
  }), null, 2)
}

async function runTuiGitHubCommand(cwd: string, timeoutMs: number, args: string[]): Promise<string> {
  const [actionRaw, maybeRepo, maybeNumberOrLimit, ...rest] = args
  if (!actionRaw) {
    return 'Usage: /github <pr-view|pr-diff|pr-checks|issue-view|issue-list|pr-comment|issue-comment|issue-create> [repo] [number|limit] [body] [--publish]'
  }
  const action = parseGitHubCliAction(actionRaw)
  const repo = maybeRepo && !/^\d+$/.test(maybeRepo) ? maybeRepo : undefined
  const numeric = Number(repo ? maybeNumberOrLimit : maybeRepo)
  const publishIndex = rest.indexOf('--publish')
  const publish = publishIndex !== -1
  const bodyParts = publish ? rest.filter((part) => part !== '--publish') : rest
  if (isGitHubWriteAction(action)) {
    if (action === 'issue-create') {
      const [title, ...body] = bodyParts
      return runGitHubCli({
        action,
        repo,
        title,
        body: body.join(' '),
        publish,
        cwd,
        timeoutMs,
      })
    }
    return runGitHubCli({
      action,
      repo,
      number: numeric,
      body: bodyParts.join(' '),
      publish,
      cwd,
      timeoutMs,
    })
  }
  return runGitHubCli({
    action,
    repo,
    number: action === 'issue-list' ? undefined : numeric,
    limit: action === 'issue-list' && Number.isFinite(numeric) ? numeric : undefined,
    cwd,
    timeoutMs,
  })
}

function runTuiMonitorCommand(cwd: string, args: string[]): string {
  const [action = 'list', ...rest] = args
  if (action === 'start') {
    const command = rest.join(' ')
    if (!command) return 'Usage: /monitor start <command>'
    const task = startMonitor(command, cwd)
    return `Started monitor ${task.id}: ${task.command}`
  }
  if (action === 'list') return listMonitors()
  if (action === 'read') {
    const [id, linesRaw] = rest
    if (!id) return 'Usage: /monitor read <id> [lines]'
    return readMonitor(id, linesRaw ? Number(linesRaw) : 80)
  }
  if (action === 'stop') {
    const [id] = rest
    if (!id) return 'Usage: /monitor stop <id>'
    return stopMonitor(id)
  }
  return 'Usage: /monitor [start <command>|list|read <id> [lines]|stop <id>]'
}

async function runTuiWorktreeCommand(cwd: string, args: string[]): Promise<string> {
  const [actionRaw = 'list', path, branchOrFlag, ...rest] = args
  const action = parseWorktreeAction(actionRaw)
  if (action === 'list') return runWorktree(cwd, action, {})
  if (action === 'add') {
    if (!path) return 'Usage: /worktree add <path> [branch|--detach]'
    return runWorktree(cwd, action, {
      path,
      branch: branchOrFlag && branchOrFlag !== '--detach' ? branchOrFlag : undefined,
      detach: branchOrFlag === '--detach' || rest.includes('--detach'),
    })
  }
  if (action === 'remove') {
    if (!path) return 'Usage: /worktree remove <path> [--force]'
    return runWorktree(cwd, action, { path, force: branchOrFlag === '--force' || rest.includes('--force') })
  }
  return 'Usage: /worktree [list|add <path> [branch|--detach]|remove <path> [--force]]'
}

async function runPermissionsCommand(
  cwd: string,
  currentMode: ApprovalMode,
  args: string[],
  setApprovalMode: (mode: ApprovalMode) => void,
): Promise<string> {
  const [action, target, ...rest] = args
  if (!action) {
    return [`Approval mode: ${currentMode}`, renderApprovalMemory(await loadApprovalMemory(cwd))].join('\n')
  }
  if (action === 'off' || action === 'risky' || action === 'all') {
    setApprovalMode(action)
    return `Approval mode: ${action}`
  }
  if (action === 'clear') {
    await clearApprovalMemory(cwd)
    return 'Approval memory cleared.'
  }
  if ((action === 'allow-tool' || action === 'deny-tool') && target) {
    await rememberApproval(cwd, { toolName: target, arguments: {}, reason: 'Manual permission command.' }, action === 'allow-tool' ? 'allow' : 'deny')
    return `${action === 'allow-tool' ? 'Allowed' : 'Denied'} tool ${target}.`
  }
  if ((action === 'allow-shell' || action === 'deny-shell') && target) {
    const command = [target, ...rest].join(' ')
    await rememberApproval(cwd, { toolName: 'run_shell', arguments: { command }, reason: 'Manual permission command.' }, action === 'allow-shell' ? 'allow' : 'deny')
    return `${action === 'allow-shell' ? 'Allowed' : 'Denied'} shell command ${command}.`
  }
  if (action === 'import' && target) {
    await saveApprovalMemory(cwd, JSON.parse(target) as ApprovalMemory)
    return 'Approval memory imported.'
  }
  return 'Usage: /permissions [off|risky|all|clear|allow-tool <name>|deny-tool <name>|allow-shell <cmd>|deny-shell <cmd>]'
}

async function askTuiApproval(rl: Interface, cwd: string, request: ApprovalRequest): Promise<boolean> {
  const answer = await rl.question([
    `[approval] ${request.toolName}: ${request.reason}`,
    formatToolArgs(request.arguments),
    '[y]es once, [n]o once, [a]lways allow, [d]eny always > ',
  ].join('\n'))
  const normalized = answer.trim().toLowerCase()
  if (normalized === 'a' || normalized === 'always') {
    await rememberApproval(cwd, request, 'allow')
    return true
  }
  if (normalized === 'd' || normalized === 'deny') {
    await rememberApproval(cwd, request, 'deny')
    return false
  }
  return normalized === 'y' || normalized === 'yes'
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object.')
  }
  return parsed as Record<string, unknown>
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Expected JSON string array.')
  }
  return parsed
}

function parseStringRecord(value: string): Record<string, string> {
  const parsed = parseJsonObject(value)
  if (Object.values(parsed).some((entry) => typeof entry !== 'string')) {
    throw new Error('Expected JSON object with string values.')
  }
  return parsed as Record<string, string>
}

export function isAffirmative(value: string): boolean {
  return ['y', 'yes', 'apply', 'a'].includes(value.trim().toLowerCase())
}

function formatToolArgs(args: Record<string, unknown>): string {
  const text = JSON.stringify(args)
  return text.length > 180 ? `${text.slice(0, 177)}...` : text
}
