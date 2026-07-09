#define _POSIX_C_SOURCE 200809L

#include "ipc.h"
#include "indexer.h"

#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

typedef struct cberg_ipc_server {
    cberg_engine *eng;
    int listen_fd;
    pthread_t thread;
} cberg_ipc_server;

static int write_all(int fd, const char *buf, size_t len) {
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, buf + off, len - off);
        if (n <= 0) {
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

static void json_escape(const char *in, char *out, size_t cap) {
    size_t j = 0;
    for (size_t i = 0; in[i] != '\0' && j + 2 < cap; i++) {
        char c = in[i];
        if (c == '"' || c == '\\') {
            out[j++] = '\\';
        }
        if (c == '\n') {
            out[j++] = '\\';
            c = 'n';
        } else if (c == '\r') {
            out[j++] = '\\';
            c = 'r';
        } else if (c == '\t') {
            out[j++] = '\\';
            c = 't';
        }
        out[j++] = c;
    }
    out[j] = '\0';
}

static void handle_status(cberg_engine *eng, int fd) {
    /* ready = the bootstrap pass finished and at least one repo is searchable;
     * the per-repo list tells consumers exactly which (a failed repo stays
     * ready:false without holding the whole daemon unhealthy). */
    size_t ready_repos = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (cberg_repo_ready(eng->repos[i])) {
            ready_repos++;
        }
    }
    int ready = eng->bootstrapped && ready_repos > 0;

    char resp[8192];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"ready\":%s,\"chunks\":%zu,\"version\":\"%s\","
                                                      "\"vectors_enabled\":%s,\"repos\":[",
                                  ready ? "true" : "false",
                                  cberg_engine_chunk_count(eng),
                                  cberg_indexer_version(),
                                  eng->vectors ? "true" : "false");
    for (size_t i = 0; i < eng->repos_len && off + 512 < sizeof(resp); i++) {
        cberg_repo *r = eng->repos[i];
        char esc_key[256];
        json_escape(r->key, esc_key, sizeof(esc_key));
        int w = snprintf(resp + off, sizeof(resp) - off, "%s{\"key\":\"%s\",\"ready\":%s,\"chunks\":%zu}", i > 0 ? "," : "", esc_key, cberg_repo_ready(r) ? "true" : "false", cberg_repo_chunk_count(r));
        if (w < 0) {
            break;
        }
        off += (size_t)w;
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

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

static void write_hit_json(char *resp, size_t cap, size_t *off, const cberg_engine_hit *h) {
    char esc_repo[256];
    char esc_path[512];
    char esc_symbol[256];
    char esc_snippet[CBERG_SNIPPET_MAX * 2];
    json_escape(h->repo != NULL ? h->repo : "", esc_repo, sizeof(esc_repo));
    json_escape(h->path, esc_path, sizeof(esc_path));
    json_escape(h->symbol, esc_symbol, sizeof(esc_symbol));
    json_escape(h->snippet, esc_snippet, sizeof(esc_snippet));
    int w = snprintf(resp + *off, cap - *off, "{\"id\":%llu,\"score\":%.6f,\"repo\":\"%s\",\"path\":\"%s\",\"symbol\":\"%s\","
                                              "\"start_line\":%u,\"end_line\":%u,\"snippet\":\"%s\"}",
                     (unsigned long long)h->id,
                     (double)h->score,
                     esc_repo,
                     esc_path,
                     esc_symbol,
                     h->start_line,
                     h->end_line,
                     esc_snippet);
    if (w > 0) {
        *off += (size_t)w;
    }
}

static void handle_search(cberg_engine *eng, int fd, char *args) {
    /* Fields, tab-separated: <query> [\t <k> [\t <repo> [\t <path_glob> [\t <kind> [\t <min_score>]]]]] */
    char *cursor = args;
    char *query = next_field(&cursor);
    if (query == NULL || query[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing query\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    size_t k = 10;
    char *kstr = next_field(&cursor);
    if (kstr != NULL && kstr[0] != '\0') {
        k = (size_t)atoi(kstr);
        if (k == 0) {
            k = 10;
        }
    }
    char *repo = null_if_empty(next_field(&cursor));
    char *path_glob = null_if_empty(next_field(&cursor));
    char *kind_str = next_field(&cursor);
    char *min_score_str = next_field(&cursor);

    cberg_search_filters filters = {0};
    filters.path_glob = path_glob;
    filters.kind = cberg_index_parse_kind(kind_str);
    if (min_score_str != NULL && min_score_str[0] != '\0') {
        filters.min_score = (float)atof(min_score_str);
    }

    cberg_engine_hit hits[64];
    size_t found = 0;
    size_t want = k > 64 ? 64 : k;
    cberg_status st = cberg_engine_search_hits(eng, query, repo, want, &filters, hits, 64, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    char resp[32768];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found && off + 512 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        write_hit_json(resp, sizeof(resp), &off, &hits[i]);
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static void handle_chunk(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = next_field(&cursor);
    char *idstr = next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || idstr == NULL || idstr[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing repo or id\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    uint64_t id = (uint64_t)strtoull(idstr, NULL, 10);
    cberg_engine_chunk_detail detail;
    cberg_status st = cberg_engine_get_chunk(eng, repo, id, &detail);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
        write_all(fd, resp, strlen(resp));
        return;
    }

    char esc_repo[256];
    char esc_path[512];
    char esc_symbol[256];
    char esc_kind[64];
    char esc_snippet[CBERG_SNIPPET_MAX * 2];
    char *esc_body = calloc((detail.body_len + 1) * 2, 1);
    if (esc_body == NULL) {
        cberg_engine_chunk_detail_free(&detail);
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"out of memory\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    json_escape(detail.repo != NULL ? detail.repo : "", esc_repo, sizeof(esc_repo));
    json_escape(detail.path, esc_path, sizeof(esc_path));
    json_escape(detail.symbol, esc_symbol, sizeof(esc_symbol));
    json_escape(detail.kind, esc_kind, sizeof(esc_kind));
    json_escape(detail.snippet, esc_snippet, sizeof(esc_snippet));
    json_escape(detail.body != NULL ? detail.body : "", esc_body, (detail.body_len + 1) * 2);

    char resp[131072];
    snprintf(resp, sizeof(resp), "{\"ok\":true,\"chunk\":{\"id\":%llu,\"repo\":\"%s\",\"path\":\"%s\",\"symbol\":\"%s\","
                                 "\"kind\":\"%s\",\"start_line\":%u,\"end_line\":%u,\"snippet\":\"%s\",\"body\":\"%s\","
                                 "\"truncated\":%s}}\n",
             (unsigned long long)detail.id,
             esc_repo,
             esc_path,
             esc_symbol,
             esc_kind,
             detail.start_line,
             detail.end_line,
             esc_snippet,
             esc_body,
             detail.truncated ? "true" : "false");
    free(esc_body);
    cberg_engine_chunk_detail_free(&detail);
    write_all(fd, resp, strlen(resp));
}

static void handle_symbol(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing name\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    char *repo = null_if_empty(next_field(&cursor));
    char *kind_str = next_field(&cursor);
    char *limit_str = next_field(&cursor);
    size_t limit = 20;
    if (limit_str != NULL && limit_str[0] != '\0') {
        limit = (size_t)atoi(limit_str);
        if (limit == 0) {
            limit = 20;
        }
    }

    cberg_engine_hit hits[64];
    size_t found = 0;
    cberg_status st =
        cberg_engine_find_symbol(eng, name, repo, cberg_index_parse_kind(kind_str), limit, hits, 64, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    char resp[32768];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found && off + 512 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        write_hit_json(resp, sizeof(resp), &off, &hits[i]);
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static void handle_outline(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = next_field(&cursor);
    char *path = next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || path == NULL || path[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing repo or path\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    cberg_engine_hit hits[256];
    size_t found = 0;
    cberg_status st = cberg_engine_file_outline(eng, repo, path, hits, 256, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found && off + 512 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        write_hit_json(resp, sizeof(resp), &off, &hits[i]);
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static const char *graph_err(cberg_status st) {
    if (st == CBERG_ERR_NOT_IMPLEMENTED) {
        return "graph disabled";
    }
    return cberg_status_str(st);
}

static void write_gnode_json(char *resp, size_t cap, size_t *off, const cberg_engine_graph_node *n) {
    char esc_repo[256];
    char esc_kind[64];
    char esc_name[512];
    char esc_qname[1024];
    char esc_path[1024];
    json_escape(n->repo != NULL ? n->repo : "", esc_repo, sizeof(esc_repo));
    json_escape(n->kind, esc_kind, sizeof(esc_kind));
    json_escape(n->name, esc_name, sizeof(esc_name));
    json_escape(n->qname, esc_qname, sizeof(esc_qname));
    json_escape(n->path, esc_path, sizeof(esc_path));
    int w = snprintf(resp + *off, cap - *off,
                     "{\"id\":%llu,\"repo\":\"%s\",\"kind\":\"%s\",\"name\":\"%s\",\"qname\":\"%s\","
                     "\"path\":\"%s\",\"start_line\":%u,\"end_line\":%u}",
                     (unsigned long long)n->id, esc_repo, esc_kind, esc_name, esc_qname, esc_path, n->start_line, n->end_line);
    if (w > 0) {
        *off += (size_t)w;
    }
}

static void write_gedge_json(char *resp, size_t cap, size_t *off, const cberg_engine_graph_edge *e) {
    char esc_kind[64];
    char esc_res[64];
    char esc_src_name[512];
    char esc_dst_name[512];
    char esc_src_path[1024];
    char esc_dst_path[1024];
    json_escape(e->kind, esc_kind, sizeof(esc_kind));
    json_escape(e->resolution, esc_res, sizeof(esc_res));
    json_escape(e->src_name, esc_src_name, sizeof(esc_src_name));
    json_escape(e->dst_name, esc_dst_name, sizeof(esc_dst_name));
    json_escape(e->src_path, esc_src_path, sizeof(esc_src_path));
    json_escape(e->dst_path, esc_dst_path, sizeof(esc_dst_path));
    int w = snprintf(resp + *off, cap - *off,
                     "{\"src\":%llu,\"dst\":%llu,\"kind\":\"%s\",\"resolution\":\"%s\",\"confidence\":%.4f,"
                     "\"line\":%u,\"src_name\":\"%s\",\"dst_name\":\"%s\",\"src_path\":\"%s\",\"dst_path\":\"%s\"}",
                     (unsigned long long)e->src, (unsigned long long)e->dst, esc_kind, esc_res, (double)e->confidence, e->line,
                     esc_src_name, esc_dst_name, esc_src_path, esc_dst_path);
    if (w > 0) {
        *off += (size_t)w;
    }
}

static size_t ipc_clamp_want(size_t limit, size_t cap) {
    return limit > cap ? cap : limit;
}

/* True when the stack/response cap may have clipped results the caller asked for. */
static int ipc_cap_truncated(size_t found, size_t want, size_t limit, size_t cap) {
    return found >= want && (limit > cap || found >= cap);
}

static void handle_search_graph(cberg_engine *eng, int fd, char *args) {
    /* search_graph\t<name>\t[<repo>\t[<kind>\t[<path_prefix>\t[<limit>]]]] */
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing name\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    char *repo = null_if_empty(next_field(&cursor));
    char *kind = null_if_empty(next_field(&cursor));
    char *path_prefix = null_if_empty(next_field(&cursor));
    char *limit_str = next_field(&cursor);
    size_t limit = 20;
    if (limit_str != NULL && limit_str[0] != '\0') {
        limit = (size_t)atoi(limit_str);
        if (limit == 0) {
            limit = 20;
        }
    }
    enum { IPC_GRAPH_NODES_CAP = 64 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_NODES_CAP);

    cberg_engine_graph_node nodes[IPC_GRAPH_NODES_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_search_graph(eng, name, repo, kind, path_prefix, want, nodes, IPC_GRAPH_NODES_CAP, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", graph_err(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_NODES_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t written = 0;
    for (; written < found && off + 512 < sizeof(resp); written++) {
        if (written > 0) {
            resp[off++] = ',';
        }
        write_gnode_json(resp, sizeof(resp), &off, &nodes[written]);
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    write_all(fd, resp, strlen(resp));
}

static void handle_trace_path(cberg_engine *eng, int fd, char *args) {
    /* trace_path\t<name>\t[<repo>\t[<direction>\t[<edge_kind>\t[<max_depth>\t[<limit>\t[<path_prefix>]]]]]] */
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing name\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    char *repo = null_if_empty(next_field(&cursor));
    char *direction = null_if_empty(next_field(&cursor));
    char *edge_kind = null_if_empty(next_field(&cursor));
    char *depth_str = next_field(&cursor);
    uint32_t max_depth = 2;
    if (depth_str != NULL && depth_str[0] != '\0') {
        max_depth = (uint32_t)atoi(depth_str);
        if (max_depth == 0) {
            max_depth = 2;
        }
    }
    char *limit_str = next_field(&cursor);
    size_t limit = 64;
    if (limit_str != NULL && limit_str[0] != '\0') {
        limit = (size_t)atoi(limit_str);
        if (limit == 0) {
            limit = 64;
        }
    }
    char *path_prefix = null_if_empty(next_field(&cursor));

    enum { IPC_GRAPH_HOPS_CAP = 256 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_HOPS_CAP);
    cberg_engine_graph_hop hops[IPC_GRAPH_HOPS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_trace_path(eng, name, 0, repo, path_prefix, direction, edge_kind, max_depth, want, hops, IPC_GRAPH_HOPS_CAP, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", graph_err(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_HOPS_CAP);
    char resp[131072];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"hops\":[");
    size_t written = 0;
    for (; written < found && off + 768 < sizeof(resp); written++) {
        if (written > 0) {
            resp[off++] = ',';
        }
        char edge_buf[1536];
        size_t eoff = 0;
        write_gedge_json(edge_buf, sizeof(edge_buf), &eoff, &hops[written].edge);
        /* edge_buf is {"src":...}; splice depth after the opening brace. */
        if (eoff > 1 && edge_buf[0] == '{') {
            int w = snprintf(resp + off, sizeof(resp) - off, "{\"depth\":%u,%s", hops[written].depth, edge_buf + 1);
            if (w > 0) {
                off += (size_t)w;
            }
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    write_all(fd, resp, strlen(resp));
}

static void handle_graph_stats(cberg_engine *eng, int fd, char *args) {
    /* graph_stats[\t<repo>] */
    char *cursor = args;
    char *repo = null_if_empty(next_field(&cursor));
    cberg_engine_graph_stats stats;
    cberg_status st = cberg_engine_get_graph_stats(eng, repo, &stats);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", graph_err(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    char esc_repo[256];
    json_escape(stats.repo != NULL ? stats.repo : "", esc_repo, sizeof(esc_repo));
    char resp[4096];
    size_t off = (size_t)snprintf(resp, sizeof(resp),
                                  "{\"ok\":true,\"repo\":\"%s\",\"nodes\":%zu,\"refs\":%zu,\"enabled\":%s,\"languages\":[", esc_repo,
                                  stats.nodes, stats.refs, stats.enabled ? "true" : "false");
    for (size_t i = 0; i < stats.languages_len && off + 96 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        char esc_lang[64];
        json_escape(stats.languages[i].lang, esc_lang, sizeof(esc_lang));
        int w = snprintf(resp + off, sizeof(resp) - off, "{\"lang\":\"%s\",\"files\":%zu}", esc_lang, stats.languages[i].files);
        if (w > 0) {
            off += (size_t)w;
        }
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static void handle_graph_hubs(cberg_engine *eng, int fd, char *args) {
    /* graph_hubs[\t<repo>[\t<limit>]] */
    char *cursor = args;
    char *repo = null_if_empty(next_field(&cursor));
    char *limit_str = next_field(&cursor);
    size_t limit = 10;
    if (limit_str != NULL && limit_str[0] != '\0') {
        limit = (size_t)atoi(limit_str);
        if (limit == 0) {
            limit = 10;
        }
    }
    enum { IPC_GRAPH_HUBS_CAP = 64 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_HUBS_CAP);
    cberg_engine_graph_hub hubs[IPC_GRAPH_HUBS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_hubs(eng, repo, want, hubs, IPC_GRAPH_HUBS_CAP, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", graph_err(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_HUBS_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t written = 0;
    for (; written < found && off + 640 < sizeof(resp); written++) {
        if (written > 0) {
            resp[off++] = ',';
        }
        size_t before = off;
        write_gnode_json(resp, sizeof(resp), &off, &hubs[written].node);
        /* Replace trailing '}' with ,"degree":N} */
        if (off > before && resp[off - 1] == '}') {
            off--;
            int w = snprintf(resp + off, sizeof(resp) - off, ",\"degree\":%u}", hubs[written].degree);
            if (w > 0) {
                off += (size_t)w;
            }
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    write_all(fd, resp, strlen(resp));
}

static void handle_graph_refs(cberg_engine *eng, int fd, char *args) {
    /* graph_refs\t<name>\t[<repo>\t[<limit>\t[<path_prefix>]]] — used by find_references */
    char *cursor = args;
    char *name = next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"missing name\"}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }
    char *repo = null_if_empty(next_field(&cursor));
    char *limit_str = next_field(&cursor);
    size_t limit = 50;
    if (limit_str != NULL && limit_str[0] != '\0') {
        limit = (size_t)atoi(limit_str);
        if (limit == 0) {
            limit = 50;
        }
    }
    char *path_prefix = null_if_empty(next_field(&cursor));
    enum { IPC_GRAPH_REFS_CAP = 64 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_REFS_CAP);
    cberg_engine_graph_edge edges[IPC_GRAPH_REFS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_references(eng, name, repo, path_prefix, want, edges, IPC_GRAPH_REFS_CAP, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", graph_err(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_REFS_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t written = 0;
    for (; written < found && off + 768 < sizeof(resp); written++) {
        if (written > 0) {
            resp[off++] = ',';
        }
        write_gedge_json(resp, sizeof(resp), &off, &edges[written]);
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    write_all(fd, resp, strlen(resp));
}

static void handle_client(cberg_engine *eng, int fd) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int pr = poll(&pfd, 1, 5000);
    if (pr <= 0) {
        return;
    }
    char line[8192];
    ssize_t n = read(fd, line, sizeof(line) - 1);
    if (n <= 0) {
        return;
    }
    line[n] = '\0';
    char *nl = strchr(line, '\n');
    if (nl != NULL) {
        *nl = '\0';
    }

    if (strcmp(line, "status") == 0) {
        handle_status(eng, fd);
        return;
    }

    if (strncmp(line, "search\t", 7) == 0) {
        handle_search(eng, fd, line + 7);
        return;
    }

    if (strncmp(line, "chunk\t", 6) == 0) {
        handle_chunk(eng, fd, line + 6);
        return;
    }

    if (strncmp(line, "symbol\t", 7) == 0) {
        handle_symbol(eng, fd, line + 7);
        return;
    }

    if (strncmp(line, "outline\t", 8) == 0) {
        handle_outline(eng, fd, line + 8);
        return;
    }

    if (strncmp(line, "search_graph\t", 13) == 0) {
        handle_search_graph(eng, fd, line + 13);
        return;
    }

    if (strncmp(line, "trace_path\t", 11) == 0) {
        handle_trace_path(eng, fd, line + 11);
        return;
    }

    if (strcmp(line, "graph_stats") == 0) {
        handle_graph_stats(eng, fd, "");
        return;
    }

    if (strncmp(line, "graph_stats\t", 12) == 0) {
        handle_graph_stats(eng, fd, line + 12);
        return;
    }

    if (strncmp(line, "graph_refs\t", 11) == 0) {
        handle_graph_refs(eng, fd, line + 11);
        return;
    }

    if (strcmp(line, "graph_hubs") == 0) {
        handle_graph_hubs(eng, fd, "");
        return;
    }

    if (strncmp(line, "graph_hubs\t", 11) == 0) {
        handle_graph_hubs(eng, fd, line + 11);
        return;
    }

    char err[128];
    snprintf(err, sizeof(err), "{\"ok\":false,\"error\":\"unknown command\"}\n");
    write_all(fd, err, strlen(err));
}

static void *ipc_thread(void *arg) {
    cberg_ipc_server *srv = arg;
    for (;;) {
        if (srv->eng->stop) {
            break;
        }
        int listen_fd = srv->listen_fd;
        if (listen_fd < 0) {
            break;
        }
        struct pollfd pfd = {.fd = listen_fd, .events = POLLIN};
        int pr = poll(&pfd, 1, 200);
        if (pr < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (pr == 0) {
            continue;
        }
        int client = accept(listen_fd, NULL, NULL);
        if (client < 0) {
            if (errno == EINTR) {
                continue;
            }
            if (srv->eng->stop || srv->listen_fd < 0) {
                break;
            }
            continue;
        }
        handle_client(srv->eng, client);
        close(client);
    }
    return NULL;
}

int cberg_ipc_start(cberg_engine *eng, cberg_ipc_server **out) {
    cberg_ipc_server *srv = calloc(1, sizeof(*srv));
    if (srv == NULL) {
        return -1;
    }
    srv->eng = eng;

    unlink(eng->socket_path);
    srv->listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (srv->listen_fd < 0) {
        free(srv);
        return -1;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, eng->socket_path, sizeof(addr.sun_path) - 1);

    if (bind(srv->listen_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(srv->listen_fd);
        free(srv);
        return -1;
    }
    if (listen(srv->listen_fd, 8) != 0) {
        close(srv->listen_fd);
        unlink(eng->socket_path);
        free(srv);
        return -1;
    }

    if (pthread_create(&srv->thread, NULL, ipc_thread, srv) != 0) {
        close(srv->listen_fd);
        unlink(eng->socket_path);
        free(srv);
        return -1;
    }

    *out = srv;
    return 0;
}

void cberg_ipc_stop(cberg_ipc_server *srv) {
    if (srv == NULL) {
        return;
    }
    srv->eng->stop = 1;
    int fd = srv->listen_fd;
    srv->listen_fd = -1;
    if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
        close(fd);
    }
    pthread_join(srv->thread, NULL);
    unlink(srv->eng->socket_path);
    free(srv);
}
