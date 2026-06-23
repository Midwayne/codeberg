#include "watch_internal.h"

#include "pathutil.h"
#include "strutil.h"
#include "walk_policy.h"

bool watch_skip_dir(const char *name, void *ctx) {
    (void)ctx;
    return cberg_walk_skip_dir(name) != 0;
}

static void watch_dir_clear_slot(cberg_watch_dir *dir) {
    free(dir->abs_path);
    free(dir->rel_path);
    dir->abs_path = NULL;
    dir->rel_path = NULL;
}

static cberg_status walk_register_entry(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    cberg_watcher *w = ctx;
    if (kind == CBERG_FS_FILE) {
        return CBERG_OK;
    }

    cberg_status st = watch_reserve_dirs(w, w->dir_len + 1);
    if (st != CBERG_OK) {
        return st;
    }
    cberg_watch_dir *slot = &w->dirs[w->dir_len];
    slot->abs_path = cberg_strdup(abs);
    slot->rel_path = cberg_strdup(rel);
    if (slot->abs_path == NULL || slot->rel_path == NULL) {
        watch_dir_clear_slot(slot);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    st = watch_platform_register_dir(w, abs, rel);
    if (st != CBERG_OK) {
        watch_dir_clear_slot(slot);
        return st;
    }

    w->dir_len++;
    return CBERG_OK;
}

cberg_status watch_walk_register(cberg_watcher *w, const char *abs, const char *rel) {
    pthread_mutex_lock(&w->mu);
    cberg_status st = cberg_fs_walk(abs, rel, walk_register_entry, w, watch_skip_dir, NULL);
    pthread_mutex_unlock(&w->mu);
    return st;
}
