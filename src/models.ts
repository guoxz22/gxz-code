import {
  apiKeyForProvider,
  defaultBaseUrl,
  type RuntimeConfig,
} from './config.js'
import type { ProviderName } from './types.js'

export type ModelChoice = {
  provider: ProviderName
  model: string
  label: string
  description: string
  aliases: string[]
}

export const MODEL_CHOICES: ModelChoice[] = [
  {
    provider: 'glm-openai',
    model: 'glm-5.1',
    label: 'GLM 5.1',
    description: 'GXZ default GLM coding model.',
    aliases: ['glm', 'glm-5', 'glm-5.1', 'default'],
  },
  {
    provider: 'glm-openai',
    model: 'glm-5-turbo',
    label: 'GLM 5 Turbo',
    description: 'Fast GLM coding model.',
    aliases: ['turbo', 'glm-turbo', 'glm-5-turbo'],
  },
  {
    provider: 'glm-openai',
    model: 'glm-4.5-air',
    label: 'GLM 4.5 Air',
    description: 'Small and fast GLM model.',
    aliases: ['air', 'glm-air', 'glm-4.5-air'],
  },
  {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    label: 'Claude Opus',
    description: 'Claude Opus alias. Requires ANTHROPIC_API_KEY.',
    aliases: ['opus', 'claude-opus', 'claude-opus-4-7'],
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet',
    description: 'Claude Sonnet alias. Requires ANTHROPIC_API_KEY.',
    aliases: ['sonnet', 'claude-sonnet', 'claude-sonnet-4-6'],
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku',
    description: 'Claude Haiku alias. Requires ANTHROPIC_API_KEY.',
    aliases: ['haiku', 'claude-haiku', 'claude-haiku-4-5'],
  },
]

export type ModelSelection = {
  config: RuntimeConfig
  choice?: ModelChoice
  note?: string
}

export function selectModel(config: RuntimeConfig, value: string, env: NodeJS.ProcessEnv = process.env): ModelSelection {
  const raw = value.trim()
  if (!raw) return { config }
  const prefixed = parseProviderPrefixedModel(raw)
  const choice = findModelChoice(prefixed.model)
  const provider = prefixed.provider ?? choice?.provider ?? inferProviderForRawModel(config.provider, raw)
  const model = choice?.model ?? prefixed.model
  const next = {
    ...config,
    provider,
    model,
    baseUrl: defaultBaseUrl(provider, env),
    apiKey: apiKeyForProvider(provider, env),
  }
  return {
    config: next,
    choice,
    note: modelSelectionNote(next, choice),
  }
}

export function renderModelChoices(config: RuntimeConfig): string {
  return [
    `Current model: ${config.provider}/${config.model}`,
    '',
    'GLM aliases:',
    ...MODEL_CHOICES
      .filter((choice) => choice.provider === 'glm-openai')
      .map((choice) => `  ${choice.aliases[0]!.padEnd(10)} -> ${choice.provider}/${choice.model}  ${choice.description}`),
    '',
    'Claude aliases:',
    ...MODEL_CHOICES
      .filter((choice) => choice.provider === 'anthropic')
      .map((choice) => `  ${choice.aliases[0]!.padEnd(10)} -> ${choice.provider}/${choice.model}  ${choice.description}`),
    '',
    'Provider prefix examples:',
    '  /model glm:turbo',
    '  /model anthropic:sonnet',
    '  /model openai:gpt-4.1',
  ].join('\n')
}

function findModelChoice(value: string): ModelChoice | undefined {
  const normalized = value.toLowerCase()
  return MODEL_CHOICES.find((choice) => choice.aliases.includes(normalized) || choice.model.toLowerCase() === normalized)
}

function parseProviderPrefixedModel(value: string): { provider?: ProviderName; model: string } {
  const match = value.match(/^(glm|glm-openai|glm-anthropic|claude|anthropic|openai):(.+)$/i)
  if (!match) return { model: value }
  const prefix = match[1]!.toLowerCase()
  const model = match[2]!.trim()
  const provider: ProviderName =
    prefix === 'glm' ? 'glm-openai' :
      prefix === 'claude' ? 'anthropic' :
        prefix as ProviderName
  return { provider, model }
}

function inferProviderForRawModel(currentProvider: ProviderName, raw: string): ProviderName {
  const normalized = raw.toLowerCase()
  if (normalized.startsWith('claude-')) return 'anthropic'
  if (normalized.startsWith('glm-')) return currentProvider.startsWith('glm-') ? currentProvider : 'glm-openai'
  if (normalized.startsWith('gpt-') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4')) return 'openai'
  return currentProvider
}

function modelSelectionNote(config: RuntimeConfig, choice: ModelChoice | undefined): string | undefined {
  if (config.provider === 'anthropic' && !config.apiKey) {
    return 'Selected a Claude model. Set ANTHROPIC_API_KEY to call Anthropic directly, or choose a GLM alias such as glm, turbo, or air.'
  }
  if (choice?.provider === 'glm-openai') {
    return 'Selected a GLM model for the BigModel OpenAI-compatible coding endpoint.'
  }
  return undefined
}
