# CGO bindings (`internal/cberg`)

Thin wrappers around `core/include/codeberg/codeberg.h`. All C handles are closed from Go
`Close()` methods.

## Packages

| File | API surface |
|------|-------------|
| `cberg.go` | Status, version, resolve root |
| `chunk.go` | Chunker, chunk list/table, sync batch |
| `watch.go` | Watcher poll |
| `vector.go` | Embedder, index, search |

## Linking

`scripts/build-daemon.sh` sets `CGO_CFLAGS` / `CGO_LDFLAGS` to link `core/build/libcodeberg.a`
and platform libs (CoreServices, ONNX Runtime on macOS).

Do not import `internal/cberg` from outside the daemon module.
