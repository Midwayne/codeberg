#ifndef CBERG_STATUTIL_H
#define CBERG_STATUTIL_H

#include <stdint.h>
#include <sys/stat.h>

/* Nanosecond mtime from struct stat (platform-specific member names). */
#if defined(__APPLE__)
#define CBERG_STAT_MTIME_NS(sb) ((int64_t)(sb).st_mtimespec.tv_sec * 1000000000LL + (int64_t)(sb).st_mtimespec.tv_nsec)
#else
#define CBERG_STAT_MTIME_NS(sb) ((int64_t)(sb).st_mtim.tv_sec * 1000000000LL + (int64_t)(sb).st_mtim.tv_nsec)
#endif

#endif /* CBERG_STATUTIL_H */
