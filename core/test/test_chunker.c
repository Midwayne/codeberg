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

static void test_rust(cberg_chunker *ch) {
    const char *src = "pub fn add(a: i32, b: i32) -> i32 {\n"
                      "    a + b\n"
                      "}\n"
                      "\n"
                      "pub struct Point {\n"
                      "    x: i32,\n"
                      "}\n"
                      "\n"
                      "pub enum Shape {\n"
                      "    Circle,\n"
                      "}\n"
                      "\n"
                      "pub trait Area {\n"
                      "    fn area(&self) -> f64;\n"
                      "}\n"
                      "\n"
                      "impl Point {\n"
                      "    fn norm(&self) -> i32 {\n"
                      "        self.x\n"
                      "    }\n"
                      "}\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_RUST, "lib.rs", src, strlen(src), &list) == CBERG_OK, "rust parse");
    const cberg_chunk *add = find_symbol(list, "add");
    CHECK(add != NULL && add->kind == CBERG_CHUNK_FUNCTION, "rust fn");
    CHECK(add != NULL && add->span.start_line == 1 && add->span.end_line == 3, "rust fn span");
    const cberg_chunk *point = find_symbol(list, "Point");
    CHECK(point != NULL && point->kind == CBERG_CHUNK_STRUCT, "rust struct");
    const cberg_chunk *shape = find_symbol(list, "Shape");
    CHECK(shape != NULL && shape->kind == CBERG_CHUNK_STRUCT, "rust enum");
    const cberg_chunk *area = find_symbol(list, "Area");
    CHECK(area != NULL && area->kind == CBERG_CHUNK_INTERFACE, "rust trait");
    /* Functions inside impl blocks are captured too. */
    const cberg_chunk *norm = find_symbol(list, "norm");
    CHECK(norm != NULL && norm->kind == CBERG_CHUNK_FUNCTION, "rust impl fn");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "rust hash");
    cberg_chunk_list_free(list);
}

static void test_ruby(cberg_chunker *ch) {
    const char *src = "module Billing\n"
                      "  class Invoice\n"
                      "    def total\n"
                      "      42\n"
                      "    end\n"
                      "\n"
                      "    def self.build\n"
                      "      new\n"
                      "    end\n"
                      "  end\n"
                      "end\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_RUBY, "billing.rb", src, strlen(src), &list) == CBERG_OK, "ruby parse");
    const cberg_chunk *mod = find_symbol(list, "Billing");
    CHECK(mod != NULL && mod->kind == CBERG_CHUNK_CLASS, "ruby module");
    CHECK(mod != NULL && mod->span.start_line == 1 && mod->span.end_line == 11, "ruby module span");
    const cberg_chunk *cls = find_symbol(list, "Invoice");
    CHECK(cls != NULL && cls->kind == CBERG_CHUNK_CLASS, "ruby class");
    const cberg_chunk *total = find_symbol(list, "total");
    CHECK(total != NULL && total->kind == CBERG_CHUNK_METHOD, "ruby method");
    CHECK(total != NULL && total->span.start_line == 3 && total->span.end_line == 5, "ruby method span");
    const cberg_chunk *build = find_symbol(list, "build");
    CHECK(build != NULL && build->kind == CBERG_CHUNK_METHOD, "ruby singleton method");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "ruby hash");
    cberg_chunk_list_free(list);
}

int main(void) {
    CHECK(cberg_language_from_path("a.go") == CBERG_LANG_GO, "lang go");
    CHECK(cberg_language_from_path("lib.rs") == CBERG_LANG_RUST, "lang rust");
    CHECK(cberg_language_from_path("app.rb") == CBERG_LANG_RUBY, "lang ruby");
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    test_go(ch);
    test_window(ch);
    test_rust(ch);
    test_ruby(ch);
    cberg_chunker_close(ch);
    return failures == 0 ? 0 : 1;
}
