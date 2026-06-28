#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "embed_internal.h"
#include "tokenize.h"

#include "onnxruntime_c_api.h"

#define MAX_SEQ 256
#define MAX_BATCH 32

static void ort_discard(const OrtApi *ort, OrtStatus *status) {
    if (status != NULL) {
        ort->ReleaseStatus(status);
    }
}

typedef enum { INPUT_IDS, INPUT_MASK, INPUT_TYPES } input_kind;

typedef struct {
    const OrtApi *ort;
    OrtEnv *env;
    OrtSession *session;
    OrtMemoryInfo *mem;
    cberg_tok *tok;
    size_t dim;
    int n_inputs;
    char *input_names[8];
    input_kind input_kinds[8];
    char *output_name;
} onnx_impl;

static void derive_dir(const char *path, char *out, size_t out_len) {
    const char *slash = strrchr(path, '/');
    if (slash == NULL) {
        snprintf(out, out_len, ".");
        return;
    }
    size_t dir_len = (size_t)(slash - path);
    if (dir_len == 0) {
        snprintf(out, out_len, "/");
        return;
    }
    snprintf(out, out_len, "%.*s", (int)dir_len, path);
}

static input_kind classify_input(const char *name) {
    if (strstr(name, "token_type") != NULL) {
        return INPUT_TYPES;
    }
    if (strstr(name, "attention") != NULL || strstr(name, "mask") != NULL) {
        return INPUT_MASK;
    }
    return INPUT_IDS;
}

void cberg_onnx_close(void *handle) {
    onnx_impl *impl = handle;
    if (impl == NULL) {
        return;
    }
    const OrtApi *ort = impl->ort;
    OrtAllocator *alloc = NULL;
    if (ort != NULL) {
        ort_discard(ort, ort->GetAllocatorWithDefaultOptions(&alloc));
    }
    for (int i = 0; i < impl->n_inputs; i++) {
        if (impl->input_names[i] != NULL && alloc != NULL) {
            alloc->Free(alloc, impl->input_names[i]);
        }
    }
    if (impl->output_name != NULL && alloc != NULL) {
        alloc->Free(alloc, impl->output_name);
    }
    if (ort != NULL) {
        if (impl->session != NULL) {
            ort->ReleaseSession(impl->session);
        }
        if (impl->mem != NULL) {
            ort->ReleaseMemoryInfo(impl->mem);
        }
        if (impl->env != NULL) {
            ort->ReleaseEnv(impl->env);
        }
    }
    if (impl->tok != NULL) {
        cberg_tok_free(impl->tok);
    }
    free(impl);
}

cberg_status cberg_onnx_open(const cberg_embed_config *cfg, void **out_impl, size_t *out_dim) {
    if (cfg->model_path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    const OrtApi *ort = OrtGetApiBase()->GetApi(ORT_API_VERSION);
    if (ort == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    onnx_impl *impl = calloc(1, sizeof(*impl));
    if (impl == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    impl->ort = ort;

    cberg_status status = CBERG_ERR_INTERNAL;
    OrtSessionOptions *opts = NULL;
    OrtAllocator *alloc = NULL;

    char model_dir[2048];
    derive_dir(cfg->model_path, model_dir, sizeof(model_dir));
    impl->tok = cberg_tok_open(model_dir);
    if (impl->tok == NULL) {
        status = CBERG_ERR_IO;
        goto fail;
    }

    if (ort->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "codeberg", &impl->env) != NULL) {
        goto fail;
    }
    if (ort->CreateSessionOptions(&opts) != NULL) {
        goto fail;
    }
    /* Squeeze the CPU provider: full graph optimization (constant folding + op
     * fusion), sequential execution, and no memory-pattern planning. Batch shapes
     * vary by sequence length, so pattern planning would re-plan on every new shape
     * instead of helping. */
    ort_discard(ort, ort->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL));
    ort_discard(ort, ort->SetSessionExecutionMode(opts, ORT_SEQUENTIAL));
    ort_discard(ort, ort->DisableMemPattern(opts));
    /* num_threads <= 0 leaves ORT's default (all physical cores). */
    if (cfg->num_threads > 0) {
        ort_discard(ort, ort->SetIntraOpNumThreads(opts, cfg->num_threads));
    }
    if (ort->CreateSession(impl->env, cfg->model_path, opts, &impl->session) != NULL) {
        status = CBERG_ERR_IO;
        goto fail;
    }
    if (ort->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &impl->mem) != NULL) {
        goto fail;
    }
    if (ort->GetAllocatorWithDefaultOptions(&alloc) != NULL) {
        goto fail;
    }

    size_t n_inputs = 0;
    if (ort->SessionGetInputCount(impl->session, &n_inputs) != NULL || n_inputs == 0 || n_inputs > 8) {
        goto fail;
    }
    impl->n_inputs = (int)n_inputs;
    for (size_t i = 0; i < n_inputs; i++) {
        if (ort->SessionGetInputName(impl->session, i, alloc, &impl->input_names[i]) != NULL) {
            goto fail;
        }
        impl->input_kinds[i] = classify_input(impl->input_names[i]);
    }
    if (ort->SessionGetOutputName(impl->session, 0, alloc, &impl->output_name) != NULL) {
        goto fail;
    }

    OrtTypeInfo *type_info = NULL;
    if (ort->SessionGetOutputTypeInfo(impl->session, 0, &type_info) != NULL) {
        goto fail;
    }
    const OrtTensorTypeAndShapeInfo *shape_info = NULL;
    size_t n_dims = 0;
    int64_t dims[8] = {0};
    if (ort->CastTypeInfoToTensorInfo(type_info, &shape_info) == NULL && shape_info != NULL) {
        ort_discard(ort, ort->GetDimensionsCount(shape_info, &n_dims));
        if (n_dims >= 1 && n_dims <= 8) {
            ort_discard(ort, ort->GetDimensions(shape_info, dims, n_dims));
        }
    }
    ort->ReleaseTypeInfo(type_info);
    if (n_dims == 0 || dims[n_dims - 1] <= 0) {
        goto fail;
    }
    impl->dim = (size_t)dims[n_dims - 1];

    ort->ReleaseSessionOptions(opts);
    *out_impl = impl;
    *out_dim = impl->dim;
    return CBERG_OK;

fail:
    if (opts != NULL) {
        ort->ReleaseSessionOptions(opts);
    }
    cberg_onnx_close(impl);
    return status;
}

static void mean_pool_row(const float *hidden, int seq_len, size_t dim, float *out) {
    for (size_t d = 0; d < dim; d++) {
        double sum = 0.0;
        for (int s = 0; s < seq_len; s++) {
            sum += hidden[(size_t)s * dim + d];
        }
        out[d] = (float)(sum / (double)seq_len);
    }
    cberg_l2_normalize(out, dim);
}

static cberg_status run_inference(onnx_impl *impl, int64_t *ids, int64_t *mask, int64_t *types, size_t batch,
                                  int max_len, const int *seq_lens, float *out) {
    const OrtApi *ort = impl->ort;
    int64_t shape[2] = {(int64_t)batch, max_len};
    size_t flat = batch * (size_t)max_len;
    size_t bytes = flat * sizeof(int64_t);

    OrtValue *inputs[8] = {0};
    const char *input_names[8] = {0};
    OrtValue *output = NULL;
    cberg_status status = CBERG_ERR_INTERNAL;

    for (int i = 0; i < impl->n_inputs; i++) {
        int64_t *data = ids;
        if (impl->input_kinds[i] == INPUT_MASK) {
            data = mask;
        } else if (impl->input_kinds[i] == INPUT_TYPES) {
            data = types;
        }
        if (ort->CreateTensorWithDataAsOrtValue(impl->mem, data, bytes, shape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64,
                                                &inputs[i]) != NULL) {
            goto cleanup;
        }
        input_names[i] = impl->input_names[i];
    }

    const char *output_names[1] = {impl->output_name};
    if (ort->Run(impl->session, NULL, input_names, (const OrtValue *const *)inputs, (size_t)impl->n_inputs,
                 output_names, 1, &output) != NULL) {
        goto cleanup;
    }

    float *hidden = NULL;
    if (ort->GetTensorMutableData(output, (void **)&hidden) != NULL) {
        goto cleanup;
    }

    for (size_t b = 0; b < batch; b++) {
        mean_pool_row(hidden + b * (size_t)max_len * impl->dim, seq_lens[b], impl->dim, out + b * impl->dim);
    }
    status = CBERG_OK;

cleanup:
    if (output != NULL) {
        ort->ReleaseValue(output);
    }
    for (int i = 0; i < impl->n_inputs; i++) {
        if (inputs[i] != NULL) {
            ort->ReleaseValue(inputs[i]);
        }
    }
    return status;
}

/* Counting sort of indices [0,count) by sequence length (0..MAX_SEQ), ascending and
 * stable. Lengths are small and bounded, so this is O(count + MAX_SEQ) with no
 * comparator or global state — portable and thread-safe. */
static void sort_indices_by_len(const int *seq_lens, size_t count, int *order) {
    int counts[MAX_SEQ + 1] = {0};
    for (size_t i = 0; i < count; i++) {
        counts[seq_lens[i]]++;
    }
    int acc = 0;
    for (int len = 0; len <= MAX_SEQ; len++) {
        int c = counts[len];
        counts[len] = acc;
        acc += c;
    }
    for (size_t i = 0; i < count; i++) {
        order[counts[seq_lens[i]]++] = (int)i;
    }
}

/* Embed one length-homogeneous group: build padded [g_count, max_len] tensors from
 * the pre-tokenized rows named by order[g_start..], run inference, and scatter each
 * pooled vector back to its caller-facing slot out[order[...]*dim]. Padding tracks
 * the group's own longest row, not the whole call's. */
static cberg_status run_group(onnx_impl *impl, const int64_t *tokbuf, const int *seq_lens, const int *order,
                              size_t g_start, size_t g_count, float *out) {
    int max_len = 0;
    for (size_t b = 0; b < g_count; b++) {
        int n = seq_lens[order[g_start + b]];
        if (n > max_len) {
            max_len = n;
        }
    }
    if (max_len == 0) {
        max_len = 1; /* never hand ORT a zero-width tensor */
    }

    size_t flat = g_count * (size_t)max_len;
    int64_t *ids = calloc(flat, sizeof(int64_t));
    int64_t *mask = calloc(flat, sizeof(int64_t));
    int64_t *types = calloc(flat, sizeof(int64_t));
    float *pooled = malloc(g_count * impl->dim * sizeof(float));
    int *glens = malloc(g_count * sizeof(int));
    if (ids == NULL || mask == NULL || types == NULL || pooled == NULL || glens == NULL) {
        free(ids);
        free(mask);
        free(types);
        free(pooled);
        free(glens);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    for (size_t b = 0; b < g_count; b++) {
        int idx = order[g_start + b];
        int n = seq_lens[idx];
        glens[b] = n;
        const int64_t *src = tokbuf + (size_t)idx * MAX_SEQ;
        for (int s = 0; s < n; s++) {
            size_t off = b * (size_t)max_len + (size_t)s;
            ids[off] = src[s];
            mask[off] = 1; /* token_type stays 0 from calloc */
        }
    }

    cberg_status st = run_inference(impl, ids, mask, types, g_count, max_len, glens, pooled);
    if (st == CBERG_OK) {
        for (size_t b = 0; b < g_count; b++) {
            memcpy(out + (size_t)order[g_start + b] * impl->dim, pooled + b * impl->dim, impl->dim * sizeof(float));
        }
    }

    free(ids);
    free(mask);
    free(types);
    free(pooled);
    free(glens);
    return st;
}

cberg_status cberg_onnx_embed(void *handle, const char *const *texts, const size_t *lens, size_t count, float *out) {
    onnx_impl *impl = handle;
    if (count == 0) {
        return CBERG_OK;
    }

    /* Tokenize everything up front, then sort by length so each inference batch pads
     * to its own group's longest row instead of the whole call's. Code chunks range
     * from one-liners to 256-token windows, so batching mixed lengths wastes compute
     * on padding; length-homogeneous batches cut that waste. */
    int64_t *tokbuf = malloc(count * (size_t)MAX_SEQ * sizeof(int64_t));
    int *seq_lens = malloc(count * sizeof(int));
    int *order = malloc(count * sizeof(int));
    if (tokbuf == NULL || seq_lens == NULL || order == NULL) {
        free(tokbuf);
        free(seq_lens);
        free(order);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    for (size_t i = 0; i < count; i++) {
        int n = cberg_tok_encode(impl->tok, texts[i], lens[i], tokbuf + i * (size_t)MAX_SEQ, MAX_SEQ);
        if (n < 0) {
            st = CBERG_ERR_INTERNAL;
            goto done;
        }
        seq_lens[i] = n;
    }

    sort_indices_by_len(seq_lens, count, order);

    for (size_t g = 0; g < count;) {
        size_t gc = count - g;
        if (gc > MAX_BATCH) {
            gc = MAX_BATCH;
        }
        st = run_group(impl, tokbuf, seq_lens, order, g, gc, out);
        if (st != CBERG_OK) {
            goto done;
        }
        g += gc;
    }

done:
    free(tokbuf);
    free(seq_lens);
    free(order);
    return st;
}
