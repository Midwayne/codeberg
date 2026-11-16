#include "ipc_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void append_progress(cberg_engine *eng, char *resp, size_t cap, size_t *off) {
    cberg_repo *active = NULL;
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];
        if (atomic_load(&r->progress_active)) {
            active = r;
            break;
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
    char key[256];
    ipc_json_escape(active->key, key, sizeof(key));
    ipc_appendf(resp, cap, off, ",\"progress\":{\"repo\":\"%s\",\"phase\":\"%s\",\"completed\":%zu,\"total\":%zu}", key, atomic_load(&active->progress_phase), completed, total);
}

void ipc_handle_status(cberg_engine *eng, int fd) {
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
                                                      "\"vectors_enabled\":%s,\"indexing\":%s,\"repos\":[",
                                  ready ? "true" : "false",
                                  cberg_engine_chunk_count(eng),
                                  cberg_indexer_version(),
                                  eng->vectors ? "true" : "false",
                                  (!eng->bootstrapped || eng->updating) ? "true" : "false");
    for (size_t i = 0; i < eng->repos_len && off + 512 < sizeof(resp); i++) {
        cberg_repo *r = eng->repos[i];
        char esc_key[256];
        ipc_json_escape(r->key, esc_key, sizeof(esc_key));
        int w = snprintf(resp + off, sizeof(resp) - off, "%s{\"key\":\"%s\",\"ready\":%s,\"chunks\":%zu}", i > 0 ? "," : "", esc_key, cberg_repo_ready(r) ? "true" : "false", cberg_repo_chunk_count(r));
        if (w < 0) {
            break;
        }
        off += (size_t)w;
    }
    ipc_appendf(resp, sizeof(resp), &off, "]");
    append_progress(eng, resp, sizeof(resp), &off);
    ipc_appendf(resp, sizeof(resp), &off, "}\n");
    ipc_write_all(fd, resp, strlen(resp));
}

#define IPC_ESC_REPO 256
#define IPC_ESC_PATH 512
#define IPC_ESC_SYMBOL 256
#define IPC_ESC_KIND 64
#define IPC_ESC_SNIPPET (CBERG_SNIPPET_MAX * 2)

/* Upper bound on one write_hit_json object: escaped fields plus keys/numbers. */
#define IPC_HIT_JSON_MAX (IPC_ESC_REPO + IPC_ESC_PATH + IPC_ESC_SYMBOL + IPC_ESC_KIND + IPC_ESC_SNIPPET + 256)

static int write_hit_json(char *resp, size_t cap, size_t *off, const cberg_engine_hit *h) {
    char esc_repo[IPC_ESC_REPO];
    char esc_path[IPC_ESC_PATH];
    char esc_symbol[IPC_ESC_SYMBOL];
    char esc_kind[IPC_ESC_KIND];
    char esc_snippet[IPC_ESC_SNIPPET];
    ipc_json_escape(h->repo != NULL ? h->repo : "", esc_repo, sizeof(esc_repo));
    ipc_json_escape(h->path, esc_path, sizeof(esc_path));
    ipc_json_escape(h->symbol, esc_symbol, sizeof(esc_symbol));
    ipc_json_escape(h->kind, esc_kind, sizeof(esc_kind));
    ipc_json_escape(h->snippet, esc_snippet, sizeof(esc_snippet));
    return ipc_appendf(resp, cap, off, "{\"id\":%llu,\"score\":%.6f,\"repo\":\"%s\",\"path\":\"%s\",\"symbol\":\"%s\","
                                        "\"kind\":\"%s\",\"start_line\":%u,\"end_line\":%u,\"snippet\":\"%s\"}",
                        (unsigned long long)h->id,
                        (double)h->score,
                        esc_repo,
                        esc_path,
                        esc_symbol,
                        esc_kind,
                        h->start_line,
                        h->end_line,
                        esc_snippet);
}

/* Writes {"ok":true,"results":[...]}. The buffer is sized for every hit at
 * its escaped worst, so results are never clipped. */
static void write_hits_response(int fd, const cberg_engine_hit *hits, size_t found) {
    size_t resp_size = found * IPC_HIT_JSON_MAX + IPC_TAIL_RESERVE + 64;
    char *resp = malloc(resp_size);
    if (resp == NULL) {
        ipc_send_error(fd, "out of memory");
        return;
    }

    size_t cap = ipc_list_cap(resp_size);
    size_t off = (size_t)snprintf(resp, resp_size, "{\"ok\":true,\"results\":[");

    for (size_t i = 0; i < found; i++) {
        size_t mark = ipc_list_item_begin(resp, cap, &off, i);
        if (!write_hit_json(resp, cap, &off, &hits[i])) {
            ipc_list_item_rollback(resp, &off, mark);
            break;
        }
    }

    snprintf(resp + off, resp_size - off, "]}\n");
    ipc_write_all(fd, resp, strlen(resp));
    free(resp);
}

void ipc_handle_search(cberg_engine *eng, int fd, char *args) {
    /* Fields, tab-separated: <query> [\t <k> [\t <repo> [\t <path_glob> [\t <kind> [\t <min_score>]]]]] */
    char *cursor = args;
    char *query = ipc_next_field(&cursor);
    if (query == NULL || query[0] == '\0') {
        ipc_send_error(fd, "missing query");
        return;
    }
    size_t k = ipc_count_field(ipc_next_field(&cursor), 10);
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    char *path_glob = ipc_null_if_empty(ipc_next_field(&cursor));
    char *kind_str = ipc_next_field(&cursor);
    char *min_score_str = ipc_next_field(&cursor);

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
        ipc_send_error(fd, cberg_status_str(st));
        return;
    }
    write_hits_response(fd, hits, found);
}

/* Writes one chunk's detail as the {"ok":true,"chunk":{...}} reply. */
static void send_chunk_detail(int fd, const cberg_engine_chunk_detail *detail) {
    size_t body_cap = (detail->body_len + 1) * 2;
    char *esc_body = calloc(body_cap, 1);
    if (esc_body == NULL) {
        ipc_send_error(fd, "out of memory");
        return;
    }

    char esc_repo[256];
    char esc_path[512];
    char esc_symbol[256];
    char esc_kind[64];
    char esc_snippet[CBERG_SNIPPET_MAX * 2];
    ipc_json_escape(detail->repo != NULL ? detail->repo : "", esc_repo, sizeof(esc_repo));
    ipc_json_escape(detail->path, esc_path, sizeof(esc_path));
    ipc_json_escape(detail->symbol, esc_symbol, sizeof(esc_symbol));
    ipc_json_escape(detail->kind, esc_kind, sizeof(esc_kind));
    ipc_json_escape(detail->snippet, esc_snippet, sizeof(esc_snippet));
    ipc_json_escape(detail->body != NULL ? detail->body : "", esc_body, body_cap);

    char resp[131072];
    snprintf(resp, sizeof(resp), "{\"ok\":true,\"chunk\":{\"id\":%llu,\"repo\":\"%s\",\"path\":\"%s\",\"symbol\":\"%s\","
                                 "\"kind\":\"%s\",\"start_line\":%u,\"end_line\":%u,\"snippet\":\"%s\",\"body\":\"%s\","
                                 "\"truncated\":%s}}\n",
             (unsigned long long)detail->id,
             esc_repo,
             esc_path,
             esc_symbol,
             esc_kind,
             detail->start_line,
             detail->end_line,
             esc_snippet,
             esc_body,
             detail->truncated ? "true" : "false");
    free(esc_body);

    ipc_write_all(fd, resp, strlen(resp));
}

/* chunk <repo> <id>: one chunk's location, snippet, and body. */
void ipc_handle_chunk(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = ipc_next_field(&cursor);
    char *idstr = ipc_next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || idstr == NULL || idstr[0] == '\0') {
        ipc_send_error(fd, "missing repo or id");
        return;
    }

    uint64_t id = (uint64_t)strtoull(idstr, NULL, 10);
    cberg_engine_chunk_detail detail;
    cberg_status st = cberg_engine_get_chunk(eng, repo, id, &detail);
    if (st != CBERG_OK) {
        ipc_send_error(fd, cberg_status_str(st));
        return;
    }

    send_chunk_detail(fd, &detail);
    cberg_engine_chunk_detail_free(&detail);
}

void ipc_handle_symbol(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *name = ipc_next_field(&cursor);
    if (name == NULL || name[0] == '\0') {
        ipc_send_error(fd, "missing name");
        return;
    }
    char *repo = ipc_null_if_empty(ipc_next_field(&cursor));
    char *kind_str = ipc_next_field(&cursor);
    size_t limit = ipc_count_field(ipc_next_field(&cursor), 20);

    cberg_engine_hit hits[64];
    size_t found = 0;
    cberg_status st =
        cberg_engine_find_symbol(eng, name, repo, cberg_index_parse_kind(kind_str), limit, hits, 64, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, cberg_status_str(st));
        return;
    }
    write_hits_response(fd, hits, found);
}

void ipc_handle_outline(cberg_engine *eng, int fd, char *args) {
    char *cursor = args;
    char *repo = ipc_next_field(&cursor);
    char *path = ipc_next_field(&cursor);
    if (repo == NULL || repo[0] == '\0' || path == NULL || path[0] == '\0') {
        ipc_send_error(fd, "missing repo or path");
        return;
    }
    cberg_engine_hit hits[256];
    size_t found = 0;
    cberg_status st = cberg_engine_file_outline(eng, repo, path, hits, 256, &found);
    if (st != CBERG_OK) {
        ipc_send_error(fd, cberg_status_str(st));
        return;
    }
    write_hits_response(fd, hits, found);
}
