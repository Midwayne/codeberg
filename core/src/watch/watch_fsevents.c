#include "watch_internal.h"

#include "pathutil.h"

#include <limits.h>
#include <unistd.h>

#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>

cberg_watch_kind watch_kind_from_fsevents(FSEventStreamEventFlags flags) {
    if ((flags & kFSEventStreamEventFlagItemRemoved) != 0) {
        return CBERG_WATCH_DELETE;
    }
    if ((flags & kFSEventStreamEventFlagItemRenamed) != 0) {
        return CBERG_WATCH_RENAME;
    }
    if ((flags & kFSEventStreamEventFlagItemCreated) != 0) {
        return CBERG_WATCH_CREATE;
    }
    if ((flags & kFSEventStreamEventFlagItemModified) != 0) {
        return CBERG_WATCH_MODIFY;
    }
    return CBERG_WATCH_MODIFY;
}

static void fsevents_callback(ConstFSEventStreamRef stream_ref, void *client_info, size_t num_events, void *event_paths, const FSEventStreamEventFlags event_flags[], const FSEventStreamEventId event_ids[]) {
    (void)stream_ref;
    (void)event_ids;
    cberg_watcher *w = client_info;
    char **paths = event_paths;
    for (size_t i = 0; i < num_events; i++) {
        FSEventStreamEventFlags flags = event_flags[i];
        if ((flags & kFSEventStreamEventFlagItemIsDir) != 0 && (flags & kFSEventStreamEventFlagItemCreated) != 0) {
            char dir_rel[PATH_MAX];
            if (watch_rel_from_abs(w, paths[i], dir_rel, sizeof(dir_rel))) {
                watch_note_created_subdir(w, paths[i], dir_rel);
            }
            continue;
        }
        char rel[PATH_MAX];
        if (!watch_rel_from_abs(w, paths[i], rel, sizeof(rel))) {
            continue;
        }
        watch_note_error(w, watch_dirty_add(w, rel, watch_kind_from_fsevents(flags)));
    }
}

cberg_status watch_platform_begin(cberg_watcher *w) {
    (void)w;
    return CBERG_OK;
}

cberg_status watch_platform_finish(cberg_watcher *w) {
    w->event_queue = dispatch_queue_create("codeberg.watch", DISPATCH_QUEUE_SERIAL);
    if (w->event_queue == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    CFStringRef path = CFStringCreateWithCString(kCFAllocatorDefault, w->root, kCFStringEncodingUTF8);
    if (path == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    CFArrayRef paths = CFArrayCreate(kCFAllocatorDefault, (const void **)&path, 1, &kCFTypeArrayCallBacks);
    FSEventStreamContext ctx = {.info = w};
    w->stream = FSEventStreamCreate(NULL, &fsevents_callback, &ctx, paths, kFSEventStreamEventIdSinceNow, (CFAbsoluteTime)CBERG_WATCH_DEBOUNCE_MS / 1000.0, kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer);
    CFRelease(paths);
    CFRelease(path);
    if (w->stream == NULL) {
        return CBERG_ERR_IO;
    }
    FSEventStreamSetDispatchQueue(w->stream, w->event_queue);
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
    if (w->event_queue != NULL) {
        dispatch_release(w->event_queue);
        w->event_queue = NULL;
    }
}

cberg_status watch_platform_register_dir(cberg_watcher *w, const char *abs, const char *rel) {
    (void)w;
    (void)abs;
    (void)rel;
    return CBERG_OK;
}

cberg_status watch_platform_wait(cberg_watcher *w, int timeout_ms) {
    if (timeout_ms > 0) {
        usleep((useconds_t)timeout_ms * 1000U);
    }
    if (w->stream != NULL) {
        FSEventStreamFlushSync(w->stream);
    }
    return CBERG_OK;
}
