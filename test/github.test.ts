import test from 'node:test'
import assert from 'node:assert/strict'
import { buildGitHubCliArgs, isGitHubWriteAction, parseGitHubCliAction, runGitHubCli } from '../src/github.js'

test('buildGitHubCliArgs renders gh PR and issue commands', () => {
  assert.deepEqual(buildGitHubCliArgs({
    action: 'pr-view',
    repo: 'owner/repo',
    number: 12,
  }), [
    'pr',
    'view',
    '12',
    '--json',
    'number,title,state,author,url,body,headRefName,baseRefName',
    '--repo',
    'owner/repo',
  ])

  assert.deepEqual(buildGitHubCliArgs({
    action: 'issue-list',
    limit: 5,
  }), ['issue', 'list', '--limit', '5', '--json', 'number,title,state,author,url'])
})

test('parseGitHubCliAction validates supported actions', () => {
  assert.equal(parseGitHubCliAction('pr-checks'), 'pr-checks')
  assert.equal(parseGitHubCliAction('pr-comment'), 'pr-comment')
  assert.equal(isGitHubWriteAction('pr-comment'), true)
  assert.throws(() => parseGitHubCliAction('delete-repo'), /Unsupported GitHub action/)
})

test('GitHub write actions build gh args and default to dry-run', async () => {
  assert.deepEqual(buildGitHubCliArgs({
    action: 'pr-comment',
    repo: 'owner/repo',
    number: 12,
    body: 'review note',
  }), ['pr', 'comment', '12', '--body', 'review note', '--repo', 'owner/repo'])

  const dryRun = await runGitHubCli({
    action: 'issue-create',
    repo: 'owner/repo',
    title: 'Bug title',
    body: 'Bug body',
    publish: false,
    cwd: process.cwd(),
    timeoutMs: 1000,
  })
  assert.match(dryRun, /GitHub write dry-run/)
  assert.match(dryRun, /gh issue create/)
})
