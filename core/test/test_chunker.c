#include "codeberg/codeberg.h"
#include "test_common.h"

#include <stdio.h>
#include <string.h>

static const cberg_chunk *find_symbol(const cberg_chunk_list *list, const char *symbol) {
    for (size_t i = 0; i < cberg_chunk_list_len(list); i++) {
        const cberg_chunk *c = cberg_chunk_list_at(list, i);
        if (c != NULL && c->symbol != NULL && strcmp(c->symbol, symbol) == 0) {
            return c;
        }
    }
    return NULL;
}

static const cberg_chunk *find_symbol_nth(const cberg_chunk_list *list, const char *symbol, size_t nth) {
    size_t seen = 0;
    for (size_t i = 0; i < cberg_chunk_list_len(list); i++) {
        const cberg_chunk *c = cberg_chunk_list_at(list, i);
        if (c != NULL && c->symbol != NULL && strcmp(c->symbol, symbol) == 0) {
            if (seen == nth) {
                return c;
            }
            seen++;
        }
    }
    return NULL;
}

static size_t count_symbol(const cberg_chunk_list *list, const char *symbol) {
    size_t n = 0;
    while (find_symbol_nth(list, symbol, n) != NULL) {
        n++;
    }
    return n;
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

static void test_yaml(cberg_chunker *ch) {
    const char *src = "# top comment\n"
                      "\n"
                      "server:\n"
                      "  host: localhost\n"
                      "  port: 8080\n"
                      "database:\n"
                      "  url: postgres://example\n"
                      "features: [a, b]\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_YAML, "config.yaml", src, strlen(src), &list) == CBERG_OK, "yaml parse");
    CHECK(cberg_chunk_list_len(list) == 4, "yaml chunk count");

    const cberg_chunk *pre = cberg_chunk_list_at(list, 0);
    CHECK(pre != NULL && pre->kind == CBERG_CHUNK_KEY && pre->symbol == NULL, "yaml preamble");

    const cberg_chunk *server = find_symbol(list, "server");
    CHECK(server != NULL && server->kind == CBERG_CHUNK_KEY, "yaml server");
    CHECK(server != NULL && server->span.start_line == 3 && server->span.end_line == 5, "yaml server span");

    const cberg_chunk *db = find_symbol(list, "database");
    CHECK(db != NULL && db->span.start_line == 6 && db->span.end_line == 7, "yaml database span");
    CHECK(find_symbol(list, "url") == NULL, "yaml nested key not split");

    CHECK(find_symbol(list, "features") != NULL, "yaml last key");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "yaml hash");
    cberg_chunk_list_free(list);
}

static void test_toml(cberg_chunker *ch) {
    const char *src = "title = \"demo\"\n"
                      "\n"
                      "[server]\n"
                      "host = \"localhost\"\n"
                      "\n"
                      "[[peers]]\n"
                      "name = \"a\"\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_TOML, "config.toml", src, strlen(src), &list) == CBERG_OK, "toml parse");
    CHECK(cberg_chunk_list_len(list) == 3, "toml chunk count");

    const cberg_chunk *pre = cberg_chunk_list_at(list, 0);
    CHECK(pre != NULL && pre->kind == CBERG_CHUNK_KEY && pre->symbol == NULL, "toml preamble");
    CHECK(pre != NULL && pre->span.start_line == 1, "toml preamble line");

    const cberg_chunk *server = find_symbol(list, "server");
    CHECK(server != NULL && server->span.start_line == 3 && server->span.end_line == 5, "toml table span");

    const cberg_chunk *peers = find_symbol(list, "peers");
    CHECK(peers != NULL && peers->span.start_line == 6 && peers->span.end_line == 7, "toml array table");
    cberg_chunk_list_free(list);
}

static void test_json(cberg_chunker *ch) {
    const char *src = "{\n"
                      "  \"name\": \"demo\",\n"
                      "  \"scripts\": {\n"
                      "    \"build\": \"make\"\n"
                      "  },\n"
                      "  \"list\": [1, 2]\n"
                      "}\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "package.json", src, strlen(src), &list) == CBERG_OK, "json parse");
    CHECK(cberg_chunk_list_len(list) == 3, "json chunk count");

    const cberg_chunk *name = find_symbol(list, "name");
    CHECK(name != NULL && name->kind == CBERG_CHUNK_KEY, "json name");
    CHECK(name != NULL && name->span.start_line == 2 && name->span.end_line == 2, "json name span");

    const cberg_chunk *scripts = find_symbol(list, "scripts");
    CHECK(scripts != NULL && scripts->span.start_line == 3 && scripts->span.end_line == 5, "json scripts span");
    CHECK(find_symbol(list, "build") == NULL, "json nested key not split");

    CHECK(find_symbol(list, "list") != NULL, "json array value");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "json hash");
    cberg_chunk_list_free(list);
}

static void test_json_window_fallback(cberg_chunker *ch) {
    static const struct {
        const char *src;
        const char *path;
        const char *label;
    } cases[] = {
        {"[1, 2, 3]\n", "data.json", "json array"},
        {"{}", "empty.json", "json empty"},
        {"{ foo: 1 }\n", "bad.json", "json malformed"},
    };

    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        cberg_chunk_list *list = NULL;
        CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, cases[i].path, cases[i].src, strlen(cases[i].src), &list) == CBERG_OK, cases[i].label);
        CHECK(cberg_chunk_list_len(list) == 1, "json window count");
        CHECK(cberg_chunk_list_at(list, 0)->kind == CBERG_CHUNK_WINDOW, "json window kind");
        cberg_chunk_list_free(list);
    }
}

static void test_json_jsonc(cberg_chunker *ch) {
    const char *src = "{\n"
                      "  // compiler options\n"
                      "  \"compilerOptions\": {\n"
                      "    \"strict\": true\n"
                      "  },\n"
                      "  /* include globs */\n"
                      "  \"include\": [\"src\"]\n"
                      "}\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "tsconfig.json", src, strlen(src), &list) == CBERG_OK, "jsonc parse");
    CHECK(cberg_chunk_list_len(list) == 2, "jsonc chunk count");
    CHECK(find_symbol(list, "compilerOptions") != NULL, "jsonc compilerOptions");
    CHECK(find_symbol(list, "include") != NULL, "jsonc include");
    cberg_chunk_list_free(list);
}

static void test_json_trailing(cberg_chunker *ch) {
    const char *src = "{ \"a\": 1 } trailing garbage\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "trail.json", src, strlen(src), &list) == CBERG_OK, "json trailing parse");
    CHECK(cberg_chunk_list_len(list) == 2, "json trailing chunk count");
    CHECK(find_symbol(list, "a") != NULL, "json trailing key");
    const cberg_chunk *tail = cberg_chunk_list_at(list, 1);
    CHECK(tail != NULL && tail->kind == CBERG_CHUNK_KEY && tail->symbol == NULL, "json trailing unnamed");
    cberg_chunk_list_free(list);
}

static void test_json_line_split(cberg_chunker *ch) {
    char buf[16384];
    size_t off = (size_t)snprintf(buf, sizeof(buf), "{\n  \"big\": [\n");
    for (int n = 0; n < 210; n++) {
        off += (size_t)snprintf(buf + off, sizeof(buf) - off, "    %d,\n", n);
    }
    off += (size_t)snprintf(buf + off, sizeof(buf) - off, "    0\n  ]\n}\n");

    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "lock.json", buf, strlen(buf), &list) == CBERG_OK, "json line split parse");
    size_t big_chunks = 0;
    for (size_t i = 0; i < cberg_chunk_list_len(list); i++) {
        const cberg_chunk *c = cberg_chunk_list_at(list, i);
        if (c != NULL && c->symbol != NULL && strcmp(c->symbol, "big") == 0) {
            big_chunks++;
        }
    }
    CHECK(big_chunks >= 2, "json big key split into multiple chunks");
    cberg_chunk_list_free(list);
}

static void test_json_long_key(cberg_chunker *ch) {
    char k1[151];
    char k2[151];
    memset(k1, 'a', 150);
    k1[150] = '\0';
    memcpy(k2, k1, 149);
    k2[149] = 'b';
    k2[150] = '\0';

    char src[512];
    snprintf(src, sizeof(src), "{ \"%s\": 1, \"%s\": 2 }\n", k1, k2);

    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "long.json", src, strlen(src), &list) == CBERG_OK, "json long key parse");
    CHECK(find_symbol(list, k1) != NULL, "json long key first");
    CHECK(find_symbol(list, k2) != NULL, "json long key second");
    cberg_chunk_list_free(list);
}

static void test_yaml_flow_style(cberg_chunker *ch) {
    const char *src = "inline:{ nested: true }\n"
                      "normal:\n"
                      "  value: 1\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_YAML, "flow.yaml", src, strlen(src), &list) == CBERG_OK, "yaml flow parse");
    CHECK(find_symbol(list, "inline:{ nested: true }") == NULL, "yaml flow not a key boundary");
    CHECK(find_symbol(list, "normal") != NULL, "yaml normal key");
    cberg_chunk_list_free(list);
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

    const cberg_chunk *install = find_symbol_nth(list, "Install", 0);
    CHECK(install != NULL && install->kind == CBERG_CHUNK_SECTION, "md Install");
    CHECK(install != NULL && install->span.start_line == 3, "md Install line");

    /* Nested headings carry a breadcrumb; the fenced '#' is not a heading. */
    const cberg_chunk *prereq = find_symbol_nth(list, "Install > Prerequisites", 0);
    CHECK(prereq != NULL && prereq->kind == CBERG_CHUNK_SECTION, "md breadcrumb");
    CHECK(prereq != NULL && prereq->span.start_line == 6, "md Prerequisites start");
    CHECK(prereq != NULL && prereq->span.end_line == 13, "md fence not split");

    /* Trailing closing hashes are trimmed from the title. */
    CHECK(find_symbol_nth(list, "Install > Usage", 0) != NULL, "md closing hashes");

    /* A later H1 resets the breadcrumb. */
    const cberg_chunk *faq = find_symbol_nth(list, "FAQ", 0);
    CHECK(faq != NULL && faq->span.end_line == 18, "md FAQ span");

    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "md hash");
    cberg_chunk_list_free(list);
}

static void test_markdown_long_section(cberg_chunker *ch) {
    char buf[8192];
    size_t off = 0;
    off += (size_t)snprintf(buf + off, sizeof(buf) - off, "# Long Section\n");
    for (int i = 0; i < 200; i++) {
        off += (size_t)snprintf(buf + off, sizeof(buf) - off, "line %d\n", i);
    }

    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_MARKDOWN, "long.md", buf, off, &list) == CBERG_OK, "md long parse");
    CHECK(list != NULL, "md long list");
    CHECK(count_symbol(list, "Long Section") == 2, "md long section split count");

    const cberg_chunk *first = find_symbol_nth(list, "Long Section", 0);
    CHECK(first != NULL && first->kind == CBERG_CHUNK_SECTION, "md long first kind");
    CHECK(first != NULL && first->span.start_line == 1, "md long first start");
    CHECK(first != NULL && first->span.end_line == 200, "md long first end");
    CHECK(first != NULL && first->key != NULL && strstr(first->key, "#0") != NULL, "md long key #0");

    const cberg_chunk *second = find_symbol_nth(list, "Long Section", 1);
    CHECK(second != NULL && second->kind == CBERG_CHUNK_SECTION, "md long second kind");
    CHECK(second != NULL && second->span.start_line == 201, "md long second start");
    CHECK(second != NULL && second->key != NULL && strstr(second->key, "#1") != NULL, "md long key #1");

    cberg_chunk_list_free(list);
    (void)ch;
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
    CHECK(cberg_language_from_path("config.yaml") == CBERG_LANG_YAML, "lang yaml");
    CHECK(cberg_language_from_path("config.yml") == CBERG_LANG_YAML, "lang yml");
    CHECK(cberg_language_from_path("Cargo.toml") == CBERG_LANG_TOML, "lang toml");
    CHECK(cberg_language_from_path("package.json") == CBERG_LANG_JSON, "lang json");
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    test_go(ch);
    test_window(ch);
    test_markdown(ch);
    test_markdown_long_section(ch);
    test_markdown_no_headings(ch);
    test_yaml(ch);
    test_toml(ch);
    test_json(ch);
    test_json_window_fallback(ch);
    test_json_jsonc(ch);
    test_json_trailing(ch);
    test_json_line_split(ch);
    test_json_long_key(ch);
    test_yaml_flow_style(ch);
    cberg_chunker_close(ch);
    TEST_MAIN_RETURN
}
