# Codeberg

Fast codebase indexing: parse source into semantic chunks, track changes incrementally,
embed into vectors, and search by meaning.

## Index root

The **index root** is the codebase tree Codeberg watches and indexes. It is not
hardcoded — configure it with the `CODEBERG_ROOT` environment variable:

```sh
export CODEBERG_ROOT=/path/to/your/repository
```

| Variable | Purpose |
|----------|---------|
| `CODEBERG_ROOT` | Absolute or relative path to the repository / workspace to index |

Library helpers (for daemons and future CLI tools):

- `cberg_config_index_root()` — read `CODEBERG_ROOT` from the environment
- `cberg_config_resolve_index_root(buf, cap)` — `realpath` into `buf` (validates the path exists)
- `cberg_watcher_open(root, …)` — pass the same path when opening the filesystem watcher

**Symlinks:** `CODEBERG_ROOT` may point at a symlink; the watcher resolves it at
open time and indexes the target tree. Symbolic links **inside** the tree are
followed — symlinked directories are walked and watched like normal directories.

## Layout

| Path | Role |
|------|------|
| `core/` | C library — chunking, change tracking, watching, ONNX embedding, usearch vector index ([docs](core/docs/)) |
| `daemon/` | Go daemons: `cberg-index` indexer, `codeberg-d` HTTP + optional git pull |
| `agent/` | Retrieval client — TBD |
| `docs/` | Project overview and links |

## Build

```sh
git submodule update --init --recursive
make build
make build-daemon   # cberg-index + codeberg-d (requires Go 1.22+)
```

Optional embedding tests:

```sh
scripts/fetch-model.sh
export CODEBERG_ROOT=/path/to/your/repository   # if your tooling reads it
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
make test TEST=test_embed
```

See [core/docs/CORE.md](core/docs/CORE.md) for architecture; [core/docs/API.md](core/docs/API.md) for the full API.

## Version

Release version is tracked in [`VERSION`](VERSION) and exposed at runtime via
`cberg_version()`. See [docs/RELEASING.md](docs/RELEASING.md) for the release
process.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project is **test-driven** — write a
failing test for the behavior first. Run `make check` before opening a PR.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE).
