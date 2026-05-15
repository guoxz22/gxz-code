import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function initWorkspace(cwd: string): Promise<string> {
  const configDir = join(cwd, '.gxz-code')
  await mkdir(configDir, { recursive: true })
  const policyPath = join(configDir, 'policy.json')
  const agentsPath = join(cwd, 'AGENTS.md')

  if (!existsSync(policyPath)) {
    await writeFile(policyPath, `${JSON.stringify({
      denyShellCommands: ['rm -rf /', 'Remove-Item -Recurse C:\\'],
    }, null, 2)}\n`, 'utf8')
  }

  if (!existsSync(agentsPath)) {
    await writeFile(agentsPath, [
      '# GXZ-code Workspace Instructions',
      '',
      '- Keep edits small and reversible.',
      '- Run targeted validation before claiming completion.',
      '- Do not store API keys or secrets in repository files.',
      '',
    ].join('\n'), 'utf8')
  }

  return `Initialized GXZ-code workspace files:\n- ${policyPath}\n- ${agentsPath}`
}
