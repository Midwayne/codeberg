#ifndef CBERG_INDEXER_H
#define CBERG_INDEXER_H

#include <pthread.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>

#include "codeberg/codeberg.h"

/*
 * One cberg-index process serves N repository roots. The engine owns the
 * process-wide pieces — the (expensive, non-thread-safe) ONNX embedder, the
 * chunker, the IPC socket — and each root gets its own cberg_repo with an
 * independent chunk table, manifest, watcher, and vector index, so a repo's
 * warm start and on-disk layout are exactly what the single-root build wrote.
 *
 * Threading: bootstrap and the watch loop run on the main thread; the IPC
 * thread only searches. Every embedder call goes through the engine's
 * embed_mu; per-repo state is guarded by that repo's mu. Lock order is
 * strictly repo->mu -> embed_mu (indexing) or each alone (search embeds the
 * query under embed_mu only, then takes one repo->mu at a time) — never
 * embed_mu -> repo->mu.
 */

typedef struct cberg_engine cberg_engine;

typedef struct cberg_repo {
    cberg_engine *eng; /* back-pointer for the shared embedder/chunker */
    char *key;         /* human-facing repo identity (registry key / basename) */
    char *root;        /* resolved absolute root */

    char *index_path;    /* per-root "<base>.<roothash>" (NULL in chunk-only mode) */
    char *chunks_path;   /* persisted chunk table (sidecar of index_path) */
    char *manifest_path; /* persisted merkle manifest (sidecar of index_path) */
    char *graph_path;    /* persisted knowledge graph (sidecar of index_path) */

    cberg_chunk_table *table;
    cberg_manifest *manifest; /* change-detection baseline; NULL until bootstrap */
    cberg_watcher *watcher;
    cberg_index *index;
    cberg_graph *graph; /* structural sidecar (ADR 0005); NULL when disabled */

    pthread_mutex_t mu;
    int ready;
} cberg_repo;

struct cberg_engine {
    char *model_path;
    char *index_base; /* CBERG_INDEX_PATH as configured; per-root paths derive from it */
    char *socket_path;
    int poll_ms;
    int vectors;
    int graph_enabled; /* CBERG_GRAPH != 0 (default on); CBERG_GRAPH_MODE is fast-only for now */
    cberg_index_config index_cfg;
    char *vectordb_url;
    char *vectordb_api_key;
    char *postgres_url;

    cberg_chunker *chunker;   /* main (bootstrap/watch) thread only */
    cberg_embedder *embedder; /* ONE per process; call only via engine_embed */
    pthread_mutex_t embed_mu; /* serializes every cberg_embedder_embed call */

    cberg_repo **repos;
    size_t repos_len;

    volatile sig_atomic_t stop;
    volatile sig_atomic_t bootstrapped; /* all repos attempted (some may have failed) */
};

/* Opens the engine from the environment: CODEBERG_ROOTS ("<key>\t<path>"
 * records, newline-separated) or the single-root CODEBERG_ROOT fallback
 * (key = basename). Unresolvable roots are skipped with a warning. */
cberg_status cberg_engine_open(cberg_engine *eng);
void cberg_engine_close(cberg_engine *eng);

cberg_status cberg_repo_bootstrap(cberg_repo *r);

/* One non-blocking pass over every repo's watcher, applying any pending
 * changes. *out_events (nullable) receives the number of events handled. */
cberg_status cberg_engine_step(cberg_engine *eng, size_t *out_events);

/* The watch loop: step until stop, sleeping poll_ms between idle passes. */
cberg_status cberg_engine_run(cberg_engine *eng);

size_t cberg_repo_chunk_count(cberg_repo *r);
int cberg_repo_ready(cberg_repo *r);
size_t cberg_engine_chunk_count(cberg_engine *eng);
const char *cberg_indexer_version(void);

#define CBERG_SNIPPET_MAX 400
#define CBERG_CHUNK_BODY_MAX 65536

typedef struct cberg_search_filters {
    const char *path_glob; /* fnmatch on chunk.path; NULL/empty = any */
    int kind;              /* cberg_chunk_kind, or -1 for any */
    float min_score;       /* 0 = any */
} cberg_search_filters;

/* A search hit resolved to its chunk metadata. path/symbol/snippet are copied
 * out while the repo lock is held (the table may mutate after return); repo
 * borrows the engine-owned key, stable for the engine's lifetime. */
typedef struct cberg_engine_hit {
    uint64_t id;
    float score;
    const char *repo;
    char path[512];
    char symbol[256];
    uint32_t start_line;
    uint32_t end_line;
    char snippet[CBERG_SNIPPET_MAX];
} cberg_engine_hit;

/* Searches one repo (repo_key) or all of them (repo_key NULL or ""), embedding
 * the query once and merging per-repo neighbors by score, best-first. Repos
 * still bootstrapping are skipped in the all-repos case (partial results); an
 * unknown repo_key — or no searchable repo at all — is CBERG_ERR_NOT_FOUND.
 * filters may be NULL; when set, hits are post-filtered and over-fetched. */
cberg_status cberg_engine_search_hits(cberg_engine *eng, const char *query, const char *repo_key, size_t k, const cberg_search_filters *filters, cberg_engine_hit *hits, size_t cap, size_t *found);

typedef struct cberg_engine_chunk_detail {
    uint64_t id;
    const char *repo;
    char path[512];
    char symbol[256];
    char kind[32];
    uint32_t start_line;
    uint32_t end_line;
    char snippet[CBERG_SNIPPET_MAX];
    char *body; /* malloc'd; caller frees via cberg_engine_chunk_detail_free */
    size_t body_len;
    int truncated;
} cberg_engine_chunk_detail;

void cberg_engine_chunk_detail_free(cberg_engine_chunk_detail *d);

/* Fetch a stored chunk by (repo_key, id). body is the indexed chunk text. */
cberg_status cberg_engine_get_chunk(cberg_engine *eng, const char *repo_key, uint64_t id, cberg_engine_chunk_detail *out);

/* Scan the chunk table for symbol name matches (case-insensitive substring).
 * Does not require vector indexing. */
cberg_status cberg_engine_find_symbol(cberg_engine *eng, const char *name, const char *repo_key, int kind, size_t limit, cberg_engine_hit *hits, size_t cap, size_t *found);

/* Return every indexed chunk in a file, sorted by start_line. */
cberg_status cberg_engine_file_outline(cberg_engine *eng, const char *repo_key, const char *path, cberg_engine_hit *hits, size_t cap, size_t *found);

/* Map kind filter string to cberg_chunk_kind, or -1 when unset/unknown. */
int cberg_index_parse_kind(const char *s);

/* --- Knowledge graph IPC surface (ADR 0005) --- */

typedef struct cberg_engine_graph_node {
    uint64_t id;
    const char *repo;
    char kind[32];
    char name[256];
    char qname[512];
    char path[512];
    uint32_t start_line;
    uint32_t end_line;
} cberg_engine_graph_node;

typedef struct cberg_engine_graph_edge {
    uint64_t src;
    uint64_t dst;
    char kind[32];
    char resolution[32];
    float confidence;
    uint32_t line;
    char src_name[256];
    char dst_name[256];
    char src_path[512];
    char dst_path[512];
} cberg_engine_graph_edge;

typedef struct cberg_engine_graph_hop {
    cberg_engine_graph_edge edge;
    uint32_t depth;
} cberg_engine_graph_hop;

typedef struct cberg_engine_graph_lang {
    char lang[32];
    size_t files;
} cberg_engine_graph_lang;

typedef struct cberg_engine_graph_stats {
    const char *repo;
    size_t nodes;
    size_t refs;
    int enabled;
    cberg_engine_graph_lang languages[16];
    size_t languages_len;
} cberg_engine_graph_stats;

typedef struct cberg_engine_graph_hub {
    cberg_engine_graph_node node;
    uint32_t degree;
} cberg_engine_graph_hub;

/* Structural symbol search over the graph. Returns CBERG_ERR_NOT_IMPLEMENTED
 * ("graph disabled") when the graph kill-switch is on or the repo has no graph. */
cberg_status cberg_engine_search_graph(cberg_engine *eng, const char *name, const char *repo_key, const char *kind, const char *path_prefix, size_t limit, cberg_engine_graph_node *out, size_t cap, size_t *found);

/* BFS traversal from a named symbol (or start_id when non-zero). path_prefix
 * disambiguates same-named symbols (NULL = any; component-aware). direction is
 * "in", "out", or "both" (default both). edge_kind NULL/empty = CALLS. Returns
 * CBERG_ERR_NOT_IMPLEMENTED when the graph is disabled. */
cberg_status cberg_engine_trace_path(cberg_engine *eng, const char *name, uint64_t start_id, const char *repo_key, const char *path_prefix, const char *direction, const char *edge_kind, uint32_t max_depth, size_t limit, cberg_engine_graph_hop *out, size_t cap, size_t *found);

/* Per-repo graph counts. repo_key NULL/empty → first ready repo with a graph. */
cberg_status cberg_engine_get_graph_stats(cberg_engine *eng, const char *repo_key, cberg_engine_graph_stats *out);

/* Incoming CALLS/INHERITS/IMPORTS edges for a symbol (graph-first find_references).
 * path_prefix disambiguates same-named symbols (NULL = any; component-aware).
 * REFERENCES is reserved and not extracted yet, so it is omitted from the mask. */
cberg_status cberg_engine_graph_references(cberg_engine *eng, const char *name, const char *repo_key, const char *path_prefix, size_t limit, cberg_engine_graph_edge *out, size_t cap, size_t *found);

/* Degree hubs: symbols ranked by incident CALLS (in+out). */
cberg_status cberg_engine_graph_hubs(cberg_engine *eng, const char *repo_key, size_t limit, cberg_engine_graph_hub *out, size_t cap, size_t *found);

/* Parse graph node/edge kind strings used on the IPC wire. */
uint32_t cberg_index_parse_gnode_mask(const char *s);
uint32_t cberg_index_parse_gedge_mask(const char *s);

#endif
