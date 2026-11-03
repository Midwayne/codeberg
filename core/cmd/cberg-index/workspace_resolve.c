#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "fileio.h"
#include "json_fields.h"
#include "workspace_graph.h"

typedef struct workspace_file {
    uint64_t id;
    size_t repo;
    cberg_language language;
    char *native;
    char *path;
    char *relative;
    char package[256];
} workspace_file;

typedef struct workspace_package {
    char go_module[256];
    char js_name[256];
    char rust_name[256];
    char *json;
} workspace_package;

typedef struct workspace_files {
    workspace_file *files;
    char **paths;
    size_t count;
    workspace_package *packages;
    cberg_engine *engine;
    cberg_graph *graph;
} workspace_files;

static void read_rust_package(const char *root, char *name, size_t capacity) {
    char path[4096];
    snprintf(path, sizeof path, "%s/Cargo.toml", root);
    size_t length = 0;
    char *body = cberg_read_file(path, &length);
    if (body == NULL)
        return;
    if (strstr(body, "[lib]") != NULL) {
        free(body);
        return;
    }
    int package = 0;
    char *state = NULL;
    for (char *line = strtok_r(body, "\n", &state); line != NULL; line = strtok_r(NULL, "\n", &state)) {
        while (isspace((unsigned char)*line))
            line++;
        if (*line == '[')
            package = strncmp(line, "[package]", 9) == 0;
        if (!package || strncmp(line, "name", 4) != 0)
            continue;
        line += 4;
        while (isspace((unsigned char)*line))
            line++;
        if (*line++ != '=')
            continue;
        while (isspace((unsigned char)*line))
            line++;
        char quote = *line++;
        if (quote != '"' && quote != '\'')
            continue;
        char *end = strchr(line, quote);
        if (end == NULL || (size_t)(end - line) >= capacity)
            continue;
        memcpy(name, line, (size_t)(end - line));
        name[end - line] = '\0';
        for (char *p = name; *p != '\0'; p++)
            if (*p == '-')
                *p = '_';
        break;
    }
    free(body);
}

static void read_source_package(workspace_file *file) {
    if (file->language != CBERG_LANG_JAVA && file->language != CBERG_LANG_KOTLIN)
        return;
    size_t length = 0;
    char *body = cberg_read_file(file->native, &length);
    if (body == NULL)
        return;
    char *p = body;
    for (;;) {
        while (isspace((unsigned char)*p))
            p++;
        if (strncmp(p, "//", 2) == 0) {
            p += strcspn(p, "\n");
        } else if (strncmp(p, "/*", 2) == 0) {
            char *end = strstr(p + 2, "*/");
            if (end == NULL)
                break;
            p = end + 2;
        } else {
            if (strncmp(p, "package", 7) != 0 || !isspace((unsigned char)p[7]))
                break;
            p += 7;
            while (isspace((unsigned char)*p))
                p++;
            size_t count = 0;
            while (isalnum((unsigned char)p[count]) || p[count] == '_' || p[count] == '.')
                count++;
            if (count > 0 && count < sizeof file->package) {
                memcpy(file->package, p, count);
                file->package[count] = '\0';
            }
            break;
        }
    }
    free(body);
}

static void read_package(cberg_repo *repo, workspace_package *package) {
    char path[4096];
    snprintf(path, sizeof path, "%s/go.mod", repo->root);
    size_t length = 0;
    char *body = cberg_read_file(path, &length);
    if (body != NULL) {
        char *state = NULL;
        for (char *line = strtok_r(body, "\n", &state); line != NULL; line = strtok_r(NULL, "\n", &state)) {
            while (isspace((unsigned char)*line))
                line++;
            if (strncmp(line, "module", 6) != 0 || !isspace((unsigned char)line[6]))
                continue;
            line += 6;
            while (isspace((unsigned char)*line))
                line++;
            if (*line == '"')
                line++;
            size_t count = strcspn(line, "\" \t\r\n");
            if (count != 0 && count < sizeof package->go_module) {
                memcpy(package->go_module, line, count);
                package->go_module[count] = '\0';
            }
            break;
        }
        free(body);
    }

    snprintf(path, sizeof path, "%s/package.json", repo->root);
    package->json = cberg_read_file(path, &length);
    cberg_json_string_copy(cberg_json_object_field(package->json, "name"), package->js_name, sizeof package->js_name);
    read_rust_package(repo->root, package->rust_name, sizeof package->rust_name);
}

static void files_free(workspace_files *files) {
    for (size_t i = 0; i < files->count; i++) {
        free(files->files[i].native);
        free(files->files[i].path);
        free(files->files[i].relative);
    }
    for (size_t i = 0; i < files->engine->repos_len; i++)
        free(files->packages != NULL ? files->packages[i].json : NULL);
    free(files->packages);
    free(files->files);
    free(files->paths);
}

static cberg_status files_open(workspace_files *files, cberg_graph *graph, cberg_engine *engine) {
    files->engine = engine;
    files->graph = graph;
    size_t nodes = 0, count = 0;
    cberg_graph_counts(graph, &nodes, NULL);
    const cberg_graph_node **all = calloc(nodes + 1, sizeof(*all));
    files->files = calloc(nodes + 1, sizeof(*files->files));
    files->paths = calloc(nodes + 1, sizeof(*files->paths));
    files->packages = calloc(engine->repos_len, sizeof(*files->packages));
    if (all == NULL || files->files == NULL || files->paths == NULL || files->packages == NULL) {
        free(all);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    for (size_t i = 0; i < engine->repos_len; i++)
        read_package(engine->repos[i], &files->packages[i]);
    cberg_status status = cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, all, nodes + 1, &count);
    for (size_t i = 0; i < count && status == CBERG_OK; i++) {
        const char *repo = cberg_graph_source_repo(graph, all[i]->id);
        size_t owner = 0;
        while (owner < engine->repos_len && strcmp(engine->repos[owner]->key, repo) != 0)
            owner++;
        if (owner == engine->repos_len)
            continue;

        workspace_file *file = &files->files[files->count++];
        file->id = all[i]->id;
        file->repo = owner;
        file->language = all[i]->lang;
        file->relative = strdup(cberg_graph_source_path(graph, all[i]));
        file->path = strdup(all[i]->path);
        size_t length = strlen(engine->repos[owner]->root) + strlen(cberg_graph_source_path(graph, all[i])) + 2;
        file->native = malloc(length);
        if (file->relative == NULL || file->path == NULL || file->native == NULL) {
            status = CBERG_ERR_OUT_OF_MEMORY;
            break;
        }
        snprintf(file->native, length, "%s/%s", engine->repos[owner]->root, file->relative);
        read_source_package(file);
        files->paths[files->count - 1] = file->native + 1;
    }
    free(all);
    return status;
}

static const workspace_file *relative_target(const workspace_files *files, const char *source, const char *import) {
    const char *path = cberg_graph_relative_file(source + 1, import, files->paths, files->count);
    if (path == NULL)
        return NULL;
    for (size_t i = 0; i < files->count; i++) {
        if (path == files->paths[i])
            return &files->files[i];
    }
    return NULL;
}

static const workspace_file *go_target(const workspace_files *files, const char *import) {
    size_t owner = SIZE_MAX, best = 0;
    int ambiguous = 0;
    for (size_t i = 0; i < files->engine->repos_len; i++) {
        const char *module = files->packages[i].go_module;
        size_t length = strlen(module);
        if (length == 0 || strncmp(import, module, length) != 0 ||
            (import[length] != '\0' && import[length] != '/'))
            continue;
        if (length > best) {
            best = length;
            owner = i;
            ambiguous = 0;
        } else if (length == best)
            ambiguous = 1;
    }
    if (owner == SIZE_MAX || ambiguous)
        return NULL;

    const char *folder = import + best;
    if (*folder == '/')
        folder++;
    size_t length = strlen(folder);
    for (size_t i = 0; i < files->count; i++) {
        const workspace_file *file = &files->files[i];
        if (file->repo != owner || file->language != CBERG_LANG_GO)
            continue;
        const char *slash = strrchr(file->relative, '/');
        size_t directory = slash != NULL ? (size_t)(slash - file->relative) : 0;
        if (directory == length && strncmp(file->relative, folder, length) == 0)
            return file;
    }
    return NULL;
}

static const workspace_file *js_entry_target(const workspace_files *files, size_t owner, const char *value) {
    char entry[1024], source[4096];
    if (cberg_json_string_copy(value, entry, sizeof entry) != 0 || entry[0] == '/')
        return NULL;

    snprintf(source, sizeof source, "%s/__package__.ts", files->engine->repos[owner]->root);
    const workspace_file *target = relative_target(files, source, entry);
    return target != NULL && target->repo == owner ? target : NULL;
}

static const workspace_file *js_entry_fields(const workspace_files *files, size_t owner, const char *object, const char *const *fields, size_t count) {
    for (size_t i = 0; i < count; i++) {
        const char *value = cberg_json_object_field(object, fields[i]);
        const workspace_file *target = js_entry_target(files, owner, value);
        if (target != NULL)
            return target;
    }
    return NULL;
}

static const workspace_file *js_entry(const workspace_files *files, size_t owner, const char *suffix) {
    const workspace_package *package = &files->packages[owner];
    const char *exports = cberg_json_object_field(package->json, "exports");
    if (exports != NULL) {
        if (*exports == '{') {
            char key[512];
            int length = snprintf(key, sizeof key, ".%s", suffix);
            if (length < 0 || (size_t)length >= sizeof key)
                return NULL;
            const char *subpath = cberg_json_object_field(exports, key);
            if (subpath != NULL)
                exports = subpath;
            else if (suffix[0] != '\0')
                return NULL;
            if (*exports == '{') {
                /* Prefer implementation evidence; unavailable entries must not
                 * hide a later supported entry that is actually indexed. */
                const char *fields[] = {"import", "default", "require", "types"};
                return js_entry_fields(files, owner, exports, fields, sizeof fields / sizeof fields[0]);
            }
        } else if (suffix[0] != '\0')
            return NULL;
        return js_entry_target(files, owner, exports);
    }
    if (suffix[0] != '\0') {
        char entry[1024];
        int length = snprintf(entry, sizeof entry, "\".%s\"", suffix);
        return length >= 0 && (size_t)length < sizeof entry ? js_entry_target(files, owner, entry) : NULL;
    }
    const char *fields[] = {"module", "main", "types"};
    const workspace_file *target = js_entry_fields(files, owner, package->json, fields, sizeof fields / sizeof fields[0]);
    return target != NULL ? target : js_entry_target(files, owner, "\"./index\"");
}

static const workspace_file *js_target(const workspace_files *files, const char *import) {
    size_t owner = SIZE_MAX, length = 0;
    for (size_t i = 0; i < files->engine->repos_len; i++) {
        const char *name = files->packages[i].js_name;
        size_t count = strlen(name);
        if (count == 0 || strncmp(import, name, count) != 0 || (import[count] != '\0' && import[count] != '/'))
            continue;
        if (owner != SIZE_MAX)
            return NULL;
        owner = i;
        length = count;
    }
    if (owner == SIZE_MAX)
        return NULL;

    return js_entry(files, owner, import + length);
}

static int file_defines(const workspace_files *files, const workspace_file *file, const char *symbol) {
    cberg_repo *repo = files->engine->repos[file->repo];
    const cberg_graph_node *nodes[64];
    size_t count = 0;
    if (cberg_graph_find_nodes(repo->graph, symbol, 0, file->relative, nodes, 64, &count) != CBERG_OK)
        return 0;
    for (size_t i = 0; i < count; i++) {
        if (nodes[i]->path != NULL && strcmp(nodes[i]->path, file->relative) == 0)
            return 1;
    }
    return 0;
}

static const workspace_file *jvm_target(const workspace_files *files, cberg_language language, const char *import) {
    const workspace_file *found = NULL;
    for (size_t i = 0; i < files->count; i++) {
        const workspace_file *file = &files->files[i];
        size_t length = strlen(file->package);
        if (file->language != language || length == 0 || strncmp(import, file->package, length) != 0 || import[length] != '.')
            continue;
        const char *symbol = import + length + 1;
        size_t count = strcspn(symbol, ". ");
        char name[256];
        if (count == 0 || count >= sizeof name)
            continue;
        memcpy(name, symbol, count);
        name[count] = '\0';
        if (!file_defines(files, file, name))
            continue;
        if (found != NULL)
            return NULL;
        found = file;
    }
    return found;
}

static const workspace_file *python_target(const workspace_files *files, const char *import) {
    char path[1024];
    if (strlen(import) + 16 >= sizeof path || import[0] == '.')
        return NULL;
    snprintf(path, sizeof path, "%s", import);
    for (char *p = path; *p != '\0'; p++)
        if (*p == '.')
            *p = '/';
    size_t length = strlen(path);
    const workspace_file *found = NULL;
    for (size_t i = 0; i < files->count; i++) {
        const workspace_file *file = &files->files[i];
        if (file->language != CBERG_LANG_PYTHON)
            continue;
        const char *relative = file->relative;
        if (strncmp(relative, "src/", 4) == 0)
            relative += 4;
        if (strncmp(relative, path, length) != 0)
            continue;
        if (strcmp(relative + length, ".py") != 0 && strcmp(relative + length, "/__init__.py") != 0)
            continue;
        if (found != NULL)
            return NULL;
        found = file;
    }
    return found;
}

static const workspace_file *rust_target(const workspace_files *files, const char *import) {
    const char *separator = strstr(import, "::");
    if (separator == NULL)
        return NULL;
    size_t length = (size_t)(separator - import);
    size_t owner = SIZE_MAX;
    for (size_t i = 0; i < files->engine->repos_len; i++) {
        const char *name = files->packages[i].rust_name;
        if (strlen(name) != length || strncmp(name, import, length) != 0)
            continue;
        if (owner != SIZE_MAX)
            return NULL;
        owner = i;
    }
    if (owner == SIZE_MAX)
        return NULL;
    const workspace_file *found = NULL;
    const char *symbol = strrchr(import, ':');
    char name[256];
    size_t count = strcspn(symbol + 1, " ");
    if (count == 0 || count >= sizeof name)
        return NULL;
    memcpy(name, symbol + 1, count);
    name[count] = '\0';
    char module[512] = {0}, flat[1024], directory[1024];
    size_t used = 0;
    for (const char *p = separator + 2; p < symbol - 1; p++) {
        if (used + 1 >= sizeof module)
            return NULL;
        if (*p == ':' && p + 1 < symbol - 1 && p[1] == ':') {
            module[used++] = '/';
            p++;
        } else {
            module[used++] = *p;
        }
    }
    if (used == 0)
        snprintf(flat, sizeof flat, "src/lib.rs");
    else
        snprintf(flat, sizeof flat, "src/%s.rs", module);
    snprintf(directory, sizeof directory, "src/%s/mod.rs", module);
    for (size_t i = 0; i < files->count; i++) {
        const workspace_file *file = &files->files[i];
        if (file->repo != owner || file->language != CBERG_LANG_RUST || !file_defines(files, file, name))
            continue;
        if (strcmp(file->relative, flat) != 0 && (used == 0 || strcmp(file->relative, directory) != 0))
            continue;
        if (found != NULL)
            return NULL;
        found = file;
    }
    return found;
}

static const workspace_file *import_target(const workspace_files *files, const workspace_file *source, const char *import) {
    if (strncmp(import, "./", 2) == 0 || strncmp(import, "../", 3) == 0 || source->language == CBERG_LANG_C) {
        return relative_target(files, source->native, import);
    }
    if (source->language == CBERG_LANG_GO)
        return go_target(files, import);
    if (source->language == CBERG_LANG_PYTHON)
        return python_target(files, import);
    if (source->language == CBERG_LANG_JAVA || source->language == CBERG_LANG_KOTLIN)
        return jvm_target(files, source->language, import);
    if (source->language == CBERG_LANG_RUST)
        return rust_target(files, import);
    if (source->language == CBERG_LANG_TYPESCRIPT || source->language == CBERG_LANG_JAVASCRIPT)
        return js_target(files, import);
    return NULL;
}

cberg_status cberg_workspace_resolve(cberg_graph *graph, cberg_engine *engine) {
    workspace_files files = {0};
    cberg_status status = files_open(&files, graph, engine);
    size_t refs = 0;
    cberg_graph_counts(graph, NULL, &refs);
    cberg_graph_edge *edges = calloc(refs + 1, sizeof(*edges));
    if (edges == NULL)
        status = CBERG_ERR_OUT_OF_MEMORY;

    for (size_t i = 0; i < files.count && status == CBERG_OK; i++) {
        workspace_file *file = &files.files[i];
        size_t count = 0;
        status = cberg_graph_edges_from(graph, file->id, CBERG_GEDGE_IMPORTS, edges, refs + 1, &count);
        for (size_t j = 0; j < count && status == CBERG_OK; j++) {
            const cberg_graph_node *module = cberg_graph_node_by_id(graph, edges[j].dst);
            if (module == NULL || module->kind != CBERG_GNODE_MODULE)
                continue;
            const workspace_file *target = import_target(&files, file, module->name);
            if (target != NULL)
                status = cberg_graph_link_import(graph, file->id, module->id, target->path);
        }
    }
    free(edges);
    files_free(&files);
    return status;
}
