#include "watch_internal.h"

#include "grow.h"
#include "pathutil.h"
#include "strutil.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

void watch_note_error(cberg_watcher *w, cberg_status status) {
    if (w != NULL && status != CBERG_OK && w->error == CBERG_OK) {
        w->error = status;
    }
}

static cberg_watch_kind kind_merge(cberg_watch_kind existing, cberg_watch_kind incoming) {
    if (incoming == CBERG_WATCH_DELETE) {
        return CBERG_WATCH_DELETE;
    }
    if (existing == CBERG_WATCH_DELETE && incoming == CBERG_WATCH_CREATE) {
        return CBERG_WATCH_CREATE;
    }
    if (existing == CBERG_WATCH_DELETE) {
        return CBERG_WATCH_DELETE;
    }
    return incoming;
}

static bool dirty_get_kind(const cberg_strmap *dirty, const char *rel, cberg_watch_kind *out_kind) {
    uint64_t value = 0;
    if (!cberg_strmap_get(dirty, rel, &value)) {
        return false;
    }
    *out_kind = (cberg_watch_kind)value;
    return true;
}

static cberg_status dirty_set_kind(cberg_strmap *dirty, const char *rel, cberg_watch_kind kind) {
    return cberg_strmap_set(dirty, rel, (uint64_t)kind);
}

cberg_status watch_dirty_add(cberg_watcher *w, const char *rel, cberg_watch_kind kind) {
    if (w == NULL || rel == NULL || rel[0] == '\0') {
        return CBERG_OK;
    }
    if (w->dirty == NULL) {
        w->dirty = cberg_strmap_new(256);
        if (w->dirty == NULL) {
            watch_note_error(w, CBERG_ERR_OUT_OF_MEMORY);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    cberg_watch_kind existing = CBERG_WATCH_MODIFY;
    cberg_status st;
    if (dirty_get_kind(w->dirty, rel, &existing)) {
        st = dirty_set_kind(w->dirty, rel, kind_merge(existing, kind));
    } else {
        st = dirty_set_kind(w->dirty, rel, kind);
    }
    if (st != CBERG_OK) {
        watch_note_error(w, st);
    }
    return st;
}

typedef struct {
    char *path;
    uint64_t kind;
} dirty_staged_item;

typedef struct {
    dirty_staged_item *items;
    size_t len;
    size_t cap;
    cberg_status status;
} dirty_staging;

static void dirty_staging_free(dirty_staging *staging) {
    if (staging == NULL) {
        return;
    }
    for (size_t i = 0; i < staging->len; i++) {
        free(staging->items[i].path);
    }
    free(staging->items);
    staging->items = NULL;
    staging->len = 0;
    staging->cap = 0;
}

static void dirty_stage_visit(const char *key, uint64_t value, void *ctx_v) {
    dirty_staging *staging = ctx_v;
    if (staging->status != CBERG_OK) {
        return;
    }
    size_t next_cap = cberg_grow_cap(staging->cap, staging->len + 1, 16);
    if (next_cap != staging->cap) {
        dirty_staged_item *grown = realloc(staging->items, next_cap * sizeof(dirty_staged_item));
        if (grown == NULL) {
            staging->status = CBERG_ERR_OUT_OF_MEMORY;
            return;
        }
        staging->items = grown;
        staging->cap = next_cap;
    }
    char *path = cberg_strdup(key);
    if (path == NULL) {
        staging->status = CBERG_ERR_OUT_OF_MEMORY;
        return;
    }
    staging->items[staging->len++] = (dirty_staged_item){.path = path, .kind = value};
}

cberg_status watch_dirty_drain(cberg_watcher *w, cberg_watch_event *events, const char **paths, size_t cap,
                               size_t *out_count) {
    if (out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;
    if (w == NULL || w->dirty == NULL) {
        return CBERG_OK;
    }

    bool transfer = events != NULL || paths != NULL;
    dirty_staging staging = {0};
    cberg_strmap_visit(w->dirty, dirty_stage_visit, &staging);
    if (staging.status != CBERG_OK) {
        dirty_staging_free(&staging);
        watch_note_error(w, staging.status);
        return staging.status;
    }

    size_t total = staging.len;
    if (!transfer) {
        *out_count = total;
        cberg_strmap_clear(w->dirty);
        dirty_staging_free(&staging);
        return CBERG_OK;
    }

    if (total > cap) {
        dirty_staging_free(&staging);
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    for (size_t i = 0; i < total; i++) {
        if (events != NULL) {
            events[i].path = staging.items[i].path;
            events[i].kind = (cberg_watch_kind)staging.items[i].kind;
        } else {
            paths[i] = staging.items[i].path;
        }
        staging.items[i].path = NULL;
    }
    *out_count = total;
    dirty_staging_free(&staging);
    cberg_strmap_clear(w->dirty);
    return CBERG_OK;
}

cberg_status watch_reserve_dirs(cberg_watcher *w, size_t want) {
    size_t cap = cberg_grow_cap(w->dir_cap, want, CBERG_DIR_INITIAL);
    if (cap == w->dir_cap) {
        return CBERG_OK;
    }
    cberg_watch_dir *grown = realloc(w->dirs, cap * sizeof(cberg_watch_dir));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->dirs = grown;
    w->dir_cap = cap;
    return CBERG_OK;
}

bool watch_rel_from_abs(cberg_watcher *w, const char *abs, char *rel_out, size_t rel_cap) {
    char resolved[PATH_MAX];
    if (cberg_path_resolve(abs, resolved, sizeof(resolved)) != CBERG_OK) {
        return false;
    }
    if (strncmp(resolved, w->root, w->root_len) != 0) {
        return false;
    }
    const char *rel = resolved + w->root_len;
    if (rel[0] == '/') {
        rel++;
    }
    if (strlen(rel) + 1 > rel_cap) {
        return false;
    }
    memcpy(rel_out, rel, strlen(rel) + 1);
    return true;
}

cberg_status cberg_watcher_open(const char *root, cberg_watcher **out_watcher) {
    if (root == NULL || out_watcher == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_watcher *w = calloc(1, sizeof(cberg_watcher));
    if (w == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    char resolved[PATH_MAX];
    cberg_status st = cberg_path_resolve(root, resolved, sizeof(resolved));
    if (st != CBERG_OK) {
        free(w);
        return st;
    }
    w->root = cberg_strdup(resolved);
    if (w->root == NULL) {
        free(w);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->root_len = strlen(w->root);
    while (w->root_len > 1 && w->root[w->root_len - 1] == '/') {
        w->root[--w->root_len] = '\0';
    }

#if defined(__linux__)
    w->inotify_fd = -1;
    st = watch_platform_begin(w);
    if (st != CBERG_OK) {
        cberg_watcher_close(w);
        return st;
    }
#endif

    st = watch_walk_register(w, w->root, "");
    if (st != CBERG_OK) {
        cberg_watcher_close(w);
        return st;
    }

    st = watch_platform_finish(w);
    if (st != CBERG_OK) {
        cberg_watcher_close(w);
        return st;
    }

    *out_watcher = w;
    return CBERG_OK;
}

void cberg_watcher_close(cberg_watcher *watcher) {
    if (watcher == NULL) {
        return;
    }
    watch_platform_stop(watcher);
    watch_platform_destroy(watcher);

    for (size_t i = 0; i < watcher->dir_len; i++) {
        free(watcher->dirs[i].abs_path);
        free(watcher->dirs[i].rel_path);
    }
    free(watcher->dirs);
    cberg_strmap_free(watcher->dirty);
    free(watcher->root);
    free(watcher);
}

cberg_status watcher_check_error(cberg_watcher *watcher) {
    if (watcher == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (watcher->error != CBERG_OK) {
        return watcher->error;
    }
    return CBERG_OK;
}

cberg_status cberg_watcher_poll(cberg_watcher *watcher, cberg_watch_event *events, size_t cap, size_t *out_count,
                                int timeout_ms) {
    if (out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = watcher_check_error(watcher);
    if (st != CBERG_OK) {
        return st;
    }
    *out_count = 0;

    st = watch_platform_wait(watcher, timeout_ms);
    if (st != CBERG_OK && st != CBERG_ERR_TIMEOUT) {
        return st;
    }

    st = watcher_check_error(watcher);
    if (st != CBERG_OK) {
        return st;
    }

    return watch_dirty_drain(watcher, events, NULL, cap, out_count);
}

cberg_status cberg_watcher_dirty_paths(cberg_watcher *watcher, const char **paths, size_t cap, size_t *out_count) {
    if (out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = watcher_check_error(watcher);
    if (st != CBERG_OK) {
        return st;
    }
    return watch_dirty_drain(watcher, NULL, paths, cap, out_count);
}
