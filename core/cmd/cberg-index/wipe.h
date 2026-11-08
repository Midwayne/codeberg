#ifndef CBERG_WIPE_H
#define CBERG_WIPE_H

/* No model, repository reads, or watchers are needed to wipe a namespace.
 * `root` is used as given, not resolved: the directory may already be gone,
 * so callers pass the canonical path the engine was started with. */
int cberg_wipe_index(const char *base, const char *root);

#endif
