/*
 * Import resolution: relative / module-prefixed imports rewrite to FILE nodes;
 * bare stdlib names (fmt, json) must stay MODULE targets.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "codeberg/codeberg.h"
#include "test_common.h"
#include "test_graph_common.h"

static const cberg_graph_node *file_by_path(graph_corpus *c, const char *path) {
    const cberg_graph_node *nodes[64];
    size_t n = 0;
    if (cberg_graph_find_nodes(c->graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), path, nodes, 64, &n) != CBERG_OK) {
        return NULL;
    }
    for (size_t i = 0; i < n; i++) {
        if (nodes[i]->qname != NULL && strcmp(nodes[i]->qname, path) == 0) {
            return nodes[i];
        }
    }
    return n > 0 ? nodes[0] : NULL;
}

static int edge_to_file(graph_corpus *c, const char *src_file, const char *dst_path) {
    const cberg_graph_node *file = file_by_path(c, src_file);
    if (file == NULL) {
        return 0;
    }
    cberg_graph_edge edges[16];
    size_t n = 0;
    if (cberg_graph_edges_from(c->graph, file->id, CBERG_GEDGE_IMPORTS, edges, 16, &n) != CBERG_OK) {
        return 0;
    }
    for (size_t i = 0; i < n; i++) {
        const cberg_graph_node *dst = cberg_graph_node_by_id(c->graph, edges[i].dst);
        if (dst == NULL) {
            continue;
        }
        if (dst->kind == CBERG_GNODE_FILE && dst->qname != NULL && strcmp(dst->qname, dst_path) == 0) {
            return edges[i].resolution == CBERG_GRES_IMPORT;
        }
    }
    return 0;
}

static int still_module(graph_corpus *c, const char *src_file, const char *mod_name) {
    const cberg_graph_node *file = file_by_path(c, src_file);
    if (file == NULL) {
        return 0;
    }
    cberg_graph_edge edges[16];
    size_t n = 0;
    if (cberg_graph_edges_from(c->graph, file->id, CBERG_GEDGE_IMPORTS, edges, 16, &n) != CBERG_OK) {
        return 0;
    }
    for (size_t i = 0; i < n; i++) {
        const cberg_graph_node *dst = cberg_graph_node_by_id(c->graph, edges[i].dst);
        if (dst != NULL && dst->kind == CBERG_GNODE_MODULE && dst->name != NULL && strcmp(dst->name, mod_name) == 0) {
            return 1;
        }
    }
    return 0;
}

static void ensure_parent(const char *path) {
    char tmp[4096];
    snprintf(tmp, sizeof tmp, "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0777);
            *p = '/';
        }
    }
}

static void write_file(const char *root, const char *rel, const char *body) {
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, rel);
    ensure_parent(path);
    FILE *f = fopen(path, "wb");
    CHECK(f != NULL, "open write");
    if (f != NULL) {
        fputs(body, f);
        fclose(f);
    }
}

static void rm_tree(const char *root) {
    char cmd[4200];
    snprintf(cmd, sizeof cmd, "rm -rf '%s'", root);
    (void)system(cmd);
}

static void test_stdlib_not_rewritten(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    write_file(root, "go.mod", "module example.com/app\n\ngo 1.22\n");
    write_file(root, "fmt.go", "package main\n\nfunc FmtHelper() {}\n");
    write_file(root, "main.go",
               "package main\n\n"
               "import \"fmt\"\n\n"
               "func main() { fmt.Println(\"x\") }\n");

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "fmt.go", "package main\n\nfunc FmtHelper() {}\n") == CBERG_OK, "index fmt.go");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "main.go",
                       "package main\n\n"
                       "import \"fmt\"\n\n"
                       "func main() { fmt.Println(\"x\") }\n") == CBERG_OK,
          "index main.go");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve");
    CHECK(still_module(&c, "main.go", "fmt"), "fmt stays MODULE (stdlib)");
    CHECK(!edge_to_file(&c, "main.go", "fmt.go"), "fmt not rewritten to fmt.go");

    corpus_close(&c);
    rm_tree(root);
}

static void test_relative_and_module_path(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    write_file(root, "go.mod", "module example.com/app\n\ngo 1.22\n");
    write_file(root, "internal/helper/helper.go", "package helper\n\nfunc Help() {}\n");
    write_file(root, "pkg/util.go", "package pkg\n\nfunc Util() {}\n");

    const char *helper_src = "package helper\n\nfunc Help() {}\n";
    const char *util_src = "package pkg\n\nfunc Util() {}\n";
    const char *main_src =
        "package main\n\n"
        "import (\n"
        "\t\"example.com/app/internal/helper\"\n"
        "\t\"example.com/app/pkg\"\n"
        ")\n\n"
        "func main() {}\n";
    write_file(root, "main.go", main_src);

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "internal/helper/helper.go", helper_src) == CBERG_OK, "index helper");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "pkg/util.go", util_src) == CBERG_OK, "index util");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "main.go", main_src) == CBERG_OK, "index main");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve");
    CHECK(edge_to_file(&c, "main.go", "internal/helper/helper.go"), "module path → helper FILE");
    CHECK(edge_to_file(&c, "main.go", "pkg/util.go"), "module path → pkg FILE");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve again");
    CHECK(edge_to_file(&c, "main.go", "internal/helper/helper.go"), "still helper after re-resolve");

    corpus_close(&c);
    rm_tree(root);
}

static void test_ts_relative(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    write_file(root, "package.json", "{\"name\":\"app\"}\n");
    write_file(root, "helper.ts", "export function help() {}\n");
    write_file(root, "json.ts", "export const x = 1;\n");
    write_file(root, "app.ts", "import { help } from \"./helper\";\nexport const n = help();\n");

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, "helper.ts", "export function help() {}\n") == CBERG_OK, "index helper");
    CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, "json.ts", "export const x = 1;\n") == CBERG_OK, "index json");
    CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, "app.ts",
                       "import { help } from \"./helper\";\nexport const n = help();\n") == CBERG_OK,
          "index app");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve");
    CHECK(edge_to_file(&c, "app.ts", "helper.ts"), "./helper → helper.ts");

    corpus_close(&c);
    rm_tree(root);
}

int main(void) {
    test_stdlib_not_rewritten();
    test_relative_and_module_path();
    test_ts_relative();
    if (failures == 0) {
        printf("ok - resolve_imports\n");
    }
    TEST_MAIN_RETURN
}
