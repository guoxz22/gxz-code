import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeConfig } from '../config.js'
import { listSkills } from '../skills.js'

export async function renderDoctor(config: RuntimeConfig): Promise<string> {
  const checks = [
    `Node: ${process.version}`,
    `Provider/model: ${config.provider}/${config.model}`,
    `Base URL: ${config.baseUrl}`,
    `API key: ${config.apiKey ? '<set>' : '<missing>'}`,
    `CWD exists: ${existsSync(config.cwd) ? 'yes' : 'no'}`,
    `Policy file: ${existsSync(join(config.cwd, '.gxz-code', 'policy.json')) ? 'present' : 'not found'}`,
    `Skills: ${(await listSkills(config.cwd)).length}`,
  ]
  return checks.join('\n')
}
