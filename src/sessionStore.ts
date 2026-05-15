import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ChatMessage, ProviderName, SessionRecord } from './types.js'

export type SessionStore = {
  dir: string
  save(session: SessionRecord): Promise<void>
  load(id: string): Promise<SessionRecord>
  list(): Promise<SessionRecord[]>
  delete(id: string): Promise<void>
}

export type CreateSessionInput = {
  id?: string
  title?: string
  cwd: string
  provider: ProviderName
  model: string
  messages?: ChatMessage[]
}

export function createSessionStore(baseDir?: string): SessionStore {
  const dir = resolve(baseDir ?? process.env.GXZ_SESSION_DIR ?? join(homedir(), '.gxz-code', 'sessions'))

  return {
    dir,
    async save(session) {
      const safeSession = { ...session, id: sanitizeId(session.id) }
      await mkdir(dir, { recursive: true })
      await writeFile(sessionPath(dir, safeSession.id), `${JSON.stringify(safeSession, null, 2)}\n`, 'utf8')
    },
    async load(id) {
      const path = sessionPath(dir, sanitizeId(id))
      if (!existsSync(path)) throw new Error(`Session not found: ${id}`)
      return JSON.parse(await readFile(path, 'utf8')) as SessionRecord
    },
    async list() {
      if (!existsSync(dir)) return []
      const files = (await readdir(dir)).filter((file) => file.endsWith('.json'))
      const sessions = await Promise.all(files.map(async (file) => {
        return JSON.parse(await readFile(join(dir, file), 'utf8')) as SessionRecord
      }))
      return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async delete(id) {
      await rm(sessionPath(dir, sanitizeId(id)), { force: true })
    },
  }
}

export function createSession(input: CreateSessionInput): SessionRecord {
  const now = new Date().toISOString()
  return {
    id: sanitizeId(input.id ?? defaultSessionId(now)),
    title: input.title ?? 'GXZ-code session',
    createdAt: now,
    updatedAt: now,
    cwd: input.cwd,
    provider: input.provider,
    model: input.model,
    messages: input.messages ?? [],
  }
}

export function updateSession(
  session: SessionRecord,
  updates: Partial<Pick<SessionRecord, 'messages' | 'provider' | 'model' | 'cwd' | 'title'>>,
): SessionRecord {
  return {
    ...session,
    ...updates,
    updatedAt: new Date().toISOString(),
  }
}

export function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-')
  if (!sanitized) throw new Error('Session id cannot be empty.')
  return sanitized.slice(0, 120)
}

function defaultSessionId(now: string): string {
  return `session-${now.replace(/[:.]/g, '-')}`
}

function sessionPath(dir: string, id: string): string {
  const resolvedDir = resolve(dir)
  const path = resolve(resolvedDir, `${sanitizeId(id)}.json`)
  const rel = relative(resolvedDir, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel === '') {
    throw new Error(`Session path escapes session directory: ${id}`)
  }
  return path
}
