#include "codeberg/codeberg.h"

#include <stdio.h>
#include <string.h>

int main(void) {
    const char *version = cberg_version();
    printf("codeberg %s\n", version);
    if (!version || version[0] != 'v') {
        fprintf(stderr, "FAIL: version should match VERSION file (vX.Y.Z), got %s\n",
                version ? version : "(null)");
        return 1;
    }
    if (strcmp(cberg_config_index_root_env_name(), "CODEBERG_ROOT") != 0) {
        fprintf(stderr, "FAIL: index root env name\n");
        return 1;
    }
    if (cberg_config_index_root() != NULL) {
        fprintf(stderr, "FAIL: index root should be unset in test env\n");
        return 1;
    }
    char buf[64];
    if (cberg_config_resolve_index_root(buf, sizeof(buf)) != CBERG_ERR_NOT_FOUND) {
        fprintf(stderr, "FAIL: resolve without env\n");
        return 1;
    }
    return 0;
}
