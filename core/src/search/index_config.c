#include "codeberg/codeberg.h"

void cberg_index_config_default(cberg_index_config *config) {
    if (config == NULL) {
        return;
    }
    config->provider = CBERG_INDEX_USEARCH;
    config->vectordb_url = NULL;
    config->vectordb_api_key = NULL;
    config->postgres_url = NULL;
    config->connectivity = 16;
    config->expansion_add = 128;
    config->expansion_search = 64;
}
