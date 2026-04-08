# Releasing `@automatalabs/libfusefs-ffi`

This repository is set up for:

- **manual npm CLI publishing** for the first bootstrap release
- **GitHub Actions + npm trusted publishing** for later releases

## Packages involved

The root package publishes these platform packages via `napi prepublish`:

- `@automatalabs/libfusefs-ffi`
- `@automatalabs/libfusefs-ffi-darwin-arm64`
- `@automatalabs/libfusefs-ffi-darwin-x64`
- `@automatalabs/libfusefs-ffi-linux-arm64-gnu`
- `@automatalabs/libfusefs-ffi-linux-x64-gnu`

## One-time repository bootstrap

If the GitHub repository does not exist yet:

```bash
gh repo create VikashLoomba/libfusefs-ffi --public --source=. --remote=origin
```

Then commit and push the initial code:

```bash
git add .
git commit -m "Initial release setup"
git push -u origin main
```

The `.gitignore` is configured so `git add .` will not pick up generated or local-only files such as:

- `node_modules/`
- `dist/`
- `target/`
- `npm/`
- `artifacts/`
- `*.node`
- generated N-API loader files (`index.js`, `index.d.ts`)
- `.firecrawl/`

## First release: publish manually with npm CLI

### Why this is needed

npm trusted publishers are configured **per package**, and npm requires the package to already exist before you can attach a trusted publisher.

Because this project publishes one root package plus four per-platform packages, the first release needs to create all of those package names on npm.

### Important constraint

A single `npm publish` only works as a complete bootstrap if the per-platform package directories contain **all target binaries**.

That means before the first publish you need artifacts for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64-gnu`
- `linux-x64-gnu`

If you only publish the root package and one platform package, you will not yet be able to switch the GitHub workflow fully to trusted publishing for all targets.

### Prerequisites

- The final GitHub repo already exists and matches `package.json.repository.url` (`VikashLoomba/libfusefs-ffi`)
- You are logged in with `npm login`
- Docker is available locally if you use `--use-napi-cross` for Linux cross-builds

### Manual bootstrap flow

1. Ensure the version in `package.json` is the one you want to release.
2. Build or collect all target `.node` binaries.
3. Create the per-platform npm package directories.
4. Copy the binaries into those per-platform directories.
5. Run `npm publish --access public` from the repo root.

A typical flow looks like this:

```bash
rm -rf artifacts npm dist index.js index.d.ts
mkdir -p artifacts

npm run build:native -- --target aarch64-apple-darwin
cp libfusefs_ffi.darwin-arm64.node artifacts/

npm run build:native -- --target x86_64-apple-darwin
cp libfusefs_ffi.darwin-x64.node artifacts/

npm run build:native -- --target x86_64-unknown-linux-gnu --use-napi-cross
cp libfusefs_ffi.linux-x64-gnu.node artifacts/

npm run build:native -- --target aarch64-unknown-linux-gnu --use-napi-cross
cp libfusefs_ffi.linux-arm64-gnu.node artifacts/

npm run create-npm-dirs
npm run artifacts
npm publish --access public
```

Notes:

- `prepublishOnly` already runs:
  - `npm run build:native`
  - `npm run build:ts`
  - `napi prepublish -t npm --no-gh-release`
- so the final `npm publish` will:
  - rebuild the local host binary and JS shim
  - build the TypeScript wrapper
  - publish the per-platform packages that exist in `npm/`
  - publish the root package
- `npm publish --access public` is still the right command for the first scoped public release

### Sanity check before publishing

You can inspect the root tarball with:

```bash
npm pack --dry-run
```

## Configure npm trusted publishers after the first release

After the first manual publish succeeds and all 5 packages exist on npm, configure trusted publishing for each one.

npm `trust` requires:

- npm `>= 11.10.0`
- package write access
- account-level 2FA enabled

Run:

```bash
for pkg in \
  @automatalabs/libfusefs-ffi \
  @automatalabs/libfusefs-ffi-darwin-arm64 \
  @automatalabs/libfusefs-ffi-darwin-x64 \
  @automatalabs/libfusefs-ffi-linux-arm64-gnu \
  @automatalabs/libfusefs-ffi-linux-x64-gnu
 do
  npm trust github "$pkg" --repo VikashLoomba/libfusefs-ffi --file release.yml --yes
 done
```

Verify:

```bash
npm trust list @automatalabs/libfusefs-ffi
npm trust list @automatalabs/libfusefs-ffi-darwin-arm64
npm trust list @automatalabs/libfusefs-ffi-darwin-x64
npm trust list @automatalabs/libfusefs-ffi-linux-arm64-gnu
npm trust list @automatalabs/libfusefs-ffi-linux-x64-gnu
```

## Lock down publishing after trusted publishing works

After you confirm an OIDC-based release works from GitHub Actions:

1. do **not** add or keep an npm publish token in GitHub Actions
2. in npm package settings for each package, set **Publishing access** to:
   - **Require two-factor authentication and disallow tokens**

That matches npm's current trusted-publisher guidance.

## Normal release flow after bootstrap

For every later release:

1. bump `package.json` version
2. commit and push
3. tag `vX.Y.Z`
4. push the tag

```bash
git tag v0.1.1
git push origin v0.1.1
```

That triggers `.github/workflows/release.yml`, which publishes using GitHub Actions OIDC trusted publishing.

## Notes

- `package.json.repository.url` must exactly match the GitHub repository used for publishing.
- The release workflow uses GitHub-hosted runners for publishing, which is required by npm trusted publishing today.
- The self-hosted runners in `ci.yml` are only for real FUSE integration tests, not npm publishing.
- This repo is expected to live at `VikashLoomba/libfusefs-ffi`; if you publish from a different repo later, update `package.json` before releasing.
