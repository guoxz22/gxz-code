import { MODEL_CHOICES } from '../models.js'

export function renderModels(): string {
  return [
    'GLM-first models:',
    ...MODEL_CHOICES
      .filter((choice) => choice.provider.startsWith('glm-'))
      .map((choice) => `  ${choice.model.padEnd(18)} aliases: ${choice.aliases.join(', ')}`),
    '',
    'Claude aliases require the anthropic provider/API key:',
    ...MODEL_CHOICES
      .filter((choice) => choice.provider === 'anthropic')
      .map((choice) => `  ${choice.aliases[0]!.padEnd(8)} -> ${choice.model}`),
    '',
    'Providers:',
    '  glm-openai      OpenAI-compatible BigModel Coding Plan endpoint',
    '  glm-anthropic   Anthropic-compatible BigModel endpoint',
    '  openai          Custom/OpenAI-compatible endpoint',
    '  anthropic       Anthropic Messages-compatible endpoint',
  ].join('\n')
}
