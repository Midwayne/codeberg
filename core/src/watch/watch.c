/*
 * Cross-platform recursive filesystem watcher with debounced dirty paths.
 *
 * macOS: FSEvents (file-level, recursive)
 * Linux: inotify (recursive directory registration)
 * other: mtime polling fallback
 */
#include "codeberg/codeberg.h"

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

#include "pathutil.h"

#if defined(__APPLE__)
#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>
#elif defined(__linux__)
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/inotify.h>
#include <unistd.h>
#else
#include <unistd.h>
#endif

#define CBERG_WATCH_DEBOUNCE_MS 75
#define CBERG_DIR_INITIAL 64
#define CBERG_DIRTY_INITIAL 64

typedef struct cberg_dirty_entry {
    char *path;
    cberg_watch_kind kind;
    struct cberg_dirty_entry *next;
} cberg_dirty_entry;

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
    cberg_dirty_entry **dirty_buckets;
    size_t dirty_bucket_count;
    cberg_watch_event *pending;
    size_t pending_len;
    size_t pending_cap;
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

static uint64_t path_hash(const char *s) {
    uint64_t h = 14695981039346656037ULL;
    while (*s != '\0') {
        h ^= (unsigned char)*s++;
        h *= 1099511628211ULL;
    }
    return h;
}

static char *watcher_strdup(const char *s) {
    if (s == NULL) {
        return NULL;
    }
    size_t n = strlen(s);
    char *out = malloc(n + 1);
    if (out == NULL) {
        return NULL;
    }
    memcpy(out, s, n + 1);
    return out;
}

static bool rel_from_abs(cberg_watcher *w, const char *abs, char *rel_out, size_t rel_cap) {
    char resolved[PATH_MAX];
    if (realpath(abs, resolved) == NULL) {
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
    strcpy(rel_out, rel);
    return true;
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

static void dirty_add(cberg_watcher *w, const char *rel, cberg_watch_kind kind) {
    if (rel == NULL || rel[0] == '\0') {
        return;
    }
    if (w->dirty_bucket_count == 0) {
        w->dirty_bucket_count = 256;
        w->dirty_buckets = calloc(w->dirty_bucket_count, sizeof(cberg_dirty_entry *));
        if (w->dirty_buckets == NULL) {
            return;
        }
    }
    uint64_t h = path_hash(rel) % w->dirty_bucket_count;
    for (cberg_dirty_entry *e = w->dirty_buckets[h]; e != NULL; e = e->next) {
        if (strcmp(e->path, rel) == 0) {
            e->kind = kind_merge(e->kind, kind);
            return;
        }
    }
    cberg_dirty_entry *entry = calloc(1, sizeof(cberg_dirty_entry));
    if (entry == NULL) {
        return;
    }
    entry->path = watcher_strdup(rel);
    if (entry->path == NULL) {
        free(entry);
        return;
    }
    entry->kind = kind;
    entry->next = w->dirty_buckets[h];
    w->dirty_buckets[h] = entry;
}

/*
 * Drains the dirty-path set. When events != NULL, fills path + kind (poll).
 * When paths != NULL, fills path pointers only (dirty_paths). Clears the set.
 */
static cberg_status dirty_drain(cberg_watcher *w, cberg_watch_event *events, const char **paths, size_t cap,
                                size_t *out_count) {
    *out_count = 0;
    if (w->dirty_buckets == NULL) {
        return CBERG_OK;
    }
    for (size_t b = 0; b < w->dirty_bucket_count; b++) {
        cberg_dirty_entry *e = w->dirty_buckets[b];
        while (e != NULL) {
            cberg_dirty_entry *next = e->next;
            if (*out_count < cap) {
                if (events != NULL) {
                    events[*out_count].path = e->path;
                    events[*out_count].kind = e->kind;
                    e->path = NULL;
                } else if (paths != NULL) {
                    paths[*out_count] = e->path;
                    e->path = NULL;
                } else {
                    free(e->path);
                }
            } else {
                free(e->path);
            }
            free(e);
            e = next;
            (*out_count)++;
        }
        w->dirty_buckets[b] = NULL;
    }
    return CBERG_OK;
}

static cberg_status reserve_dirs(cberg_watcher *w, size_t want) {
    if (want <= w->dir_cap) {
        return CBERG_OK;
    }
    size_t cap = w->dir_cap == 0 ? CBERG_DIR_INITIAL : w->dir_cap * 2;
    while (cap < want) {
        cap *= 2;
    }
    cberg_watch_dir *grown = realloc(w->dirs, cap * sizeof(cberg_watch_dir));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->dirs = grown;
    w->dir_cap = cap;
    return CBERG_OK;
}

#if defined(__linux__)
static cberg_status watch_dir_linux(cberg_watcher *w, const char *abs, const char *rel);
#endif

static cberg_status walk_register(cberg_watcher *w, const char *abs, const char *rel) {
    if (reserve_dirs(w, w->dir_len + 1) != CBERG_OK) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->dirs[w->dir_len].abs_path = watcher_strdup(abs);
    w->dirs[w->dir_len].rel_path = watcher_strdup(rel);
    if (w->dirs[w->dir_len].abs_path == NULL || w->dirs[w->dir_len].rel_path == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
#if defined(__linux__)
    if (watch_dir_linux(w, abs, rel) != CBERG_OK) {
        return CBERG_ERR_IO;
    }
#endif
    w->dir_len++;

    DIR *dir = opendir(abs);
    if (dir == NULL) {
        if (rel[0] == '\0') {
            return CBERG_ERR_IO;
        }
        return CBERG_OK;
    }
    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL) {
        if (ent->d_name[0] == '.' && (ent->d_name[1] == '\0' || (ent->d_name[1] == '.' && ent->d_name[2] == '\0'))) {
            continue;
        }
        if (cberg_path_skip_dir(ent->d_name)) {
            continue;
        }
        char child_abs[PATH_MAX];
        char child_rel[PATH_MAX];
        if (!cberg_path_join(abs, ent->d_name, child_abs, sizeof(child_abs))) {
            continue;
        }
        if (!cberg_path_join(rel, ent->d_name, child_rel, sizeof(child_rel))) {
            continue;
        }
        struct stat st;
        if (stat(child_abs, &st) != 0) {
            continue;
        }
        if (S_ISDIR(st.st_mode)) {
            cberg_status st_reg = walk_register(w, child_abs, child_rel);
            if (st_reg != CBERG_OK) {
                closedir(dir);
                return st_reg;
            }
        }
    }
    closedir(dir);
    return CBERG_OK;
}

#if defined(__APPLE__)
static void fsevents_callback(ConstFSEventStreamRef stream_ref, void *client_info, size_t num_events, void *event_paths,
                              const FSEventStreamEventFlags event_flags[], const FSEventStreamEventId event_ids[]) {
    (void)stream_ref;
    (void)event_ids;
    cberg_watcher *w = client_info;
    char **paths = event_paths;
    for (size_t i = 0; i < num_events; i++) {
        FSEventStreamEventFlags flags = event_flags[i];
        if ((flags & kFSEventStreamEventFlagItemIsDir) != 0 && (flags & kFSEventStreamEventFlagItemCreated) != 0) {
            char dir_rel[PATH_MAX];
            if (rel_from_abs(w, paths[i], dir_rel, sizeof(dir_rel))) {
                walk_register(w, paths[i], dir_rel);
            }
            continue;
        }
        char rel[PATH_MAX];
        if (!rel_from_abs(w, paths[i], rel, sizeof(rel))) {
            continue;
        }
        if ((flags & kFSEventStreamEventFlagItemRemoved) != 0) {
            dirty_add(w, rel, CBERG_WATCH_DELETE);
        } else if ((flags & kFSEventStreamEventFlagItemRenamed) != 0) {
            dirty_add(w, rel, CBERG_WATCH_RENAME);
        } else if ((flags & kFSEventStreamEventFlagItemCreated) != 0) {
            dirty_add(w, rel, CBERG_WATCH_CREATE);
        } else if ((flags & kFSEventStreamEventFlagItemModified) != 0) {
            dirty_add(w, rel, CBERG_WATCH_MODIFY);
        }
    }
}
#elif defined(__linux__)
static cberg_status watch_dir_linux(cberg_watcher *w, const char *abs, const char *rel) {
    (void)rel;
    int wd = inotify_add_watch(w->inotify_fd, abs, IN_CREATE | IN_DELETE | IN_MODIFY | IN_MOVED_FROM | IN_MOVED_TO);
    if (wd < 0) {
        return CBERG_ERR_IO;
    }
    w->dirs[w->dir_len].wd = wd;
    return CBERG_OK;
}

static cberg_watch_dir *dir_by_wd(cberg_watcher *w, int wd) {
    for (size_t i = 0; i < w->dir_len; i++) {
        if (w->dirs[i].wd == wd) {
            return &w->dirs[i];
        }
    }
    return NULL;
}

static cberg_watch_kind kind_from_inotify(uint32_t mask) {
    if ((mask & (IN_DELETE | IN_MOVED_FROM)) != 0) {
        return CBERG_WATCH_DELETE;
    }
    if ((mask & (IN_CREATE | IN_MOVED_TO)) != 0) {
        return CBERG_WATCH_CREATE;
    }
    if ((mask & IN_MODIFY) != 0) {
        return CBERG_WATCH_MODIFY;
    }
    return CBERG_WATCH_MODIFY;
}
#else
static cberg_status poll_scan_file(cberg_watcher *w, const char *abs, const char *rel) {
    struct stat st;
    for (size_t i = 0; i < w->file_len; i++) {
        if (strcmp(w->files[i].rel, rel) != 0) {
            continue;
        }
        if (stat(abs, &st) != 0) {
            dirty_add(w, rel, CBERG_WATCH_DELETE);
            free(w->files[i].rel);
            w->files[i] = w->files[w->file_len - 1];
            w->file_len--;
            return CBERG_OK;
        }
        if (!S_ISREG(st.st_mode)) {
            return CBERG_OK;
        }
        if (w->files[i].mtime != st.st_mtime) {
            w->files[i].mtime = st.st_mtime;
            dirty_add(w, rel, CBERG_WATCH_MODIFY);
        }
        return CBERG_OK;
    }
    if (stat(abs, &st) != 0 || !S_ISREG(st.st_mode)) {
        return CBERG_OK;
    }
    if (w->file_len == w->file_cap) {
        size_t cap = w->file_cap == 0 ? 256 : w->file_cap * 2;
        void *grown = realloc(w->files, cap * sizeof(*w->files));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        w->files = grown;
        w->file_cap = cap;
    }
    w->files[w->file_len].rel = watcher_strdup(rel);
    w->files[w->file_len].mtime = st.st_mtime;
    if (w->files[w->file_len].rel == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->file_len++;
    dirty_add(w, rel, CBERG_WATCH_CREATE);
    return CBERG_OK;
}

static cberg_status poll_scan_tree(cberg_watcher *w, const char *abs, const char *rel) {
    DIR *dir = opendir(abs);
    if (dir == NULL) {
        return CBERG_OK;
    }
    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL) {
        if (ent->d_name[0] == '.' && (ent->d_name[1] == '\0' || (ent->d_name[1] == '.' && ent->d_name[2] == '\0'))) {
            continue;
        }
        if (cberg_path_skip_dir(ent->d_name)) {
            continue;
        }
        char child_abs[PATH_MAX];
        char child_rel[PATH_MAX];
        if (!cberg_path_join(abs, ent->d_name, child_abs, sizeof(child_abs))) {
            continue;
        }
        if (!cberg_path_join(rel, ent->d_name, child_rel, sizeof(child_rel))) {
            continue;
        }
        struct stat st;
        if (stat(child_abs, &st) != 0) {
            continue;
        }
        if (S_ISDIR(st.st_mode)) {
            poll_scan_tree(w, child_abs, child_rel);
        } else if (S_ISREG(st.st_mode)) {
            poll_scan_file(w, child_abs, child_rel);
        }
    }
    closedir(dir);
    return CBERG_OK;
}
#endif

cberg_status cberg_watcher_open(const char *root, cberg_watcher **out_watcher) {
    if (root == NULL || out_watcher == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_watcher *w = calloc(1, sizeof(cberg_watcher));
    if (w == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->root = watcher_strdup(root);
    if (w->root == NULL) {
        free(w);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    char resolved[PATH_MAX];
    if (realpath(w->root, resolved) == NULL) {
        free(w->root);
        free(w);
        return CBERG_ERR_IO;
    }
    free(w->root);
    w->root = watcher_strdup(resolved);
    if (w->root == NULL) {
        free(w);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->root_len = strlen(w->root);
    while (w->root_len > 1 && w->root[w->root_len - 1] == '/') {
        w->root[--w->root_len] = '\0';
    }

#if defined(__linux__)
    w->inotify_fd = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (w->inotify_fd < 0) {
        free(w->root);
        free(w);
        return CBERG_ERR_IO;
    }
#endif

    cberg_status st = walk_register(w, w->root, "");
    if (st != CBERG_OK) {
        cberg_watcher_close(w);
        return st;
    }

#if defined(__APPLE__)
    CFStringRef path = CFStringCreateWithCString(kCFAllocatorDefault, w->root, kCFStringEncodingUTF8);
    if (path == NULL) {
        cberg_watcher_close(w);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    CFArrayRef paths = CFArrayCreate(kCFAllocatorDefault, (const void **)&path, 1, &kCFTypeArrayCallBacks);
    FSEventStreamContext ctx = {.info = w};
    w->stream = FSEventStreamCreate(NULL, &fsevents_callback, &ctx, paths, kFSEventStreamEventIdSinceNow,
                                    (CFAbsoluteTime)CBERG_WATCH_DEBOUNCE_MS / 1000.0,
                                    kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot |
                                        kFSEventStreamCreateFlagNoDefer);
    CFRelease(paths);
    CFRelease(path);
    if (w->stream == NULL) {
        cberg_watcher_close(w);
        return CBERG_ERR_IO;
    }
    FSEventStreamSetDispatchQueue(w->stream, dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0));
    if (!FSEventStreamStart(w->stream)) {
        cberg_watcher_close(w);
        return CBERG_ERR_IO;
    }
#elif !defined(__linux__)
    poll_scan_tree(w, w->root, "");
#endif

    *out_watcher = w;
    return CBERG_OK;
}

void cberg_watcher_close(cberg_watcher *watcher) {
    if (watcher == NULL) {
        return;
    }
#if defined(__APPLE__)
    if (watcher->stream != NULL) {
        FSEventStreamStop(watcher->stream);
        FSEventStreamInvalidate(watcher->stream);
        FSEventStreamRelease(watcher->stream);
    }
#elif defined(__linux__)
    if (watcher->inotify_fd >= 0) {
        close(watcher->inotify_fd);
    }
#else
    for (size_t i = 0; i < watcher->file_len; i++) {
        free(watcher->files[i].rel);
    }
    free(watcher->files);
#endif
    for (size_t i = 0; i < watcher->dir_len; i++) {
        free(watcher->dirs[i].abs_path);
        free(watcher->dirs[i].rel_path);
    }
    free(watcher->dirs);
    if (watcher->dirty_buckets != NULL) {
        for (size_t i = 0; i < watcher->dirty_bucket_count; i++) {
            cberg_dirty_entry *e = watcher->dirty_buckets[i];
            while (e != NULL) {
                cberg_dirty_entry *next = e->next;
                free(e->path);
                free(e);
                e = next;
            }
        }
    }
    free(watcher->dirty_buckets);
    free(watcher->pending);
    free(watcher->root);
    free(watcher);
}

cberg_status cberg_watcher_poll(cberg_watcher *watcher, cberg_watch_event *events, size_t cap, size_t *out_count,
                                int timeout_ms) {
    if (watcher == NULL || out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;

#if defined(__APPLE__)
    if (timeout_ms > 0) {
        usleep((useconds_t)timeout_ms * 1000U);
    }
#elif defined(__linux__)
    if (events != NULL && cap > 0) {
        struct pollfd pfd = {.fd = watcher->inotify_fd, .events = POLLIN};
        int pr = poll(&pfd, 1, timeout_ms);
        if (pr < 0) {
            return CBERG_ERR_IO;
        }
        if (pr == 0) {
            return timeout_ms > 0 ? CBERG_ERR_TIMEOUT : CBERG_OK;
        }
        char buf[4096];
        ssize_t n = read(watcher->inotify_fd, buf, sizeof(buf));
        if (n < 0) {
            if (errno == EAGAIN) {
                return CBERG_OK;
            }
            return CBERG_ERR_IO;
        }
        char *p = buf;
        while (p < buf + n) {
            struct inotify_event *ev = (struct inotify_event *)p;
            cberg_watch_dir *dir = dir_by_wd(watcher, ev->wd);
            if (dir != NULL && ev->len > 0) {
                char rel[PATH_MAX];
                if (dir->rel_path[0] == '\0') {
                    snprintf(rel, sizeof(rel), "%s", ev->name);
                } else {
                    snprintf(rel, sizeof(rel), "%s/%s", dir->rel_path, ev->name);
                }
                if ((ev->mask & IN_ISDIR) != 0 && (ev->mask & IN_CREATE) != 0) {
                    char abs[PATH_MAX];
                    cberg_path_join(dir->abs_path, ev->name, abs, sizeof(abs));
                    walk_register(watcher, abs, rel);
                }
                dirty_add(watcher, rel, kind_from_inotify(ev->mask));
            }
            p += sizeof(struct inotify_event) + ev->len;
        }
    } else if (timeout_ms > 0) {
        struct timespec ts = {.tv_sec = timeout_ms / 1000, .tv_nsec = (long)(timeout_ms % 1000) * 1000000L};
        nanosleep(&ts, NULL);
    }
#else
    struct timespec ts = {.tv_sec = timeout_ms / 1000, .tv_nsec = (long)(timeout_ms % 1000) * 1000000L};
    if (timeout_ms > 0) {
        nanosleep(&ts, NULL);
    }
    poll_scan_tree(watcher, watcher->root, "");
#endif

    if (events == NULL || cap == 0) {
        return dirty_drain(watcher, NULL, NULL, 0, out_count);
    }

    cberg_status st = dirty_drain(watcher, events, NULL, cap, out_count);
    return st;
}

cberg_status cberg_watcher_dirty_paths(cberg_watcher *watcher, const char **paths, size_t cap, size_t *out_count) {
    if (watcher == NULL || out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return dirty_drain(watcher, NULL, paths, cap, out_count);
}
