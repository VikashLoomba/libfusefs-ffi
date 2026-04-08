import { createRequire } from 'node:module'

import type { IdMapEntry } from './types.js'

export interface NativeCreateWorkspaceOptions {
  repoPath: string
  mountPath: string
  upperPath: string
  privileged?: boolean
  allowOther?: boolean
  uidMap?: IdMapEntry[]
  gidMap?: IdMapEntry[]
}

export interface NativeWorkspaceDescriptor {
  id: string
  repoPath: string
  mountPath: string
  upperPath: string
  platform: string
  fsKind: string
}

export interface NativePlatformSupport {
  platform: string
  supported: boolean
  reason?: string | null
}

export interface NativeBinding {
  create_workspace_native(
    options: NativeCreateWorkspaceOptions,
  ): Promise<NativeWorkspaceDescriptor>
  close_workspace_native(id: string): Promise<boolean>
  is_workspace_mounted_native(id: string): boolean
  native_support(): NativePlatformSupport
}

interface RawNativeBinding {
  create_workspace_native?: NativeBinding['create_workspace_native']
  createWorkspaceNative?: NativeBinding['create_workspace_native']
  close_workspace_native?: NativeBinding['close_workspace_native']
  closeWorkspaceNative?: NativeBinding['close_workspace_native']
  is_workspace_mounted_native?: NativeBinding['is_workspace_mounted_native']
  isWorkspaceMountedNative?: NativeBinding['is_workspace_mounted_native']
  native_support?: NativeBinding['native_support']
  nativeSupport?: NativeBinding['native_support']
}

let cachedBinding: NativeBinding | undefined
let overrideBinding: NativeBinding | undefined

export function getNativeBinding(): NativeBinding {
  if (overrideBinding) {
    return overrideBinding
  }

  if (!cachedBinding) {
    const require = createRequire(import.meta.url)

    try {
      cachedBinding = normalizeLoadedBinding(require('../index.js') as RawNativeBinding)
    } catch (error) {
      throw new Error(
        'Failed to load the native binding shim. Build the native module first with `npm run build:native` or inject a test binding.',
        { cause: error },
      )
    }
  }

  return cachedBinding
}

export function setNativeBindingForTests(binding: NativeBinding): void {
  overrideBinding = binding
}

export function resetNativeBindingForTests(): void {
  overrideBinding = undefined
  cachedBinding = undefined
}

function normalizeLoadedBinding(rawBinding: RawNativeBinding): NativeBinding {
  const createWorkspace =
    rawBinding.create_workspace_native ?? rawBinding.createWorkspaceNative
  const closeWorkspace =
    rawBinding.close_workspace_native ?? rawBinding.closeWorkspaceNative
  const isMounted =
    rawBinding.is_workspace_mounted_native ?? rawBinding.isWorkspaceMountedNative
  const nativeSupport = rawBinding.native_support ?? rawBinding.nativeSupport

  if (!createWorkspace || !closeWorkspace || !isMounted || !nativeSupport) {
    throw new TypeError('Loaded native binding does not expose the expected workspace APIs')
  }

  return {
    create_workspace_native: createWorkspace,
    close_workspace_native: closeWorkspace,
    is_workspace_mounted_native: isMounted,
    native_support: nativeSupport,
  }
}
