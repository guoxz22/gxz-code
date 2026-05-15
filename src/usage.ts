import type { ChatMessage, ProviderName, UsageRecord } from './types.js'

const PRICE_PER_MILLION: Partial<Record<string, { input: number; output: number }>> = {
  'glm-4.5-air': { input: 0.11, output: 0.28 },
  'glm-5-turbo': { input: 0.2, output: 0.6 },
  'glm-5.1': { input: 0.6, output: 2.0 },
}

export function estimateUsage(
  provider: ProviderName,
  model: string,
  inputMessages: ChatMessage[],
  outputText: string,
): UsageRecord {
  const inputChars = inputMessages.reduce((sum, message) => sum + message.content.length, 0)
  const outputChars = outputText.length
  const inputTokensApprox = Math.ceil(inputChars / 4)
  const outputTokensApprox = Math.ceil(outputChars / 4)
  const price = PRICE_PER_MILLION[model] ?? { input: 0, output: 0 }
  return {
    provider,
    model,
    inputTokensApprox,
    outputTokensApprox,
    estimatedCostUsd: (inputTokensApprox / 1_000_000) * price.input + (outputTokensApprox / 1_000_000) * price.output,
  }
}
