# Releasing

The `VERSION` file at the repository root is the single source of truth for the
release version. CMake reads it at configure time and defines `CBERG_VERSION` for
`cberg_version()`.

1. Update the changelog: move `[Unreleased]` notes under a new version heading
   with the release date.
2. Bump the version:

   ```sh
   make set-version v=v0.2.0
   ```

   This rewrites `VERSION`. Rebuild the core so the library reports the new
   version (`make build-core && make test TEST=test_smoke`).
3. Run the full gate: `make check` (and embedding tests if the embed path changed).
4. Commit (`chore(release): v0.2.0`) and tag:

   ```sh
   git tag v0.2.0
   git push origin main --tags
   ```

Pre-v1 releases use `v0.MINOR.PATCH` tags matching the `VERSION` file (including
the leading `v`).
