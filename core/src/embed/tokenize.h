#ifndef CBERG_TOKENIZE_H
#define CBERG_TOKENIZE_H

#include <stddef.h>
#include <stdint.h>

typedef struct cberg_tok cberg_tok;

cberg_tok *cberg_tok_open(const char *model_dir);
void cberg_tok_free(cberg_tok *t);

int cberg_tok_encode(const cberg_tok *t, const char *text, size_t len, int64_t *out_ids, size_t max_tokens);

#endif /* CBERG_TOKENIZE_H */
