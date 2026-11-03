#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "codeberg/codeberg.h"
#include "pathutil.h"
#include "test_graph_common.h"

typedef struct quality_edge {
    uint32_t kind;
    char source[512];
    unsigned line;
    char target[512];
    unsigned definition;
} quality_edge;

typedef struct quality_score {
    size_t tp, fp, fn, sites, negatives;
} quality_score;

typedef struct quality_corpus {
    graph_corpus corpus;
    int error;
} quality_corpus;

static int index_source(const char *absolute, const char *relative, void *context) {
    quality_corpus *quality = context;
    cberg_language language = cberg_language_from_path(relative);
    if (language == CBERG_LANG_UNKNOWN || language >= CBERG_LANG_MARKDOWN) {
        return 0;
    }

    FILE *file = fopen(absolute, "rb");
    if (file == NULL || fseek(file, 0, SEEK_END) != 0) {
        if (file != NULL)
            fclose(file);
        return -1;
    }

    long length = ftell(file);
    rewind(file);
    char *source = length >= 0 ? calloc((size_t)length + 1, 1) : NULL;
    if (source == NULL || fread(source, 1, (size_t)length, file) != (size_t)length) {
        free(source);
        fclose(file);
        return -1;
    }

    fclose(file);
    quality->error = corpus_index(&quality->corpus, language, relative, source) != CBERG_OK;
    free(source);

    return quality->error ? -1 : 0;
}

static size_t read_expected(const char *root, quality_edge *expected, size_t capacity) {
    char path[4096];
    snprintf(path, sizeof path, "%s/expected.tsv", root);
    FILE *file = fopen(path, "r");
    if (file == NULL)
        return 0;

    size_t count = 0;
    char kind[32];
    while (count < capacity && fscanf(file, "%31s %511s %u %511s %u", kind, expected[count].source, &expected[count].line, expected[count].target, &expected[count].definition) == 5) {
        if (strcmp(kind, "calls") == 0)
            expected[count].kind = CBERG_GEDGE_CALLS;
        else if (strcmp(kind, "imports") == 0)
            expected[count].kind = CBERG_GEDGE_IMPORTS;
        else if (strcmp(kind, "references") == 0)
            expected[count].kind = CBERG_GEDGE_REFERENCES;
        else {
            fclose(file);
            return SIZE_MAX;
        }
        count++;
    }

    fclose(file);
    return count < capacity ? count : SIZE_MAX;
}

static int same_site(const quality_edge *a, const quality_edge *b) {
    return a->kind == b->kind && a->line == b->line && strcmp(a->source, b->source) == 0;
}

static int same_edge(const quality_edge *a, const quality_edge *b) {
    return same_site(a, b) && a->definition == b->definition && strcmp(a->target, b->target) == 0;
}

static size_t collect_actual(cberg_graph *graph, const quality_edge *expected, size_t count, quality_edge *actual, size_t capacity) {
    const cberg_graph_node *nodes[512];
    size_t length = 0;
    if (cberg_graph_find_nodes(graph, NULL, 0, NULL, nodes, 512, &length) != CBERG_OK || length == 512) {
        return SIZE_MAX;
    }

    size_t written = 0;
    for (size_t i = 0; i < length; i++) {
        if (nodes[i]->path == NULL)
            continue;

        cberg_graph_edge edges[256];
        size_t found = 0;
        uint32_t mask = CBERG_GEDGE_CALLS | CBERG_GEDGE_IMPORTS | CBERG_GEDGE_REFERENCES;
        if (cberg_graph_edges_from(graph, nodes[i]->id, mask, edges, 256, &found) != CBERG_OK || found == 256) {
            return SIZE_MAX;
        }

        for (size_t j = 0; j < found; j++) {
            const cberg_graph_node *target = cberg_graph_node_by_id(graph, edges[j].dst);
            if (target == NULL)
                return SIZE_MAX;

            quality_edge edge = {.kind = edges[j].kind, .line = edges[j].line, .definition = target->span.start_line};
            snprintf(edge.source, sizeof edge.source, "%s", nodes[i]->path);
            snprintf(edge.target, sizeof edge.target, "%s", target->path != NULL ? target->path : "<external>");

            int included = 0, duplicate = 0;
            for (size_t k = 0; k < count; k++)
                included |= same_site(&edge, &expected[k]);
            for (size_t k = 0; k < written; k++)
                duplicate |= same_edge(&edge, &actual[k]);
            if (!included || duplicate)
                continue;
            if (written == capacity)
                return SIZE_MAX;

            actual[written++] = edge;
        }
    }

    return written;
}

static quality_score score_edges(const quality_edge *expected, size_t count, const quality_edge *actual, size_t found) {
    quality_score score = {0};
    for (size_t i = 0; i < count; i++) {
        score.sites++;
        if (strcmp(expected[i].target, "-") == 0) {
            score.negatives++;
            continue;
        }

        int matched = 0;
        for (size_t j = 0; j < found; j++)
            matched |= same_edge(&expected[i], &actual[j]);
        score.tp += matched != 0;
        score.fn += matched == 0;
    }

    score.fp = found - score.tp;
    return score;
}

static void print_score(const char *name, quality_score score) {
    double precision = score.tp + score.fp ? (double)score.tp / (score.tp + score.fp) : 1.0;
    double recall = score.tp + score.fn ? (double)score.tp / (score.tp + score.fn) : 1.0;
    double f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0.0;

    printf("{\"case\":\"%s\",\"tp\":%zu,\"fp\":%zu,\"fn\":%zu,\"sites\":%zu,"
           "\"negative_sites\":%zu,\"precision\":%.6f,\"recall\":%.6f,\"f1\":%.6f}\n",
           name,
           score.tp,
           score.fp,
           score.fn,
           score.sites,
           score.negatives,
           precision,
           recall,
           f1);
}

static int evaluate_case(const char *name, size_t allowed_misses, size_t allowed_wrong, quality_score *total) {
    char root[4096];
    snprintf(root, sizeof root, "%s/%s", CBERG_GRAPH_QUALITY_DIR, name);
    quality_corpus quality = {0};
    if (corpus_open(&quality.corpus) != 0)
        return -1;

    int error = cberg_fs_walk_files(root, index_source, &quality) != 0 || quality.error;
    if (!error)
        error = cberg_graph_resolve_imports(quality.corpus.graph, root) != CBERG_OK;

    quality_edge expected[256], actual[1024];
    size_t count = read_expected(root, expected, 256);
    if (count == 0 || count == SIZE_MAX) {
        corpus_close(&quality.corpus);
        return -1;
    }

    size_t found = !error ? collect_actual(quality.corpus.graph, expected, count, actual, 1024) : SIZE_MAX;
    if (count == 0 || found == SIZE_MAX) {
        corpus_close(&quality.corpus);
        return -1;
    }

    quality_score score = score_edges(expected, count, actual, found);
    print_score(name, score);
    total->tp += score.tp;
    total->fp += score.fp;
    total->fn += score.fn;
    total->sites += score.sites;
    total->negatives += score.negatives;

    char snapshot[] = "/tmp/cberg-quality-XXXXXX";
    int fd = mkstemp(snapshot);
    cberg_graph *loaded = NULL;
    if (fd < 0)
        error = 1;
    if (fd >= 0) {
        close(fd);
        error = cberg_graph_save(quality.corpus.graph, snapshot) != CBERG_OK ||
                cberg_graph_load(snapshot, &loaded) != CBERG_OK;
        unlink(snapshot);
    }

    if (loaded != NULL && !error) {
        size_t reloaded = collect_actual(loaded, expected, count, actual, 1024);
        quality_score after = reloaded != SIZE_MAX ? score_edges(expected, count, actual, reloaded) : (quality_score){0};
        error = reloaded == SIZE_MAX || score.tp != after.tp || score.fp != after.fp || score.fn != after.fn;
    }

    cberg_graph_free(loaded);
    corpus_close(&quality.corpus);
    if (error)
        return -1;
    return score.fp <= allowed_wrong && score.fn <= allowed_misses ? 0 : 1;
}

int main(int argc, char **argv) {
    int report_only = argc == 2 && strcmp(argv[1], "--report-only") == 0;
    const char *manifest = getenv("CBERG_GRAPH_QUALITY_CASES");
    FILE *cases = fopen(manifest != NULL ? manifest : CBERG_GRAPH_QUALITY_DIR "/cases.txt", "r");
    if (cases == NULL)
        return 1;

    char name[256];
    char row[512];
    size_t allowed_misses = 0;
    int regressions = 0;
    quality_score total = {0};
    while (fgets(row, sizeof row, cases) != NULL) {
        size_t allowed_wrong = 0;
        if (sscanf(row, "%255s %zu %zu", name, &allowed_misses, &allowed_wrong) < 2) {
            fclose(cases);
            return 1;
        }
        int result = evaluate_case(name, allowed_misses, allowed_wrong, &total);
        if (result < 0) {
            fprintf(stderr, "could not evaluate %s\n", name);
            fclose(cases);
            return 1;
        }
        regressions += result > 0;
    }

    fclose(cases);
    print_score("total", total);
    return report_only || regressions == 0 ? 0 : 1;
}
