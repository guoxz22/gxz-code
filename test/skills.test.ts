import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillTool, listSkills } from '../src/skills.js'

test('lists and reads local skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gxz-skills-'))
  try {
    const skillDir = join(root, '.gxz-code', 'skills', 'review')
    await mkdir(skillDir, { recursive: true })
    await writeFile(join(skillDir, 'SKILL.md'), '---\ndescription: Review code\n---\n# Review\n', 'utf8')
    const skills = await listSkills(root)
    assert.equal(skills[0]!.name, 'review')
    assert.equal(skills[0]!.description, 'Review code')
    const content = await createSkillTool().execute({ path: '.gxz-code/skills/review/SKILL.md' }, {
      cwd: root,
      allowShell: false,
      timeoutMs: 1000,
    })
    assert.match(content, /Review/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
