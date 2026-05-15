import { resolve, sep } from 'node:path'

export function resolveInside(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(resolvedRoot, inputPath)
  const comparableRoot = normalizeForCompare(resolvedRoot)
  const comparablePath = normalizeForCompare(resolvedPath)
  if (comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}${sep}`)) {
    return resolvedPath
  }
  throw new Error(`Path escapes workspace: ${inputPath}`)
}

function normalizeForCompare(path: string): string {
  const normalized = path.endsWith(sep) ? path.slice(0, -1) : path
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
