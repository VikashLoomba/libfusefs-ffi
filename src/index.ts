import {
  getNativeBinding,
  type NativeBinding,
  type NativeWorkspaceDescriptor,
} from './binding.js'
import {
  normalizeCreateWorkspaceOptions,
  type NativeCreateWorkspaceOptions,
} from './validate.js'
import type {
  CreateWorkspaceOptions,
  PlatformSupport,
  WorkspaceDescriptor,
} from './types.js'

function toPublicDescriptor(
  descriptor: NativeWorkspaceDescriptor,
): WorkspaceDescriptor {
  return {
    id: descriptor.id,
    repoPath: descriptor.repoPath,
    mountPath: descriptor.mountPath,
    upperPath: descriptor.upperPath,
    platform: descriptor.platform,
    kind: 'overlayfs',
  }
}

export class WorkspaceMount implements WorkspaceDescriptor {
  readonly id: string
  readonly repoPath: string
  readonly mountPath: string
  readonly upperPath: string
  readonly platform: string
  readonly kind = 'overlayfs' as const

  #binding: NativeBinding
  #closed = false

  constructor(binding: NativeBinding, descriptor: NativeWorkspaceDescriptor) {
    this.#binding = binding
    this.id = descriptor.id
    this.repoPath = descriptor.repoPath
    this.mountPath = descriptor.mountPath
    this.upperPath = descriptor.upperPath
    this.platform = descriptor.platform
  }

  isMounted(): boolean {
    if (this.#closed) {
      return false
    }

    return this.#binding.is_workspace_mounted_native(this.id)
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    await this.#binding.close_workspace_native(this.id)
    this.#closed = true
  }

  toJSON(): WorkspaceDescriptor {
    return {
      id: this.id,
      repoPath: this.repoPath,
      mountPath: this.mountPath,
      upperPath: this.upperPath,
      platform: this.platform,
      kind: this.kind,
    }
  }
}

export async function createWorkspace(
  options: CreateWorkspaceOptions,
): Promise<WorkspaceMount> {
  const binding = getNativeBinding()
  const support = binding.native_support()

  if (!support.supported) {
    throw new Error(
      support.reason ?? `Platform ${support.platform} is not supported by libfusefs-ffi`,
    )
  }

  const normalized: NativeCreateWorkspaceOptions =
    normalizeCreateWorkspaceOptions(options)
  const descriptor = await binding.create_workspace_native(normalized)
  return new WorkspaceMount(binding, descriptor)
}

export function getPlatformSupport(): PlatformSupport {
  const support = getNativeBinding().native_support()
  return {
    platform: support.platform,
    supported: support.supported,
    reason: support.reason ?? undefined,
  }
}

export function isPlatformSupported(): boolean {
  return getPlatformSupport().supported
}

export type {
  CreateWorkspaceOptions,
  IdMapEntry,
  PlatformSupport,
  WorkspaceDescriptor,
} from './types.js'

export { toPublicDescriptor }
