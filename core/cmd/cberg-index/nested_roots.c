/*
 * Nested roots: when one configured root lies inside another (a project
 * directory and the repositories under it), the outer root leaves the inner
 * one out so every file is indexed, watched, and linked under exactly one root.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "indexer_internal.h"
#include "strutil.h"

/* `inner` relative to `outer` when it lies strictly inside it, else NULL. */
static const char *nested_rel(const char *outer, const char *inner) {
    size_t len = strlen(outer);

    while (len > 1 && outer[len - 1] == '/') {
        len--;
    }

    if (strncmp(outer, inner, len) != 0 || inner[len] != '/' || inner[len + 1] == '\0') {
        return NULL;
    }

    return inner + len + 1;
}

static cberg_status repo_add_exclusion(cberg_repo *r, const char *rel) {
    char **grown = realloc(r->excluded_dirs, (r->exclusions.len + 1) * sizeof(*grown));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    r->excluded_dirs = grown;

    grown[r->exclusions.len] = cberg_strdup(rel);
    if (grown[r->exclusions.len] == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    r->exclusions.len++;
    r->exclusions.dirs = (const char *const *)r->excluded_dirs;
    return CBERG_OK;
}

cberg_status engine_link_nested_roots(cberg_engine *eng) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *outer = eng->repos[i];

        for (size_t j = 0; j < eng->repos_len; j++) {
            const char *rel = i != j ? nested_rel(outer->root, eng->repos[j]->root) : NULL;
            if (rel == NULL) {
                continue;
            }

            cberg_status st = repo_add_exclusion(outer, rel);
            if (st != CBERG_OK) {
                return st;
            }
            fprintf(stderr, "cberg-index[%s]: '%s' is indexed as its own root\n", outer->key, rel);
        }
    }

    return CBERG_OK;
}

cberg_status engine_open_watchers(cberg_engine *eng) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];

        cberg_status st = cberg_watcher_open_ex(r->root, &r->exclusions, &r->watcher);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: failed to watch '%s': %s\n", r->key, r->root, cberg_status_str(st));
            return st;
        }
    }

    return CBERG_OK;
}

void repo_free_exclusions(cberg_repo *r) {
    for (size_t i = 0; i < r->exclusions.len; i++) {
        free(r->excluded_dirs[i]);
    }

    free(r->excluded_dirs);
    r->excluded_dirs = NULL;
    r->exclusions = (cberg_exclusions){0};
}
