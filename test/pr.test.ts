import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchPrSummary, parsePrPlatform, publishPrComment } from '../src/pr.js'

test('parsePrPlatform accepts supported platforms', () => {
  assert.equal(parsePrPlatform('github'), 'github')
  assert.equal(parsePrPlatform('gitlab'), 'gitlab')
  assert.throws(() => parsePrPlatform('other'), /Unsupported/)
})

test('publishPrComment defaults to dry run without network', async () => {
  const result = await publishPrComment({
    platform: 'github',
    repo: 'owner/repo',
    number: 12,
    body: 'review body',
    dryRun: true,
  })
  assert.match(result, /"dryRun": true/)
  assert.match(result, /review body/)
})

test('fetchPrSummary reads GitHub metadata and diff', async () => {
  const urls: string[] = []
  const summary = await fetchPrSummary({
    platform: 'github',
    repo: 'owner/repo',
    number: 7,
    fetchImpl: async (url, init) => {
      urls.push(String(url))
      const accept = new Headers(init?.headers).get('accept')
      if (accept?.includes('diff')) return new Response('diff --git a/x b/x')
      return new Response(JSON.stringify({
        title: 'Fix bug',
        state: 'open',
        html_url: 'https://example.test/pr/7',
        user: { login: 'alice' },
      }))
    },
  })
  assert.equal(summary.title, 'Fix bug')
  assert.equal(summary.author, 'alice')
  assert.match(summary.diff ?? '', /diff --git/)
  assert.equal(urls.length, 2)
})
