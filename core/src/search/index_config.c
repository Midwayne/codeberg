#include "codeberg/codeberg.h"

void cberg_index_config_default(cberg_index_config *config) {
    if (config == NULL) {
        return;
    }
    config->connectivity = 16;
    config->expansion_add = 128;
    config->expansion_search = 64;
}
