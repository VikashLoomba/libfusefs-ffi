import type { CreateWorkspaceOptions, IdMapEntry } from './types.js'

export interface NativeCreateWorkspaceOptions {
  repoPath: string
  mountPath: string
  upperPath: string
  privileged?: boolean
  allowOther?: boolean
  uidMap?: IdMapEntry[]
  gidMap?: IdMapEntry[]
}

export function normalizeCreateWorkspaceOptions(
  options: CreateWorkspaceOptions,
): NativeCreateWorkspaceOptions {
  const repoPath = normalizePath(options.repoPath, 'repoPath')
  const mountPath = normalizePath(options.mountPath, 'mountPath')
  const upperPath = normalizePath(options.upperPath, 'upperPath')

  validateIdMaps(options.uidMap, options.gidMap)

  return {
    repoPath,
    mountPath,
    upperPath,
    privileged: options.privileged,
    allowOther: options.allowOther,
    uidMap: options.uidMap,
    gidMap: options.gidMap,
  }
}

function normalizePath(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new TypeError(`${field} must be a non-empty path`)
  }

  return normalized
}

function validateIdMaps(uidMap?: IdMapEntry[], gidMap?: IdMapEntry[]): void {
  if ((uidMap && !gidMap) || (!uidMap && gidMap)) {
    throw new TypeError('uidMap and gidMap must either both be provided or both be omitted')
  }

  if (!uidMap || !gidMap) {
    return
  }

  if (uidMap.length === 0 || gidMap.length === 0) {
    throw new TypeError('uidMap and gidMap must contain at least one mapping entry')
  }

  for (const [kind, entries] of [
    ['uidMap', uidMap],
    ['gidMap', gidMap],
  ] as const) {
    for (const entry of entries) {
      validateIdMapEntry(kind, entry)
    }
  }
}

function validateIdMapEntry(kind: string, entry: IdMapEntry): void {
  for (const [field, value] of Object.entries(entry)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${kind}.${field} must be a non-negative integer`)
    }
  }

  if (entry.len === 0) {
    throw new TypeError(`${kind}.len must be greater than zero`)
  }
}
