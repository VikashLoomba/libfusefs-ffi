import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { createWorkspace, getPlatformSupport } from '../src/index.ts'

const execFile = promisify(execFileCallback)
const shouldRun = process.env.RUN_FUSE_TESTS === '1'
const requireFuse = process.env.REQUIRE_FUSE === '1'
const integrationTest = shouldRun ? test : test.skip

integrationTest(
  'mounts a real overlay workspace and stores agent writes in the upper layer while leaving the repo unchanged',
  async (t) => {
    const support = getPlatformSupport()
    if (!support.supported) {
      if (requireFuse) {
        assert.fail(support.reason ?? 'current platform does not support libfusefs-ffi')
      }
      t.skip(support.reason ?? 'current platform does not support libfusefs-ffi')
      return
    }

    const sandboxRoot = await mkdtemp(join(tmpdir(), 'libfusefs-ffi-integration-'))
    const repoPath = join(sandboxRoot, 'repo')
    const mountPath = join(sandboxRoot, 'mount')
    const upperPath = join(sandboxRoot, 'upper')

    await mkdir(repoPath, { recursive: true })
    await mkdir(mountPath, { recursive: true })
    await mkdir(upperPath, { recursive: true })
    await writeFile(join(repoPath, 'README.md'), 'hello from lower layer')

    const canonicalRepoPath = await realpath(repoPath)
    const canonicalMountPath = await realpath(mountPath)
    const canonicalUpperPath = await realpath(upperPath)

    let workspace: Awaited<ReturnType<typeof createWorkspace>> | undefined
    try {
      workspace = await createWorkspace({
        repoPath,
        mountPath,
        upperPath,
      })

      assert.equal(workspace.repoPath, canonicalRepoPath)
      assert.equal(workspace.mountPath, canonicalMountPath)
      assert.equal(workspace.upperPath, canonicalUpperPath)

      await waitForMounted(workspace.mountPath)

      assert.equal(
        await readFile(join(workspace.mountPath, 'README.md'), 'utf8'),
        'hello from lower layer',
      )

      await writeFile(join(workspace.mountPath, 'agent.txt'), 'hello from upper layer')

      await assert.rejects(readFile(join(repoPath, 'agent.txt'), 'utf8'))
      assert.equal(
        await readFile(join(workspace.upperPath, 'agent.txt'), 'utf8'),
        'hello from upper layer',
      )
    } finally {
      await workspace?.close()
      await waitForUnmounted(canonicalMountPath)
      await removeTreeWithRetries(sandboxRoot)
    }
  },
)

integrationTest(
  'create then immediate close succeeds without leaving a mounted filesystem behind',
  async (t) => {
    const support = getPlatformSupport()
    if (!support.supported) {
      if (requireFuse) {
        assert.fail(support.reason ?? 'current platform does not support libfusefs-ffi')
      }
      t.skip(support.reason ?? 'current platform does not support libfusefs-ffi')
      return
    }

    const sandboxRoot = await mkdtemp(join(tmpdir(), 'libfusefs-ffi-race-'))
    const repoPath = join(sandboxRoot, 'repo')
    const mountPath = join(sandboxRoot, 'mount')
    const upperPath = join(sandboxRoot, 'upper')

    await mkdir(repoPath, { recursive: true })
    await mkdir(mountPath, { recursive: true })
    await mkdir(upperPath, { recursive: true })
    await writeFile(join(repoPath, 'hello.txt'), 'hello world')

    const canonicalMountPath = await realpath(mountPath)

    let workspace: Awaited<ReturnType<typeof createWorkspace>> | undefined
    try {
      workspace = await createWorkspace({
        repoPath,
        mountPath,
        upperPath,
      })

      await workspace.close()
      assert.equal(workspace.isMounted(), false)
      await waitForUnmounted(canonicalMountPath)
      await access(canonicalMountPath)
    } finally {
      await waitForUnmounted(canonicalMountPath)
      await removeTreeWithRetries(sandboxRoot)
    }
  },
)

async function waitForMounted(mountPath: string): Promise<void> {
  await waitForCondition(async () => isMounted(mountPath), {
    description: `expected ${mountPath} to become a mounted filesystem`,
  })
}

async function waitForUnmounted(mountPath: string): Promise<void> {
  await waitForCondition(async () => !(await isMounted(mountPath)), {
    description: `expected ${mountPath} to be unmounted`,
  })
}

async function waitForCondition(
  predicate: () => Promise<boolean>,
  options: { description: string; timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  assert.fail(options.description)
}

async function isMounted(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('mount')
    const escaped = escapeRegExp(path)
    const pattern = new RegExp(` on ${escaped}(?: type | \\()`) 
    return pattern.test(stdout)
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function removeTreeWithRetries(path: string): Promise<void> {
  await waitForCondition(
    async () => {
      try {
        await rm(path, { recursive: true, force: true })
        return !(await pathExists(path))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EBUSY') {
          return false
        }
        throw error
      }
    },
    {
      description: `expected ${path} to become removable after unmount`,
      timeoutMs: 15_000,
      intervalMs: 200,
    },
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
