# @automatalabs/libfusefs-ffi

Node.js bindings for sandboxed agent workspaces backed by [`libfuse-fs`](https://crates.io/crates/libfuse-fs) via `napi-rs`.

## Scope

This package is intentionally a **thin wrapper** around the Rust FUSE layer.

It mounts and unmounts overlay workspaces using `libfuse-fs` / `rfuse3`.
It does **not** implement its own workspace directory manager, metadata store, or temp-root lifecycle.

That means callers are responsible for creating the directories they want to use:

- the existing repo path
- the mount path
- the upper layer path

## What it does

This package creates copy-on-write agent workspaces over an existing local repository:

- the repo is mounted as the read-only lower layer
- agent writes go into a separate upper layer
- the user can keep working in the original repo
- the mounted workspace looks like a normal writable filesystem view to the agent

Example:

```ts
import { createWorkspace } from '@automatalabs/libfusefs-ffi'

const workspace = await createWorkspace({
  repoPath: '/path/to/repo',
  mountPath: '/path/to/mount',
  upperPath: '/path/to/upper',
})

console.log(workspace.mountPath)
await workspace.close()
```

## Platform support

Supported targets:

- Linux with FUSE available
- macOS with macFUSE available

Runtime checks are performed before workspace creation. On machines without usable FUSE support, `getPlatformSupport()` explains why the native layer is unavailable.

## API

### `createWorkspace(options)`

Creates an agent workspace and returns a `WorkspaceMount`.

Required:

- `repoPath: string`
  - must already exist
  - must point to a directory
- `mountPath: string`
  - must already exist
  - must point to a directory
  - must be empty before mount
- `upperPath: string`
  - must already exist
  - must point to a directory

Optional:

- `privileged?: boolean`
- `allowOther?: boolean`
- `uidMap?: IdMapEntry[]`
- `gidMap?: IdMapEntry[]`

Notes:

- the lower repo path must live outside the mount and upper directories
- `uidMap`/`gidMap` are Linux-only right now
- `uidMap` and `gidMap` must either both be provided or both be omitted

### `WorkspaceMount`

Returned from `createWorkspace()`.

Properties:

- `id`
- `repoPath`
- `mountPath`
- `upperPath`
- `platform`
- `kind`

Methods:

- `isMounted(): boolean`
- `close(): Promise<void>`
- `toJSON()`

`close()` uses the underlying `rfuse3::MountHandle::unmount()` path. The wrapper does not perform its own directory cleanup.

## Why the API is explicit

The wrapper is meant to stay close to the underlying Rust crate.

So, unlike a higher-level sandbox manager, it does **not**:

- invent temp workspace roots
- create metadata files
- delete user directories on close

That behavior belongs in a separate higher-level package if you want it.

## Development

### Install

```bash
npm ci
```

### Build

```bash
npm run build
```

### Typecheck

```bash
npm run typecheck
```

### Unit tests

Unit tests are behavior-driven and test the public TypeScript API using injected native bindings.

```bash
npm test
```

### Real FUSE integration tests

These tests create and tear down **real FUSE mounts** and verify behavior as a black box:

- mounted overlay view exposes lower-layer repo content
- writes to the mounted workspace land in the upper layer
- the original repo stays unchanged
- create-then-immediate-close succeeds without leaving a mounted filesystem behind

Run them only on machines with FUSE correctly provisioned:

```bash
npm run test:integration
```

To make missing FUSE support fail the run instead of skipping tests:

```bash
REQUIRE_FUSE=1 npm run test:integration
```

## CI

GitHub Actions is configured with:

- a GitHub-hosted unit/check job
- self-hosted Linux FUSE integration job
- self-hosted macOS macFUSE integration job
- a release workflow that builds prebuilt native binaries and publishes the scoped npm package `@automatalabs/libfusefs-ffi`

See `RELEASING.md` for the end-to-end commit/push/publish flow, including npm trusted publisher setup.

Expected self-hosted runner labels:

- Linux integration runner:
  - `self-hosted`
  - `linux`
  - `fuse`
- macOS integration runner:
  - `self-hosted`
  - `macOS`
  - `macfuse`

### Linux self-hosted runner requirements

- `/dev/fuse` exists
- `fusermount3` is installed and on `PATH`
- the runner user is allowed to perform FUSE mounts
- the working directory is on a filesystem that supports the required xattrs

### macOS self-hosted runner requirements

- macFUSE is installed and loaded
- `/dev/macfuse0` or `/dev/osxfuse0` exists
- the runner user can mount and unmount FUSE filesystems

## Publishing prebuilt binaries

Publishing is handled by `.github/workflows/release.yml`.

Release flow:

1. Push a semver tag like `v0.1.0`
2. GitHub-hosted runners build prebuilt binaries for:
   - `x86_64-apple-darwin`
   - `aarch64-apple-darwin`
   - `x86_64-unknown-linux-gnu`
   - `aarch64-unknown-linux-gnu`
3. The publish job regenerates the N-API JS shim, builds the TypeScript wrapper, creates the per-platform npm package directories, and collects downloaded artifacts with `napi artifacts`
4. `npm publish` triggers `napi prepublish -t npm --no-gh-release`, which:
   - publishes the platform packages
   - updates optional dependencies for the root package
   - publishes the root scoped package `@automatalabs/libfusefs-ffi`

The workflow is configured for npm **trusted publishing** with GitHub Actions OIDC (`id-token: write`).

Important bootstrap note:

- npm trusted publishers are configured per package and require the package to already exist
- because this project publishes a root package plus per-platform packages, the **first** release is intended to be done manually with the npm CLI so those package names exist
- after the first release exists, configure trusted publishers for all package names and use the GitHub Actions release workflow for later releases

See `RELEASING.md` for the exact manual bootstrap and trusted-publisher setup steps.

## Testing philosophy

Per `AGENTS.md`, tests are written against intended behavior, not incidental implementation details. The integration tests therefore validate:

- what the public API promises
- what a real mounted workspace does
- what teardown guarantees the caller can depend on

They are allowed to fail if the implementation regresses, even if such failures reduce short-term coverage comfort.
