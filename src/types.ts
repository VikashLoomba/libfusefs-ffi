export interface IdMapEntry {
  host: number
  to: number
  len: number
}

export interface CreateWorkspaceOptions {
  repoPath: string
  mountPath: string
  upperPath: string
  privileged?: boolean
  allowOther?: boolean
  uidMap?: IdMapEntry[]
  gidMap?: IdMapEntry[]
}

export interface PlatformSupport {
  platform: string
  supported: boolean
  reason?: string
}

export interface WorkspaceDescriptor {
  id: string
  repoPath: string
  mountPath: string
  upperPath: string
  platform: string
  kind: 'overlayfs'
}
