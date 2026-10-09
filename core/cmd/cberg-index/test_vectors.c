/* Exercises the vector pipeline end to end with a logging embed worker: every
 * unique chunk body is embedded exactly once (duplicates reuse a vector), every
 * chunk id lands in the index, and a watched edit re-embeds only the bodies
 * that changed. The repo spans several embed calls, so bodies reach the
 * embedder length-sorted and in bounded calls, and the sort must not scramble
 * which chunk ids receive which vector. */
#include "indexer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

#define TEST_LABELED(lbl, cond, msg)                                                  \
    do {                                                                              \
        if (!(cond)) {                                                                \
            fprintf(stderr, "FAIL [%s]: %s (%s:%d)\n", lbl, msg, __FILE__, __LINE__); \
            failures++;                                                               \
        }                                                                             \
    } while (0)

#define N_FILES 60
#define FUNCS_PER_FILE 3
#define MAX_EMBED_CALL 96

typedef struct {
    char **items;
    size_t *lens;
    size_t len;
} text_set;

static void text_set_free(text_set *s) {
    for (size_t i = 0; i < s->len; i++) {
        free(s->items[i]);
    }
    free(s->items);
    free(s->lens);
    memset(s, 0, sizeof(*s));
}

static void text_set_push(text_set *s, const char *text, size_t len) {
    s->items = realloc(s->items, (s->len + 1) * sizeof(*s->items));
    s->lens = realloc(s->lens, (s->len + 1) * sizeof(*s->lens));

    char *copy = malloc(len + 1);
    memcpy(copy, text, len);
    copy[len] = '\0';

    s->items[s->len] = copy;
    s->lens[s->len] = len;
    s->len++;
}

static size_t text_set_count(const text_set *s, const char *text, size_t len) {
    size_t n = 0;
    for (size_t i = 0; i < s->len; i++) {
        if (s->lens[i] == len && memcmp(s->items[i], text, len) == 0) {
            n++;
        }
    }
    return n;
}

static void write_file(const char *root, const char *rel, const char *body) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", root, rel);

    FILE *f = fopen(path, "w");
    if (f == NULL) {
        fprintf(stderr, "FAIL: cannot write %s\n", path);
        failures++;
        return;
    }
    fputs(body, f);
    fclose(f);
}

/* File i defines FUNCS_PER_FILE functions; the last one is byte-identical in
 * every file, so the repo carries N_FILES - 1 duplicate bodies. */
static void write_nested_source(const char *root) {
    char dir[512];
    snprintf(dir, sizeof(dir), "%s/pkg", root);
    mkdir(dir, 0755);
    snprintf(dir, sizeof(dir), "%s/pkg/sub", root);
    mkdir(dir, 0755);

    write_file(root, "pkg/sub/deep.go", "package sub\n\nfunc Deep(a int) int {\n\treturn a * 7\n}\n");
}

/* path_glob uses rg semantics: only_nested demands every hit lies under
 * pkg/sub; otherwise hits must exist and none may be the nested file when the
 * glob negates it. */
static void check_glob_search(cberg_engine *eng, const char *glob, int only_nested) {
    cberg_search_filters filters = {.path_glob = glob, .kind = -1, .min_score = 0.0f};
    cberg_engine_hit hits[16];
    size_t found = 0;

    cberg_status st = cberg_engine_search_hits(eng, "multiply", NULL, 16, &filters, hits, 16, &found);
    TEST_LABELED(glob, st == CBERG_OK && found > 0, "filtered search returns hits");

    int negated = glob[0] == '!';
    for (size_t i = 0; i < found; i++) {
        int nested = strcmp(hits[i].path, "pkg/sub/deep.go") == 0;
        if (only_nested) {
            TEST_LABELED(glob, nested, "hit lies under the glob");
        }
        if (negated) {
            TEST_LABELED(glob, !nested, "negated glob excludes the nested file");
        }
    }
}

static void write_source(const char *root, int i, const char *tag) {
    char body[2048];
    int off = snprintf(body, sizeof(body), "package main\n\n");
    for (int f = 0; f < FUNCS_PER_FILE - 1; f++) {
        off += snprintf(body + off, sizeof(body) - (size_t)off,
                        "func F%d_%d%s(a int) int {\n\treturn a + %d\n}\n\n", i, f, tag, i * 10 + f);
    }
    snprintf(body + off, sizeof(body) - (size_t)off, "func Shared() int {\n\treturn 42\n}\n");

    char rel[64];
    snprintf(rel, sizeof(rel), "f%02d.go", i);
    write_file(root, rel, body);
}

static void read_log(const char *path, text_set *out) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return;
    }

    size_t len = 0;
    while (fscanf(f, "%zu", &len) == 1) {
        fgetc(f);

        char *buf = malloc(len + 1);
        size_t got = fread(buf, 1, len, f);
        fgetc(f);
        if (got == len) {
            text_set_push(out, buf, len);
        }
        free(buf);
    }
    fclose(f);
}

/* Unique chunk bodies currently in the table, read back from disk. */
static void table_unique_bodies(cberg_repo *r, text_set *out) {
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);

        char path[1024];
        snprintf(path, sizeof(path), "%s/%s", r->root, sc->chunk.path);

        FILE *f = fopen(path, "rb");
        if (f == NULL) {
            continue;
        }
        size_t len = sc->chunk.span.end_byte - sc->chunk.span.start_byte;
        char *buf = malloc(len + 1);
        fseek(f, (long)sc->chunk.span.start_byte, SEEK_SET);
        size_t got = fread(buf, 1, len, f);
        fclose(f);

        if (got == len && text_set_count(out, buf, len) == 0) {
            text_set_push(out, buf, len);
        }
        free(buf);
    }
}

static size_t index_population(cberg_repo *r, size_t want) {
    uint64_t *ids = calloc(want + 8, sizeof(*ids));
    float *scores = calloc(want + 8, sizeof(*scores));
    const float query[3] = {1.0f, 1.0f, 1.0f};

    size_t found = 0;
    cberg_status st = cberg_index_search(r->index, query, want + 8, NULL, ids, scores, &found);

    free(ids);
    free(scores);
    return st == CBERG_OK ? found : 0;
}

/* Every unique body appears in the log exactly once, and nothing else does. */
static void check_embedded_once(const text_set *logged, const text_set *expected, const char *what) {
    char msg[256];

    snprintf(msg, sizeof(msg), "%s: embedded %zu texts, want %zu unique bodies", what, logged->len, expected->len);
    CHECK(logged->len == expected->len, msg);

    for (size_t i = 0; i < expected->len; i++) {
        snprintf(msg, sizeof(msg), "%s: body %zu embedded exactly once", what, i);
        CHECK(text_set_count(logged, expected->items[i], expected->lens[i]) == 1, msg);
    }
}

/* Bodies go to the embedder shortest-first within a sort window, so a repo
 * smaller than one window arrives in non-decreasing length order. */
static void check_length_sorted(const text_set *logged) {
    size_t unsorted = 0;

    for (size_t i = 1; i < logged->len; i++) {
        if (logged->lens[i] < logged->lens[i - 1]) {
            unsorted++;
        }
    }

    CHECK(unsorted == 0, "bootstrap bodies are embedded in length order");
}

/* Every embed call stays within the per-call cap, and a repo larger than one
 * call really is split across several. */
static void check_call_sizes(const char *calls_path, size_t want_texts) {
    FILE *f = fopen(calls_path, "r");
    CHECK(f != NULL, "embed call log exists");
    if (f == NULL) {
        return;
    }

    size_t count = 0;
    size_t calls = 0;
    size_t total = 0;
    size_t oversized = 0;

    while (fscanf(f, "%zu", &count) == 1) {
        calls++;
        total += count;
        if (count > MAX_EMBED_CALL) {
            oversized++;
        }
    }
    fclose(f);

    CHECK(oversized == 0, "no embed call exceeds the per-call cap");
    CHECK(calls > 1, "bootstrap spans several embed calls");
    CHECK(total == want_texts, "call sizes add up to the embedded texts");
}

/* The worker gives "Shared" bodies (and the query) their own axis, so the top
 * N_FILES hits must be exactly the duplicated Shared chunks. A wrong scatter
 * after the length sort would hand that vector to some other chunk. */
static void check_shared_vectors(cberg_engine *eng) {
    cberg_search_filters filters = {.path_glob = NULL, .kind = -1, .min_score = 0.0f};
    cberg_engine_hit hits[N_FILES];
    size_t found = 0;

    cberg_status st = cberg_engine_search_hits(eng, "Shared", NULL, N_FILES, &filters, hits, N_FILES, &found);
    CHECK(st == CBERG_OK && found == N_FILES, "search returns one hit per Shared duplicate");

    size_t wrong = 0;
    for (size_t i = 0; i < found; i++) {
        if (strcmp(hits[i].symbol, "Shared") != 0 || hits[i].score < 0.99f) {
            wrong++;
        }
    }

    CHECK(wrong == 0, "every Shared duplicate carries the Shared vector");
}

static void step_until_log_grows(cberg_engine *eng, const char *log_path, size_t have) {
    for (int i = 0; i < 200; i++) {
        size_t handled = 0;
        if (cberg_engine_step(eng, &handled) != CBERG_OK) {
            break;
        }

        text_set logged = {0};
        read_log(log_path, &logged);
        size_t now = logged.len;
        text_set_free(&logged);
        if (now > have && handled == 0) {
            return;
        }

        struct timespec ts = {.tv_sec = 0, .tv_nsec = 50 * 1000000L};
        nanosleep(&ts, NULL);
    }
}

static void cleanup(const char *root, const char *work) {
    char cmd[1200];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s' '%s'", root, work);
    if (system(cmd) != 0) {
        fprintf(stderr, "warning: cleanup failed\n");
    }
}

int main(void) {
    char root_tmpl[] = "/tmp/cberg-vectors-root-XXXXXX";
    char work_tmpl[] = "/tmp/cberg-vectors-work-XXXXXX";
    char *root = mkdtemp(root_tmpl);
    char *work = mkdtemp(work_tmpl);
    if (root == NULL || work == NULL) {
        fprintf(stderr, "FAIL: mkdtemp\n");
        return 1;
    }

    for (int i = 0; i < N_FILES; i++) {
        write_source(root, i, "");
    }
    write_nested_source(root);

    char model[512], index[512], sock[512], log_path[512], calls_path[512];
    snprintf(model, sizeof(model), "%s/model.onnx", work);
    snprintf(index, sizeof(index), "%s/idx.usearch", work);
    snprintf(sock, sizeof(sock), "%s/sock", work);
    snprintf(log_path, sizeof(log_path), "%s/embedded.log", work);
    snprintf(calls_path, sizeof(calls_path), "%s/calls.log", work);
    write_file(work, "model.onnx", "");

    unsetenv("CODEBERG_ROOTS");
    setenv("CODEBERG_ROOT", root, 1);
    setenv("CBERG_MODEL", model, 1);
    setenv("CBERG_INDEX_PATH", index, 1);
    setenv("CBERG_SOCKET", sock, 1);
    setenv("CBERG_POLL_MS", "50", 1);
    setenv("CBERG_EMBED_BACKEND", "llama", 1);
    setenv("CBERG_EMBED_WORKER", CBERG_LOG_WORKER, 1);
    setenv("CBERG_TEST_EMBED_LOG", log_path, 1);
    setenv("CBERG_TEST_EMBED_CALLS", calls_path, 1);

    cberg_engine eng;
    cberg_status st = cberg_engine_open(&eng);
    CHECK(st == CBERG_OK, "engine opens with the worker embedder");
    if (st != CBERG_OK) {
        cleanup(root, work);
        return 1;
    }
    CHECK(eng.vectors && eng.repos_len == 1, "vector mode, one repo");
    cberg_repo *r = eng.repos[0];

    /* Cold bootstrap. */
    CHECK(cberg_repo_bootstrap(r) == CBERG_OK, "bootstrap");
    eng.bootstrapped = 1;

    size_t chunks = cberg_repo_chunk_count(r);
    CHECK(chunks >= (size_t)(N_FILES * FUNCS_PER_FILE), "every function chunked");

    text_set expected = {0};
    text_set logged = {0};
    table_unique_bodies(r, &expected);
    read_log(log_path, &logged);
    CHECK(expected.len > MAX_EMBED_CALL, "unique bodies span more than one embed call");
    CHECK(expected.len < chunks, "repo carries duplicate bodies");
    check_embedded_once(&logged, &expected, "bootstrap");
    check_length_sorted(&logged);
    check_call_sizes(calls_path, logged.len);
    CHECK(index_population(r, chunks) == chunks, "every chunk id is in the index");

    /* Watched edit: only the rewritten file's new bodies are embedded. */
    size_t before = logged.len;
    text_set_free(&expected);
    text_set_free(&logged);

    write_source(root, 5, "x");
    step_until_log_grows(&eng, log_path, before);

    read_log(log_path, &logged);
    text_set fresh = {0};
    for (size_t i = before; i < logged.len; i++) {
        text_set_push(&fresh, logged.items[i], logged.lens[i]);
    }

    CHECK(fresh.len == FUNCS_PER_FILE - 1, "edit re-embeds only the changed bodies");
    for (size_t i = 0; i < fresh.len; i++) {
        CHECK(strstr(fresh.items[i], "x(a int)") != NULL, "re-embedded body is the edited one");
    }
    CHECK(cberg_repo_chunk_count(r) == chunks, "chunk count stable after edit");
    CHECK(index_population(r, chunks) == chunks, "index still holds every chunk id");

    check_glob_search(&eng, "pkg/**", 1);
    check_glob_search(&eng, "deep.go", 1);
    check_glob_search(&eng, "**/*.go", 0);
    check_glob_search(&eng, "!pkg/**", 0);
    check_shared_vectors(&eng);

    text_set_free(&fresh);
    text_set_free(&logged);
    cberg_engine_close(&eng);
    cleanup(root, work);

    if (failures == 0) {
        printf("ok - vectors\n");
        return 0;
    }
    return 1;
}
