#define _POSIX_C_SOURCE 200809L

#include "indexer.h"

#include "chunk_kind.h"
#include "chunk_table_internal.h"
#include "pathglob.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <unistd.h>

int cberg_index_parse_kind(const char *s) {
    return cberg_chunk_kind_parse(s);
}

static int chunk_passes_filters(const cberg_stored_chunk *sc, float score, const cberg_search_filters *f) {
    if (f == NULL) {
        return 1;
    }
    if (f->min_score > 0.0f && score < f->min_score) {
        return 0;
    }
    if (f->kind >= 0 && (int)sc->chunk.kind != f->kind) {
        return 0;
    }
    if (f->path_glob != NULL && f->path_glob[0] != '\0') {
        const char *path = sc->chunk.path != NULL ? sc->chunk.path : "";
        if (!cberg_path_glob_match(f->path_glob, path)) {
            return 0;
        }
    }
    return 1;
}

/* A chunk's source file opened for span reads, so hits and chunk details read
 * only the bytes they return instead of the whole file. */
typedef struct {
    int fd; /* -1 when the file could not be opened */
    off_t size;
} chunk_source;

static chunk_source chunk_source_open(const cberg_repo *r, const char *rel) {
    chunk_source src = {.fd = -1, .size = 0};
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s", r->root, rel != NULL ? rel : "");

    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) {
        return src;
    }

    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)) {
        close(fd);
        return src;
    }

    src.fd = fd;
    src.size = st.st_size;
    return src;
}

static void chunk_source_close(chunk_source *src) {
    if (src->fd >= 0) {
        close(src->fd);
    }
    src->fd = -1;
}

static int span_in_file(const chunk_source *src, const cberg_stored_chunk *sc) {
    uint32_t start = sc->chunk.span.start_byte;
    uint32_t end = sc->chunk.span.end_byte;
    return src->fd >= 0 && start <= end && (off_t)end <= src->size;
}

/* Reads up to len bytes of the span into out (NUL-terminated); returns the
 * byte count, which is short only if the file shrank since fstat. */
static size_t read_span(const chunk_source *src, const cberg_stored_chunk *sc, char *out, size_t len) {
    off_t at = (off_t)sc->chunk.span.start_byte;
    size_t got = 0;

    while (got < len) {
        ssize_t n = pread(src->fd, out + got, len - got, at + (off_t)got);
        if (n < 0 && errno == EINTR) {
            continue;
        }
        if (n <= 0) {
            break;
        }
        got += (size_t)n;
    }

    out[got] = '\0';
    return got;
}

static void snippet_from(const chunk_source *src, const cberg_stored_chunk *sc, char *out, size_t cap) {
    out[0] = '\0';
    if (sc == NULL || cap == 0 || !span_in_file(src, sc)) {
        return;
    }

    size_t len = (size_t)(sc->chunk.span.end_byte - sc->chunk.span.start_byte);
    if (len >= cap) {
        len = cap - 1;
    }
    read_span(src, sc, out, len);
}

static void fill_snippet(cberg_repo *r, const cberg_stored_chunk *sc, char *out, size_t cap) {
    out[0] = '\0';
    if (sc == NULL) {
        return;
    }

    chunk_source src = chunk_source_open(r, sc->chunk.path);
    snippet_from(&src, sc, out, cap);
    chunk_source_close(&src);
}

/* Copies a chunk's metadata into a hit; the snippet is filled separately. */
static void fill_hit_meta(const cberg_repo *r, const cberg_stored_chunk *sc, uint64_t id, float score, cberg_engine_hit *h) {
    h->id = id;
    h->score = score;
    h->repo = r->key;
    snprintf(h->path, sizeof(h->path), "%s", sc->chunk.path != NULL ? sc->chunk.path : "");
    snprintf(h->symbol, sizeof(h->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
    snprintf(h->kind, sizeof(h->kind), "%s", cberg_chunk_kind_name(sc->chunk.kind));
    h->start_line = sc->chunk.span.start_line;
    h->end_line = sc->chunk.span.end_line;
    h->snippet[0] = '\0';
}

#define CBERG_FILTER_FETCH_MAX 256

static int search_filters_active(const cberg_search_filters *filters) {
    return filters != NULL &&
           (filters->path_glob != NULL || filters->kind >= 0 || filters->min_score > 0.0f);
}

static int hit_id_seen(const uint64_t *seen, size_t seen_len, uint64_t id) {
    for (size_t i = 0; i < seen_len; i++) {
        if (seen[i] == id) {
            return 1;
        }
    }
    return 0;
}

/* Search one repo with an already-embedded query, copying chunk metadata into
 * hits while r->mu is held. NOT_FOUND when the repo is not ready yet. */
static cberg_status repo_search_hits(cberg_repo *r, const float *vec, size_t k, const cberg_search_filters *filters, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->index == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    const int filtered = search_filters_active(filters);
    size_t fetch = filtered ? 64 : k;

    uint64_t ids[CBERG_FILTER_FETCH_MAX];
    float scores[CBERG_FILTER_FETCH_MAX];
    uint64_t seen_ids[CBERG_FILTER_FETCH_MAX];
    size_t seen_len = 0;
    cberg_search_config search_cfg;
    cberg_search_config_default(&search_cfg);
    if (filtered) {
        search_cfg.oversample = 8;
        search_cfg.min_expansion_search = 128;
    }

    for (;;) {
        size_t n = 0;
        cberg_status st = cberg_search_vector(r->index, vec, filtered ? &search_cfg : NULL, fetch, ids, scores, &n);
        if (st != CBERG_OK) {
            pthread_mutex_unlock(&r->mu);
            return st;
        }

        for (size_t i = 0; i < n && *found < k && *found < cap; i++) {
            if (hit_id_seen(seen_ids, seen_len, ids[i])) {
                continue;
            }
            if (seen_len < CBERG_FILTER_FETCH_MAX) {
                seen_ids[seen_len++] = ids[i];
            }

            const cberg_stored_chunk *sc = cberg_chunk_table_find_by_id(r->table, ids[i]);
            if (sc == NULL) {
                continue;
            }
            if (!chunk_passes_filters(sc, scores[i], filters)) {
                continue;
            }
            cberg_engine_hit *h = &hits[*found];
            fill_hit_meta(r, sc, ids[i], scores[i], h);
            fill_snippet(r, sc, h->snippet, sizeof(h->snippet));
            (*found)++;
        }

        if (*found >= k || !filtered) {
            break;
        }
        if (n < fetch || fetch >= CBERG_FILTER_FETCH_MAX) {
            break;
        }
        size_t next = fetch * 2;
        fetch = next > CBERG_FILTER_FETCH_MAX ? CBERG_FILTER_FETCH_MAX : next;
    }

    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

static int hit_score_desc(const void *a, const void *b) {
    float sa = ((const cberg_engine_hit *)a)->score;
    float sb = ((const cberg_engine_hit *)b)->score;
    if (sa > sb) {
        return -1;
    }
    if (sa < sb) {
        return 1;
    }
    return 0;
}

static int hit_line_asc(const void *a, const void *b) {
    uint32_t la = ((const cberg_engine_hit *)a)->start_line;
    uint32_t lb = ((const cberg_engine_hit *)b)->start_line;
    if (la < lb) {
        return -1;
    }
    if (la > lb) {
        return 1;
    }
    return 0;
}

cberg_status cberg_engine_search_hits(cberg_engine *eng, const char *query, const char *repo_key, size_t k, const cberg_search_filters *filters, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (hits == NULL || found == NULL || query == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (cap == 0 || k == 0) {
        return CBERG_OK;
    }
    if (k > cap) {
        k = cap;
    }
    if (k > 64) {
        k = 64;
    }
    if (!eng->vectors) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    if (repo_key != NULL && repo_key[0] == '\0') {
        repo_key = NULL;
    }

    cberg_repo *only = cberg_engine_find_repo(eng, repo_key);
    if (repo_key != NULL && only == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    /* Embed the query once (under embed_mu alone — never while holding a repo
     * lock), then vector-search each target index. */
    const char *texts[1] = {query};
    size_t lens[1] = {strlen(query)};
    float *vec = NULL;
    cberg_status st = cberg_engine_embed(eng, texts, lens, 1, 1, &vec);
    if (st != CBERG_OK) {
        return st;
    }

    if (only != NULL) {
        st = repo_search_hits(only, vec, k, filters, hits, cap, found);
        cberg_vectors_free(vec);
        return st;
    }

    cberg_engine_hit *all = malloc(eng->repos_len * k * sizeof(*all));
    if (all == NULL) {
        cberg_vectors_free(vec);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t n = 0;
    size_t searched = 0;
    st = CBERG_OK;
    for (size_t i = 0; i < eng->repos_len; i++) {
        size_t got = 0;
        cberg_status rst = repo_search_hits(eng->repos[i], vec, k, filters, all + n, k, &got);
        if (rst == CBERG_OK) {
            n += got;
            searched++;
        } else if (rst != CBERG_ERR_NOT_FOUND) {
            st = rst; /* a real search failure; not-ready repos are just skipped */
            break;
        }
    }
    cberg_vectors_free(vec);
    if (st != CBERG_OK) {
        free(all);
        return st;
    }
    if (searched == 0) {
        free(all);
        return CBERG_ERR_NOT_FOUND;
    }

    qsort(all, n, sizeof(*all), hit_score_desc);
    for (size_t i = 0; i < n && *found < k; i++) {
        hits[(*found)++] = all[i];
    }
    free(all);
    return CBERG_OK;
}

void cberg_engine_chunk_detail_free(cberg_engine_chunk_detail *d) {
    if (d == NULL) {
        return;
    }
    free(d->body);
    d->body = NULL;
    d->body_len = 0;
}

static cberg_status fill_chunk_detail(cberg_repo *r, const cberg_stored_chunk *sc, cberg_engine_chunk_detail *out) {
    memset(out, 0, sizeof(*out));
    out->id = sc->id;
    out->repo = r->key;
    snprintf(out->path, sizeof(out->path), "%s", sc->chunk.path != NULL ? sc->chunk.path : "");
    snprintf(out->symbol, sizeof(out->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
    snprintf(out->kind, sizeof(out->kind), "%s", cberg_chunk_kind_name(sc->chunk.kind));
    out->start_line = sc->chunk.span.start_line;
    out->end_line = sc->chunk.span.end_line;

    chunk_source src = chunk_source_open(r, sc->chunk.path);
    if (src.fd < 0) {
        return CBERG_ERR_IO;
    }
    if (!span_in_file(&src, sc)) {
        chunk_source_close(&src);
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    size_t len = (size_t)(sc->chunk.span.end_byte - sc->chunk.span.start_byte);
    out->truncated = len > CBERG_CHUNK_BODY_MAX ? 1 : 0;
    if (len > CBERG_CHUNK_BODY_MAX) {
        len = CBERG_CHUNK_BODY_MAX;
    }
    out->body = malloc(len + 1);
    if (out->body == NULL) {
        chunk_source_close(&src);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    out->body_len = read_span(&src, sc, out->body, len);
    chunk_source_close(&src);

    size_t snip = out->body_len < sizeof(out->snippet) ? out->body_len : sizeof(out->snippet) - 1;
    memcpy(out->snippet, out->body, snip);
    out->snippet[snip] = '\0';
    return CBERG_OK;
}

cberg_status cberg_engine_get_chunk(cberg_engine *eng, const char *repo_key, uint64_t id, cberg_engine_chunk_detail *out) {
    if (eng == NULL || repo_key == NULL || out == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_repo *r = cberg_engine_find_repo(eng, repo_key);
    if (r == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    cberg_status st;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    const cberg_stored_chunk *sc = cberg_chunk_table_find_by_id(r->table, id);
    if (sc == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    st = fill_chunk_detail(r, sc, out);
    pthread_mutex_unlock(&r->mu);
    return st;
}

static int symbol_matches(const char *symbol, const char *name) {
    if (symbol == NULL || name == NULL || name[0] == '\0') {
        return 0;
    }
    if (strcasecmp(symbol, name) == 0) {
        return 1;
    }
    /* Case-insensitive substring for partial matches. */
    size_t nlen = strlen(name);
    for (const char *p = symbol; *p != '\0'; p++) {
        if (strncasecmp(p, name, nlen) == 0) {
            return 1;
        }
    }
    return 0;
}

static cberg_status repo_find_symbol(cberg_repo *r, const char *name, int kind, size_t limit, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n && *found < cap && *found < limit; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL) {
            continue;
        }
        if (kind >= 0 && (int)sc->chunk.kind != kind) {
            continue;
        }
        if (!symbol_matches(sc->chunk.symbol, name)) {
            continue;
        }
        cberg_engine_hit *h = &hits[*found];
        fill_hit_meta(r, sc, sc->id, 1.0f, h);
        fill_snippet(r, sc, h->snippet, sizeof(h->snippet));
        (*found)++;
    }
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

cberg_status cberg_engine_find_symbol(cberg_engine *eng, const char *name, const char *repo_key, int kind, size_t limit, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (eng == NULL || name == NULL || hits == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (cap == 0 || limit == 0) {
        return CBERG_OK;
    }
    if (limit > cap) {
        limit = cap;
    }
    if (limit > 64) {
        limit = 64;
    }
    if (repo_key != NULL && repo_key[0] == '\0') {
        repo_key = NULL;
    }

    if (repo_key != NULL) {
        cberg_repo *r = cberg_engine_find_repo(eng, repo_key);
        if (r == NULL) {
            return CBERG_ERR_NOT_FOUND;
        }
        return repo_find_symbol(r, name, kind, limit, hits, cap, found);
    }

    size_t searched = 0;
    for (size_t i = 0; i < eng->repos_len && *found < limit; i++) {
        size_t got = 0;
        cberg_status st = repo_find_symbol(eng->repos[i], name, kind, limit - *found, hits + *found, cap - *found, &got);
        if (st == CBERG_OK) {
            *found += got;
            searched++;
        } else if (st != CBERG_ERR_NOT_FOUND) {
            return st;
        }
    }
    if (searched == 0) {
        return CBERG_ERR_NOT_FOUND;
    }
    return CBERG_OK;
}

static cberg_status repo_file_outline(cberg_repo *r, const char *path, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    chunk_source src = chunk_source_open(r, path);
    size_t n = cberg_chunk_table_len(r->table);

    for (size_t i = 0; i < n && *found < cap; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL || sc->chunk.path == NULL || strcmp(sc->chunk.path, path) != 0) {
            continue;
        }
        cberg_engine_hit *h = &hits[*found];
        fill_hit_meta(r, sc, sc->id, 1.0f, h);
        snippet_from(&src, sc, h->snippet, sizeof(h->snippet));
        (*found)++;
    }

    chunk_source_close(&src);
    pthread_mutex_unlock(&r->mu);
    if (*found == 0) {
        return CBERG_ERR_NOT_FOUND;
    }
    qsort(hits, *found, sizeof(*hits), hit_line_asc);
    return CBERG_OK;
}

cberg_status cberg_engine_file_outline(cberg_engine *eng, const char *repo_key, const char *path, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (eng == NULL || repo_key == NULL || path == NULL || hits == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_repo *r = cberg_engine_find_repo(eng, repo_key);
    if (r == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    return repo_file_outline(r, path, hits, cap, found);
}
