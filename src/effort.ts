import type { ConfigOverrides, RuntimeConfig } from './config.js'

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh'

export type EffortPreset = {
  level: EffortLevel
  maxTurns: number
  maxOutputTokens: number
  temperature: number
  description: string
}

export const EFFORT_PRESETS: EffortPreset[] = [
  {
    level: 'low',
    maxTurns: 6,
    maxOutputTokens: 2048,
    temperature: 0.1,
    description: 'Fast, low-cost answers and small edits.',
  },
  {
    level: 'medium',
    maxTurns: 12,
    maxOutputTokens: 4096,
    temperature: 0.2,
    description: 'Balanced default for everyday coding.',
  },
  {
    level: 'high',
    maxTurns: 20,
    maxOutputTokens: 8192,
    temperature: 0.2,
    description: 'Deeper tool loops and longer responses for complex work.',
  },
  {
    level: 'xhigh',
    maxTurns: 30,
    maxOutputTokens: 12000,
    temperature: 0.1,
    description: 'Maximum local-terminal depth for hard repo tasks.',
  },
]

export function parseEffortLevel(value: string): EffortLevel {
  const normalized = value.toLowerCase()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') return normalized
  throw new Error('Unsupported effort. Use low, medium, high, or xhigh.')
}

export function applyEffortPreset(config: RuntimeConfig, level: EffortLevel): RuntimeConfig {
  const preset = EFFORT_PRESETS.find((candidate) => candidate.level === level)
  if (!preset) throw new Error(`Unknown effort preset: ${level}`)
  return {
    ...config,
    maxTurns: preset.maxTurns,
    maxOutputTokens: preset.maxOutputTokens,
    temperature: preset.temperature,
  }
}

export function effortOverrides(level: EffortLevel): ConfigOverrides {
  const preset = EFFORT_PRESETS.find((candidate) => candidate.level === level)
  if (!preset) throw new Error(`Unknown effort preset: ${level}`)
  return {
    maxTurns: preset.maxTurns,
    maxOutputTokens: preset.maxOutputTokens,
    temperature: preset.temperature,
  }
}

export function inferEffortLevel(config: Pick<RuntimeConfig, 'maxTurns' | 'maxOutputTokens' | 'temperature'>): EffortLevel | 'custom' {
  return EFFORT_PRESETS.find((preset) =>
    preset.maxTurns === config.maxTurns &&
    preset.maxOutputTokens === config.maxOutputTokens &&
    preset.temperature === config.temperature
  )?.level ?? 'custom'
}

export function renderEffort(config: RuntimeConfig): string {
  const current = inferEffortLevel(config)
  return [
    `Current effort: ${current}`,
    `  maxTurns=${config.maxTurns}`,
    `  maxOutputTokens=${config.maxOutputTokens}`,
    `  temperature=${config.temperature}`,
    '',
    'Presets:',
    ...EFFORT_PRESETS.map((preset) =>
      `  ${preset.level.padEnd(6)} maxTurns=${preset.maxTurns} maxOutputTokens=${preset.maxOutputTokens} temperature=${preset.temperature} - ${preset.description}`
    ),
  ].join('\n')
}
