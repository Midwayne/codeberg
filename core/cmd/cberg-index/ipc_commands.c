#include "ipc_internal.h"

#include "chunk_kind.h"
#include "ipc_json.h"

#include <stdlib.h>
#include <string.h>

/* ------------------------------------------------------------ replies */

static void send_error(int fd, const char *message) {
    ipc_json j;
    ipc_json_init(&j);

    ipc_json_raw(&j, "{\"ok\":false");
    ipc_json_field_str(&j, ',', "error", message);
    ipc_json_raw(&j, "}\n");

    if (j.failed) {
        const char *oom = "{\"ok\":false,\"error\":\"out of memory\"}\n";
        cberg_ipc_write_all(fd, oom, strlen(oom));
    } else {
        cberg_ipc_write_all(fd, j.data, j.len);
    }
    ipc_json_free(&j);
}

static void send_json(int fd, ipc_json *j) {
    if (j->failed) {
        send_error(fd, "out of memory");
    } else {
        cberg_ipc_write_all(fd, j->data, j->len);
    }
    ipc_json_free(j);
}

static const char *graph_err(cberg_status st) {
    if (st == CBERG_ERR_NOT_IMPLEMENTED) {
        return "graph disabled";
    }
    return cberg_status_str(st);
}

/* A full page may mean the engine's max clipped the results. */
static void end_list(ipc_json *j, size_t found, size_t max) {
    ipc_json_raw(j, "]");
    ipc_json_field_bool(j, ',', "truncated", found >= max);
    ipc_json_raw(j, "}\n");
}

/* ------------------------------------------------------------ fields */

static char *next_field(char **cursor) {
    if (cursor == NULL || *cursor == NULL || **cursor == '\0') {
        return NULL;
    }

    char *start = *cursor;
    char *tab = strchr(start, '\t');
    if (tab != NULL) {
        *tab = '\0';
        *cursor = tab + 1;
    } else {
        *cursor = start + strlen(start);
    }
    return start;
}

/* Empty IPC fields become NULL so callers can pass them through unchanged. */
static char *null_if_empty(char *s) {
    return (s != NULL && s[0] == '\0') ? NULL : s;
}

/* Missing, empty, zero, or negative counts are 0: the engine's default. */
static size_t next_count(char **cursor) {
    char *s = next_field(cursor);
    if (s == NULL || s[0] == '\0') {
        return 0;
    }

    int n = atoi(s);
    return n > 0 ? (size_t)n : 0;
}

/* ------------------------------------------------------------ objects */

static void write_hit(ipc_json *j, const cberg_engine_hit *h) {
    ipc_json_field_u64(j, '{', "id", h->id);
    ipc_json_appendf(j, ",\"score\":%.6f", (double)h->score);
    ipc_json_field_str(j, ',', "repo", h->repo);
    ipc_json_field_str(j, ',', "path", h->path);
    ipc_json_field_str(j, ',', "symbol", h->symbol);
    ipc_json_field_str(j, ',', "kind", h->kind);
    ipc_json_field_u64(j, ',', "start_line", h->start_line);
    ipc_json_field_u64(j, ',', "end_line", h->end_line);
    ipc_json_field_str(j, ',', "snippet", h->snippet);
    ipc_json_raw(j, "}");
}

static void send_hits(int fd, const cberg_engine_hit *hits, size_t found) {
    ipc_json j;
    ipc_json_init(&j);

    ipc_json_raw(&j, "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found; i++) {
        if (i > 0) {
            ipc_json_raw(&j, ",");
        }
        write_hit(&j, &hits[i]);
    }
    ipc_json_raw(&j, "]}\n");

    send_json(fd, &j);
}

/* Node fields without braces, so hubs can extend the object. */
static void write_gnode_fields(ipc_json *j, const cberg_engine_graph_node *n) {
    ipc_json_field_u64(j, 0, "id", n->id);
    ipc_json_field_str(j, ',', "repo", n->repo);
    ipc_json_field_str(j, ',', "kind", n->kind);
    ipc_json_field_str(j, ',', "name", n->name);
    ipc_json_field_str(j, ',', "qname", n->qname);
    ipc_json_field_str(j, ',', "path", n->path);
    ipc_json_field_u64(j, ',', "start_line", n->start_line);
    ipc_json_field_u64(j, ',', "end_line", n->end_line);
}

/* Edge fields without braces, so trace hops can extend the object. */
static void write_gedge_fields(ipc_json *j, const cberg_engine_graph_edge *e) {
    ipc_json_field_u64(j, 0, "src", e->src);
    ipc_json_field_u64(j, ',', "dst", e->dst);
    ipc_json_field_str(j, ',', "kind", e->kind);
    ipc_json_field_str(j, ',', "resolution", e->resolution);
    ipc_json_appendf(j, ",\"confidence\":%.4f", (double)e->confidence);
    ipc_json_field_u64(j, ',', "line", e->line);
    ipc_json_field_str(j, ',', "src_name", e->src_name);
    ipc_json_field_str(j, ',', "dst_name", e->dst_name);
    ipc_json_field_str(j, ',', "src_path", e->src_path);
    ipc_json_field_str(j, ',', "dst_path", e->dst_path);
    ipc_json_field_str(j, ',', "src_repo", e->src_repo);
    ipc_json_field_str(j, ',', "dst_repo", e->dst_repo);
}

/* ------------------------------------------------------------ status */

static void write_progress(ipc_json *j, cberg_engine *eng) {
    cberg_repo *active = NULL;
    for (size_t i = 0; i < eng->repos_len && active == NULL; i++) {
        if (atomic_load(&eng->repos[i]->progress_active)) {
            active = eng->repos[i];
        }
    }
    if (active == NULL) {
        return;
    }

    size_t total = atomic_load(&active->progress_total);
    size_t completed = atomic_load(&active->progress_completed);
    if (total > 0 && completed > total) {
        completed = total;
    }

    ipc_json_raw(j, ",\"progress\":{");
    ipc_json_field_str(j, 0, "repo", active->key);
    ipc_json_field_str(j, ',', "phase", atomic_load(&active->progress_phase));
    ipc_json_field_u64(j, ',', "completed", completed);
    ipc_json_field_u64(j, ',', "total", total);
    ipc_json_raw(j, "}");
}

static void write_repos(ipc_json *j, cberg_engine *eng) {
    ipc_json_raw(j, ",\"repos\":[");
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];
        if (i > 0) {
            ipc_json_raw(j, ",");
        }
        ipc_json_field_str(j, '{', "key", r->key);
        ipc_json_field_bool(j, ',', "ready", cberg_repo_ready(r));
        ipc_json_field_u64(j, ',', "chunks", cberg_repo_chunk_count(r));
        ipc_json_raw(j, "}");
    }
    ipc_json_raw(j, "]");
}

/* ready: bootstrap finished and at least one repo is searchable; the repo
 * list tells consumers which (a failed repo stays ready:false without holding
 * the whole daemon unhealthy). */
void cberg_ipc_status(cberg_engine *eng, int fd) {
    ipc_json j;
    ipc_json_init(&j);

    ipc_json_raw(&j, "{\"ok\":true");
    ipc_json_field_bool(&j, ',', "ready", cberg_engine_ready(eng));
    ipc_json_field_u64(&j, ',', "chunks", cberg_engine_chunk_count(eng));
    ipc_json_field_str(&j, ',', "version", cberg_version());
    ipc_json_field_bool(&j, ',', "vectors_enabled", eng->vectors);
    ipc_json_field_bool(&j, ',', "indexing", cberg_engine_indexing(eng));
    write_repos(&j, eng);
    write_progress(&j, eng);
    ipc_json_raw(&j, "}\n");

    send_json(fd, &j);
}

/* ------------------------------------------------------------ chunks */

/* search\t<query>[\t<k>[\t<repo>[\t<path_glob>[\t<kind>[\t<min_score>]]]]] */
static void handle_search(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *query = next_field(&cursor);
    if (query == NULL || query[0] == '\0') {
        send_error(fd, "missing query");
        return;
    }

    size_t k = next_count(&cursor);
    char *repo = null_if_empty(next_field(&cursor));

    cberg_search_filters filters = {0};
    filters.path_glob = null_if_empty(next_field(&cursor));
    filters.kind = cberg_chunk_kind_parse(next_field(&cursor));
    char *min_score = next_field(&cursor);
    if (min_score != NULL && min_score[0] != '\0') {
        filters.min_score = (float)atof(min_score);
    }

    cberg_engine_hit hits[CBERG_SEARCH_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_search_hits(eng, query, repo, k, &filters, hits, CBERG_SEARCH_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, cberg_status_str(st));
        return;
    }
    send_hits(fd, hits, found);
}

/* chunk\t<repo>\t<id> */
static void handle_chunk(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = next_field(&cursor);
    char *id = next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || id == NULL || id[0] == '\0') {
        send_error(fd, "missing repo or id");
        return;
    }

    cberg_engine_chunk_detail d;
    cberg_status st = cberg_engine_get_chunk(eng, repo, (uint64_t)strtoull(id, NULL, 10), &d);
    if (st != CBERG_OK) {
        send_error(fd, cberg_status_str(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);

    ipc_json_raw(&j, "{\"ok\":true,\"chunk\":");
    ipc_json_field_u64(&j, '{', "id", d.id);
    ipc_json_field_str(&j, ',', "repo", d.repo);
    ipc_json_field_str(&j, ',', "path", d.path);
    ipc_json_field_str(&j, ',', "symbol", d.symbol);
    ipc_json_field_str(&j, ',', "kind", d.kind);
    ipc_json_field_u64(&j, ',', "start_line", d.start_line);
    ipc_json_field_u64(&j, ',', "end_line", d.end_line);
    ipc_json_field_str(&j, ',', "snippet", d.snippet);
    ipc_json_raw(&j, ",\"body\":");
    ipc_json_strn(&j, d.body, d.body_len);
    ipc_json_field_bool(&j, ',', "truncated", d.truncated);
    ipc_json_raw(&j, "}}\n");

    cberg_engine_chunk_detail_free(&d);
    send_json(fd, &j);
}

/* symbol\t<name>[\t<repo>[\t<kind>[\t<limit>]]] */
static void handle_symbol(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        send_error(fd, "missing name");
        return;
    }

    char *repo = null_if_empty(next_field(&cursor));
    int kind = cberg_chunk_kind_parse(next_field(&cursor));
    size_t limit = next_count(&cursor);

    cberg_engine_hit hits[CBERG_SYMBOL_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_find_symbol(eng, name, repo, kind, limit, hits, CBERG_SYMBOL_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, cberg_status_str(st));
        return;
    }
    send_hits(fd, hits, found);
}

/* outline\t<repo>\t<path> */
static void handle_outline(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = next_field(&cursor);
    char *path = next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || path == NULL || path[0] == '\0') {
        send_error(fd, "missing repo or path");
        return;
    }

    cberg_engine_hit hits[CBERG_OUTLINE_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_file_outline(eng, repo, path, hits, CBERG_OUTLINE_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, cberg_status_str(st));
        return;
    }
    send_hits(fd, hits, found);
}

/* ------------------------------------------------------------ graph */

/* search_graph\t<name>[\t<repo>[\t<kind>[\t<path_prefix>[\t<limit>]]]] */
static void handle_search_graph(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        send_error(fd, "missing name");
        return;
    }

    char *repo = null_if_empty(next_field(&cursor));
    char *kind = null_if_empty(next_field(&cursor));
    char *path_prefix = null_if_empty(next_field(&cursor));
    size_t limit = next_count(&cursor);

    cberg_engine_graph_node nodes[CBERG_GRAPH_SEARCH_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_search_graph(eng, name, repo, kind, path_prefix, limit, nodes, CBERG_GRAPH_SEARCH_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, graph_err(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);
    ipc_json_raw(&j, "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found; i++) {
        ipc_json_raw(&j, i > 0 ? ",{" : "{");
        write_gnode_fields(&j, &nodes[i]);
        ipc_json_raw(&j, "}");
    }
    end_list(&j, found, CBERG_GRAPH_SEARCH_MAX);
    send_json(fd, &j);
}

/* trace_path\t<name>[\t<repo>[\t<direction>[\t<edge_kind>[\t<max_depth>[\t<limit>[\t<path_prefix>]]]]]] */
static void handle_trace_path(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        send_error(fd, "missing name");
        return;
    }

    char *repo = null_if_empty(next_field(&cursor));
    char *direction = null_if_empty(next_field(&cursor));
    char *edge_kind = null_if_empty(next_field(&cursor));
    uint32_t max_depth = (uint32_t)next_count(&cursor);
    size_t limit = next_count(&cursor);
    char *path_prefix = null_if_empty(next_field(&cursor));

    cberg_engine_graph_hop hops[CBERG_TRACE_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_trace_path(eng, name, 0, repo, path_prefix, direction, edge_kind, max_depth, limit, hops, CBERG_TRACE_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, graph_err(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);
    ipc_json_raw(&j, "{\"ok\":true,\"hops\":[");
    for (size_t i = 0; i < found; i++) {
        ipc_json_raw(&j, i > 0 ? "," : "");
        ipc_json_field_u64(&j, '{', "depth", hops[i].depth);
        ipc_json_raw(&j, ",");
        write_gedge_fields(&j, &hops[i].edge);
        ipc_json_raw(&j, "}");
    }
    end_list(&j, found, CBERG_TRACE_MAX);
    send_json(fd, &j);
}

/* graph_stats[\t<repo>] */
static void handle_graph_stats(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = null_if_empty(next_field(&cursor));

    cberg_engine_graph_stats stats;
    cberg_status st = cberg_engine_get_graph_stats(eng, repo, &stats);
    if (st != CBERG_OK) {
        send_error(fd, graph_err(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);
    ipc_json_raw(&j, "{\"ok\":true");
    ipc_json_field_str(&j, ',', "repo", stats.repo);
    ipc_json_field_u64(&j, ',', "nodes", stats.nodes);
    ipc_json_field_u64(&j, ',', "refs", stats.refs);
    ipc_json_field_bool(&j, ',', "enabled", stats.enabled);
    ipc_json_raw(&j, ",\"languages\":[");
    for (size_t i = 0; i < stats.languages_len; i++) {
        ipc_json_raw(&j, i > 0 ? "," : "");
        ipc_json_field_str(&j, '{', "lang", stats.languages[i].lang);
        ipc_json_field_u64(&j, ',', "files", stats.languages[i].files);
        ipc_json_raw(&j, "}");
    }
    ipc_json_raw(&j, "]}\n");
    send_json(fd, &j);
}

/* graph_hubs[\t<repo>[\t<limit>]] */
static void handle_graph_hubs(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = null_if_empty(next_field(&cursor));
    size_t limit = next_count(&cursor);

    cberg_engine_graph_hub hubs[CBERG_HUBS_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_hubs(eng, repo, limit, hubs, CBERG_HUBS_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, graph_err(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);
    ipc_json_raw(&j, "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found; i++) {
        ipc_json_raw(&j, i > 0 ? ",{" : "{");
        write_gnode_fields(&j, &hubs[i].node);
        ipc_json_field_u64(&j, ',', "degree", hubs[i].degree);
        ipc_json_raw(&j, "}");
    }
    end_list(&j, found, CBERG_HUBS_MAX);
    send_json(fd, &j);
}

/* graph_refs\t<name>[\t<repo>[\t<limit>[\t<path_prefix>]]] */
static void handle_graph_refs(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        send_error(fd, "missing name");
        return;
    }

    char *repo = null_if_empty(next_field(&cursor));
    size_t limit = next_count(&cursor);
    char *path_prefix = null_if_empty(next_field(&cursor));

    cberg_engine_graph_edge edges[CBERG_REFS_MAX];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_references(eng, name, repo, path_prefix, limit, edges, CBERG_REFS_MAX, &found);
    if (st != CBERG_OK) {
        send_error(fd, graph_err(st));
        return;
    }

    ipc_json j;
    ipc_json_init(&j);
    ipc_json_raw(&j, "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found; i++) {
        ipc_json_raw(&j, i > 0 ? ",{" : "{");
        write_gedge_fields(&j, &edges[i]);
        ipc_json_raw(&j, "}");
    }
    end_list(&j, found, CBERG_REFS_MAX);
    send_json(fd, &j);
}

/* ------------------------------------------------------------ dispatch */

typedef void (*command_fn)(cberg_engine *eng, int fd, char *args);

static const struct {
    const char *name;
    command_fn fn;
} k_commands[] = {
    {"search", handle_search},
    {"chunk", handle_chunk},
    {"symbol", handle_symbol},
    {"outline", handle_outline},
    {"search_graph", handle_search_graph},
    {"trace_path", handle_trace_path},
    {"graph_stats", handle_graph_stats},
    {"graph_hubs", handle_graph_hubs},
    {"graph_refs", handle_graph_refs},
};

void cberg_ipc_dispatch(cberg_engine *eng, int fd, char *line) {
    char *args = strchr(line, '\t');
    if (args != NULL) {
        *args++ = '\0';
    } else {
        args = line + strlen(line);
    }

    for (size_t i = 0; i < sizeof(k_commands) / sizeof(k_commands[0]); i++) {
        if (strcmp(line, k_commands[i].name) == 0) {
            k_commands[i].fn(eng, fd, args);
            return;
        }
    }
    send_error(fd, "unknown command");
}
