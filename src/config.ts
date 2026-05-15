import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { ProviderName } from './types.js'

export const DEFAULT_GLM_OPENAI_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'
export const DEFAULT_GLM_ANTHROPIC_BASE_URL = 'https://open.bigmodel.cn/api/anthropic'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_GLM_MODEL = 'glm-5.1'

export type RuntimeConfig = {
  provider: ProviderName
  model: string
  baseUrl: string
  apiKey?: string
  cwd: string
  maxTurns: number
  timeoutMs: number
  allowShell: boolean
  requireApproval: boolean
  temperature: number
  maxOutputTokens: number
}

export type ConfigOverrides = {
  provider?: ProviderName
  model?: string
  baseUrl?: string
  apiKey?: string
  cwd?: string
  maxTurns?: number
  timeoutMs?: number
  allowShell?: boolean
  requireApproval?: boolean
  temperature?: number
  maxOutputTokens?: number
}

type FileConfig = Partial<Omit<RuntimeConfig, 'apiKey'>>

export function loadConfig(overrides: ConfigOverrides = {}, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const fileConfig = loadFileConfig(env)
  const provider = parseProvider(
    overrides.provider ?? env.GXZ_PROVIDER ?? fileConfig.provider ?? 'glm-openai',
  )

  const model =
    overrides.model ??
    env.GXZ_MODEL ??
    fileConfig.model ??
    defaultModelForProvider(provider, env)

  return {
    provider,
    model,
    baseUrl: overrides.baseUrl ?? env.GXZ_BASE_URL ?? fileConfig.baseUrl ?? defaultBaseUrl(provider, env),
    apiKey: overrides.apiKey ?? apiKeyForProvider(provider, env),
    cwd: resolve(overrides.cwd ?? env.GXZ_CWD ?? fileConfig.cwd ?? process.cwd()),
    maxTurns: numberOption(overrides.maxTurns, env.GXZ_MAX_TURNS, fileConfig.maxTurns, 12),
    timeoutMs: numberOption(overrides.timeoutMs, env.GXZ_TOOL_TIMEOUT_MS, fileConfig.timeoutMs, 120_000),
    allowShell: booleanOption(overrides.allowShell, env.GXZ_ALLOW_SHELL, fileConfig.allowShell, false),
    requireApproval: booleanOption(overrides.requireApproval, env.GXZ_REQUIRE_APPROVAL, fileConfig.requireApproval, false),
    temperature: numberOption(overrides.temperature, env.GXZ_TEMPERATURE, fileConfig.temperature, 0.2),
    maxOutputTokens: numberOption(
      overrides.maxOutputTokens,
      env.GXZ_MAX_OUTPUT_TOKENS,
      fileConfig.maxOutputTokens,
      4096,
    ),
  }
}

export function redactedConfig(config: RuntimeConfig): Record<string, unknown> {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? '<set>' : '<missing>',
    cwd: config.cwd,
    maxTurns: config.maxTurns,
    timeoutMs: config.timeoutMs,
    allowShell: config.allowShell,
    requireApproval: config.requireApproval,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  }
}

export function defaultBaseUrl(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): string {
  switch (provider) {
    case 'glm-openai':
      return env.GLM_OPENAI_BASE_URL ?? DEFAULT_GLM_OPENAI_BASE_URL
    case 'glm-anthropic':
      return env.GLM_ANTHROPIC_BASE_URL ?? DEFAULT_GLM_ANTHROPIC_BASE_URL
    case 'openai':
      return env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL
    case 'anthropic':
      return env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL
  }
}

export function defaultModelForProvider(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): string {
  switch (provider) {
    case 'glm-openai':
    case 'glm-anthropic':
      return env.GLM_MODEL ?? DEFAULT_GLM_MODEL
    case 'openai':
      return env.OPENAI_MODEL ?? 'gpt-4.1'
    case 'anthropic':
      return env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'
  }
}

export function apiKeyForProvider(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  switch (provider) {
    case 'glm-openai':
    case 'glm-anthropic':
      return env.GLM_API_KEY ?? env.BIGMODEL_API_KEY ?? env.ZHIPU_API_KEY
    case 'openai':
      return env.OPENAI_API_KEY
    case 'anthropic':
      return env.ANTHROPIC_API_KEY
  }
}

export function parseProvider(value: string): ProviderName {
  if (value === 'glm-openai' || value === 'glm-anthropic' || value === 'openai' || value === 'anthropic') {
    return value
  }
  throw new Error(`Unsupported provider "${value}". Use glm-openai, glm-anthropic, openai, or anthropic.`)
}

function loadFileConfig(env: NodeJS.ProcessEnv): FileConfig {
  const candidates = [
    env.GXZ_CONFIG,
    resolve(process.cwd(), '.gxz-code', 'config.json'),
    resolve(homedir(), '.gxz-code', 'config.json'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as FileConfig & { apiKey?: string }
    if ('apiKey' in parsed) {
      throw new Error(`Refusing to load apiKey from ${candidate}. Use environment variables for secrets.`)
    }
    return parsed
  }

  return {}
}

function numberOption(
  override: number | undefined,
  envValue: string | undefined,
  fileValue: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number') return override
  if (envValue !== undefined) {
    const parsed = Number(envValue)
    if (!Number.isFinite(parsed)) throw new Error(`Expected numeric environment value, got "${envValue}".`)
    return parsed
  }
  if (typeof fileValue === 'number') return fileValue
  return fallback
}

function booleanOption(
  override: boolean | undefined,
  envValue: string | undefined,
  fileValue: boolean | undefined,
  fallback: boolean,
): boolean {
  if (typeof override === 'boolean') return override
  if (envValue !== undefined) return ['1', 'true', 'yes', 'on'].includes(envValue.toLowerCase())
  if (typeof fileValue === 'boolean') return fileValue
  return fallback
}
