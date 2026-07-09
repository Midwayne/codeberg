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

static void test_slash_stdlib_not_rewritten(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    /* Leading comments before module line must still be parsed. */
    write_file(root, "go.mod", "// comment\n\nmodule example.com/app\n\ngo 1.22\n");
    write_file(root, "encoding/json.go", "package encoding\n\nfunc Fake() {}\n");
    const char *main_src =
        "package main\n\n"
        "import (\n"
        "\t\"encoding/json\"\n"
        "\t\"fmt\"\n"
        ")\n\n"
        "func main() {}\n";
    write_file(root, "main.go", main_src);

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "encoding/json.go", "package encoding\n\nfunc Fake() {}\n") == CBERG_OK,
          "index decoy");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "main.go", main_src) == CBERG_OK, "index main");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve");
    CHECK(still_module(&c, "main.go", "encoding/json"), "encoding/json stays MODULE");
    CHECK(still_module(&c, "main.go", "fmt"), "fmt stays MODULE");
    CHECK(!edge_to_file(&c, "main.go", "encoding/json.go"), "not rewritten to decoy");

    corpus_close(&c);
    rm_tree(root);
}

static void test_rust_crate_path(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    write_file(root, "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n");
    write_file(root, "src/helper.rs", "pub fn help() {}\n");
    const char *main_src = "use crate::helper;\nfn main() {}\n";
    write_file(root, "src/main.rs", main_src);

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    CHECK(corpus_index(&c, CBERG_LANG_RUST, "src/helper.rs", "pub fn help() {}\n") == CBERG_OK, "index helper");
    CHECK(corpus_index(&c, CBERG_LANG_RUST, "src/main.rs", main_src) == CBERG_OK, "index main");

    /* Precondition: extractor captured the crate:: path (same query as std::fmt::Debug). */
    CHECK(still_module(&c, "src/main.rs", "crate::helper"), "rust use crate::helper captured");

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve");
    CHECK(!still_module(&c, "src/main.rs", "crate::helper"), "crate::helper rewritten off MODULE");
    CHECK(edge_to_file(&c, "src/main.rs", "src/helper.rs"), "crate::helper → src/helper.rs");

    corpus_close(&c);
    rm_tree(root);
}

/* More than 64 relative imports must all rewrite (no silent 64-cap truncation).
 * Also exercises rewrite_import → maybe_compact while iterating many files:
 * file IDs (not node pointers) must remain valid across compaction. */
static void test_many_relative_imports(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    const int n = 65;
    char *body = malloc((size_t)n * 32 + 64);
    CHECK(body != NULL, "alloc body");
    if (body == NULL) {
        rm_tree(root);
        return;
    }
    size_t off = 0;
    for (int i = 0; i < n; i++) {
        char path[64];
        snprintf(path, sizeof path, "m%d.ts", i);
        write_file(root, path, "export const x = 1;\n");
        off += (size_t)snprintf(body + off, 32, "import \"./m%d\";\n", i);
    }
    write_file(root, "app.ts", body);
    free(body);

    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");
    for (int i = 0; i < n; i++) {
        char path[64];
        snprintf(path, sizeof path, "m%d.ts", i);
        CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, path, "export const x = 1;\n") == CBERG_OK, "index module");
    }
    /* Rebuild app.ts source for indexing. */
    body = malloc((size_t)n * 32 + 64);
    CHECK(body != NULL, "alloc body2");
    if (body == NULL) {
        corpus_close(&c);
        rm_tree(root);
        return;
    }
    off = 0;
    for (int i = 0; i < n; i++) {
        off += (size_t)snprintf(body + off, 32, "import \"./m%d\";\n", i);
    }
    CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, "app.ts", body) == CBERG_OK, "index app");
    free(body);

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve many");

    const cberg_graph_node *app = file_by_path(&c, "app.ts");
    CHECK(app != NULL, "app.ts file node");
    if (app != NULL) {
        cberg_graph_edge edges[128];
        size_t ne = 0;
        CHECK(cberg_graph_edges_from(c.graph, app->id, CBERG_GEDGE_IMPORTS, edges, 128, &ne) == CBERG_OK, "list imports");
        CHECK(ne == (size_t)n, "all imports present");
        size_t resolved = 0;
        for (size_t i = 0; i < ne; i++) {
            const cberg_graph_node *dst = cberg_graph_node_by_id(c.graph, edges[i].dst);
            if (dst != NULL && dst->kind == CBERG_GNODE_FILE && edges[i].resolution == CBERG_GRES_IMPORT) {
                resolved++;
            }
        }
        CHECK(resolved == (size_t)n, "all 65 relative imports rewrite to FILE");
    }

    corpus_close(&c);
    rm_tree(root);
}

/* Enough rewrites to trip GRAPH_COMPACT_MIN_DEAD while resolve still walks
 * remaining file IDs — catches UAF if node pointers were cached across compact. */
static void test_resolve_survives_compact(void) {
    char tmpl[] = "/tmp/cberg_resolve_XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return;
    }

    const int n_files = 8;
    const int imports_per = 40; /* 8*40 = 320 rewrites > compact threshold */
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "corpus open");

    for (int f = 0; f < n_files; f++) {
        for (int i = 0; i < imports_per; i++) {
            char path[64];
            snprintf(path, sizeof path, "lib/f%dm%d.ts", f, i);
            write_file(root, path, "export const x = 1;\n");
            CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, path, "export const x = 1;\n") == CBERG_OK, "index lib");
        }
        size_t body_cap = (size_t)imports_per * 48 + 64;
        char *body = malloc(body_cap);
        CHECK(body != NULL, "body");
        if (body == NULL) {
            corpus_close(&c);
            rm_tree(root);
            return;
        }
        size_t off = 0;
        for (int i = 0; i < imports_per; i++) {
            off += (size_t)snprintf(body + off, body_cap - off, "import \"./lib/f%dm%d\";\n", f, i);
        }
        char app[64];
        snprintf(app, sizeof app, "app%d.ts", f);
        write_file(root, app, body);
        CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, app, body) == CBERG_OK, "index appN");
        free(body);
    }

    CHECK(cberg_graph_resolve_imports(c.graph, root) == CBERG_OK, "resolve under compact pressure");

    size_t resolved_apps = 0;
    for (int f = 0; f < n_files; f++) {
        char app[64];
        snprintf(app, sizeof app, "app%d.ts", f);
        const cberg_graph_node *node = file_by_path(&c, app);
        if (node == NULL) {
            continue;
        }
        cberg_graph_edge edges[64];
        size_t ne = 0;
        if (cberg_graph_edges_from(c.graph, node->id, CBERG_GEDGE_IMPORTS, edges, 64, &ne) != CBERG_OK) {
            continue;
        }
        size_t ok = 0;
        for (size_t i = 0; i < ne; i++) {
            const cberg_graph_node *dst = cberg_graph_node_by_id(c.graph, edges[i].dst);
            if (dst != NULL && dst->kind == CBERG_GNODE_FILE && edges[i].resolution == CBERG_GRES_IMPORT) {
                ok++;
            }
        }
        if (ok == (size_t)imports_per) {
            resolved_apps++;
        }
    }
    CHECK(resolved_apps == (size_t)n_files, "all apps fully resolved after compact");

    corpus_close(&c);
    rm_tree(root);
}

int main(void) {
    test_stdlib_not_rewritten();
    test_slash_stdlib_not_rewritten();
    test_relative_and_module_path();
    test_ts_relative();
    test_rust_crate_path();
    test_many_relative_imports();
    test_resolve_survives_compact();
    if (failures == 0) {
        printf("ok - resolve_imports\n");
    }
    TEST_MAIN_RETURN
}
