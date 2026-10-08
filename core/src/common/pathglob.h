#ifndef CBERG_PATHGLOB_H
#define CBERG_PATHGLOB_H

#include <stdbool.h>

/*
 * Matches a repo-relative file path against a ripgrep --glob style pattern
 * (gitignore semantics), so index filters agree with the daemon's rg-backed
 * grep:
 *   - a pattern without '/' matches the file's basename at any depth;
 *   - a pattern with '/' (or a leading '/') matches the whole path, where '*'
 *     stays within one segment and a '**' segment spans any number of them;
 *   - {a,b} alternatives, [classes], and a leading '!' (negation) work.
 * An empty pattern matches every path.
 */
bool cberg_path_glob_match(const char *glob, const char *path);

#endif /* CBERG_PATHGLOB_H */
