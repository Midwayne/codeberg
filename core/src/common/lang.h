#ifndef CBERG_LANG_H
#define CBERG_LANG_H

#include "codeberg/codeberg.h"

/*
 * Per-language facts shared by the chunker, the graph, the import resolvers,
 * and the indexer. Grammar-specific content (chunk and reference queries)
 * stays with the module that runs it.
 *
 * Languages 1..CBERG_LANG_PARSED_LAST have a tree-sitter grammar; they are the
 * "code" languages that get syntax chunks, graph extraction, and import
 * resolution. Later enum values are document/config formats.
 */
#define CBERG_LANG_PARSED_LAST CBERG_LANG_RUBY
#define CBERG_LANG_PARSED_SLOTS ((int)CBERG_LANG_PARSED_LAST + 1)

/* Stable lower-case name ("go", "markdown", ...); "unknown" for UNKNOWN. */
const char *cberg_language_name(cberg_language lang);

int cberg_language_is_code(cberg_language lang);

#endif /* CBERG_LANG_H */
