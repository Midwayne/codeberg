#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"
#include "index_provider_harness.h"
#include "test_common.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void test_provider_names(void) {
    cberg_index_provider p;
    CHECK(cberg_index_provider_from_name("usearch", &p) == CBERG_OK && p == CBERG_INDEX_USEARCH, "parse usearch");
    CHECK(cberg_index_provider_from_name("qdrant", &p) == CBERG_OK && p == CBERG_INDEX_QDRANT, "parse qdrant");
    CHECK(cberg_index_provider_from_name("pgvector", &p) == CBERG_OK && p == CBERG_INDEX_PGVECTOR, "parse pgvector");
    CHECK(cberg_index_provider_from_name("postgres", &p) == CBERG_OK && p == CBERG_INDEX_PGVECTOR, "parse postgres alias");
    CHECK(cberg_index_provider_from_name("unknown", &p) == CBERG_ERR_INVALID_ARGUMENT, "reject unknown backend");
    CHECK(strcmp(cberg_status_str(CBERG_ERR_CORRUPT), "corrupt or incompatible index") == 0, "corrupt status string");
}

static int run_backend(const char *name, const cberg_index_config *cfg, size_t dim) {
    char label[64];
    snprintf(label, sizeof label, "%s-%zu", name, dim);
    char *path = test_unique_path(name);
    if (path == NULL) {
        fprintf(stderr, "FAIL: out of memory for path\n");
        return 1;
    }
    int n = index_provider_harness_run(label, cfg, path, dim);
    free(path);
    return n;
}

static int run_backend_dims(const char *name, const cberg_index_config *cfg) {
    int n = run_backend(name, cfg, 4);
    n += run_backend(name, cfg, 768);
    return n;
}

int main(void) {
    test_provider_names();

    cberg_index_config usearch_cfg;
    cberg_index_config_default(&usearch_cfg);
    failures += index_provider_test_usearch_expansion_restore();
    failures += run_backend_dims("usearch", &usearch_cfg);

    const char *qdrant_url = getenv("CBERG_TEST_QDRANT_URL");
    if (qdrant_url != NULL && qdrant_url[0] != '\0') {
        cberg_index_config qdrant_cfg;
        cberg_index_config_default(&qdrant_cfg);
        qdrant_cfg.provider = CBERG_INDEX_QDRANT;
        qdrant_cfg.vectordb_url = qdrant_url;
        qdrant_cfg.vectordb_api_key = getenv("CBERG_TEST_QDRANT_API_KEY");
        failures += run_backend_dims("qdrant", &qdrant_cfg);
    } else {
        printf("skip - qdrant (set CBERG_TEST_QDRANT_URL)\n");
    }

    const char *postgres_url = getenv("CBERG_TEST_POSTGRES_URL");
    if (postgres_url != NULL && postgres_url[0] != '\0') {
        cberg_index_config pg_cfg;
        cberg_index_config_default(&pg_cfg);
        pg_cfg.provider = CBERG_INDEX_PGVECTOR;
        pg_cfg.postgres_url = postgres_url;
        failures += run_backend_dims("pgvector", &pg_cfg);
    } else {
        printf("skip - pgvector (set CBERG_TEST_POSTGRES_URL)\n");
    }

    if (failures == 0) {
        printf("ok - index providers\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
