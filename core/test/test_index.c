#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"
#include "index_provider_harness.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void temp_index_path(char *path, size_t cap, const char *template) {
    snprintf(path, cap, "%s", template);
    int fd = mkstemp(path);
    if (fd >= 0) {
        close(fd);
        remove(path);
    }
}

static int test_quant_from_name(void) {
    int failures = 0;
#define QCHECK(cond, msg)                                                          \
    do {                                                                           \
        if (!(cond)) {                                                             \
            fprintf(stderr, "FAIL [quant-name]: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                            \
        }                                                                          \
    } while (0)

    cberg_index_quant quant = CBERG_QUANT_I8;
    QCHECK(cberg_index_quant_from_name("f32", &quant) == CBERG_OK && quant == CBERG_QUANT_F32, "f32 parses");
    QCHECK(cberg_index_quant_from_name("i8", &quant) == CBERG_OK && quant == CBERG_QUANT_I8, "i8 parses");
    QCHECK(cberg_index_quant_from_name("int8", &quant) == CBERG_OK && quant == CBERG_QUANT_I8, "int8 alias parses");
    QCHECK(cberg_index_quant_from_name("f16", &quant) == CBERG_ERR_INVALID_ARGUMENT, "unknown name rejected");
    QCHECK(cberg_index_quant_from_name(NULL, &quant) == CBERG_ERR_INVALID_ARGUMENT, "NULL name rejected");
    QCHECK(cberg_index_quant_from_name("i8", NULL) == CBERG_ERR_INVALID_ARGUMENT, "NULL out rejected");

    return failures;
#undef QCHECK
}

/* An f32-saved index stays loadable when the config asks for i8: usearch file
 * metadata wins on load, so flipping the quantization knob must not corrupt
 * existing indexes (they migrate on the next rebuild). */
static int test_quant_reopen_across_kinds(void) {
    int failures = 0;
#define MCHECK(cond, msg)                                                          \
    do {                                                                           \
        if (!(cond)) {                                                             \
            fprintf(stderr, "FAIL [quant-reopen]: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                            \
        }                                                                          \
    } while (0)

    char path[64];
    temp_index_path(path, sizeof path, "/tmp/cberg_quant_XXXXXX");

    cberg_index_config cfg;
    cberg_index_config_default(&cfg);
    cfg.quantization = CBERG_QUANT_F32;

    cberg_index *idx = NULL;
    MCHECK(cberg_index_open(path, 4, &cfg, &idx) == CBERG_OK && idx != NULL, "open f32");
    if (idx != NULL) {
        float v[4] = {1, 0, 0, 0};
        MCHECK(cberg_index_add(idx, 7, v) == CBERG_OK, "add under f32");
        MCHECK(cberg_index_save(idx) == CBERG_OK, "save f32 file");
        cberg_index_close(idx);
        idx = NULL;

        cfg.quantization = CBERG_QUANT_I8;
        MCHECK(cberg_index_open(path, 4, &cfg, &idx) == CBERG_OK && idx != NULL, "reopen f32 file with i8 config");
        if (idx != NULL) {
            uint64_t ids[1];
            float scores[1];
            size_t found = 0;
            MCHECK(cberg_index_search(idx, v, 1, NULL, ids, scores, &found) == CBERG_OK && found >= 1 && ids[0] == 7,
                   "f32 vector survives reopen under i8 config");
            cberg_index_close(idx);
        }
    }

    remove(path);
    return failures;
#undef MCHECK
}

int main(void) {
    char path[64];
    temp_index_path(path, sizeof path, "/tmp/cberg_index_XXXXXX");

    int failures = index_provider_harness_run("usearch", NULL, path, 4);
    failures += index_provider_test_usearch_expansion_restore();

    cberg_index_config f32cfg;
    cberg_index_config_default(&f32cfg);
    f32cfg.quantization = CBERG_QUANT_F32;
    char f32path[64];
    temp_index_path(f32path, sizeof f32path, "/tmp/cberg_index_f32_XXXXXX");
    failures += index_provider_harness_run("usearch-f32", &f32cfg, f32path, 4);

    cberg_index_config i8cfg;
    cberg_index_config_default(&i8cfg);
    i8cfg.quantization = CBERG_QUANT_I8;
    char i8path[64];
    temp_index_path(i8path, sizeof i8path, "/tmp/cberg_index_i8_XXXXXX");
    failures += index_provider_harness_run("usearch-i8", &i8cfg, i8path, 4);

    failures += test_quant_from_name();
    failures += test_quant_reopen_across_kinds();

    if (failures == 0) {
        printf("ok - index\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
