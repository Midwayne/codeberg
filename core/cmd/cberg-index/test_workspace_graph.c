#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "../../test/test_common.h"
#include "indexer.h"

static void put(const char *root, const char *file, const char *body) {
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, file);
    for (char *slash = path + strlen(root) + 1; *slash != '\0'; slash++) {
        if (*slash != '/')
            continue;
        *slash = '\0';
        mkdir(path, 0700);
        *slash = '/';
    }
    FILE *stream = fopen(path, "w");
    CHECK(stream != NULL, "open fixture source");
    if (stream != NULL) {
        fputs(body, stream);
        fclose(stream);
    }
}

typedef struct cross_case {
    const char *language, *caller, *source_path, *source, *target_path, *target;
} cross_case;

static const cross_case cases[] = {
    {"go", "go_run", "cross.go", "package api\nimport db \"example.com/storage\"\nfunc go_run() { db.Save() }\n", "main.go", "package storage\nfunc Save() { Write() }\nfunc Write() {}\n"},
    {"typescript", "ts_run", "main.ts", "import { save as persist } from '@quality/storage';\nexport function ts_run() { persist(); }\n", "src/index.ts", "export function save() {}\n"},
    {"javascript", "js_run", "main.js", "import { save } from '../storage/source.js';\nexport function js_run() { save(); }\n", "source.js", "export function save() {}\n"},
    {"c", "c_run", "main.c", "#include \"../storage/save.h\"\nvoid c_run(void) { save(); }\n", "save.h", "static inline void save(void) {}\n"},
    {"python", "python_run", "main.py", "from storage.api import save\ndef python_run():\n    save()\n", "storage/api.py", "def save():\n    pass\n"},
    {"java", "java_run", "Main.java", "import storage.Store;\nclass Main { static void java_run() { Store.save(); } }\n", "src/storage/Store.java", "package storage;\npublic class Store { public static void save() {} }\n"},
    {"kotlin", "kotlin_run", "main.kt", "import storage.save\nfun kotlin_run() { save() }\n", "src/storage/Store.kt", "package storage\nfun save() {}\n"},
    {"rust", "rust_run", "src/main.rs", "use storage::save;\nfn rust_run() { save(); }\n", "src/lib.rs", "pub fn save() {}\n"},
    {"ruby", "ruby_run", "main.rb", "require_relative '../storage/lib/storage'\ndef ruby_run\n  Storage.save()\nend\n", "lib/storage.rb", "module Storage\n  def self.save\n  end\nend\n"},
};

static void remove_tree(const char *root) {
    DIR *directory = opendir(root);
    if (directory == NULL)
        return;
    struct dirent *entry;
    while ((entry = readdir(directory)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0)
            continue;
        char path[4096];
        snprintf(path, sizeof path, "%s/%s", root, entry->d_name);
        struct stat info;
        if (lstat(path, &info) == 0 && S_ISDIR(info.st_mode))
            remove_tree(path);
        else
            unlink(path);
    }
    closedir(directory);
    rmdir(root);
}

static void check_languages(cberg_engine *engine) {
    for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
        cberg_engine_graph_hop hops[16];
        size_t count = 0, correct = 0;
        cberg_status status = cberg_engine_trace_path(engine, cases[i].caller, 0, "api", cases[i].source_path, "out", "calls", 1, 16, hops, 16, &count);
        CHECK(status == CBERG_OK, "cross-language caller query succeeds");
        for (size_t j = 0; j < count; j++) {
            correct += strcmp(hops[j].edge.src_repo, "api") == 0 && strcmp(hops[j].edge.dst_repo, "storage") == 0 &&
                       strcmp(hops[j].edge.src_name, cases[i].caller) == 0 &&
                       strcmp(hops[j].edge.dst_name, strcmp(cases[i].language, "go") == 0 ? "Save" : "save") == 0 &&
                       strcmp(hops[j].edge.dst_path, cases[i].target_path) == 0;
        }
        printf("{\"case\":\"cross-%s\",\"tp\":%zu,\"fp\":%zu,\"fn\":%d}\n",
               cases[i].language,
               correct,
               count - correct,
               correct == 0);
        CHECK(correct == 1 && count == 1, "one imported target, with qualified repository identities");
        cberg_engine_graph_edge refs[16];
        status = cberg_engine_graph_references(engine, strcmp(cases[i].language, "go") == 0 ? "Save" : "save", "decoy", NULL, 16, refs, 16, &count);
        CHECK(status == CBERG_OK && count == 0, "unrelated provider does not acquire cross-repo callers");
        printf("{\"case\":\"cross-%s-decoy\",\"tp\":0,\"fp\":%zu,\"fn\":0,\"negative_sites\":1}\n", cases[i].language, count);
    }
}

static void check_js_entrypoints(cberg_engine *engine, char paths[3][4096]) {
    const struct {
        const char *fields;
        size_t expected;
    } entries[] = {
        {"\"exports\":{\".\":{\"types\":\"./missing.d.ts\",\"import\":\"./src/index.ts\"}}", 1},
        {"\"exports\":{\".\":{\"types\":\"./index.d.ts\",\"import\":\"./src/index.ts\"}}", 1},
        {"\"types\":\"./missing.d.ts\",\"module\":\"./src/index.ts\"", 1},
        {"\"types\":\"./index.d.ts\",\"main\":\"./src/index.ts\"", 1},
        {"\"exports\":null,\"main\":\"./src/index.ts\"", 0},
        {"\"exports\":{\"./private\":\"./src/index.ts\"},\"main\":\"./src/index.ts\"", 0},
    };
    for (size_t i = 0; i < sizeof entries / sizeof entries[0]; i++) {
        char manifest[1024];
        snprintf(manifest, sizeof manifest, "{\"name\":\"@quality/storage\",%s}", entries[i].fields);
        put(paths[1], "package.json", manifest);
        cberg_engine_graph_hop hops[16];
        size_t count = 0;
        CHECK(cberg_engine_trace_path(engine, "ts_run", 0, "api", "main.ts", "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
              "query after package entrypoint change");
        CHECK(count == entries[i].expected, "try available implementation entrypoints while respecting exports");
        if (count == 1) {
            CHECK(strcmp(hops[0].edge.dst_repo, "storage") == 0 && strcmp(hops[0].edge.dst_path, "src/index.ts") == 0,
                  "package import resolves implementation instead of declaration file");
        }
    }
    put(paths[1], "package.json", "{\"name\":\"@quality/storage\",\"exports\":\"./src/index.ts\"}");
}

static void check_local_class(cberg_engine *engine) {
    cberg_engine_graph_hop hops[16];
    size_t count = 0;
    CHECK(cberg_engine_trace_path(engine, "local_run", 0, "api", "local.ts", "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
          "query locally shadowed imported class");
    CHECK(count == 3, "constructor, instance and static method calls resolve");
    for (size_t i = 0; i < count; i++) {
        CHECK(strcmp(hops[i].edge.dst_repo, "api") == 0 && strcmp(hops[i].edge.dst_path, "local.ts") == 0,
              "local class does not acquire methods from another repository");
    }
}

static void check_invalidation(cberg_engine *engine, char paths[3][4096]) {
    cberg_engine_graph_hop hops[16];
    size_t count = 0;
    put(paths[2], "go.mod", "module example.com/storage\n\ngo 1.22\n");
    CHECK(cberg_engine_trace_path(engine, "Run", 0, "api", NULL, "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
          "query after provider identity changes");
    CHECK(count == 0, "duplicate module identities stay unresolved");
    put(paths[2], "go.mod", "module example.com/decoy\n\ngo 1.22\n");
    CHECK(cberg_engine_trace_path(engine, "Run", 0, "api", NULL, "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
          "query after restoring unique provider");
    CHECK(count == 1, "manifest-only changes invalidate cached links");

    put(paths[2], "package.json", "{\"name\":\"@quality/storage\",\"exports\":\"./src/index.ts\"}");
    CHECK(cberg_engine_trace_path(engine, "ts_run", 0, "api", NULL, "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
          "query after duplicate JS package appears");
    CHECK(count == 0, "duplicate JS provider identities stay unresolved");
    char path[4096];
    snprintf(path, sizeof path, "%s/package.json", paths[2]);
    unlink(path);

    cberg_repo *provider = engine->repos[1];
    pthread_mutex_lock(&provider->mu);
    CHECK(cberg_graph_remove_file(provider->graph, "main.go") == CBERG_OK, "delete provider target");
    pthread_mutex_unlock(&provider->mu);
    CHECK(cberg_engine_trace_path(engine, "Run", 0, "api", NULL, "out", "calls", 1, 16, hops, 16, &count) == CBERG_OK,
          "query after provider deletion");
    CHECK(count == 0, "target deletion invalidates links without changing the importer");
}

static void check_workspace(cberg_engine *engine) {
    cberg_engine_graph_node nodes[16];
    size_t count = 0;
    struct timespec begin, cold, warm;
    clock_gettime(CLOCK_MONOTONIC, &begin);
    CHECK(cberg_engine_search_graph(engine, "Save", NULL, NULL, NULL, 16, nodes, 16, &count) == CBERG_OK,
          "search all workspace roots");
    clock_gettime(CLOCK_MONOTONIC, &cold);
    uintptr_t cache = (uintptr_t)engine->workspace_graph;
    for (size_t i = 0; i < 200; i++) {
        CHECK(cberg_engine_search_graph(engine, "Save", NULL, NULL, NULL, 16, nodes, 16, &count) == CBERG_OK,
              "cached workspace search succeeds");
    }
    clock_gettime(CLOCK_MONOTONIC, &warm);
    CHECK(cache == (uintptr_t)engine->workspace_graph, "unchanged queries reuse the workspace view");
    double cold_ms = (cold.tv_sec - begin.tv_sec) * 1000.0 + (cold.tv_nsec - begin.tv_nsec) / 1000000.0;
    double warm_ms = (warm.tv_sec - cold.tv_sec) * 1000.0 + (warm.tv_nsec - cold.tv_nsec) / 1000000.0;
    printf("{\"benchmark\":\"workspace_view\",\"cold_ms\":%.6f,\"warm_queries\":200,\"warm_total_ms\":%.6f}\n", cold_ms, warm_ms);
    CHECK(count == 2, "search includes provider and same-name decoy");
    cberg_engine_graph_stats stats;
    CHECK(cberg_engine_get_graph_stats(engine, NULL, &stats) == CBERG_OK, "workspace architecture aggregates roots");
    CHECK(stats.languages_len == 9, "workspace language mix includes every supported source language");
    size_t expected_nodes = 0;
    for (size_t i = 0; i < engine->repos_len; i++) {
        size_t nodes_in_repo = 0;
        cberg_graph_counts(engine->repos[i]->graph, &nodes_in_repo, NULL);
        expected_nodes += nodes_in_repo;
    }
    CHECK(stats.nodes == expected_nodes, "unscoped counts include every repository");

    cberg_engine_graph_edge refs[16];
    CHECK(cberg_engine_graph_references(engine, "Save", "storage", NULL, 16, refs, 16, &count) == CBERG_OK,
          "lookup provider references");
    CHECK(count == 2, "explicit dependency yields both cross-repo callers");
    if (count == 2) {
        CHECK(strcmp(refs[0].src_repo, "api") == 0, "caller comes from the importing repo");
        CHECK(strcmp(refs[0].dst_name, "Save") == 0, "callee comes from the provider");
    }

    cberg_engine_graph_hop hops[16];
    CHECK(cberg_engine_trace_path(engine, "Save", 0, NULL, NULL, "out", "calls", 2, 16, hops, 16, &count) == CBERG_ERR_INVALID_ARGUMENT,
          "ambiguous cross-repo trace requires an explicit starting repository");
    CHECK(cberg_engine_trace_path(engine, "Run", 0, "api", NULL, "out", "calls", 2, 16, hops, 16, &count) == CBERG_OK,
          "trace from importer");
    CHECK(count == 2, "trace crosses dependency and continues within the provider");

    CHECK(cberg_engine_graph_references(engine, "Save", "decoy", NULL, 16, refs, 16, &count) == CBERG_OK,
          "lookup decoy references");
    CHECK(count == 0, "same-name unrelated repository must not acquire the caller");

    CHECK(cberg_engine_graph_references(engine, "rareMethod", "storage", "many.ts", 16, refs, 16, &count) == CBERG_OK,
          "query many same-name definitions");
    CHECK(count == 1 && strcmp(refs[0].src_name, "rare_run") == 0,
          "reference lookup must inspect targets beyond the first 64 same-name definitions");
}

int main(void) {
    char workspace[] = "/tmp/cberg-workspace-graph-XXXXXX";
    char *root = mkdtemp(workspace);
    CHECK(root != NULL, "temporary workspace");
    if (root == NULL)
        return 1;

    const char *keys[] = {"api", "storage", "decoy"};
    char paths[3][4096], roots[16384] = {0};
    size_t used = 0;
    for (size_t i = 0; i < 3; i++) {
        snprintf(paths[i], sizeof paths[i], "%s/%s", root, keys[i]);
        CHECK(mkdir(paths[i], 0700) == 0, "create repository");
        used += (size_t)snprintf(roots + used, sizeof roots - used, "%s\t%s\n", keys[i], paths[i]);
        char manifest[256];
        snprintf(manifest, sizeof manifest, "module example.com/%s\n\ngo 1.22\n", keys[i]);
        put(paths[i], "go.mod", manifest);
    }

    put(paths[0], "main.go", "package api\nimport db \"example.com/storage\"\nfunc Run() { db.Save() }\n");
    put(paths[1], "main.go", "package storage\nfunc Save() { Write() }\nfunc Write() {}\n");
    put(paths[2], "main.go", "package decoy\nfunc Save() {}\n");
    put(paths[1], "package.json", "{\"private\":false,\"name\":\"@quality/storage\",\"exports\":\"./src/index.ts\"}");
    put(paths[1], "Cargo.toml", "[package]\nname = \"storage\"\nversion = \"0.1.0\"\n");
    for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
        put(paths[0], cases[i].source_path, cases[i].source);
        put(paths[1], cases[i].target_path, cases[i].target);
        if (strcmp(cases[i].language, "python") == 0) {
            put(paths[2], "unrelated/api.py", cases[i].target);
        } else if (strcmp(cases[i].language, "java") == 0) {
            put(paths[2], cases[i].target_path, "package unrelated;\nclass Store { static void save() {} }\n");
        } else if (strcmp(cases[i].language, "kotlin") == 0) {
            put(paths[2], cases[i].target_path, "package unrelated\nfun save() {}\n");
        } else {
            put(paths[2], cases[i].target_path, cases[i].target);
        }
    }
    char many[16384] = "export class Rare { rareMethod() {} }\n";
    size_t length = strlen(many);
    for (size_t i = 1; i < 70; i++) {
        length += (size_t)snprintf(many + length, sizeof many - length, "export class Other%zu { rareMethod() {} }\n", i);
    }
    put(paths[1], "many.ts", many);
    put(paths[0], "many.ts", "import { Rare } from '../storage/many';\nexport function rare_run(value: Rare) { value.rareMethod(); }\n");
    put(paths[1], "index.d.ts", "export declare function save(): void;\n");
    put(paths[1], "user.ts", "export class User { static storeLocalStatic() {} storeLocal() {} }\n");
    put(paths[0], "local.ts", "import { User } from '../storage/user';\nexport function local_run() {\n  class User { static storeLocalStatic() {} storeLocal() {} }\n  const user: User = new User();\n  user.storeLocal();\n  User.storeLocalStatic();\n}\n");
    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    setenv("CODEBERG_ROOTS", roots, 1);

    cberg_engine engine;
    cberg_status status = cberg_engine_open(&engine);
    CHECK(status == CBERG_OK, "open multi-repo chunk-only engine");
    if (status == CBERG_OK) {
        for (size_t i = 0; i < engine.repos_len; i++) {
            CHECK(cberg_repo_bootstrap(engine.repos[i]) == CBERG_OK, "bootstrap repository");
        }
        check_workspace(&engine);
        check_languages(&engine);
        check_js_entrypoints(&engine, paths);
        check_local_class(&engine);
        check_invalidation(&engine, paths);
        cberg_engine_close(&engine);
    }

    remove_tree(root);
    TEST_MAIN_RETURN
}
