#define _XOPEN_SOURCE 700

#include "bench.h"
#include "codeberg/codeberg.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

/*
 * Chunk a real source tree, then embed the chunk bodies with the ONNX embedder
 * at several call sizes (how many texts the indexer hands cberg_embedder_embed
 * per call). Separates chunking cost from embedding cost and shows how the call
 * size changes padding waste and throughput.
 *
 * Usage: bench_embed [root] [max_chunks] [call_sizes...]
 * Model: CBERG_BENCH_MODEL or CBERG_TEST_MODEL (skips when neither is set).
 */

#define SKIP 77

typedef struct {
    char **srcs;
    size_t srcs_len;
    size_t srcs_cap;
    const char **texts;
    size_t *lens;
    size_t len;
    size_t cap;
    size_t max;
    size_t files;
    cberg_chunker *chunker;
} corpus;

static int push_src(corpus *c, char *src) {
    if (c->srcs_len == c->srcs_cap) {
        size_t cap = c->srcs_cap == 0 ? 64 : c->srcs_cap * 2;
        char **next = realloc(c->srcs, cap * sizeof(*next));

        if (next == NULL) {
            return -1;
        }

        c->srcs = next;
        c->srcs_cap = cap;
    }

    c->srcs[c->srcs_len++] = src;
    return 0;
}

static int push_text(corpus *c, const char *text, size_t len) {
    if (c->len == c->cap) {
        size_t cap = c->cap == 0 ? 256 : c->cap * 2;
        const char **texts = realloc(c->texts, cap * sizeof(*texts));
        size_t *lens = realloc(c->lens, cap * sizeof(*lens));

        if (texts != NULL) {
            c->texts = texts;
        }
        if (lens != NULL) {
            c->lens = lens;
        }
        if (texts == NULL || lens == NULL) {
            return -1;
        }

        c->cap = cap;
    }

    c->texts[c->len] = text;
    c->lens[c->len] = len;
    c->len++;
    return 0;
}

static char *read_all(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return NULL;
    }

    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);

    char *buf = n >= 0 ? malloc((size_t)n + 1) : NULL;
    if (buf != NULL && fread(buf, 1, (size_t)n, f) != (size_t)n) {
        free(buf);
        buf = NULL;
    }
    fclose(f);

    if (buf != NULL) {
        buf[n] = '\0';
        *out_len = (size_t)n;
    }
    return buf;
}

static void chunk_file(corpus *c, const char *path) {
    cberg_language lang = cberg_language_from_path(path);
    if (lang == CBERG_LANG_UNKNOWN) {
        return;
    }

    size_t len = 0;
    char *src = read_all(path, &len);
    if (src == NULL || push_src(c, src) != 0) {
        free(src);
        return;
    }

    cberg_chunk_list *list = NULL;
    if (cberg_chunker_analyze(c->chunker, lang, path, src, len, &list, NULL) != CBERG_OK || list == NULL) {
        return;
    }

    c->files++;
    for (size_t i = 0; i < cberg_chunk_list_len(list) && c->len < c->max; i++) {
        const cberg_chunk *ch = cberg_chunk_list_at(list, i);
        uint32_t start = ch->span.start_byte;
        uint32_t end = ch->span.end_byte;

        if (end > len || start >= end) {
            continue;
        }
        if (push_text(c, src + start, end - start) != 0) {
            break;
        }
    }
    cberg_chunk_list_free(list);
}

static void walk(corpus *c, const char *dir) {
    DIR *d = opendir(dir);
    if (d == NULL) {
        return;
    }

    struct dirent *e;
    while (c->len < c->max && (e = readdir(d)) != NULL) {
        if (e->d_name[0] == '.' || cberg_walk_skip_dir(e->d_name)) {
            continue;
        }

        char path[4096];
        snprintf(path, sizeof(path), "%s/%s", dir, e->d_name);

        struct stat st;
        if (lstat(path, &st) != 0) {
            continue;
        }
        if (S_ISDIR(st.st_mode)) {
            walk(c, path);
        } else if (S_ISREG(st.st_mode)) {
            chunk_file(c, path);
        }
    }
    closedir(d);
}

static void corpus_free(corpus *c) {
    for (size_t i = 0; i < c->srcs_len; i++) {
        free(c->srcs[i]);
    }
    free(c->srcs);
    free(c->texts);
    free(c->lens);
}

static const size_t *sort_lens;

static int cmp_len(const void *a, const void *b) {
    size_t la = sort_lens[*(const size_t *)a];
    size_t lb = sort_lens[*(const size_t *)b];
    return la < lb ? -1 : la > lb;
}

/* Mirror the indexer's sort window: order each window of chunks by byte length
 * so consecutive calls carry similar-length texts. */
static void sort_windows(corpus *c, size_t window) {
    size_t *order = malloc(c->len * sizeof(*order));
    const char **texts = malloc(c->len * sizeof(*texts));
    size_t *lens = malloc(c->len * sizeof(*lens));

    if (order == NULL || texts == NULL || lens == NULL) {
        free(order);
        free(texts);
        free(lens);
        return;
    }

    for (size_t i = 0; i < c->len; i++) {
        order[i] = i;
    }
    sort_lens = c->lens;
    for (size_t w = 0; w < c->len; w += window) {
        size_t n = c->len - w < window ? c->len - w : window;
        qsort(order + w, n, sizeof(*order), cmp_len);
    }

    for (size_t i = 0; i < c->len; i++) {
        texts[i] = c->texts[order[i]];
        lens[i] = c->lens[order[i]];
    }

    free(order);
    free(c->texts);
    free(c->lens);
    c->texts = texts;
    c->lens = lens;
}

/* Mirror cberg-index's per-call text budget (CBERG_BENCH_CALL_BUDGET bytes,
 * each text clamped to 1 KiB); 0 disables it. */
static size_t budgeted_len(const corpus *c, size_t start, size_t n, size_t budget) {
    if (budget == 0) {
        return n;
    }

    size_t used = 0;
    size_t bn = 0;
    while (bn < n) {
        size_t cost = c->lens[start + bn] < 1024 ? c->lens[start + bn] : 1024;
        if (bn > 0 && used + cost > budget) {
            break;
        }

        used += cost;
        bn++;
    }
    return bn;
}

/* Total time, plus the slowest single call: in cberg-index that is the longest
 * a search query can wait on embed_mu. */
static int embed_all(cberg_embedder *emb, const corpus *c, size_t call, double *out_s, double *out_max_call) {
    const char *budget_env = getenv("CBERG_BENCH_CALL_BUDGET");
    size_t budget = budget_env != NULL ? (size_t)strtoul(budget_env, NULL, 10) : 0;

    cberg_bench_timer t;
    cberg_bench_start(&t);
    *out_max_call = 0.0;

    for (size_t i = 0, n = 0; i < c->len; i += n) {
        n = budgeted_len(c, i, c->len - i < call ? c->len - i : call, budget);
        float *vecs = NULL;

        cberg_bench_timer ct;
        cberg_bench_start(&ct);
        if (cberg_embedder_embed(emb, c->texts + i, c->lens + i, n, &vecs) != CBERG_OK) {
            return -1;
        }
        cberg_bench_stop(&ct);
        cberg_vectors_free(vecs);

        if (cberg_bench_seconds(&ct) > *out_max_call) {
            *out_max_call = cberg_bench_seconds(&ct);
        }
    }

    cberg_bench_stop(&t);
    *out_s = cberg_bench_seconds(&t);
    return 0;
}

static int run_embeds(const corpus *c, const char *model, int argc, char **argv) {
    cberg_embed_config cfg = {0};
    cfg.provider = CBERG_EMBED_ONNX;
    cfg.model_path = model;

    const char *threads = getenv("CBERG_EMBED_THREADS");
    cfg.num_threads = threads != NULL ? atoi(threads) : 0;

    cberg_embedder *emb = NULL;
    if (cberg_embedder_open(&cfg, &emb) != CBERG_OK) {
        fprintf(stderr, "bench_embed: cannot open model '%s'\n", model);
        return 1;
    }

    static char *defaults[] = {"32", "256", "1024"};
    char **sizes = argc > 0 ? argv : defaults;
    int n_sizes = argc > 0 ? argc : 3;

    int rc = 0;
    for (int i = 0; i < n_sizes && rc == 0; i++) {
        size_t call = (size_t)strtoul(sizes[i], NULL, 10);
        double s = 0.0;
        double max_call = 0.0;

        if (call == 0 || embed_all(emb, c, call, &s, &max_call) != 0) {
            fprintf(stderr, "bench_embed: embed failed at call size %s\n", sizes[i]);
            rc = 1;
            break;
        }

        printf("embed call=%-6zu %9.3f s  %8.1f chunks/s  max call %6.3f s\n", call, s, (double)c->len / s, max_call);
        fflush(stdout);
    }

    cberg_embedder_close(emb);
    return rc;
}

int main(int argc, char **argv) {
    const char *model = getenv("CBERG_BENCH_MODEL");
    if (model == NULL || model[0] == '\0') {
        model = getenv("CBERG_TEST_MODEL");
    }
    if (model == NULL || model[0] == '\0') {
        printf("skip - set CBERG_BENCH_MODEL or CBERG_TEST_MODEL\n");
        return SKIP;
    }

    corpus c = {0};
    const char *root = argc > 1 ? argv[1] : ".";
    c.max = argc > 2 ? (size_t)strtoul(argv[2], NULL, 10) : 2000;

    if (cberg_chunker_open(&c.chunker) != CBERG_OK) {
        return 1;
    }

    cberg_bench_timer t;
    cberg_bench_start(&t);
    walk(&c, root);
    cberg_bench_stop(&t);
    cberg_chunker_close(c.chunker);

    size_t bytes = 0;
    for (size_t i = 0; i < c.len; i++) {
        bytes += c.lens[i];
    }

    printf("chunk  %zu files -> %zu chunks (%.0f avg bytes) in %.3f s\n", c.files, c.len, c.len ? (double)bytes / (double)c.len : 0.0, cberg_bench_seconds(&t));
    fflush(stdout);

    const char *window = getenv("CBERG_BENCH_SORT_WINDOW");
    if (window != NULL && strtoul(window, NULL, 10) > 0) {
        sort_windows(&c, (size_t)strtoul(window, NULL, 10));
        printf("sorted by byte length in windows of %s\n", window);
    }

    int rc = c.len == 0 ? 1 : run_embeds(&c, model, argc > 3 ? argc - 3 : 0, argv + 3);
    corpus_free(&c);
    return rc;
}
