#include "watch_internal.h"

#include "grow.h"
#include "pathutil.h"
#include "strutil.h"

#include <dirent.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>

static cberg_status poll_scan_file(cberg_watcher *w, const char *abs, const char *rel) {
    struct stat st;
    for (size_t i = 0; i < w->file_len; i++) {
        if (strcmp(w->files[i].rel, rel) != 0) {
            continue;
        }
        if (stat(abs, &st) != 0) {
            watch_note_error(w, watch_dirty_add(w, rel, CBERG_WATCH_DELETE));
            free(w->files[i].rel);
            w->files[i] = w->files[w->file_len - 1];
            w->file_len--;
            return watcher_check_error(w);
        }
        if (!S_ISREG(st.st_mode)) {
            return CBERG_OK;
        }
        if (w->files[i].mtime != st.st_mtime) {
            w->files[i].mtime = st.st_mtime;
            watch_note_error(w, watch_dirty_add(w, rel, CBERG_WATCH_MODIFY));
        }
        return watcher_check_error(w);
    }
    if (stat(abs, &st) != 0 || !S_ISREG(st.st_mode)) {
        return CBERG_OK;
    }
    size_t cap = cberg_grow_cap(w->file_cap, w->file_len + 1, 256);
    if (cap != w->file_cap) {
        void *grown = realloc(w->files, cap * sizeof(*w->files));
        if (grown == NULL) {
            watch_note_error(w, CBERG_ERR_OUT_OF_MEMORY);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        w->files = grown;
        w->file_cap = cap;
    }
    w->files[w->file_len].rel = cberg_strdup(rel);
    w->files[w->file_len].mtime = st.st_mtime;
    if (w->files[w->file_len].rel == NULL) {
        watch_note_error(w, CBERG_ERR_OUT_OF_MEMORY);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->file_len++;
    watch_note_error(w, watch_dirty_add(w, rel, CBERG_WATCH_CREATE));
    return watcher_check_error(w);
}

static cberg_status poll_walk_entry(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    if (kind == CBERG_FS_DIR) {
        return CBERG_OK;
    }
    return poll_scan_file(ctx, abs, rel);
}

cberg_status watch_platform_register_dir(cberg_watcher *w, const char *abs, const char *rel) {
    (void)w;
    (void)abs;
    (void)rel;
    return CBERG_OK;
}

cberg_status watch_platform_begin(cberg_watcher *w) {
    (void)w;
    return CBERG_OK;
}

cberg_status watch_platform_finish(cberg_watcher *w) {
    return cberg_fs_walk(w->root, "", poll_walk_entry, w, watch_skip_dir, NULL);
}

void watch_platform_stop(cberg_watcher *w) {
    (void)w;
}

void watch_platform_destroy(cberg_watcher *w) {
    for (size_t i = 0; i < w->file_len; i++) {
        free(w->files[i].rel);
    }
    free(w->files);
    w->files = NULL;
    w->file_len = 0;
    w->file_cap = 0;
}

cberg_status watch_platform_wait(cberg_watcher *w, int timeout_ms) {
    if (timeout_ms > 0) {
        struct timespec ts = {.tv_sec = timeout_ms / 1000, .tv_nsec = (long)(timeout_ms % 1000) * 1000000L};
        nanosleep(&ts, NULL);
    }
    return cberg_fs_walk(w->root, "", poll_walk_entry, w, watch_skip_dir, NULL);
}
