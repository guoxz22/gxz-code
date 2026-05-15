#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { loadConfig, parseProvider } from './config.js'
import { runAgent, type AgentEvent } from './agent.js'
import { createProvider } from './providers/index.js'
import { createAgentTools, createDefaultTools } from './tools/index.js'
import { renderConfig } from './commands/configCommand.js'
import { renderModels } from './commands/modelsCommand.js'
import { renderSessions, titleFromPrompt } from './commands/sessionCommands.js'
import { createGitCommit, renderGitDiff, renderGitStatus } from './commands/gitCommands.js'
import { buildReviewPrompt } from './commands/reviewCommand.js'
import { renderSessionCost } from './commands/costCommand.js'
import { initWorkspace } from './commands/initCommand.js'
import { renderTranscript, searchTranscript } from './commands/transcriptCommands.js'
import { renderDoctor } from './commands/doctorCommand.js'
import { createSession, createSessionStore, updateSession } from './sessionStore.js'
import { loadPolicy } from './policy.js'
import { compactMessages } from './compact.js'
import { listSkills } from './skills.js'
import { askApproval } from './approvals.js'
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
import { startBridge } from './bridge.js'
import { runTui } from './tui.js'
import { buildDefaultTeamPlan, parseTeamPlan, renderTeamResults, runTeam } from './team.js'
import { buildLocalPrReview, defaultPrToken, fetchPrSummary, parsePrPlatform, publishPrComment } from './pr.js'
import { effortOverrides, parseEffortLevel, renderEffort } from './effort.js'
import { parseGitHubCliAction, runGitHubCli, type GitHubCliAction } from './github.js'
import { renderModelChoices, selectModel } from './models.js'
import type { ConfigOverrides } from './config.js'
import type { ChatMessage, SessionRecord } from './types.js'

type ParsedArgs = {
  command: string
  prompt: string
  overrides: ConfigOverrides
  json: boolean
  help: boolean
  version: boolean
  showConfig: boolean
  requestedModel?: string
  sessionId?: string
  resumeId?: string
  deleteSessionId?: string
  exportSessionId?: string
  searchQuery?: string
  policyPath?: string
  mcpConfigPath?: string
  commitMessage?: string
  bridgePort?: number
  mcpAction?: string
  mcpServer?: string
  mcpTool?: string
  mcpResourceUri?: string
  mcpPrompt?: string
  mcpArguments?: Record<string, unknown>
  mcpServerCommand?: string
  mcpServerArgs?: string[]
  mcpServerEnv?: Record<string, string>
  mcpServerUrl?: string
  mcpServerHeaders?: Record<string, string>
  teamPlan?: string
  concurrency?: number
  codeActionPath?: string
  codeActionName?: string
  prPlatform?: string
  prRepo?: string
  prNumber?: number
  prBaseUrl?: string
  prComment?: string
  prPublish: boolean
  githubAction?: GitHubCliAction
  githubRepo?: string
  githubNumber?: number
  githubLimit?: number
  githubTitle?: string
  githubBody?: string
  githubPublish: boolean
  patchPath?: string
  patchOldText?: string
  patchNewText?: string
  patchApply: boolean
}

const VERSION = '0.1.0'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.version) {
    console.log(VERSION)
    return
  }

  if (args.help) {
    console.log(helpText())
    return
  }

  let config = loadConfig(args.overrides)
  if (args.requestedModel) config = selectModel(config, args.requestedModel).config

  if (args.command === 'config') {
    if (!args.showConfig) {
      console.log('Use: gxz-code config --show')
      return
    }
    console.log(renderConfig(config))
    return
  }

  if (args.command === 'models') {
    console.log(renderModels())
    return
  }

  if (args.command === 'init') {
    console.log(await initWorkspace(config.cwd))
    return
  }

  if (args.command === 'status') {
    console.log(await renderGitStatus(config.cwd))
    return
  }

  if (args.command === 'diff') {
    console.log(await renderGitDiff(config.cwd))
    return
  }

  if (args.command === 'commit') {
    if (!args.commitMessage) {
      console.log('Use: gxz-code commit --message <message>')
      return
    }
    console.log(await createGitCommit(config.cwd, args.commitMessage))
    return
  }

  if (args.command === 'doctor') {
    console.log(await renderDoctor(config))
    return
  }

  if (args.command === 'mcp') {
    console.log(await runMcpCommand(config.cwd, args))
    return
  }

  if (args.command === 'bridge') {
    await startBridge(config, args.bridgePort ?? 37818)
    return
  }

  if (args.command === 'diagnostics') {
    console.log(await createDiagnosticsTool().execute({}, {
      cwd: config.cwd,
      allowShell: false,
      timeoutMs: config.timeoutMs,
    }))
    return
  }

  if (args.command === 'code-action') {
    if (!args.codeActionPath || !args.codeActionName) {
      console.log('Use: gxz-code code-action --path <file> --action <name>')
      return
    }
    console.log(await runCodeAction(config.cwd, args.codeActionPath, args.codeActionName, config.timeoutMs))
    return
  }

  if (args.command === 'patch') {
    if (!args.patchPath || args.patchOldText === undefined || args.patchNewText === undefined) {
      console.log('Use: gxz-code patch --path <file> --old <text> --new <text> [--apply]')
      return
    }
    console.log(await createPatchTool().execute({
      path: args.patchPath,
      oldText: args.patchOldText,
      newText: args.patchNewText,
      apply: args.patchApply,
    }, { cwd: config.cwd, allowShell: false, timeoutMs: config.timeoutMs }))
    return
  }

  if (args.command === 'pr') {
    if (!args.prRepo || !args.prNumber) {
      console.log(await buildLocalPrReview(config.cwd))
      return
    }
    const platform = parsePrPlatform(args.prPlatform ?? 'github')
    const token = defaultPrToken(platform)
    if (args.prComment) {
      console.log(await publishPrComment({
        platform,
        repo: args.prRepo,
        number: args.prNumber,
        baseUrl: args.prBaseUrl,
        token,
        body: args.prComment,
        dryRun: !args.prPublish,
      }))
      return
    }
    console.log(JSON.stringify(await fetchPrSummary({
      platform,
      repo: args.prRepo,
      number: args.prNumber,
      baseUrl: args.prBaseUrl,
      token,
    }), null, 2))
    return
  }

  if (args.command === 'github' || args.command === 'gh') {
    if (!args.githubAction) {
      console.log('Use: gxz-code github --action pr-view|pr-diff|pr-checks|issue-view|issue-list [--repo owner/repo] [--number n] [--limit n]')
      return
    }
    console.log(await runGitHubCli({
      action: args.githubAction,
      repo: args.githubRepo,
      number: args.githubNumber,
      limit: args.githubLimit,
      title: args.githubTitle,
      body: args.githubBody,
      publish: args.githubPublish,
      cwd: config.cwd,
      timeoutMs: config.timeoutMs,
    }))
    return
  }

  if (args.command === 'cost') {
    if (!args.resumeId) {
      console.log('Use: gxz-code cost --resume <session-id>')
      return
    }
    console.log(renderSessionCost(await createSessionStore().load(args.resumeId)))
    return
  }

  if (args.command === 'skills') {
    const skills = await listSkills(config.cwd)
    console.log(skills.length ? skills.map((skill) => `${skill.name}\t${skill.description ?? ''}\t${skill.path}`).join('\n') : 'No skills found.')
    return
  }

  if (args.command === 'sessions') {
    const store = createSessionStore()
    if (args.deleteSessionId) {
      await store.delete(args.deleteSessionId)
      console.log(`Deleted session ${args.deleteSessionId}`)
      return
    }
    if (args.exportSessionId) {
      console.log(renderTranscript(await store.load(args.exportSessionId)))
      return
    }
    if (args.resumeId && args.searchQuery) {
      console.log(searchTranscript(await store.load(args.resumeId), args.searchQuery))
      return
    }
    console.log(renderSessions(await store.list()))
    return
  }

  const policy = await loadPolicy(config.cwd, args.policyPath)
  const provider = createProvider(config)

  if (args.command === 'run' && !args.prompt.trim()) {
    await runTui({ config, sessionId: args.sessionId ?? args.resumeId, resume: Boolean(args.resumeId), policy })
    return
  }

  if (args.command === 'review') {
    const reviewPrompt = await buildReviewPrompt(config.cwd)
    if (reviewPrompt.includes('Not a git repository.') || reviewPrompt.trim().endsWith('[no output]')) {
      console.log('No reviewable git diff found. Run status or make changes in a git repository first.')
      return
    }
    const result = await runAgent({
      provider,
      model: config.model,
      prompt: reviewPrompt,
      cwd: config.cwd,
      tools: [],
      allowShell: config.allowShell,
      maxTurns: 1,
      timeoutMs: config.timeoutMs,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      policy,
      approve: config.requireApproval ? askApproval : undefined,
      onEvent: renderEvent,
    })
    if (!result.text.trim()) console.log('[completed with no text response]')
    return
  }

  if (args.command === 'chat') {
    await runChat(config, args.sessionId ?? args.resumeId, Boolean(args.resumeId), policy)
    return
  }

  if (args.command === 'tui') {
    await runTui({ config, sessionId: args.sessionId ?? args.resumeId, resume: Boolean(args.resumeId), policy })
    return
  }

  if (args.command === 'team') {
    const plan = args.teamPlan ? parseTeamPlan(args.teamPlan) : buildDefaultTeamPlan(args.prompt)
    const results = await runTeam({
      provider,
      model: config.model,
      cwd: config.cwd,
      tools: createAgentTools({ provider, model: config.model, temperature: config.temperature, maxOutputTokens: config.maxOutputTokens }),
      plan,
      allowShell: config.allowShell,
      timeoutMs: config.timeoutMs,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      concurrency: args.concurrency,
    })
    console.log(renderTeamResults(results, args.json))
    return
  }

  const prompt = args.prompt.trim()
  if (!prompt) {
    await runTui({ config, sessionId: args.sessionId ?? args.resumeId, resume: Boolean(args.resumeId), policy })
    return
  }

  const store = createSessionStore()
  const loadedSession = args.resumeId ? await store.load(args.resumeId) : undefined
  const result = await runAgent({
    provider,
    model: config.model,
    prompt,
    messages: loadedSession?.messages,
    cwd: config.cwd,
    tools: createAgentTools({ provider, model: config.model, temperature: config.temperature, maxOutputTokens: config.maxOutputTokens }),
    allowShell: config.allowShell,
    maxTurns: config.maxTurns,
    timeoutMs: config.timeoutMs,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    policy,
    approve: config.requireApproval ? askApproval : undefined,
    onEvent: args.json ? undefined : renderEvent,
  })

  if (args.json) {
    console.log(JSON.stringify({
      text: result.text,
      turns: result.turns,
      toolCalls: result.toolCalls,
      usage: result.usage,
    }, null, 2))
  } else if (!result.text.trim()) {
    console.log('[completed with no text response]')
  }

  if (args.sessionId || args.resumeId) {
    const session = loadedSession
      ? updateSession(loadedSession, { messages: result.messages, provider: config.provider, model: config.model, cwd: config.cwd })
      : createSession({
        id: args.sessionId,
        title: titleFromPrompt(prompt),
        cwd: config.cwd,
        provider: config.provider,
        model: config.model,
        messages: result.messages,
      })
    await store.save(session)
  }
}

async function runChat(
  config = loadConfig(),
  sessionId?: string,
  resume = false,
  policy = {},
): Promise<void> {
  const rl = createInterface({ input, output })
  const store = createSessionStore()
  const provider = createProvider(config)
  let session: SessionRecord | undefined = resume && sessionId ? await store.load(sessionId) : undefined
  let messages: ChatMessage[] = session?.messages ?? []
  console.log(`GXZ-code chat (${config.provider}/${config.model}). Type /exit to quit.`)
  try {
    while (true) {
      const prompt = await rl.question('gxz> ')
      const slashHandled = await handleSlashCommand(prompt, config, () => messages, (next) => {
        messages = next
      })
      if (slashHandled === 'exit') break
      if (slashHandled === 'handled') continue
      if (!prompt.trim()) continue
      const result = await runAgent({
        provider,
        model: config.model,
        prompt,
        messages,
        cwd: config.cwd,
        tools: createAgentTools({ provider, model: config.model, temperature: config.temperature, maxOutputTokens: config.maxOutputTokens }),
        allowShell: config.allowShell,
        maxTurns: config.maxTurns,
        timeoutMs: config.timeoutMs,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        policy,
        approve: config.requireApproval ? askApproval : undefined,
        onEvent: renderEvent,
      })
      messages = result.messages
      if (sessionId) {
        session = session
          ? updateSession(session, { messages, provider: config.provider, model: config.model, cwd: config.cwd })
          : createSession({
            id: sessionId,
            title: titleFromPrompt(prompt),
            cwd: config.cwd,
            provider: config.provider,
            model: config.model,
            messages,
          })
        await store.save(session)
      }
      if (!result.text.trim()) console.log('[completed with no text response]')
    }
  } finally {
    rl.close()
  }
}

async function handleSlashCommand(
  prompt: string,
  config: ReturnType<typeof loadConfig>,
  getMessages: () => ChatMessage[],
  setMessages: (messages: ChatMessage[]) => void,
): Promise<'handled' | 'exit' | 'none'> {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith('/')) return 'none'
  const [command, ...rest] = trimmed.slice(1).split(/\s+/)
  switch (command) {
    case 'exit':
    case 'quit':
      return 'exit'
    case 'help':
      console.log(chatHelpText())
      return 'handled'
    case 'config':
      console.log(renderConfig(config))
      return 'handled'
    case 'model':
      console.log(renderModelChoices(config))
      return 'handled'
    case 'effort':
    case 'effect':
      console.log(renderEffort(config))
      return 'handled'
    case 'tools':
      console.log(createDefaultTools().map((tool) => `${tool.name}: ${tool.description}`).join('\n'))
      return 'handled'
    case 'skills': {
      const skills = await listSkills(config.cwd)
      console.log(skills.length ? skills.map((skill) => `${skill.name}\t${skill.description ?? ''}`).join('\n') : 'No skills found.')
      return 'handled'
    }
    case 'doctor':
      console.log(await renderDoctor(config))
      return 'handled'
    case 'compact': {
      const compacted = await compactMessages({
        provider: createProvider(config),
        model: config.model,
        messages: getMessages(),
        tools: createDefaultTools(),
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        cwd: config.cwd,
      })
      setMessages(compacted)
      console.log(`Compacted context to ${compacted.length} message.`)
      return 'handled'
    }
    case 'clear':
      setMessages([])
      console.log('Conversation context cleared.')
      return 'handled'
    case 'history':
      console.log(`${getMessages().length} messages in context.`)
      return 'handled'
    case 'save': {
      const id = rest.join(' ').trim()
      if (!id) {
        console.log('Usage: /save <session-id>')
        return 'handled'
      }
      const store = createSessionStore()
      const session = createSession({
        id,
        title: `Saved chat ${id}`,
        cwd: config.cwd,
        provider: config.provider,
        model: config.model,
        messages: getMessages(),
      })
      await store.save(session)
      console.log(`Saved session ${session.id}`)
      return 'handled'
    }
    default:
      console.log(`Unknown slash command: /${command}. Use /help.`)
      return 'handled'
  }
}

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'assistant_text':
      process.stdout.write(event.text.endsWith('\n') ? event.text : `${event.text}\n`)
      break
    case 'assistant_delta':
      process.stdout.write(event.text)
      break
    case 'tool_start':
      console.error(`[tool] ${event.toolCall.name}`)
      break
    case 'tool_result':
      console.error(`[tool] ${event.toolCall.name} ok (${event.result.length} chars)`)
      break
    case 'tool_error':
      console.error(`[tool] ${event.toolCall.name} failed: ${event.error}`)
      break
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const overrides: ConfigOverrides = {}
  const positional: string[] = []
  let command = 'run'
  let json = false
  let help = false
  let version = false
  let showConfig = false
  let requestedModel: string | undefined
  let sessionId: string | undefined
  let resumeId: string | undefined
  let deleteSessionId: string | undefined
  let exportSessionId: string | undefined
  let searchQuery: string | undefined
  let policyPath: string | undefined
  let mcpConfigPath: string | undefined
  let commitMessage: string | undefined
  let bridgePort: number | undefined
  let mcpAction: string | undefined
  let mcpServer: string | undefined
  let mcpTool: string | undefined
  let mcpResourceUri: string | undefined
  let mcpPrompt: string | undefined
  let mcpArguments: Record<string, unknown> | undefined
  let mcpServerCommand: string | undefined
  let mcpServerArgs: string[] | undefined
  let mcpServerEnv: Record<string, string> | undefined
  let mcpServerUrl: string | undefined
  let mcpServerHeaders: Record<string, string> | undefined
  let teamPlan: string | undefined
  let concurrency: number | undefined
  let codeActionPath: string | undefined
  let codeActionName: string | undefined
  let prPlatform: string | undefined
  let prRepo: string | undefined
  let prNumber: number | undefined
  let prBaseUrl: string | undefined
  let prComment: string | undefined
  let prPublish = false
  let githubAction: GitHubCliAction | undefined
  let githubRepo: string | undefined
  let githubNumber: number | undefined
  let githubLimit: number | undefined
  let githubTitle: string | undefined
  let githubBody: string | undefined
  let githubPublish = false
  let patchPath: string | undefined
  let patchOldText: string | undefined
  let patchNewText: string | undefined
  let patchApply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--version' || arg === '-v') {
      version = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--show') {
      showConfig = true
    } else if (arg === '--allow-shell') {
      overrides.allowShell = true
    } else if (arg === '--session') {
      sessionId = requireValue(argv, ++index, '--session')
    } else if (arg === '--resume') {
      resumeId = requireValue(argv, ++index, '--resume')
    } else if (arg === '--delete') {
      deleteSessionId = requireValue(argv, ++index, '--delete')
    } else if (arg === '--export') {
      exportSessionId = requireValue(argv, ++index, '--export')
    } else if (arg === '--search') {
      searchQuery = requireValue(argv, ++index, '--search')
    } else if (arg === '--policy') {
      policyPath = requireValue(argv, ++index, '--policy')
    } else if (arg === '--mcp-config') {
      mcpConfigPath = requireValue(argv, ++index, '--mcp-config')
    } else if (arg === '--action') {
      if (command === 'code-action') {
        codeActionName = requireValue(argv, ++index, '--action')
      } else if (command === 'github' || command === 'gh') {
        githubAction = parseGitHubCliAction(requireValue(argv, ++index, '--action'))
      } else {
        mcpAction = requireValue(argv, ++index, '--action')
      }
    } else if (arg === '--server') {
      mcpServer = requireValue(argv, ++index, '--server')
    } else if (arg === '--tool') {
      mcpTool = requireValue(argv, ++index, '--tool')
    } else if (arg === '--uri') {
      mcpResourceUri = requireValue(argv, ++index, '--uri')
    } else if (arg === '--prompt-name') {
      mcpPrompt = requireValue(argv, ++index, '--prompt-name')
    } else if (arg === '--arguments') {
      mcpArguments = parseJsonObjectFlag(requireValue(argv, ++index, '--arguments'))
    } else if (arg === '--cmd') {
      mcpServerCommand = requireValue(argv, ++index, '--cmd')
    } else if (arg === '--args') {
      mcpServerArgs = parseJsonArrayFlag(requireValue(argv, ++index, '--args'))
    } else if (arg === '--env') {
      mcpServerEnv = parseStringRecordFlag(requireValue(argv, ++index, '--env'))
    } else if (arg === '--url') {
      mcpServerUrl = requireValue(argv, ++index, '--url')
    } else if (arg === '--headers') {
      mcpServerHeaders = parseStringRecordFlag(requireValue(argv, ++index, '--headers'))
    } else if (arg === '--plan-json') {
      teamPlan = requireValue(argv, ++index, '--plan-json')
    } else if (arg === '--concurrency') {
      concurrency = Number(requireValue(argv, ++index, '--concurrency'))
    } else if (arg === '--path') {
      if (command === 'patch') patchPath = requireValue(argv, ++index, '--path')
      else codeActionPath = requireValue(argv, ++index, '--path')
    } else if (arg === '--old') {
      patchOldText = requireValue(argv, ++index, '--old')
    } else if (arg === '--new') {
      patchNewText = requireValue(argv, ++index, '--new')
    } else if (arg === '--apply') {
      patchApply = true
    } else if (arg === '--platform') {
      prPlatform = requireValue(argv, ++index, '--platform')
    } else if (arg === '--repo') {
      if (command === 'github' || command === 'gh') githubRepo = requireValue(argv, ++index, '--repo')
      else prRepo = requireValue(argv, ++index, '--repo')
    } else if (arg === '--number') {
      if (command === 'github' || command === 'gh') githubNumber = Number(requireValue(argv, ++index, '--number'))
      else prNumber = Number(requireValue(argv, ++index, '--number'))
    } else if (arg === '--limit') {
      githubLimit = Number(requireValue(argv, ++index, '--limit'))
    } else if (arg === '--pr-base-url') {
      prBaseUrl = requireValue(argv, ++index, '--pr-base-url')
    } else if (arg === '--comment') {
      prComment = requireValue(argv, ++index, '--comment')
    } else if (arg === '--title') {
      githubTitle = requireValue(argv, ++index, '--title')
    } else if (arg === '--body') {
      githubBody = requireValue(argv, ++index, '--body')
    } else if (arg === '--publish') {
      if (command === 'github' || command === 'gh') githubPublish = true
      else prPublish = true
    } else if (arg === '--message' || arg === '-m') {
      commitMessage = requireValue(argv, ++index, arg)
    } else if (arg === '--require-approval') {
      overrides.requireApproval = true
    } else if (arg === '--port') {
      bridgePort = Number(requireValue(argv, ++index, '--port'))
    } else if (arg === '--provider') {
      overrides.provider = parseProvider(requireValue(argv, ++index, '--provider'))
    } else if (arg === '--model') {
      requestedModel = requireValue(argv, ++index, '--model')
    } else if (arg === '--base-url') {
      overrides.baseUrl = requireValue(argv, ++index, '--base-url')
    } else if (arg === '--cwd') {
      overrides.cwd = requireValue(argv, ++index, '--cwd')
    } else if (arg === '--max-turns') {
      overrides.maxTurns = Number(requireValue(argv, ++index, '--max-turns'))
    } else if (arg === '--timeout-ms') {
      overrides.timeoutMs = Number(requireValue(argv, ++index, '--timeout-ms'))
    } else if (arg === '--temperature') {
      overrides.temperature = Number(requireValue(argv, ++index, '--temperature'))
    } else if (arg === '--max-output-tokens') {
      overrides.maxOutputTokens = Number(requireValue(argv, ++index, '--max-output-tokens'))
    } else if (arg === '--effort' || arg === '--effect') {
      Object.assign(overrides, effortOverrides(parseEffortLevel(requireValue(argv, ++index, arg))))
    } else if (
      (
        arg === 'chat' ||
        arg === 'tui' ||
        arg === 'team' ||
        arg === 'config' ||
        arg === 'models' ||
        arg === 'sessions' ||
        arg === 'status' ||
        arg === 'diff' ||
        arg === 'init' ||
        arg === 'doctor' ||
        arg === 'skills' ||
        arg === 'mcp' ||
        arg === 'diagnostics' ||
        arg === 'code-action' ||
        arg === 'patch' ||
        arg === 'review' ||
        arg === 'pr' ||
        arg === 'github' ||
        arg === 'gh' ||
        arg === 'commit' ||
        arg === 'cost' ||
        arg === 'bridge'
      ) &&
      positional.length === 0 &&
      command === 'run'
    ) {
      command = arg
    } else {
      positional.push(arg)
    }
  }

  return {
    command,
    prompt: positional.join(' '),
    overrides,
    json,
    help,
    version,
    showConfig,
    requestedModel,
    sessionId,
    resumeId,
    deleteSessionId,
    exportSessionId,
    searchQuery,
    policyPath,
    mcpConfigPath,
    commitMessage,
    bridgePort,
    mcpAction,
    mcpServer,
    mcpTool,
    mcpResourceUri,
    mcpPrompt,
    mcpArguments,
    mcpServerCommand,
    mcpServerArgs,
    mcpServerEnv,
    mcpServerUrl,
    mcpServerHeaders,
    teamPlan,
    concurrency,
    codeActionPath,
    codeActionName,
    prPlatform,
    prRepo,
    prNumber,
    prBaseUrl,
    prComment,
    prPublish,
    githubAction,
    githubRepo,
    githubNumber,
    githubLimit,
    githubTitle,
    githubBody,
    githubPublish,
    patchPath,
    patchOldText,
    patchNewText,
    patchApply,
  }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`Missing value for ${flag}`)
  return value
}

async function runMcpCommand(cwd: string, args: ParsedArgs): Promise<string> {
  const action = args.mcpAction ?? 'tools'
  if (action === 'list' || action === 'servers') return renderMcpServers(cwd, args.mcpConfigPath)
  if (action === 'add') {
    if (!args.mcpServer || (!args.mcpServerCommand && !args.mcpServerUrl)) throw new Error('Use: gxz-code mcp --action add --server <name> (--cmd <command> [--args JSON_ARRAY] [--env JSON_OBJECT] | --url <http-url> [--headers JSON_OBJECT])')
    return addMcpServer(cwd, args.mcpServer, {
      command: args.mcpServerCommand,
      args: args.mcpServerArgs,
      env: args.mcpServerEnv,
      url: args.mcpServerUrl,
      headers: args.mcpServerHeaders,
    }, args.mcpConfigPath)
  }
  if (action === 'remove') {
    if (!args.mcpServer) throw new Error('Use: gxz-code mcp --action remove --server <name>')
    return removeMcpServer(cwd, args.mcpServer, args.mcpConfigPath)
  }
  if (action === 'test') {
    if (!args.mcpServer) throw new Error('Use: gxz-code mcp --action test --server <name>')
    return testMcpServer(cwd, args.mcpServer, args.mcpConfigPath)
  }
  if (action === 'tools') return listMcpTools(cwd, args.mcpConfigPath)
  if (action === 'resources') return listMcpResources(cwd, args.mcpConfigPath)
  if (action === 'prompts') return listMcpPrompts(cwd, args.mcpConfigPath)
  if (action === 'call') {
    if (!args.mcpServer || !args.mcpTool) throw new Error('Use: gxz-code mcp --action call --server <name> --tool <name> [--arguments JSON]')
    return callMcpTool(cwd, args.mcpServer, args.mcpTool, args.mcpArguments ?? {}, undefined, args.mcpConfigPath)
  }
  if (action === 'read-resource') {
    if (!args.mcpServer || !args.mcpResourceUri) throw new Error('Use: gxz-code mcp --action read-resource --server <name> --uri <uri>')
    return readMcpResource(cwd, args.mcpServer, args.mcpResourceUri, undefined, args.mcpConfigPath)
  }
  if (action === 'get-prompt') {
    if (!args.mcpServer || !args.mcpPrompt) throw new Error('Use: gxz-code mcp --action get-prompt --server <name> --prompt-name <name> [--arguments JSON]')
    return getMcpPrompt(cwd, args.mcpServer, args.mcpPrompt, args.mcpArguments ?? {}, undefined, args.mcpConfigPath)
  }
  throw new Error(`Unknown MCP action: ${action}`)
}

function parseJsonObjectFlag(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object for --arguments.')
  }
  return parsed as Record<string, unknown>
}

function parseJsonArrayFlag(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Expected JSON string array.')
  }
  return parsed
}

function parseStringRecordFlag(value: string): Record<string, string> {
  const parsed = parseJsonObjectFlag(value)
  const invalid = Object.entries(parsed).find(([, entryValue]) => typeof entryValue !== 'string')
  if (invalid) throw new Error('Expected JSON object with string values.')
  return parsed as Record<string, string>
}

function helpText(): string {
  return [
    'GXZ-code - GLM-first coding agent CLI',
    '',
    'Usage:',
    '  gxz-code                 Start the interactive terminal UI',
    '  gxz-code [options] <prompt>',
    '  gxz-code chat [options]',
    '  gxz-code tui [options]',
    '  gxz-code team [options] <goal>',
    '  gxz-code config --show',
    '  gxz-code models',
    '  gxz-code sessions [--delete <id> | --export <id> | --resume <id> --search <query>]',
    '  gxz-code status',
    '  gxz-code diff',
    '  gxz-code init',
    '  gxz-code doctor',
    '  gxz-code skills',
    '  gxz-code mcp [--action list|add|remove|test|tools|resources|prompts|call|read-resource|get-prompt]',
    '  gxz-code code-action --path <file> --action <name>',
    '  gxz-code patch --path <file> --old <text> --new <text> [--apply]',
    '  gxz-code review',
    '  gxz-code pr [--repo owner/repo --number <n>]',
    '  gxz-code github --action <action> [--repo owner/repo] [--number <n>] [--publish]',
    '  gxz-code commit --message <message>',
    '  gxz-code cost --resume <session-id>',
    '  gxz-code bridge [--port <port>]',
    '',
    'Options:',
    '  --provider <name>           glm-openai | glm-anthropic | openai | anthropic',
    '  --model <name>              Model name, default glm-5.1',
    '  --base-url <url>            Override provider base URL',
    '  --cwd <path>                Workspace root',
    '  --max-turns <n>             Max model/tool loop turns',
    '  --timeout-ms <n>            Tool timeout',
    '  --temperature <n>           Sampling temperature',
    '  --max-output-tokens <n>     Response token limit',
    '  --effort <level>            Apply low | medium | high | xhigh preset',
    '  --allow-shell               Allow write-like shell commands',
    '  --session <id>              Save one-shot/chat transcript under this id',
    '  --resume <id>               Resume a saved session',
    '  --policy <path>             Permission policy JSON path',
    '  --mcp-config <path>         MCP config JSON path',
    '  --server <name>             MCP server for call/read/get actions',
    '  --tool <name>               MCP tool for --action call',
    '  --uri <uri>                 MCP resource URI for --action read-resource',
    '  --prompt-name <name>        MCP prompt name for --action get-prompt',
    '  --arguments <json>          MCP tool/prompt JSON arguments',
    '  --cmd <command>             MCP server command for --action add',
    '  --args <json-array>         MCP server argv for --action add',
    '  --env <json-object>         MCP server env for --action add',
    '  --url <url>                 MCP streamable HTTP URL for --action add',
    '  --headers <json-object>     MCP HTTP headers for --action add',
    '  --plan-json <json>          Team plan JSON with tasks',
    '  --concurrency <n>           Team task concurrency, max 6',
    '  --path <file>               File path for code-action',
    '  --old <text>                Old text for patch',
    '  --new <text>                New text for patch',
    '  --apply                     Apply patch; default is preview',
    '  --platform <name>           PR platform: github or gitlab',
    '  --repo <owner/repo|id>       PR repository or GitLab project id/path',
    '  --number <n>                PR/MR number',
    '  --pr-base-url <url>         Override PR platform API base URL',
    '  --comment <text>            PR/MR comment body; dry-run unless --publish',
    '  --publish                   Publish PR/MR comment to the platform',
    '  --limit <n>                 GitHub issue list limit',
    '  --title <text>              GitHub issue title for issue-create',
    '  --body <text>               GitHub body/comment for write actions',
    '  --require-approval          Prompt before each tool call',
    '  --port <port>               Bridge server port',
    '  --json                      JSON output for one-shot mode',
    '  -h, --help                  Show help',
    '  -v, --version               Show version',
  ].join('\n')
}

function chatHelpText(): string {
  return [
    'Chat commands:',
    '  /help              Show chat commands',
    '  /config            Show effective config with secret redaction',
    '  /model             Show provider/model',
    '  /effort            Show low/medium/high/xhigh presets',
    '  /effect            Alias for /effort',
    '  /tools             List available tools',
    '  /skills            List local skills',
    '  /doctor            Show environment diagnostics',
    '  /compact           Summarize and compact chat context through the model',
    '  /history           Show message count in context',
    '  /clear             Clear conversation context',
    '  /save <id>         Save current chat session',
    '  /exit              Quit chat',
  ].join('\n')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`GXZ-code error: ${message}`)
  process.exitCode = 1
})
