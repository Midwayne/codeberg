#include "watch_internal.h"

#include "pathutil.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <sys/inotify.h>
#include <time.h>

cberg_status watch_platform_finish(cberg_watcher *w) {
    (void)w;
    return CBERG_OK;
}

cberg_status watch_platform_register_dir(cberg_watcher *w, const char *abs, const char *rel) {
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

cberg_watch_kind watch_kind_from_inotify(uint32_t mask) {
    if ((mask & (IN_MOVED_FROM | IN_MOVED_TO)) != 0) {
        return CBERG_WATCH_RENAME;
    }
    if ((mask & IN_DELETE) != 0) {
        return CBERG_WATCH_DELETE;
    }
    if ((mask & IN_CREATE) != 0) {
        return CBERG_WATCH_CREATE;
    }
    if ((mask & IN_MODIFY) != 0) {
        return CBERG_WATCH_MODIFY;
    }
    return CBERG_WATCH_MODIFY;
}

cberg_status watch_platform_begin(cberg_watcher *w) {
    w->inotify_fd = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (w->inotify_fd < 0) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

void watch_platform_stop(cberg_watcher *w) {
    (void)w;
}

void watch_platform_destroy(cberg_watcher *w) {
    if (w->inotify_fd >= 0) {
        close(w->inotify_fd);
        w->inotify_fd = -1;
    }
}

cberg_status watch_platform_wait(cberg_watcher *w, int timeout_ms) {
    if (timeout_ms == 0) {
        struct pollfd pfd = {.fd = w->inotify_fd, .events = POLLIN};
        int pr = poll(&pfd, 1, 0);
        if (pr < 0) {
            return CBERG_ERR_IO;
        }
        if (pr == 0) {
            return CBERG_OK;
        }
    } else {
        struct pollfd pfd = {.fd = w->inotify_fd, .events = POLLIN};
        int pr = poll(&pfd, 1, timeout_ms);
        if (pr < 0) {
            return CBERG_ERR_IO;
        }
        if (pr == 0) {
            return CBERG_ERR_TIMEOUT;
        }
    }

    char buf[4096];
    for (;;) {
        ssize_t n = read(w->inotify_fd, buf, sizeof(buf));
        if (n < 0) {
            if (errno == EAGAIN) {
                return CBERG_OK;
            }
            return CBERG_ERR_IO;
        }
        if (n == 0) {
            return CBERG_OK;
        }

        char *p = buf;
        while (p < buf + n) {
            struct inotify_event *ev = (struct inotify_event *)p;
            cberg_watch_dir *dir = dir_by_wd(w, ev->wd);
            if (dir != NULL && ev->len > 0) {
                char rel[PATH_MAX];
                if (!watch_rel_join(dir->rel_path, ev->name, rel, sizeof(rel))) {
                    p += sizeof(struct inotify_event) + ev->len;
                    continue;
                }
                if ((ev->mask & IN_ISDIR) != 0 && (ev->mask & IN_CREATE) != 0) {
                    char abs[PATH_MAX];
                    if (cberg_path_join(dir->abs_path, ev->name, abs, sizeof(abs))) {
                        watch_note_created_subdir(w, abs, rel);
                    }
                }
                watch_note_error(w, watch_dirty_add(w, rel, watch_kind_from_inotify(ev->mask)));
            }
            p += sizeof(struct inotify_event) + ev->len;
        }
    }
}
