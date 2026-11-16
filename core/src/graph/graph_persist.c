/*
 * Snapshot format: magic + version guard, live node and ref counts, then the
 * records. Incompatible or truncated files load as NOT_FOUND (cold rebuild),
 * matching the chunk-table contract.
 */
#include "graph_store.h"

#include <stdlib.h>
#include <string.h>

#include "binio.h"

#define CBERG_GRAPH_MAGIC "CBG1"
/* v4 invalidates bindings extracted before lexical shadowing fixes. */
#define CBERG_GRAPH_VERSION 4u

/* A ref's kind, reverse flag, resolution, and binding share one u32. */
static uint32_t pack_ref_flags(const graph_ref_rec *rec) {
    return ((uint32_t)rec->binding << 24) | ((uint32_t)rec->resolution << 16) | ((uint32_t)rec->rev << 8) | rec->kind;
}

static void unpack_ref_flags(uint32_t packed, graph_ref_rec *rec) {
    rec->kind = (uint8_t)(packed & 0xFFu);
    rec->rev = (uint8_t)((packed >> 8) & 0x1u);
    rec->resolution = (uint8_t)((packed >> 16) & 0xFFu);
    rec->binding = (uint8_t)(packed >> 24);
}

/* ------------------------------------------------------------------ save */

static bool write_node(FILE *f, const cberg_graph_node *node) {
    return cberg_bin_w_u64(f, node->id) == CBERG_OK && cberg_bin_w_u32(f, (uint32_t)node->kind) == CBERG_OK &&
           cberg_bin_w_u32(f, (uint32_t)node->lang) == CBERG_OK && cberg_bin_w_u32(f, node->span.start_byte) == CBERG_OK &&
           cberg_bin_w_u32(f, node->span.end_byte) == CBERG_OK && cberg_bin_w_u32(f, node->span.start_line) == CBERG_OK &&
           cberg_bin_w_u32(f, node->span.end_line) == CBERG_OK && cberg_bin_w_str(f, node->name) == CBERG_OK &&
           cberg_bin_w_str(f, node->qname) == CBERG_OK && cberg_bin_w_str(f, node->path) == CBERG_OK;
}

static bool write_ref(FILE *f, const graph_ref_rec *rec) {
    return cberg_bin_w_u64(f, rec->src) == CBERG_OK && cberg_bin_w_u64(f, rec->dst) == CBERG_OK &&
           cberg_bin_w_u32(f, rec->line) == CBERG_OK && cberg_bin_w_u32(f, pack_ref_flags(rec)) == CBERG_OK &&
           cberg_bin_w_str(f, rec->name) == CBERG_OK && cberg_bin_w_str(f, rec->path) == CBERG_OK &&
           cberg_bin_w_str(f, rec->module) == CBERG_OK && cberg_bin_w_str(f, rec->owner) == CBERG_OK;
}

/* Writes the header, then every live node and ref. */
static bool write_snapshot(FILE *f, const cberg_graph *graph) {
    size_t live_nodes = 0;
    size_t live_refs = 0;
    cberg_graph_counts(graph, &live_nodes, &live_refs);

    bool ok = cberg_bin_w_bytes(f, CBERG_GRAPH_MAGIC, 4) == CBERG_OK && cberg_bin_w_u32(f, CBERG_GRAPH_VERSION) == CBERG_OK &&
              cberg_bin_w_u64(f, live_nodes) == CBERG_OK && cberg_bin_w_u64(f, live_refs) == CBERG_OK;

    for (size_t i = 0; ok && i < graph->nodes_len; i++) {
        if (!graph->nodes[i].dead) {
            ok = write_node(f, &graph->nodes[i].pub);
        }
    }

    for (size_t i = 0; ok && i < graph->refs_len; i++) {
        if (!graph->refs[i].dead) {
            ok = write_ref(f, &graph->refs[i]);
        }
    }

    return ok;
}

/* Writes to "<path>.tmp" and renames it into place, so a crash mid-save
 * leaves the previous snapshot intact. */
cberg_status cberg_graph_save(const cberg_graph *graph, const char *path) {
    if (graph == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        return CBERG_ERR_IO;
    }

    bool ok = write_snapshot(f, graph) && fflush(f) == 0;
    ok = fclose(f) == 0 && ok;

    if (!ok || rename(tmp, path) != 0) {
        remove(tmp);
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

/* ------------------------------------------------------------------ load */

static bool read_header(FILE *f, uint64_t *node_count, uint64_t *ref_count) {
    char magic[4];
    uint32_t version = 0;

    return cberg_bin_r_exact(f, magic, 4) == CBERG_OK && memcmp(magic, CBERG_GRAPH_MAGIC, 4) == 0 &&
           cberg_bin_r_u32(f, &version) == CBERG_OK && version == CBERG_GRAPH_VERSION &&
           cberg_bin_r_u64(f, node_count) == CBERG_OK && cberg_bin_r_u64(f, ref_count) == CBERG_OK;
}

/* Reads one node record into g. A truncated or corrupt record is NOT_FOUND,
 * which makes the caller rebuild the graph cold. */
static cberg_status load_node(FILE *f, cberg_graph *g) {
    cberg_graph_node node = {0};
    uint32_t kind = 0;
    uint32_t lang = 0;
    char *name = NULL;
    char *qname = NULL;
    char *npath = NULL;

    bool ok = cberg_bin_r_u64(f, &node.id) == CBERG_OK && cberg_bin_r_u32(f, &kind) == CBERG_OK &&
              cberg_bin_r_u32(f, &lang) == CBERG_OK && cberg_bin_r_u32(f, &node.span.start_byte) == CBERG_OK &&
              cberg_bin_r_u32(f, &node.span.end_byte) == CBERG_OK && cberg_bin_r_u32(f, &node.span.start_line) == CBERG_OK &&
              cberg_bin_r_u32(f, &node.span.end_line) == CBERG_OK && cberg_bin_r_str(f, &name) == CBERG_OK &&
              cberg_bin_r_str(f, &qname) == CBERG_OK && cberg_bin_r_str(f, &npath) == CBERG_OK && name != NULL &&
              qname != NULL && kind <= CBERG_GNODE_MODULE;

    cberg_status st = CBERG_ERR_NOT_FOUND;
    if (ok) {
        node.kind = (cberg_graph_node_kind)kind;
        node.lang = (cberg_language)lang;
        node.name = name;
        node.qname = qname;
        node.path = npath;
        st = graph_add_node(g, &node);
    }

    free(name);
    free(qname);
    free(npath);
    return st;
}

/* Reads one ref record into g; corrupt records are NOT_FOUND like nodes. */
static cberg_status load_ref(FILE *f, cberg_graph *g) {
    graph_ref_rec rec = {0};
    uint32_t flags = 0;
    char *name = NULL;
    char *rpath = NULL;
    char *module = NULL;
    char *owner = NULL;

    bool ok = cberg_bin_r_u64(f, &rec.src) == CBERG_OK && cberg_bin_r_u64(f, &rec.dst) == CBERG_OK &&
              cberg_bin_r_u32(f, &rec.line) == CBERG_OK && cberg_bin_r_u32(f, &flags) == CBERG_OK &&
              cberg_bin_r_str(f, &name) == CBERG_OK && cberg_bin_r_str(f, &rpath) == CBERG_OK && rpath != NULL &&
              cberg_bin_r_str(f, &module) == CBERG_OK && cberg_bin_r_str(f, &owner) == CBERG_OK &&
              (flags >> 24) <= CBERG_BIND_UNKNOWN;

    cberg_status st = CBERG_ERR_NOT_FOUND;
    if (ok) {
        unpack_ref_flags(flags, &rec);
        rec.name = name;
        rec.path = rpath;
        rec.module = module;
        rec.owner = owner;
        st = graph_add_ref(g, &rec);
    }

    free(name);
    free(rpath);
    free(module);
    free(owner);
    return st;
}

cberg_status cberg_graph_load(const char *path, cberg_graph **out_graph) {
    if (path == NULL || out_graph == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_graph = NULL;

    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    uint64_t node_count = 0;
    uint64_t ref_count = 0;
    if (!read_header(f, &node_count, &ref_count)) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_graph *g = NULL;
    cberg_status st = cberg_graph_new(&g);

    for (uint64_t i = 0; i < node_count && st == CBERG_OK; i++) {
        st = load_node(f, g);
    }
    for (uint64_t i = 0; i < ref_count && st == CBERG_OK; i++) {
        st = load_ref(f, g);
    }
    fclose(f);

    if (st != CBERG_OK) {
        cberg_graph_free(g);
        return st;
    }

    *out_graph = g;
    return CBERG_OK;
}
