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

static size_t count_symbol(const cberg_chunk_list *list, const char *symbol) {
    size_t n = 0;
    for (size_t i = 0; i < cberg_chunk_list_len(list); i++) {
        const cberg_chunk *c = cberg_chunk_list_at(list, i);
        if (c != NULL && c->symbol != NULL && strcmp(c->symbol, symbol) == 0) {
            n++;
        }
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

    /* Leading comments before the first key form an unnamed preamble. */
    const cberg_chunk *pre = cberg_chunk_list_at(list, 0);
    CHECK(pre != NULL && pre->kind == CBERG_CHUNK_KEY && pre->symbol == NULL, "yaml preamble");

    const cberg_chunk *server = find_symbol(list, "server");
    CHECK(server != NULL && server->kind == CBERG_CHUNK_KEY, "yaml server");
    CHECK(server != NULL && server->span.start_line == 3 && server->span.end_line == 5, "yaml server span");

    /* Nested `url:` is indented, so it stays inside the database chunk. */
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

    /* Root keys before the first table form an unnamed preamble. */
    const cberg_chunk *pre = cberg_chunk_list_at(list, 0);
    CHECK(pre != NULL && pre->kind == CBERG_CHUNK_KEY && pre->symbol == NULL, "toml preamble");
    CHECK(pre != NULL && pre->span.start_line == 1, "toml preamble line");

    const cberg_chunk *server = find_symbol(list, "server");
    CHECK(server != NULL && server->span.start_line == 3 && server->span.end_line == 5, "toml table span");

    /* [[array-of-tables]] strips both bracket pairs. */
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

    /* Object values span until their closing brace; the nested key does not split. */
    const cberg_chunk *scripts = find_symbol(list, "scripts");
    CHECK(scripts != NULL && scripts->span.start_line == 3 && scripts->span.end_line == 5, "json scripts span");
    CHECK(find_symbol(list, "build") == NULL, "json nested key not split");

    CHECK(find_symbol(list, "list") != NULL, "json array value");
    CHECK(cberg_chunk_list_hash_bodies(list, src, strlen(src)) == CBERG_OK, "json hash");
    cberg_chunk_list_free(list);

    /* Non-object roots fall back to window chunks. */
    const char *arr = "[1, 2, 3]\n";
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "data.json", arr, strlen(arr), &list) == CBERG_OK, "json array parse");
    CHECK(cberg_chunk_list_len(list) == 1, "json array one chunk");
    CHECK(cberg_chunk_list_at(list, 0)->kind == CBERG_CHUNK_WINDOW, "json array window kind");
    cberg_chunk_list_free(list);
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

static void test_json_empty_object(cberg_chunker *ch) {
    const char *src = "{}";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "empty.json", src, strlen(src), &list) == CBERG_OK, "json empty parse");
    CHECK(cberg_chunk_list_len(list) == 1, "json empty window fallback");
    CHECK(cberg_chunk_list_at(list, 0)->kind == CBERG_CHUNK_WINDOW, "json empty window kind");
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

static void test_json_malformed(cberg_chunker *ch) {
    const char *src = "{ foo: 1 }\n";
    cberg_chunk_list *list = NULL;
    CHECK(cberg_chunker_parse(ch, CBERG_LANG_JSON, "bad.json", src, strlen(src), &list) == CBERG_OK, "json malformed parse");
    CHECK(cberg_chunk_list_len(list) == 1, "json malformed window fallback");
    CHECK(cberg_chunk_list_at(list, 0)->kind == CBERG_CHUNK_WINDOW, "json malformed window kind");
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
    CHECK(count_symbol(list, "big") >= 2, "json big key split into multiple chunks");
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

int main(void) {
    CHECK(cberg_language_from_path("a.go") == CBERG_LANG_GO, "lang go");
    CHECK(cberg_language_from_path("config.yaml") == CBERG_LANG_YAML, "lang yaml");
    CHECK(cberg_language_from_path("config.yml") == CBERG_LANG_YAML, "lang yml");
    CHECK(cberg_language_from_path("Cargo.toml") == CBERG_LANG_TOML, "lang toml");
    CHECK(cberg_language_from_path("package.json") == CBERG_LANG_JSON, "lang json");
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    test_go(ch);
    test_window(ch);
    test_yaml(ch);
    test_toml(ch);
    test_json(ch);
    test_json_jsonc(ch);
    test_json_empty_object(ch);
    test_json_trailing(ch);
    test_json_malformed(ch);
    test_json_line_split(ch);
    test_json_long_key(ch);
    test_yaml_flow_style(ch);
    cberg_chunker_close(ch);
    return failures == 0 ? 0 : 1;
}
