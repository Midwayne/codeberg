#ifndef CBERG_CHUNK_RULES_H
#define CBERG_CHUNK_RULES_H

/*
 * Bump whenever chunking output changes for unchanged input (tree-sitter
 * queries, window sizes, key format). Saved manifests embed it, so the first
 * warm start after an upgrade re-chunks every file once instead of serving the
 * old rules for files that did not change. Chunk ids and vectors for bodies
 * that chunk the same way are kept, so only genuinely new chunks are embedded.
 *
 * 2: pointer-returning C functions; module-level JS/TS function consts.
 */
#define CBERG_CHUNK_RULES_VERSION 2u

#endif /* CBERG_CHUNK_RULES_H */
