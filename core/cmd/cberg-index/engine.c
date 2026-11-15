#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "../../src/graph/import_cache.h"
#include "embed_internal.h"
#include "pathutil.h"
#include "workspace_graph.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#define CBERG_DEFAULT_MAX_FILE_BYTES (1024ULL * 1024ULL) /* per-file indexing limit */
#define DEFAULT_POLL_MS 1000
#define DEFAULT_SOCKET_PATH "/tmp/codeberg-index.sock"

/* An environment variable's value, or NULL when it is unset or empty. */
static const char *env_value(const char *name) {
    const char *value = getenv(name);
    return value != NULL && value[0] != '\0' ? value : NULL;
}

/* 16-hex-char digest of the resolved root path: a stable per-directory tag, so
 * each indexed tree keeps its own index + sidecars. The realpath is the
 * directory's identity — a reverted directory hashes back to the same tag (its
 * cached state is reused), and a different tree gets a disjoint set of files. */
static void root_suffix(const char *root, char out[17]) {
    static const char hex[] = "0123456789abcdef";
    uint8_t h[CBERG_HASH_LEN];
    if (cberg_hash(root, strlen(root), h) != CBERG_OK) {
        memset(h, 0, sizeof(h));
    }
    for (size_t i = 0; i < 8; i++) {
        out[2 * i] = hex[h[i] >> 4];
        out[2 * i + 1] = hex[h[i] & 0x0F];
    }
    out[16] = '\0';
}

static char *join_str(const char *a, const char *b) {
    size_t la = strlen(a), lb = strlen(b);
    char *s = malloc(la + lb + 1);
    if (s != NULL) {
        memcpy(s, a, la);
        memcpy(s + la, b, lb + 1);
    }
    return s;
}

const char *cberg_indexer_version(void) {
    return cberg_version();
}

size_t cberg_repo_chunk_count(cberg_repo *r) {
    return atomic_load(&r->published_chunks);
}

int cberg_repo_ready(cberg_repo *r) {
    return atomic_load(&r->published_ready);
}

size_t cberg_engine_chunk_count(cberg_engine *eng) {
    size_t total = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        total += cberg_repo_chunk_count(eng->repos[i]);
    }
    return total;
}

cberg_repo *engine_find_repo(cberg_engine *eng, const char *repo_key) {
    if (repo_key == NULL || repo_key[0] == '\0') {
        return NULL;
    }
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (strcmp(eng->repos[i]->key, repo_key) == 0) {
            return eng->repos[i];
        }
    }
    return NULL;
}

static void repo_close(cberg_repo *r) {
    if (r == NULL) {
        return;
    }
    /* On a clean shutdown after bootstrap, refresh the baseline so the next start
     * re-chunks nothing it doesn't have to. Skipped on early-open failures (not
     * ready) to avoid overwriting good state with a half-built one. */
    if (r->ready) {
        repo_refresh_manifest(r);
        repo_save_state(r);
    }
    if (r->index != NULL) {
        cberg_index_save(r->index);
        cberg_index_close(r->index);
    }
    if (r->watcher != NULL) {
        cberg_watcher_close(r->watcher);
    }
    if (r->manifest != NULL) {
        cberg_manifest_free(r->manifest);
    }
    if (r->table != NULL) {
        cberg_chunk_table_free(r->table);
    }
    cberg_graph_free(r->graph);
    cberg_import_cache_free(r->import_cache);
    free(r->key);
    free(r->root);
    free(r->index_path);
    free(r->chunks_path);
    free(r->manifest_path);
    free(r->graph_path);
    pthread_mutex_destroy(&r->mu);
    free(r);
}

/* ------------------------------------------------------------- open a repo */

static cberg_repo *repo_new(cberg_engine *eng, const char *key, const char *root) {
    cberg_repo *r = calloc(1, sizeof(*r));
    if (r == NULL) {
        return NULL;
    }

    pthread_mutex_init(&r->mu, NULL);
    atomic_init(&r->published_chunks, 0);
    atomic_init(&r->published_ready, 0);
    atomic_init(&r->progress_completed, 0);
    atomic_init(&r->progress_total, 0);
    atomic_init(&r->progress_phase, "pending");
    atomic_init(&r->progress_active, 0);

    r->eng = eng;
    r->key = strdup(key);
    r->root = strdup(root);
    r->table = cberg_chunk_table_new();
    if (r->key == NULL || r->root == NULL || r->table == NULL) {
        repo_close(r);
        return NULL;
    }
    return r;
}

/* CBERG_INDEX_PATH is a base path; the actual index and its chunk-table /
 * manifest / graph sidecars are per-directory
 * ("<base>.<roothash>[.chunks|.manifest|.graph]"). Pointing at a different
 * tree never reuses another tree's chunks, and reverting to a prior tree
 * finds its embeddings (and graph) still cached. Sidecars are written even
 * in chunk-only mode when the base path is set, so warm restart can reload
 * the graph without ONNX. */
static cberg_status repo_set_sidecar_paths(cberg_repo *r) {
    if (r->eng->index_base == NULL) {
        return CBERG_OK;
    }

    char tag[18]; /* ".<16 hex>" */
    tag[0] = '.';
    root_suffix(r->root, tag + 1);

    r->index_path = join_str(r->eng->index_base, tag);
    if (r->index_path == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    r->chunks_path = join_str(r->index_path, ".chunks");
    r->manifest_path = join_str(r->index_path, ".manifest");
    if (r->chunks_path == NULL || r->manifest_path == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    if (r->graph != NULL) {
        r->graph_path = join_str(r->index_path, ".graph");
        if (r->graph_path == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    return CBERG_OK;
}

static int remove_if_present(const char *path) {
    return path == NULL || remove(path) == 0 || errno == ENOENT;
}

/* Wipe the vectors and every sidecar derived from them, so the repo
 * cold-reindexes from source. */
static cberg_status repo_discard_index(cberg_repo *r) {
    cberg_status st = cberg_index_wipe(r->index_path, r->eng->embed_dim, &r->eng->index_cfg);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: failed to wipe vector index '%s': %s\n", r->key, r->index_path, cberg_status_str(st));
        return st;
    }

    if (!remove_if_present(r->chunks_path) || !remove_if_present(r->manifest_path) || !remove_if_present(r->graph_path)) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status repo_open_index(cberg_repo *r) {
    cberg_engine *eng = r->eng;
    if (!eng->vectors) {
        return CBERG_OK;
    }

    cberg_status st = cberg_index_open(r->index_path, eng->embed_dim, &eng->index_cfg, &r->index);
    if (st == CBERG_ERR_CORRUPT) {
        /* Corrupt on-disk usearch file or remote collection/table with wrong
         * dimension. Transient I/O (DB down, network) returns CBERG_ERR_IO
         * and is not wiped here. */
        fprintf(stderr, "cberg-index[%s]: vector index '%s' is corrupt or incompatible; discarding and reindexing\n", r->key, r->index_path);

        st = repo_discard_index(r);
        if (st != CBERG_OK) {
            return st;
        }
        st = cberg_index_open(r->index_path, eng->embed_dim, &eng->index_cfg, &r->index);
    }

    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: failed to open vector index '%s': %s\n", r->key, r->index_path, cberg_status_str(st));
    }
    return st;
}

/* Graph, watcher, sidecar paths, and (in vector mode) the index. */
static cberg_status repo_open_parts(cberg_repo *r) {
    cberg_status st = CBERG_OK;

    if (r->eng->graph_enabled) {
        st = cberg_graph_new(&r->graph);
    }
    if (st == CBERG_OK) {
        st = cberg_watcher_open(r->root, &r->watcher);
    }
    if (st == CBERG_OK) {
        st = repo_set_sidecar_paths(r);
    }
    if (st == CBERG_OK) {
        st = repo_open_index(r);
    }
    return st;
}

static int engine_has_repo(const cberg_engine *eng, const char *key, const char *root) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (strcmp(eng->repos[i]->root, root) == 0 || strcmp(eng->repos[i]->key, key) == 0) {
            return 1;
        }
    }
    return 0;
}

/* Open one repo under the engine: per-root chunk table, watcher, and (in vector
 * mode) the "<base>.<roothash>" index + sidecars — the exact single-root layout,
 * so existing on-disk indexes stay valid. `root` must already be resolved. */
static cberg_status engine_add_repo(cberg_engine *eng, const char *key, const char *root) {
    if (engine_has_repo(eng, key, root)) {
        fprintf(stderr, "cberg-index: warning: duplicate root or key '%s' ignored\n", key);
        return CBERG_OK;
    }

    cberg_repo *r = repo_new(eng, key, root);
    if (r == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = repo_open_parts(r);
    if (st != CBERG_OK) {
        repo_close(r);
        return st;
    }

    cberg_repo **grown = realloc(eng->repos, (eng->repos_len + 1) * sizeof(*grown));
    if (grown == NULL) {
        repo_close(r);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    eng->repos = grown;
    eng->repos[eng->repos_len++] = r;
    return CBERG_OK;
}

/* One "<key>\t<path>" record. A malformed record or an unresolvable root is
 * skipped — a registry entry whose tree was deleted must not keep every other
 * repo from indexing. */
static cberg_status engine_add_root_record(cberg_engine *eng, char *record) {
    char *tab = strchr(record, '\t');
    if (tab == NULL || tab == record || tab[1] == '\0') {
        return CBERG_OK;
    }
    *tab = '\0';

    const char *key = record;
    const char *path = tab + 1;
    char resolved[4096];
    if (cberg_path_resolve(path, resolved, sizeof(resolved)) != CBERG_OK) {
        fprintf(stderr, "cberg-index: warning: skipping repo '%s': unresolvable root '%s'\n", key, path);
        return CBERG_OK;
    }
    return engine_add_repo(eng, key, resolved);
}

/* Open every root listed in CODEBERG_ROOTS (newline-separated records). */
static cberg_status open_repos_from_env(cberg_engine *eng) {
    const char *roots = env_value("CODEBERG_ROOTS");
    if (roots == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    char *records = strdup(roots);
    if (records == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    char *save = NULL;
    for (char *record = strtok_r(records, "\n", &save); record != NULL && st == CBERG_OK; record = strtok_r(NULL, "\n", &save)) {
        st = engine_add_root_record(eng, record);
    }
    free(records);

    if (st == CBERG_OK && eng->repos_len == 0) {
        fprintf(stderr, "cberg-index: no usable roots in CODEBERG_ROOTS\n");
        return CBERG_ERR_NOT_FOUND;
    }
    return st;
}

/* --------------------------------------------------- engine configuration */

static cberg_status dup_env(const char *name, char **out) {
    const char *value = env_value(name);
    if (value == NULL) {
        return CBERG_OK;
    }

    *out = strdup(value);
    return *out != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;
}

static cberg_status configure_index_kind(cberg_engine *eng) {
    const char *backend = env_value("CBERG_INDEX_BACKEND");
    if (backend != NULL && cberg_index_provider_from_name(backend, &eng->index_cfg.provider) != CBERG_OK) {
        fprintf(stderr, "cberg-index: unknown CBERG_INDEX_BACKEND '%s' (use: usearch, qdrant, pgvector, postgres)\n", backend);
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    const char *quant = env_value("CBERG_INDEX_QUANT");
    if (quant != NULL && cberg_index_quant_from_name(quant, &eng->index_cfg.quantization) != CBERG_OK) {
        fprintf(stderr, "cberg-index: unknown CBERG_INDEX_QUANT '%s' (use: f32, i8)\n", quant);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return CBERG_OK;
}

static cberg_status configure_qdrant(cberg_engine *eng) {
    cberg_status st = dup_env("CBERG_VECTORDB_URL", &eng->vectordb_url);
    if (st != CBERG_OK) {
        return st;
    }

    if (eng->vectordb_url == NULL) {
        fprintf(stderr,
                "cberg-index: CBERG_VECTORDB_URL is required when CBERG_INDEX_BACKEND=qdrant\n"
                "  e.g. CBERG_VECTORDB_URL=https://your-cluster.qdrant.io\n");
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    st = dup_env("CBERG_VECTORDB_API_KEY", &eng->vectordb_api_key);
    if (st != CBERG_OK) {
        return st;
    }

    eng->index_cfg.vectordb_url = eng->vectordb_url;
    eng->index_cfg.vectordb_api_key = eng->vectordb_api_key;
    return CBERG_OK;
}

static cberg_status configure_pgvector(cberg_engine *eng) {
    cberg_status st = dup_env("CBERG_POSTGRES_URL", &eng->postgres_url);
    if (st != CBERG_OK) {
        return st;
    }

    if (eng->postgres_url == NULL) {
        fprintf(stderr,
                "cberg-index: CBERG_POSTGRES_URL is required when CBERG_INDEX_BACKEND=pgvector\n"
                "  e.g. CBERG_POSTGRES_URL=postgresql://user:pass@host:5432/dbname\n");
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    eng->index_cfg.postgres_url = eng->postgres_url;
    return CBERG_OK;
}

/* Vector mode needs both a model and an index base path. The base path alone
 * still enables sidecars: chunk-only mode can persist .chunks / .manifest /
 * .graph when CBERG_INDEX_PATH is set. */
static cberg_status configure_vectors(cberg_engine *eng) {
    cberg_status st = dup_env("CBERG_INDEX_PATH", &eng->index_base);
    if (st != CBERG_OK || eng->index_base == NULL || env_value("CBERG_MODEL") == NULL) {
        return st;
    }

    st = dup_env("CBERG_MODEL", &eng->model_path);
    if (st != CBERG_OK) {
        return st;
    }
    eng->vectors = 1;

    cberg_index_config_default(&eng->index_cfg);
    st = configure_index_kind(eng);
    if (st != CBERG_OK) {
        return st;
    }

    if (eng->index_cfg.provider == CBERG_INDEX_QDRANT) {
        return configure_qdrant(eng);
    }
    if (eng->index_cfg.provider == CBERG_INDEX_PGVECTOR) {
        return configure_pgvector(eng);
    }
    return CBERG_OK;
}

/* Graph sidecar (ADR 0005): on by default, CBERG_GRAPH=0 is the kill
 * switch. CBERG_GRAPH_MODE only knows "fast" (syntactic) today; other
 * modes fall back with a warning rather than failing startup. */
static void configure_graph(cberg_engine *eng) {
    const char *graph = getenv("CBERG_GRAPH");
    int disabled = graph != NULL && (strcmp(graph, "0") == 0 || strcasecmp(graph, "off") == 0 || strcasecmp(graph, "false") == 0);
    eng->graph_enabled = !disabled;

    const char *mode = env_value("CBERG_GRAPH_MODE");
    if (eng->graph_enabled && mode != NULL && strcasecmp(mode, "fast") != 0) {
        fprintf(stderr, "cberg-index: CBERG_GRAPH_MODE '%s' not implemented yet; using 'fast'\n", mode);
    }
}

static cberg_status configure_poll_interval(cberg_engine *eng) {
    eng->poll_ms = DEFAULT_POLL_MS;

    const char *poll = env_value("CBERG_POLL_MS");
    if (poll == NULL) {
        return CBERG_OK;
    }

    int parsed = atoi(poll);
    if (parsed < 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (parsed > 0) {
        eng->poll_ms = parsed;
    }
    return CBERG_OK;
}

/* An unparsable CBERG_MAX_FILE_BYTES keeps the default. */
static void configure_max_file_bytes(cberg_engine *eng) {
    eng->max_file_bytes = CBERG_DEFAULT_MAX_FILE_BYTES;

    const char *max_file = env_value("CBERG_MAX_FILE_BYTES");
    if (max_file == NULL || max_file[0] == '-') {
        return;
    }

    char *end = NULL;
    unsigned long long parsed = strtoull(max_file, &end, 10);
    if (end != max_file && *end == '\0') {
        eng->max_file_bytes = parsed;
    }
}

static cberg_status configure_socket(cberg_engine *eng) {
    const char *sock = env_value("CBERG_SOCKET");

    eng->socket_path = strdup(sock != NULL ? sock : DEFAULT_SOCKET_PATH);
    return eng->socket_path != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;
}

static cberg_status engine_configure(cberg_engine *eng) {
    cberg_status st = configure_vectors(eng);
    if (st != CBERG_OK) {
        return st;
    }

    configure_graph(eng);

    st = configure_poll_interval(eng);
    if (st != CBERG_OK) {
        return st;
    }

    configure_max_file_bytes(eng);
    return configure_socket(eng);
}

static cberg_status engine_load_model(cberg_engine *eng) {
    if (!eng->vectors) {
        return CBERG_OK;
    }

    struct stat info;
    if (stat(eng->model_path, &info) != 0) {
        fprintf(stderr,
                "cberg-index: embedding model not found: '%s'\n"
                "  prepare a selected model with codeberg build --embedding <model-id>,\n"
                "  or fetch an ONNX model with scripts/fetch-model.sh and set CBERG_MODEL,\n"
                "  or unset CBERG_MODEL and CBERG_INDEX_PATH to run chunk-only.\n",
                eng->model_path);
        return CBERG_ERR_IO;
    }

    cberg_status st = cberg_engine_open_embedder(eng);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: failed to load embedding model '%s': %s\n", eng->model_path, cberg_status_str(st));
    }
    return st;
}

cberg_status cberg_engine_open(cberg_engine *eng) {
    memset(eng, 0, sizeof(*eng));
    atomic_init(&eng->bootstrapped, 0);
    atomic_init(&eng->updating, 0);
    pthread_mutex_init(&eng->embed_mu, NULL);
    pthread_mutex_init(&eng->work_mu, NULL);
    pthread_mutex_init(&eng->graph_mu, NULL);

    cberg_status st = engine_configure(eng);
    if (st == CBERG_OK) {
        st = cberg_chunker_open(&eng->chunker);
    }
    if (st == CBERG_OK) {
        st = engine_load_model(eng);
    }
    if (st == CBERG_OK) {
        st = open_repos_from_env(eng);
    }

    if (st != CBERG_OK) {
        cberg_engine_close(eng);
    }
    return st;
}

void cberg_engine_close(cberg_engine *eng) {
    if (eng == NULL) {
        return;
    }
    eng->stop = 1;
    cberg_workspace_free(eng->workspace_graph);
    for (size_t i = 0; i < eng->repos_len; i++) {
        repo_close(eng->repos[i]);
    }
    free(eng->repos);
    if (eng->embedder != NULL) {
        cberg_embedder_close(eng->embedder);
    }
    if (eng->chunker != NULL) {
        cberg_chunker_close(eng->chunker);
    }
    free(eng->model_path);
    free(eng->index_base);
    free(eng->vectordb_url);
    free(eng->vectordb_api_key);
    free(eng->postgres_url);
    free(eng->socket_path);
    pthread_mutex_destroy(&eng->embed_mu);
    pthread_mutex_destroy(&eng->work_mu);
    pthread_mutex_destroy(&eng->graph_mu);
    memset(eng, 0, sizeof(*eng));
}
