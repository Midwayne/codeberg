#ifndef CBERG_GRAPH_INTERNAL_H
#define CBERG_GRAPH_INTERNAL_H

#include "codeberg/codeberg.h"

#include <tree_sitter/api.h>

#include "arena.h"

/* Reference names / import strings longer than this are truncated at
 * extraction (long rust use-trees, generated import paths). */
#define CBERG_GRAPH_NAME_MAX 256

/*
 * Per-file extraction result. Definitions mirror the file's symbol chunks
 * (identified by chunk key so cberg_graph_apply can map them onto stable chunk
 * ids); references are the file's outgoing call/import/inherit/contain links,
 * unresolved except where both endpoints live in this file.
 */
typedef struct cberg_graph_fdef {
    const char *key;  /* chunk key (fragment arena) */
    const char *name; /* symbol (fragment arena) */
    cberg_chunk_kind kind;
    cberg_span span;
} cberg_graph_fdef;

typedef struct cberg_graph_fref {
    int32_t src_def;  /* index into defs, or -1 for the file node */
    int32_t dst_def;  /* pre-resolved target def (span nesting), or -1 */
    const char *name; /* target name / module string; NULL when dst_def >= 0 */
    uint32_t line;    /* 1-based reference site line */
    uint8_t kind;     /* one cberg_graph_edge_kind bit */
    uint8_t rev;      /* reversed: the edge runs (named candidate) -> src_def */
} cberg_graph_fref;

struct cberg_graph_fragment {
    cberg_arena *arena;
    const char *path;
    cberg_language lang;
    cberg_graph_fdef *defs;
    size_t defs_len;
    size_t defs_cap;
    cberg_graph_fref *refs;
    size_t refs_len;
    size_t refs_cap;
};

/*
 * Warm per-language reference queries (call / import / inherit / member
 * captures). Owned by the chunker so extraction reuses its parse tree; create
 * one per worker thread, like the chunker itself.
 */
typedef struct cberg_graph_extractor cberg_graph_extractor;

cberg_graph_extractor *cberg_graph_extractor_new(void);
void cberg_graph_extractor_free(cberg_graph_extractor *extractor);

/*
 * Builds `path`'s fragment from an already-parsed tree and its chunk list
 * (fragment defs = the list's symbol chunks; CONTAINS derives from chunk span
 * nesting). Languages without a reference query yield defs-only fragments.
 */
cberg_status cberg_graph_extract(cberg_graph_extractor *extractor, const TSLanguage *ts_lang, cberg_language lang, TSNode root, const char *path, const char *src, size_t src_len, const cberg_chunk_list *chunks, cberg_graph_fragment **out_fragment);

/* Internal: rewrite one IMPORTS edge onto a resolved FILE (resolve_pkg.c). */
cberg_status cberg_graph_rewrite_import(cberg_graph *graph, uint64_t src_file_id, uint64_t old_dst, uint64_t new_dst, const char *new_name);

#endif /* CBERG_GRAPH_INTERNAL_H */
