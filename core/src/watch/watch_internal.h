#ifndef CBERG_WATCH_INTERNAL_H
#define CBERG_WATCH_INTERNAL_H

#include "codeberg/codeberg.h"

#include <stddef.h>
#include <stdbool.h>

#include "strmap.h"

#if defined(__APPLE__)
#include <CoreServices/CoreServices.h>
#elif defined(__linux__)
/* inotify fd stored in watcher */
#else
#include <time.h>
#endif

#define CBERG_WATCH_DEBOUNCE_MS 75
#define CBERG_DIR_INITIAL 64

typedef struct {
    char *abs_path;
    char *rel_path;
#if defined(__linux__)
    int wd;
#endif
} cberg_watch_dir;

struct cberg_watcher {
    char *root;
    size_t root_len;
    cberg_watch_dir *dirs;
    size_t dir_len;
    size_t dir_cap;
    cberg_strmap *dirty;
    cberg_status error;
#if defined(__APPLE__)
    FSEventStreamRef stream;
#elif defined(__linux__)
    int inotify_fd;
#else
    struct {
        char *rel;
        time_t mtime;
    } *files;
    size_t file_len;
    size_t file_cap;
#endif
};

cberg_status watch_reserve_dirs(cberg_watcher *w, size_t want);
cberg_status watch_dirty_add(cberg_watcher *w, const char *rel, cberg_watch_kind kind);
cberg_status watch_dirty_drain(cberg_watcher *w, cberg_watch_event *events, const char **paths, size_t cap,
                               size_t *out_count);
bool watch_rel_from_abs(cberg_watcher *w, const char *abs, char *rel_out, size_t rel_cap);
void watch_note_error(cberg_watcher *w, cberg_status status);
cberg_status watcher_check_error(cberg_watcher *w);

cberg_status watch_walk_register(cberg_watcher *w, const char *abs, const char *rel);

cberg_status watch_platform_begin(cberg_watcher *w);
cberg_status watch_platform_finish(cberg_watcher *w);
cberg_status watch_platform_register_dir(cberg_watcher *w, const char *abs, const char *rel);

void watch_platform_stop(cberg_watcher *w);
void watch_platform_destroy(cberg_watcher *w);
cberg_status watch_platform_wait(cberg_watcher *w, int timeout_ms);

#endif /* CBERG_WATCH_INTERNAL_H */
