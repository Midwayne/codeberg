#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"
#include "index_provider_harness.h"
#include "test_common.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static cberg_status open_f32_add_save_reopen_i8(const char *path, size_t dim, const float *v, uint64_t id, cberg_index **out) {
    cberg_index_config cfg;
    cberg_index_config_default(&cfg);
    cfg.quantization = CBERG_QUANT_F32;

    cberg_index *idx = NULL;
    cberg_status st = cberg_index_open(path, dim, &cfg, &idx);
    if (st != CBERG_OK || idx == NULL) {
        return st != CBERG_OK ? st : CBERG_ERR_INTERNAL;
    }
    st = cberg_index_add(idx, id, v);
    if (st != CBERG_OK) {
        cberg_index_close(idx);
        return st;
    }
    st = cberg_index_save(idx);
    cberg_index_close(idx);
    if (st != CBERG_OK) {
        return st;
    }

    cfg.quantization = CBERG_QUANT_I8;
    return cberg_index_open(path, dim, &cfg, out);
}

static int test_quant_from_name(void) {
    const char *label = "quant-name";
    int base = failures;

    cberg_index_quant quant = CBERG_QUANT_I8;
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("f32", &quant) == CBERG_OK && quant == CBERG_QUANT_F32, "f32 parses");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("i8", &quant) == CBERG_OK && quant == CBERG_QUANT_I8, "i8 parses");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("int8", &quant) == CBERG_OK && quant == CBERG_QUANT_I8, "int8 alias parses");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("F32", &quant) == CBERG_OK && quant == CBERG_QUANT_F32, "F32 case-insensitive");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("I8", &quant) == CBERG_OK && quant == CBERG_QUANT_I8, "I8 case-insensitive");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("f16", &quant) == CBERG_ERR_INVALID_ARGUMENT, "unknown name rejected");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name(NULL, &quant) == CBERG_ERR_INVALID_ARGUMENT, "NULL name rejected");
    TEST_CHECK_LABELED(label, cberg_index_quant_from_name("i8", NULL) == CBERG_ERR_INVALID_ARGUMENT, "NULL out rejected");

    return failures - base;
}

static int test_quant_reopen_across_kinds(void) {
    const char *label = "quant-reopen";
    int base = failures;

    char path[64];
    test_temp_path(path, sizeof path, "/tmp/cberg_quant_XXXXXX");

    cberg_index *idx = NULL;
    float v[4] = {1, 0, 0, 0};
    TEST_CHECK_LABELED(label, open_f32_add_save_reopen_i8(path, 4, v, 7, &idx) == CBERG_OK && idx != NULL, "reopen f32 file with i8 config");
    if (idx != NULL) {
        uint64_t ids[1];
        float scores[1];
        size_t found = 0;
        TEST_CHECK_LABELED(label, cberg_index_search(idx, v, 1, NULL, ids, scores, &found) == CBERG_OK && found >= 1 && ids[0] == 7,
                           "f32 vector survives reopen under i8 config");
        cberg_index_close(idx);
    }

    remove(path);
    return failures - base;
}

static int test_i8_orthogonal_ranking(void) {
    const char *label = "i8-ortho";
    int base = failures;

    char path[64];
    test_temp_path(path, sizeof path, "/tmp/cberg_ortho_XXXXXX");

    cberg_index_config cfg;
    cberg_index_config_default(&cfg);
    cfg.quantization = CBERG_QUANT_I8;

    cberg_index *idx = NULL;
    TEST_CHECK_LABELED(label, cberg_index_open(path, 4, &cfg, &idx) == CBERG_OK && idx != NULL, "open i8");
    if (idx != NULL) {
        float a[4] = {1, 0, 0, 0};
        float b[4] = {0, 1, 0, 0};
        TEST_CHECK_LABELED(label, cberg_index_add(idx, 1, a) == CBERG_OK, "add axis-a");
        TEST_CHECK_LABELED(label, cberg_index_add(idx, 2, b) == CBERG_OK, "add axis-b (orthogonal)");

        uint64_t ids[2];
        float scores[2];
        size_t found = 0;
        TEST_CHECK_LABELED(label, cberg_index_search(idx, a, 1, NULL, ids, scores, &found) == CBERG_OK && found >= 1 && ids[0] == 1,
                           "self-match beats orthogonal neighbor");
        cberg_index_close(idx);
    }

    remove(path);
    return failures - base;
}

static int test_quant_clear_honors_loaded_kind(void) {
    const char *label = "quant-clear";
    int base = failures;

    char path[64];
    test_temp_path(path, sizeof path, "/tmp/cberg_qclear_XXXXXX");

    cberg_index *idx = NULL;
    float v[4] = {1, 0, 0, 0};
    TEST_CHECK_LABELED(label, open_f32_add_save_reopen_i8(path, 4, v, 7, &idx) == CBERG_OK && idx != NULL, "reopen f32 file with i8 config");
    if (idx != NULL) {
        cberg_index_quant stored = CBERG_QUANT_I8;
        TEST_CHECK_LABELED(label, cberg_usearch_index_stored_quant(idx, &stored) == CBERG_OK && stored == CBERG_QUANT_F32,
                           "loaded f32 file keeps f32 scalar kind under i8 config");
        TEST_CHECK_LABELED(label, cberg_index_clear(idx) == CBERG_OK, "clear loaded f32 index");
        stored = CBERG_QUANT_I8;
        TEST_CHECK_LABELED(label, cberg_usearch_index_stored_quant(idx, &stored) == CBERG_OK && stored == CBERG_QUANT_F32,
                           "clear keeps loaded f32 scalar kind");
        TEST_CHECK_LABELED(label, cberg_index_add(idx, 9, v) == CBERG_OK, "add after clear");
        TEST_CHECK_LABELED(label, cberg_index_save(idx) == CBERG_OK, "save after clear");
        cberg_index_close(idx);
        idx = NULL;

        cberg_index_config cfg;
        cberg_index_config_default(&cfg);
        cfg.quantization = CBERG_QUANT_I8;
        TEST_CHECK_LABELED(label, cberg_index_open(path, 4, &cfg, &idx) == CBERG_OK && idx != NULL, "reopen after clear");
        if (idx != NULL) {
            uint64_t ids[1];
            float scores[1];
            size_t found = 0;
            TEST_CHECK_LABELED(label, cberg_index_search(idx, v, 1, NULL, ids, scores, &found) == CBERG_OK && found >= 1 && ids[0] == 9,
                               "vector searchable after clear kept f32 kind");
            cberg_index_close(idx);
        }
    }

    remove(path);
    return failures - base;
}

int main(void) {
    char path[64];
    test_temp_path(path, sizeof path, "/tmp/cberg_index_XXXXXX");

    int failures = index_provider_harness_run("usearch", NULL, path, 4);
    failures += index_provider_test_usearch_expansion_restore();

    cberg_index_config f32cfg;
    cberg_index_config_default(&f32cfg);
    f32cfg.quantization = CBERG_QUANT_F32;
    char f32path[64];
    test_temp_path(f32path, sizeof f32path, "/tmp/cberg_index_f32_XXXXXX");
    failures += index_provider_harness_run("usearch-f32", &f32cfg, f32path, 4);

    cberg_index_config i8cfg;
    cberg_index_config_default(&i8cfg);
    i8cfg.quantization = CBERG_QUANT_I8;
    char i8path[64];
    test_temp_path(i8path, sizeof i8path, "/tmp/cberg_index_i8_XXXXXX");
    failures += index_provider_harness_run("usearch-i8", &i8cfg, i8path, 4);

    failures += test_quant_from_name();
    failures += test_quant_reopen_across_kinds();
    failures += test_i8_orthogonal_ranking();
    failures += test_quant_clear_honors_loaded_kind();

    if (failures == 0) {
        printf("ok - index\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
