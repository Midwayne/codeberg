#include "watch_internal.h"

#include "pathutil.h"

#include <limits.h>
#include <unistd.h>

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>

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
            if (watch_rel_from_abs(w, paths[i], dir_rel, sizeof(dir_rel))) {
                cberg_status st = watch_walk_register(w, paths[i], dir_rel);
                watch_note_error(w, st);
            }
            continue;
        }
        char rel[PATH_MAX];
        if (!watch_rel_from_abs(w, paths[i], rel, sizeof(rel))) {
            continue;
        }
        cberg_watch_kind kind = CBERG_WATCH_MODIFY;
        if ((flags & kFSEventStreamEventFlagItemRemoved) != 0) {
            kind = CBERG_WATCH_DELETE;
        } else if ((flags & kFSEventStreamEventFlagItemRenamed) != 0) {
            kind = CBERG_WATCH_RENAME;
        } else if ((flags & kFSEventStreamEventFlagItemCreated) != 0) {
            kind = CBERG_WATCH_CREATE;
        } else if ((flags & kFSEventStreamEventFlagItemModified) != 0) {
            kind = CBERG_WATCH_MODIFY;
        }
        watch_note_error(w, watch_dirty_add(w, rel, kind));
    }
}

cberg_status watch_platform_begin(cberg_watcher *w) {
    (void)w;
    return CBERG_OK;
}

cberg_status watch_platform_finish(cberg_watcher *w) {
    CFStringRef path = CFStringCreateWithCString(kCFAllocatorDefault, w->root, kCFStringEncodingUTF8);
    if (path == NULL) {
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
        return CBERG_ERR_IO;
    }
    FSEventStreamSetDispatchQueue(w->stream, dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0));
    if (!FSEventStreamStart(w->stream)) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

void watch_platform_stop(cberg_watcher *w) {
    if (w->stream != NULL) {
        FSEventStreamStop(w->stream);
        FSEventStreamInvalidate(w->stream);
    }
}

void watch_platform_destroy(cberg_watcher *w) {
    if (w->stream != NULL) {
        FSEventStreamRelease(w->stream);
        w->stream = NULL;
    }
}

cberg_status watch_platform_register_dir(cberg_watcher *w, const char *abs, const char *rel) {
    (void)w;
    (void)abs;
    (void)rel;
    return CBERG_OK;
}

cberg_status watch_platform_wait(cberg_watcher *w, int timeout_ms) {
    (void)w;
    if (timeout_ms > 0) {
        usleep((useconds_t)timeout_ms * 1000U);
    }
    return CBERG_OK;
}
