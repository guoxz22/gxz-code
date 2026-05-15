import type { RuntimeConfig } from '../config.js'
import type { ModelProvider } from '../types.js'
import { createAnthropicCompatibleProvider } from './anthropicCompatible.js'
import { createOpenAICompatibleProvider } from './openaiCompatible.js'

export function createProvider(config: RuntimeConfig): ModelProvider {
  switch (config.provider) {
    case 'glm-openai':
    case 'openai':
      return createOpenAICompatibleProvider({
        name: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      })
    case 'glm-anthropic':
    case 'anthropic':
      return createAnthropicCompatibleProvider({
        name: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      })
  }
}
