#define _POSIX_C_SOURCE 200809L

#include "tokenize.h"

#include <stdlib.h>
#include <string.h>

#include "ortx_tokenizer.h"

struct cberg_tok {
    OrtxTokenizer *ort;
};

cberg_tok *cberg_tok_open(const char *model_dir) {
    if (model_dir == NULL) {
        return NULL;
    }
    OrtxTokenizer *ort = NULL;
    if (OrtxCreateTokenizer(&ort, model_dir) != kOrtxOK) {
        return NULL;
    }
    cberg_tok *t = calloc(1, sizeof(*t));
    if (t == NULL) {
        OrtxDisposeOnly((OrtxObject *)ort);
        return NULL;
    }
    t->ort = ort;
    return t;
}

void cberg_tok_free(cberg_tok *t) {
    if (t == NULL) {
        return;
    }
    if (t->ort != NULL) {
        OrtxDisposeOnly((OrtxObject *)t->ort);
    }
    free(t);
}

int cberg_tok_encode(const cberg_tok *t, const char *text, size_t len, int64_t *out_ids, size_t max_tokens) {
    if (t == NULL || out_ids == NULL || max_tokens < 2) {
        return -1;
    }

    char *buf = malloc(len + 1);
    if (buf == NULL) {
        return -1;
    }
    memcpy(buf, text, len);
    buf[len] = '\0';

    const char *inputs[1] = {buf};
    OrtxTokenId2DArray *ids2d = NULL;
    extError_t err = OrtxTokenize(t->ort, inputs, 1, &ids2d);
    free(buf);
    if (err != kOrtxOK || ids2d == NULL) {
        return -1;
    }

    const extTokenId_t *ids = NULL;
    size_t n = 0;
    err = OrtxTokenId2DArrayGetItem(ids2d, 0, &ids, &n);
    if (err != kOrtxOK || ids == NULL) {
        OrtxDisposeOnly((OrtxObject *)ids2d);
        return -1;
    }

    int count;
    if (n <= max_tokens) {
        for (size_t i = 0; i < n; i++) {
            out_ids[i] = (int64_t)ids[i];
        }
        count = (int)n;
    } else {
        for (size_t i = 0; i + 1 < max_tokens; i++) {
            out_ids[i] = (int64_t)ids[i];
        }
        out_ids[max_tokens - 1] = (int64_t)ids[n - 1];
        count = (int)max_tokens;
    }

    OrtxDisposeOnly((OrtxObject *)ids2d);
    return count;
}
