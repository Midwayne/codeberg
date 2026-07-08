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

static void test_markdown(cberg_chunker *ch) {
    const char *src = "Intro paragraph before any heading.\n"
                      "\n"
                      "# Install\n"
                      "Run make.\n"
                      "\n"
                      "## Prerequisites\n"
                      "A C compiler.\n"
                      "\n"
                      "```sh\n"
                      "# this comment is not a heading\n"
                      "make build\n"
                      "```\n"
                      "\n"
                      "## Usage ##\n"
                      "Run the binary.\n"
                      "\n"
                      "# FAQ\n"
                      "Nothing yet.\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_MARKDOWN, "README.md", src, strlen(src), &list) == CBERG_OK, "md parse");
    CHECK(list != NULL, "md list");
    CHECK(cberg_chunk_list_len(list) == 5, "md section count");

    /* Preamble before the first heading is its own unnamed section. */
    const cberg_chunk *pre = cberg_chunk_list_at(list, 0);
    CHECK(pre != NULL && pre->kind == CBERG_CHUNK_SECTION && pre->symbol == NULL, "md preamble");
    CHECK(pre != NULL && pre->span.start_line == 1, "md preamble start");

    const cberg_chunk *install = find_symbol(list, "Install");
    CHECK(install != NULL && install->kind == CBERG_CHUNK_SECTION, "md Install");
    CHECK(install != NULL && install->span.start_line == 3, "md Install line");

    /* Nested headings carry a breadcrumb; the fenced '#' is not a heading. */
    const cberg_chunk *prereq = find_symbol(list, "Install > Prerequisites");
    CHECK(prereq != NULL && prereq->kind == CBERG_CHUNK_SECTION, "md breadcrumb");
    CHECK(prereq != NULL && prereq->span.start_line == 6, "md Prerequisites start");
    CHECK(prereq != NULL && prereq->span.end_line == 13, "md fence not split");

    /* Trailing closing hashes are trimmed from the title. */
    CHECK(find_symbol(list, "Install > Usage") != NULL, "md closing hashes");

    /* A later H1 resets the breadcrumb. */
    const cberg_chunk *faq = find_symbol(list, "FAQ");
    CHECK(faq != NULL && faq->span.end_line == 18, "md FAQ span");

    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "md hash");
    cberg_chunk_list_free(list);
}

static void test_markdown_no_headings(cberg_chunker *ch) {
    const char *src = "just prose\nwith no headings\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_MARKDOWN, "notes.md", src, strlen(src), &list) == CBERG_OK, "md plain parse");
    CHECK(cberg_chunk_list_len(list) == 1, "md plain single section");
    const cberg_chunk *c = cberg_chunk_list_at(list, 0);
    CHECK(c != NULL && c->kind == CBERG_CHUNK_SECTION && c->symbol == NULL, "md plain kind");
    CHECK(c != NULL && c->span.start_byte == 0 && c->span.end_byte == strlen(src), "md plain span");
    cberg_chunk_list_free(list);

    CHECK(cberg_chunker_parse(ch, CBERG_LANG_MARKDOWN, "empty.md", "", 0, &list) == CBERG_OK, "md empty parse");
    CHECK(cberg_chunk_list_len(list) == 0, "md empty no chunks");
    cberg_chunk_list_free(list);
}

int main(void) {
    CHECK(cberg_language_from_path("a.go") == CBERG_LANG_GO, "lang go");
    CHECK(cberg_language_from_path("README.md") == CBERG_LANG_MARKDOWN, "lang md");
    CHECK(cberg_language_from_path("doc.markdown") == CBERG_LANG_MARKDOWN, "lang markdown");
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    test_go(ch);
    test_window(ch);
    test_markdown(ch);
    test_markdown_no_headings(ch);
    cberg_chunker_close(ch);
    return failures == 0 ? 0 : 1;
}
