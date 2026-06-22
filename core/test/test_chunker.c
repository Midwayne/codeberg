#include "codeberg/codeberg.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static const cberg_chunk *find_symbol(const cberg_chunk_list *list, const char *symbol) {
    for (size_t i = 0; i < cberg_chunk_list_len(list); i++) {
        const cberg_chunk *c = cberg_chunk_list_at(list, i);
        if (c != NULL && c->symbol != NULL && strcmp(c->symbol, symbol) == 0) {
            return c;
        }
    }
    return NULL;
}

static void test_go(cberg_chunker *ch) {
    const char *src = "package main\n\n"
                      "func Add(a, b int) int {\n"
                      "\treturn a + b\n"
                      "}\n\n"
                      "type Shape interface {\n"
                      "\tArea() float64\n"
                      "}\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_GO, "main.go", src, strlen(src), &list) == CBERG_OK, "go parse");
    CHECK(list != NULL, "go list");
    const cberg_chunk *add = find_symbol(list, "Add");
    CHECK(add != NULL && add->kind == CBERG_CHUNK_FUNCTION, "go Add");
    CHECK(add != NULL && add->span.start_line == 3, "go Add line");
    const cberg_chunk *shape = find_symbol(list, "Shape");
    CHECK(shape != NULL && shape->kind == CBERG_CHUNK_INTERFACE, "go Shape");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "go hash");
    cberg_chunk_list_free(list);
}

static void test_window(cberg_chunker *ch) {
    const char *src = "line1\nline2\nline3\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_UNKNOWN, "notes.txt", src, strlen(src), &list) == CBERG_OK, "window");
    CHECK(cberg_chunk_list_len(list) >= 1, "window count");
    CHECK(cberg_chunk_list_at(list, 0)->kind == CBERG_CHUNK_WINDOW, "window kind");
    cberg_chunk_list_free(list);
    (void)ch;
}

int main(void) {
    CHECK(cberg_language_from_path("a.go") == CBERG_LANG_GO, "lang go");
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    test_go(ch);
    test_window(ch);
    cberg_chunker_close(ch);
    return failures == 0 ? 0 : 1;
}
