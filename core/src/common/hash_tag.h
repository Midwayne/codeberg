#ifndef CBERG_HASH_TAG_H
#define CBERG_HASH_TAG_H

#define CBERG_HASH_TAG_LEN 16

/*
 * Lower-case hex of the first 8 bytes of cberg_hash(s): the stable short tag
 * that names per-root index files ("<base>.<tag>") and remote collections
 * ("codeberg_<tag>"). `cberg-index --wipe-index` finds an index by recomputing
 * it, so every namer must use this one function.
 */
void cberg_hash_tag(const char *s, char out[CBERG_HASH_TAG_LEN + 1]);

#endif /* CBERG_HASH_TAG_H */
