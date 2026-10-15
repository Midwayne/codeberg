# Prebuilt releases

Codeberg's release workflow builds macOS arm64, macOS x64, and Linux x64
archives. Supported systems are macOS 14+ and glibc Linux (Ubuntu 22.04+).
The C core is built on each target; the Go daemon and launcher, agent production
modules, browser UI, database MCP server, Node 22, ripgrep, ONNX Runtime, and
non-system native dependencies are included. Models and Python are not bundled.
Python embedding adapters need Python 3.10+ with venv/pip. Jina ONNX and
`--no-vector` work without Python. Optional SearXNG needs Python and git; git
features need git. External MCP servers may have their own runtime requirements.

## Publish a release

1. Update `VERSION` using `make set-version v=vX.Y.Z` and commit the change.
2. Push a matching `vX.Y.Z` tag. `.github/workflows/release.yml` checks the version,
   builds three platform bundles, runs core/launcher/installer tests, and starts
   each relocated bundle with no system Node, project, chat model, or API key.
3. Review the generated **draft** GitHub release, then publish it. Until published,
   it is not selected by the public installer's `latest` URL.

The workflow uploads `codeberg-vX.Y.Z-{darwin-arm64,darwin-x64,linux-x64}.tar.gz`,
`SHA256SUMS`, and `install.sh`. A manual workflow dispatch builds and tests
artifacts without creating a release. Linux archives rely on the host glibc and
loader; they are not Alpine/musl or Windows packages. macOS binaries are ad-hoc
signed after library relocation, not Developer ID signed or notarized; manual
browser downloads may require approval in macOS Privacy & Security.

The installer requires `sh`, curl, tar, and sha256sum or shasum. It resolves the
latest published version once, verifies the matching archive's SHA-256, validates
its payload, and switches the command only after the launcher can execute.
The checksum protects against corrupted downloads; its trust is the same HTTPS
release source as the archive. It does not replace a separate signing system.

## Install and upgrade

```sh
curl -fsSL https://github.com/Midwayne/codeberg/releases/latest/download/install.sh | sh
```

Set `CODEBERG_VERSION=vX.Y.Z` on `sh` to pin a release. Use absolute
`CODEBERG_INSTALL_DIR` and `CODEBERG_BIN_DIR` values to override defaults:

```sh
curl -fsSL https://github.com/Midwayne/codeberg/releases/latest/download/install.sh |
  CODEBERG_VERSION=v0.1.0 CODEBERG_INSTALL_DIR="$HOME/apps/codeberg" sh
```

Stop the running app before upgrading, then repeat the installer. It retains old
release directories so running processes can finish and rollback stays possible.
To roll back, run the installer with the previous `CODEBERG_VERSION`.
Configuration, projects, chats, indexes, and model downloads stay in
`CODEBERG_HOME` (default `~/.codeberg`). The installer does not change that data.

The launcher checks the same `releases/latest` URL in the background once per
launch and prints a terminal notice for a newer stable version. It never blocks
startup or installs an update; failed checks are silent and time out after two
seconds. Version comparisons use numeric major, minor, and patch components.
Prerelease tags and unstamped development builds skip notifications. Source
installs through `launcher/install.sh` stamp the launcher from `VERSION`; direct
`go build` commands produce `dev` unless `-ldflags "-X main.version=vX.Y.Z"` is set.

For manual installation, download an archive and `SHA256SUMS` from the same
release, verify with `sha256sum --check` (or `shasum -a 256 --check` on macOS),
and extract it into a new directory. Keep `bin/` beside `libexec/`, then run
`bin/codeberg`. You may symlink that executable onto PATH; do not copy it alone.

`codeberg uninstall` removes the command and offers to remove managed data.
Release payload directories under `~/.local/share/codeberg` are retained. Once
Codeberg is stopped, remove that directory separately if you no longer need any
installed release. For a custom install prefix, use that prefix instead.

## Build an archive locally

Build machines need all developer prerequisites, ripgrep, Python 3, and
`patchelf` on Linux. Install ONNX Runtime before configuring CMake so Jina works
in the packaged release. Native library bundling fails on unresolved dependencies.

```sh
make dist
CODEBERG_ORT_DIR=/path/to/extracted/onnxruntime scripts/package-release.sh
python3 scripts/smoke-release.py build/release/codeberg-$(cat VERSION)-darwin-arm64.tar.gz
```

Adjust the smoke-test filename for your platform. The packager downloads a pinned
Node distribution and verifies its upstream checksum. It bundles dependency
libraries, rewrites loader paths, and ad-hoc signs modified macOS binaries.
Set `CODEBERG_ORT_DIR` to the extracted ONNX Runtime directory to include its license and third-party notices; the GitHub workflow sets this automatically.
