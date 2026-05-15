import { renderGitDiff } from './commands/gitCommands.js'

export type PrPlatform = 'github' | 'gitlab'

export type PrOptions = {
  platform: PrPlatform
  repo: string
  number: number
  baseUrl?: string
  token?: string
  fetchImpl?: typeof fetch
}

export type PrSummary = {
  platform: PrPlatform
  repo: string
  number: number
  title?: string
  author?: string
  state?: string
  url?: string
  diff?: string
}

export async function fetchPrSummary(options: PrOptions): Promise<PrSummary> {
  if (options.platform === 'github') return fetchGitHubPr(options)
  return fetchGitLabMr(options)
}

export async function publishPrComment(options: PrOptions & { body: string; dryRun?: boolean }): Promise<string> {
  if (!options.body.trim()) throw new Error('PR comment body cannot be empty.')
  if (options.dryRun) {
    return JSON.stringify({
      dryRun: true,
      platform: options.platform,
      repo: options.repo,
      number: options.number,
      body: options.body,
    }, null, 2)
  }
  if (!options.token) throw new Error(`Missing ${tokenEnvName(options.platform)} for PR comment publishing.`)
  if (options.platform === 'github') return publishGitHubComment(options)
  return publishGitLabComment(options)
}

export async function buildLocalPrReview(cwd: string): Promise<string> {
  const diff = await renderGitDiff(cwd)
  return [
    'Review the following local diff. Prioritize bugs, regressions, security issues, and missing tests.',
    '',
    diff,
  ].join('\n')
}

export function parsePrPlatform(value: string): PrPlatform {
  if (value === 'github' || value === 'gitlab') return value
  throw new Error('Unsupported PR platform. Use github or gitlab.')
}

export function defaultPrToken(platform: PrPlatform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return platform === 'github' ? env.GITHUB_TOKEN ?? env.GH_TOKEN : env.GITLAB_TOKEN ?? env.GL_TOKEN
}

async function fetchGitHubPr(options: PrOptions): Promise<PrSummary> {
  const baseUrl = options.baseUrl ?? 'https://api.github.com'
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/repos/${options.repo}/pulls/${options.number}`, {
    authorization: options.token ? `Bearer ${options.token}` : undefined,
    accept: 'application/vnd.github+json',
  })
  const diffResponse = await fetchText(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/repos/${options.repo}/pulls/${options.number}`, {
    authorization: options.token ? `Bearer ${options.token}` : undefined,
    accept: 'application/vnd.github.v3.diff',
  })
  return {
    platform: 'github',
    repo: options.repo,
    number: options.number,
    title: stringField(response.title),
    author: stringField((response.user as Record<string, unknown> | undefined)?.login),
    state: stringField(response.state),
    url: stringField(response.html_url),
    diff: diffResponse,
  }
}

async function fetchGitLabMr(options: PrOptions): Promise<PrSummary> {
  const baseUrl = options.baseUrl ?? 'https://gitlab.com/api/v4'
  const fetchImpl = options.fetchImpl ?? fetch
  const project = encodeURIComponent(options.repo)
  const response = await fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/projects/${project}/merge_requests/${options.number}`, {
    'private-token': options.token,
  })
  const changes = await fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/projects/${project}/merge_requests/${options.number}/changes`, {
    'private-token': options.token,
  })
  return {
    platform: 'gitlab',
    repo: options.repo,
    number: options.number,
    title: stringField(response.title),
    author: stringField((response.author as Record<string, unknown> | undefined)?.username),
    state: stringField(response.state),
    url: stringField(response.web_url),
    diff: JSON.stringify(changes.changes ?? [], null, 2),
  }
}

async function publishGitHubComment(options: PrOptions & { body: string }): Promise<string> {
  const baseUrl = options.baseUrl ?? 'https://api.github.com'
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await postJson(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/repos/${options.repo}/issues/${options.number}/comments`, {
    authorization: `Bearer ${options.token}`,
    accept: 'application/vnd.github+json',
  }, { body: options.body })
  return JSON.stringify(response, null, 2)
}

async function publishGitLabComment(options: PrOptions & { body: string }): Promise<string> {
  const baseUrl = options.baseUrl ?? 'https://gitlab.com/api/v4'
  const fetchImpl = options.fetchImpl ?? fetch
  const project = encodeURIComponent(options.repo)
  const response = await postJson(fetchImpl, `${baseUrl.replace(/\/+$/, '')}/projects/${project}/merge_requests/${options.number}/notes`, {
    'private-token': options.token,
  }, { body: options.body })
  return JSON.stringify(response, null, 2)
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string, headers: Record<string, string | undefined>): Promise<T> {
  const response = await fetchImpl(url, {
    headers: withoutUndefined(headers),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 2000)}`)
  return text ? JSON.parse(text) as T : {} as T
}

async function fetchText(fetchImpl: typeof fetch, url: string, headers: Record<string, string | undefined>): Promise<string> {
  const response = await fetchImpl(url, {
    headers: withoutUndefined(headers),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 2000)}`)
  return text
}

async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string | undefined>, body: unknown): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...withoutUndefined(headers),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 2000)}`)
  return text ? JSON.parse(text) as unknown : {}
}

function withoutUndefined(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => Boolean(entry[1])))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function tokenEnvName(platform: PrPlatform): string {
  return platform === 'github' ? 'GITHUB_TOKEN/GH_TOKEN' : 'GITLAB_TOKEN/GL_TOKEN'
}
