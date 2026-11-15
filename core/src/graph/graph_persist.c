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
    cberg_status st = CBERG_OK;
    size_t live_nodes = 0;
    size_t live_refs = 0;
    cberg_graph_counts(graph, &live_nodes, &live_refs);
    if (cberg_bin_w_bytes(f, CBERG_GRAPH_MAGIC, 4) != CBERG_OK || cberg_bin_w_u32(f, CBERG_GRAPH_VERSION) != CBERG_OK ||
        cberg_bin_w_u64(f, live_nodes) != CBERG_OK || cberg_bin_w_u64(f, live_refs) != CBERG_OK) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    for (size_t i = 0; i < graph->nodes_len; i++) {
        const graph_node_rec *rec = &graph->nodes[i];
        if (rec->dead) {
            continue;
        }
        if (cberg_bin_w_u64(f, rec->pub.id) != CBERG_OK || cberg_bin_w_u32(f, (uint32_t)rec->pub.kind) != CBERG_OK ||
            cberg_bin_w_u32(f, (uint32_t)rec->pub.lang) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->pub.span.start_byte) != CBERG_OK || cberg_bin_w_u32(f, rec->pub.span.end_byte) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->pub.span.start_line) != CBERG_OK || cberg_bin_w_u32(f, rec->pub.span.end_line) != CBERG_OK ||
            cberg_bin_w_str(f, rec->pub.name) != CBERG_OK || cberg_bin_w_str(f, rec->pub.qname) != CBERG_OK ||
            cberg_bin_w_str(f, rec->pub.path) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    for (size_t i = 0; i < graph->refs_len; i++) {
        const graph_ref_rec *rec = &graph->refs[i];
        if (rec->dead) {
            continue;
        }
        if (cberg_bin_w_u64(f, rec->src) != CBERG_OK || cberg_bin_w_u64(f, rec->dst) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->line) != CBERG_OK ||
            cberg_bin_w_u32(f, ((uint32_t)rec->binding << 24) | ((uint32_t)rec->resolution << 16) | ((uint32_t)rec->rev << 8) | rec->kind) != CBERG_OK ||
            cberg_bin_w_str(f, rec->name) != CBERG_OK || cberg_bin_w_str(f, rec->path) != CBERG_OK ||
            cberg_bin_w_str(f, rec->module) != CBERG_OK || cberg_bin_w_str(f, rec->owner) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    if (fflush(f) != 0) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (fclose(f) != 0) {
        f = NULL;
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
        remove(tmp);
        return st;
    }
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    remove(tmp);
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

    char magic[4];
    uint32_t version = 0;
    uint64_t node_count = 0;
    uint64_t ref_count = 0;
    if (cberg_bin_r_exact(f, magic, 4) != CBERG_OK || memcmp(magic, CBERG_GRAPH_MAGIC, 4) != 0 ||
        cberg_bin_r_u32(f, &version) != CBERG_OK || version != CBERG_GRAPH_VERSION ||
        cberg_bin_r_u64(f, &node_count) != CBERG_OK || cberg_bin_r_u64(f, &ref_count) != CBERG_OK) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_graph *g = NULL;
    cberg_status st = cberg_graph_new(&g);
    if (st != CBERG_OK) {
        fclose(f);
        return st;
    }

    for (uint64_t i = 0; i < node_count && st == CBERG_OK; i++) {
        cberg_graph_node node = {0};
        uint32_t kind = 0;
        uint32_t lang = 0;
        char *name = NULL;
        char *qname = NULL;
        char *npath = NULL;
        if (cberg_bin_r_u64(f, &node.id) != CBERG_OK || cberg_bin_r_u32(f, &kind) != CBERG_OK ||
            cberg_bin_r_u32(f, &lang) != CBERG_OK || cberg_bin_r_u32(f, &node.span.start_byte) != CBERG_OK ||
            cberg_bin_r_u32(f, &node.span.end_byte) != CBERG_OK || cberg_bin_r_u32(f, &node.span.start_line) != CBERG_OK ||
            cberg_bin_r_u32(f, &node.span.end_line) != CBERG_OK || cberg_bin_r_str(f, &name) != CBERG_OK ||
            cberg_bin_r_str(f, &qname) != CBERG_OK || cberg_bin_r_str(f, &npath) != CBERG_OK || name == NULL ||
            qname == NULL || kind > CBERG_GNODE_MODULE) {
            free(name);
            free(qname);
            free(npath);
            st = CBERG_ERR_NOT_FOUND; /* truncated/corrupt -> cold rebuild */
            break;
        }
        node.kind = (cberg_graph_node_kind)kind;
        node.lang = (cberg_language)lang;
        node.name = name;
        node.qname = qname;
        node.path = npath;
        st = graph_add_node(g, &node);
        free(name);
        free(qname);
        free(npath);
    }

    for (uint64_t i = 0; i < ref_count && st == CBERG_OK; i++) {
        graph_ref_rec rec = {0};
        uint32_t kind_rev = 0;
        char *name = NULL;
        char *rpath = NULL;
        char *module = NULL;
        char *owner = NULL;
        if (cberg_bin_r_u64(f, &rec.src) != CBERG_OK || cberg_bin_r_u64(f, &rec.dst) != CBERG_OK ||
            cberg_bin_r_u32(f, &rec.line) != CBERG_OK || cberg_bin_r_u32(f, &kind_rev) != CBERG_OK ||
            cberg_bin_r_str(f, &name) != CBERG_OK || cberg_bin_r_str(f, &rpath) != CBERG_OK || rpath == NULL ||
            cberg_bin_r_str(f, &module) != CBERG_OK || cberg_bin_r_str(f, &owner) != CBERG_OK ||
            (kind_rev >> 24) > CBERG_BIND_UNKNOWN) {
            free(name);
            free(rpath);
            free(module);
            free(owner);
            st = CBERG_ERR_NOT_FOUND;
            break;
        }
        rec.kind = (uint8_t)(kind_rev & 0xFFu);
        rec.rev = (uint8_t)((kind_rev >> 8) & 0x1u);
        rec.resolution = (uint8_t)((kind_rev >> 16) & 0xFFu);
        rec.binding = (uint8_t)(kind_rev >> 24);
        rec.name = name;
        rec.path = rpath;
        rec.module = module;
        rec.owner = owner;
        st = graph_add_ref(g, &rec);
        free(name);
        free(rpath);
        free(module);
        free(owner);
    }
    fclose(f);
    if (st != CBERG_OK) {
        cberg_graph_free(g);
        return st;
    }
    *out_graph = g;
    return CBERG_OK;
}
