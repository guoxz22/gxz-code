import { redactedConfig, type RuntimeConfig } from '../config.js'

export function renderConfig(config: RuntimeConfig): string {
  return JSON.stringify(redactedConfig(config), null, 2)
}
