#include <usearch/index_dense.hpp>

extern "C" {
#include "usearch.h"
}

using namespace unum::usearch;
using namespace unum;

extern "C" void usearch_compact(usearch_index_t index, size_t threads, usearch_error_t *error) {
    if (index == NULL || error == NULL) {
        return;
    }
    index_dense_t *typed = reinterpret_cast<index_dense_t *>(index);
    if (threads == 0) {
        threads = 1;
    }
    executor_default_t executor(threads);
    auto result = typed->compact(executor, dummy_progress_t{});
    if (!result) {
        *error = result.error.release();
    }
}
