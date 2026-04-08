import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  WorkspaceMount,
  createWorkspace,
  getPlatformSupport,
  isPlatformSupported,
} from '../src/index.ts'
import {
  resetNativeBindingForTests,
  setNativeBindingForTests,
  type NativeBinding,
} from '../src/testing.ts'

describe('createWorkspace', () => {
  let createCalls = 0
  let closeCalls = 0
  let mounted = true
  let lastCreateOptions: Parameters<
    NativeBinding['create_workspace_native']
  >[0] | undefined

  const mockBinding: NativeBinding = {
    native_support() {
      return { platform: 'linux', supported: true }
    },
    async create_workspace_native(options) {
      createCalls += 1
      lastCreateOptions = options

      return {
        id: 'workspace-1',
        repoPath: options.repoPath,
        mountPath: options.mountPath,
        upperPath: options.upperPath,
        platform: 'linux',
        fsKind: 'overlayfs',
      }
    },
    async close_workspace_native() {
      closeCalls += 1
      mounted = false
      return true
    },
    is_workspace_mounted_native() {
      return mounted
    },
  }

  beforeEach(() => {
    createCalls = 0
    closeCalls = 0
    mounted = true
    lastCreateOptions = undefined
    setNativeBindingForTests(mockBinding)
  })

  afterEach(() => {
    resetNativeBindingForTests()
  })

  it('passes the caller-provided libfuse paths through to the native layer', async () => {
    const workspace = await createWorkspace({
      repoPath: '/repos/demo',
      mountPath: '/mounts/demo-agent',
      upperPath: '/layers/demo-agent',
    })

    assert.ok(workspace instanceof WorkspaceMount)
    assert.equal(createCalls, 1)
    assert.deepEqual(lastCreateOptions, {
      repoPath: '/repos/demo',
      mountPath: '/mounts/demo-agent',
      upperPath: '/layers/demo-agent',
      privileged: undefined,
      allowOther: undefined,
      uidMap: undefined,
      gidMap: undefined,
    })
    assert.deepEqual(workspace.toJSON(), {
      id: 'workspace-1',
      repoPath: '/repos/demo',
      mountPath: '/mounts/demo-agent',
      upperPath: '/layers/demo-agent',
      platform: 'linux',
      kind: 'overlayfs',
    })
  })

  it('rejects a blank repoPath before calling the native binding', async () => {
    await assert.rejects(
      createWorkspace({
        repoPath: '   ',
        mountPath: '/mounts/demo-agent',
        upperPath: '/layers/demo-agent',
      }),
      /repoPath must be a non-empty path/,
    )

    assert.equal(createCalls, 0)
  })

  it('rejects a blank mountPath before calling the native binding', async () => {
    await assert.rejects(
      createWorkspace({
        repoPath: '/repos/demo',
        mountPath: '   ',
        upperPath: '/layers/demo-agent',
      }),
      /mountPath must be a non-empty path/,
    )

    assert.equal(createCalls, 0)
  })

  it('rejects incomplete id mapping configuration before calling the native binding', async () => {
    await assert.rejects(
      createWorkspace({
        repoPath: '/repos/demo',
        mountPath: '/mounts/demo-agent',
        upperPath: '/layers/demo-agent',
        uidMap: [{ host: 501, to: 1000, len: 1 }],
      }),
      /uidMap and gidMap must either both be provided or both be omitted/,
    )

    assert.equal(createCalls, 0)
  })

  it('treats close as idempotent at the TypeScript API boundary', async () => {
    const workspace = await createWorkspace({
      repoPath: '/repos/demo',
      mountPath: '/mounts/demo-agent',
      upperPath: '/layers/demo-agent',
    })

    await workspace.close()
    await workspace.close()

    assert.equal(closeCalls, 1)
    assert.equal(workspace.isMounted(), false)
  })

  it('reflects mounted state through the public API until the workspace is closed', async () => {
    const workspace = await createWorkspace({
      repoPath: '/repos/demo',
      mountPath: '/mounts/demo-agent',
      upperPath: '/layers/demo-agent',
    })

    assert.equal(workspace.isMounted(), true)
    await workspace.close()
    assert.equal(workspace.isMounted(), false)
  })
})

describe('platform support helpers', () => {
  afterEach(() => {
    resetNativeBindingForTests()
  })

  it('surface the native platform support report verbatim', () => {
    setNativeBindingForTests({
      native_support() {
        return {
          platform: 'darwin',
          supported: false,
          reason: 'macFUSE is not available',
        }
      },
      async create_workspace_native() {
        throw new Error('not reached')
      },
      async close_workspace_native() {
        return true
      },
      is_workspace_mounted_native() {
        return false
      },
    })

    assert.deepEqual(getPlatformSupport(), {
      platform: 'darwin',
      supported: false,
      reason: 'macFUSE is not available',
    })
    assert.equal(isPlatformSupported(), false)
  })
})
