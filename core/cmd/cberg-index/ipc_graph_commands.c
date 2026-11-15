#include "ipc_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *graph_err(cberg_status st) {
    if (st == CBERG_ERR_NOT_IMPLEMENTED) {
        return "graph disabled";
    }
    return cberg_status_str(st);
}

static int write_gnode_json(char *resp, size_t cap, size_t *off, const cberg_engine_graph_node *n) {
    char esc_repo[256];
    char esc_kind[64];
    char esc_name[512];
    char esc_qname[1024];
    char esc_path[1024];
    ipc_json_escape(n->repo != NULL ? n->repo : "", esc_repo, sizeof(esc_repo));
    ipc_json_escape(n->kind, esc_kind, sizeof(esc_kind));
    ipc_json_escape(n->name, esc_name, sizeof(esc_name));
    ipc_json_escape(n->qname, esc_qname, sizeof(esc_qname));
    ipc_json_escape(n->path, esc_path, sizeof(esc_path));
    return ipc_appendf(resp, cap, off, "{\"id\":%llu,\"repo\":\"%s\",\"kind\":\"%s\",\"name\":\"%s\",\"qname\":\"%s\","
                                        "\"path\":\"%s\",\"start_line\":%u,\"end_line\":%u}",
                        (unsigned long long)n->id,
                        esc_repo,
                        esc_kind,
                        esc_name,
                        esc_qname,
                        esc_path,
                        n->start_line,
                        n->end_line);
}

static int write_gedge_json(char *resp, size_t cap, size_t *off, const cberg_engine_graph_edge *e) {
    char esc_kind[64];
    char esc_res[64];
    char esc_src_name[512];
    char esc_dst_name[512];
    char esc_src_path[1024];
    char esc_dst_path[1024];
    char esc_src_repo[512], esc_dst_repo[512];
    ipc_json_escape(e->kind, esc_kind, sizeof(esc_kind));
    ipc_json_escape(e->resolution, esc_res, sizeof(esc_res));
    ipc_json_escape(e->src_name, esc_src_name, sizeof(esc_src_name));
    ipc_json_escape(e->dst_name, esc_dst_name, sizeof(esc_dst_name));
    ipc_json_escape(e->src_path, esc_src_path, sizeof(esc_src_path));
    ipc_json_escape(e->dst_path, esc_dst_path, sizeof(esc_dst_path));
    ipc_json_escape(e->src_repo, esc_src_repo, sizeof(esc_src_repo));
    ipc_json_escape(e->dst_repo, esc_dst_repo, sizeof(esc_dst_repo));
    return ipc_appendf(resp, cap, off, "{\"src\":%llu,\"dst\":%llu,\"kind\":\"%s\",\"resolution\":\"%s\",\"confidence\":%.4f,"
                                        "\"line\":%u,\"src_name\":\"%s\",\"dst_name\":\"%s\",\"src_path\":\"%s\",\"dst_path\":\"%s\",\"src_repo\":\"%s\",\"dst_repo\":\"%s\"}",
                        (unsigned long long)e->src,
                        (unsigned long long)e->dst,
                        esc_kind,
                        esc_res,
                        (double)e->confidence,
                        e->line,
                        esc_src_name,
                        esc_dst_name,
                        esc_src_path,
                        esc_dst_path,
                        esc_src_repo,
                        esc_dst_repo);
}

void ipc_handle_search_graph(cberg_engine *eng, int fd, char *args) {
    /* search_graph\t<name>\t[<repo>\t[<kind>\t[<path_prefix>\t[<limit>]]]] */
    char *cursor = args;
    char *name = ipc_next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        ipc_send_error(fd, "missing name");
        return;
    }
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    char *kind = ipc_null_if_empty(ipc_next_field(&cursor));
    char *path_prefix = ipc_null_if_empty(ipc_next_field(&cursor));
    size_t limit = ipc_count_field(ipc_next_field(&cursor), 20);
    enum { IPC_GRAPH_NODES_CAP = 64 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_NODES_CAP);

    cberg_engine_graph_node nodes[IPC_GRAPH_NODES_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_search_graph(eng, name, repo, kind, path_prefix, want, nodes, IPC_GRAPH_NODES_CAP, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, graph_err(st));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_NODES_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t cap = ipc_list_cap(sizeof(resp));
    size_t written = 0;
    for (; written < found; written++) {
        size_t mark = ipc_list_item_begin(resp, cap, &off, written);
        if (!write_gnode_json(resp, cap, &off, &nodes[written])) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    ipc_write_all(fd, resp, strlen(resp));
}

void ipc_handle_trace_path(cberg_engine *eng, int fd, char *args) {
    /* trace_path\t<name>\t[<repo>\t[<direction>\t[<edge_kind>\t[<max_depth>\t[<limit>\t[<path_prefix>]]]]]] */
    char *cursor = args;
    char *name = ipc_next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        ipc_send_error(fd, "missing name");
        return;
    }
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    char *direction = ipc_null_if_empty(ipc_next_field(&cursor));
    char *edge_kind = ipc_null_if_empty(ipc_next_field(&cursor));
    uint32_t max_depth = (uint32_t)ipc_count_field(ipc_next_field(&cursor), 2);
    size_t limit = ipc_count_field(ipc_next_field(&cursor), 64);
    char *path_prefix = ipc_null_if_empty(ipc_next_field(&cursor));

    enum { IPC_GRAPH_HOPS_CAP = 256 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_HOPS_CAP);
    cberg_engine_graph_hop hops[IPC_GRAPH_HOPS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_trace_path(eng, name, 0, repo, path_prefix, direction, edge_kind, max_depth, want, hops, IPC_GRAPH_HOPS_CAP, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, graph_err(st));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_HOPS_CAP);
    char resp[131072];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"hops\":[");
    size_t cap = ipc_list_cap(sizeof(resp));
    size_t written = 0;
    for (; written < found; written++) {
        char edge_buf[4096];
        size_t eoff = 0;
        if (!write_gedge_json(edge_buf, sizeof(edge_buf), &eoff, &hops[written].edge)) {
            break;
        }

        /* edge_buf is {"src":...}; splice depth after the opening brace. */
        size_t mark = ipc_list_item_begin(resp, cap, &off, written);
        if (!ipc_appendf(resp, cap, &off, "{\"depth\":%u,%s", hops[written].depth, edge_buf + 1)) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    ipc_write_all(fd, resp, strlen(resp));
}

void ipc_handle_graph_stats(cberg_engine *eng, int fd, char *args) {
    /* graph_stats[\t<repo>] */
    char *cursor = args;
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    cberg_engine_graph_stats stats;
    cberg_status st = cberg_engine_get_graph_stats(eng, repo, &stats);
    if (st != CBERG_OK) {
        ipc_send_error(fd, graph_err(st));
        return;
    }
    char esc_repo[256];
    ipc_json_escape(stats.repo != NULL ? stats.repo : "", esc_repo, sizeof(esc_repo));
    char resp[4096];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"repo\":\"%s\",\"nodes\":%zu,\"refs\":%zu,\"enabled\":%s,\"languages\":[", esc_repo, stats.nodes, stats.refs, stats.enabled ? "true" : "false");
    for (size_t i = 0; i < stats.languages_len && off + 96 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        char esc_lang[64];
        ipc_json_escape(stats.languages[i].lang, esc_lang, sizeof(esc_lang));
        int w = snprintf(resp + off, sizeof(resp) - off, "{\"lang\":\"%s\",\"files\":%zu}", esc_lang, stats.languages[i].files);
        if (w > 0) {
            off += (size_t)w;
        }
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    ipc_write_all(fd, resp, strlen(resp));
}

void ipc_handle_graph_hubs(cberg_engine *eng, int fd, char *args) {
    /* graph_hubs[\t<repo>[\t<limit>]] */
    char *cursor = args;
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    size_t limit = ipc_count_field(ipc_next_field(&cursor), 10);
    enum { IPC_GRAPH_HUBS_CAP = 64 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_HUBS_CAP);
    cberg_engine_graph_hub hubs[IPC_GRAPH_HUBS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_hubs(eng, repo, want, hubs, IPC_GRAPH_HUBS_CAP, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, graph_err(st));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_HUBS_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t cap = ipc_list_cap(sizeof(resp));
    size_t written = 0;
    for (; written < found; written++) {
        size_t mark = ipc_list_item_begin(resp, cap, &off, written);
        if (!write_gnode_json(resp, cap, &off, &hubs[written].node)) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }

        /* Replace trailing '}' with ,"degree":N} */
        off--;
        if (!ipc_appendf(resp, cap, &off, ",\"degree\":%u}", hubs[written].degree)) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    ipc_write_all(fd, resp, strlen(resp));
}

void ipc_handle_graph_refs(cberg_engine *eng, int fd, char *args) {
    /* graph_refs\t<name>\t[<repo>\t[<limit>\t[<path_prefix>]]] — used by find_references */
    char *cursor = args;
    char *name = ipc_next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        ipc_send_error(fd, "missing name");
        return;
    }
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    size_t limit = ipc_count_field(ipc_next_field(&cursor), 50);
    char *path_prefix = ipc_null_if_empty(ipc_next_field(&cursor));
    enum { IPC_GRAPH_REFS_CAP = 256 };
    size_t want = ipc_clamp_want(limit, IPC_GRAPH_REFS_CAP);
    cberg_engine_graph_edge edges[IPC_GRAPH_REFS_CAP];
    size_t found = 0;
    cberg_status st = cberg_engine_graph_references(eng, name, repo, path_prefix, want, edges, IPC_GRAPH_REFS_CAP, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, graph_err(st));
        return;
    }
    int truncated = ipc_cap_truncated(found, want, limit, IPC_GRAPH_REFS_CAP);
    char resp[65536];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    size_t cap = ipc_list_cap(sizeof(resp));
    size_t written = 0;
    for (; written < found; written++) {
        size_t mark = ipc_list_item_begin(resp, cap, &off, written);
        if (!write_gedge_json(resp, cap, &off, &edges[written])) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }
    }
    if (written < found) {
        truncated = 1;
    }
    snprintf(resp + off, sizeof(resp) - off, "],\"truncated\":%s}\n", truncated ? "true" : "false");
    ipc_write_all(fd, resp, strlen(resp));
}
