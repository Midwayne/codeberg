/* Private to import resolution: the per-repository index of source files and
 * import strings that resolve_pkg.c matches IMPORTS edges against. Built by
 * import_index.c; exposed to the indexer as the opaque cberg_import_cache. */
#ifndef CBERG_IMPORT_INDEX_H
#define CBERG_IMPORT_INDEX_H

#include "codeberg/codeberg.h"

#include <stddef.h>

#include "arena.h"
#include "import_cache.h"
#include "strmap.h"

typedef struct cberg_import_cache {
    cberg_strmap *file_set;       /* source membership detects create+modify event coalescing */
    cberg_strmap *import_to_file; /* import string -> arena path */
    cberg_arena *arena;
    char **file_paths; /* all indexed-looking source paths (rel) */
    size_t file_len;
    size_t file_cap;
    char go_module[512]; /* from go.mod, empty if absent */
    cberg_status err;    /* first walk/add failure (walk_cb collapses to -1) */
} pkg_index;

/* True for code languages only — not markdown/yaml/toml/json, which never
 * resolve as imports. */
int graph_is_code_source(const char *rel);

/* Walks root for source files, reads go.mod, and maps each language's import
 * strings to the files they name. *out is freed with cberg_import_cache_free. */
cberg_status graph_import_index_build(const char *root, const cberg_exclusions *exclusions, pkg_index **out);

#endif
