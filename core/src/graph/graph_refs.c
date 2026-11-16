/*
 * Reference walk: runs a language's reference query over the parse tree and
 * turns its captures into fragment references (calls, references, imports,
 * inheritance, out-of-body membership, Ruby requires), deduplicated per file.
 * See graph_extract.c for the capture vocabulary.
 */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "arena.h"
#include "graph_extract.h"
#include "grow.h"
#include "strmap.h"


/* Copies a capture's text, truncated to CBERG_GRAPH_NAME_MAX. For imports,
 * strips one layer of quotes / angle brackets and trims rust use-tree braces
 * ("x::{a, b}" -> "x"). */
static void capture_text(const char *src, size_t src_len, TSNode node, int is_import, char *buf, size_t buf_cap) {
    uint32_t start = ts_node_start_byte(node);
    uint32_t end = ts_node_end_byte(node);
    if (end > src_len || start > end) {
        buf[0] = '\0';
        return;
    }
    if (is_import && end - start >= 2) {
        char open = src[start];
        char close = src[end - 1];
        if ((open == '"' && close == '"') || (open == '\'' && close == '\'') || (open == '<' && close == '>')) {
            start++;
            end--;
        }
    }
    size_t len = end - start;
    if (len >= buf_cap) {
        len = buf_cap - 1;
    }
    memcpy(buf, src + start, len);
    buf[len] = '\0';
    if (is_import) {
        char *brace = strchr(buf, '{');
        if (brace != NULL) {
            while (brace > buf && (brace[-1] == ':' || brace[-1] == ' ')) {
                brace--;
            }
            *brace = '\0';
        }
    }
}

typedef enum ref_capture {
    CAP_NONE = 0,
    CAP_CALL,
    CAP_REFERENCE,
    CAP_IMPORT,
    CAP_INHERIT,
    CAP_MEMBER_CONTAINER,
    CAP_MEMBER_NAME,
    CAP_REQUIRE_METHOD,
    CAP_REQUIRE_PATH,
} ref_capture;

static ref_capture capture_kind(const char *name, uint32_t len) {
    struct {
        const char *name;
        ref_capture kind;
    } kinds[] = {
        {"call", CAP_CALL},
        {"reference", CAP_REFERENCE},
        {"import", CAP_IMPORT},
        {"inherit", CAP_INHERIT},
        {"member.container", CAP_MEMBER_CONTAINER},
        {"member.name", CAP_MEMBER_NAME},
        {"require.method", CAP_REQUIRE_METHOD},
        {"require.path", CAP_REQUIRE_PATH},
    };
    for (size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); i++) {
        if (strlen(kinds[i].name) == len && strncmp(name, kinds[i].name, len) == 0) {
            return kinds[i].kind;
        }
    }
    return CAP_NONE;
}

/* Deduplicate captures at the same line with the same source and binding.
 * Calls on separate lines and through different receivers remain distinct. */
static cberg_status ref_seen(cberg_strmap *dedupe, uint8_t kind, uint8_t rev, int32_t src_def, const char *name, uint32_t line, const cberg_graph_binding *binding, int *out_seen) {
    char key[CBERG_GRAPH_NAME_MAX * 3 + 64];
    snprintf(key, sizeof key, "%u:%u:%d:%u:%s:%s:%s", kind, rev, src_def, line, name, binding != NULL ? binding->module : "", binding != NULL ? binding->owner : "");
    uint64_t hit = 0;
    if (cberg_strmap_get(dedupe, key, &hit)) {
        *out_seen = 1;
        return CBERG_OK;
    }
    *out_seen = 0;
    return cberg_strmap_set(dedupe, key, 1);
}

static cberg_status add_bound_ref(cberg_graph_fragment *frag, cberg_strmap *dedupe, uint8_t kind, uint8_t rev, int32_t src_def, const char *name, uint32_t line, const cberg_graph_binding *binding) {
    if (name == NULL || name[0] == '\0') {
        return CBERG_OK;
    }
    int seen = 0;
    cberg_status st = ref_seen(dedupe, kind, rev, src_def, name, line, binding, &seen);
    if (st != CBERG_OK || seen) {
        return st;
    }
    st = graph_fragment_push_ref(frag, src_def, binding != NULL ? binding->local_def : -1, name, line, kind, rev);
    if (st != CBERG_OK || binding == NULL)
        return st;

    cberg_graph_fref *reference = &frag->refs[frag->refs_len - 1];
    reference->binding = (uint8_t)binding->kind;
    reference->module = binding->module[0] ? cberg_arena_strdup(frag->arena, binding->module) : NULL;
    reference->owner = binding->owner[0] ? cberg_arena_strdup(frag->arena, binding->owner) : NULL;
    if ((binding->module[0] && reference->module == NULL) || (binding->owner[0] && reference->owner == NULL)) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    return CBERG_OK;
}

static cberg_status add_named_ref(cberg_graph_fragment *frag, cberg_strmap *dedupe, uint8_t kind, uint8_t rev, int32_t src_def, const char *name, uint32_t line) {
    return add_bound_ref(frag, dedupe, kind, rev, src_def, name, line, NULL);
}

/* What every match of one file's reference query reads and writes. */
typedef struct {
    cberg_graph_fragment *frag;
    cberg_strmap *dedupe;
    cberg_graph_scope_cache *scopes; /* optional: binding without it is only slower */
    TSNode root;
    const char *src;
    size_t src_len;
} ref_walk;

/* Captures of one match that only become an edge once the whole match is
 * read: out-of-body membership and Ruby require calls. */
typedef struct {
    char container[CBERG_GRAPH_NAME_MAX];
    TSNode member_name;
    int has_member_name;
    char require_method[CBERG_GRAPH_NAME_MAX];
    char require_path[CBERG_GRAPH_NAME_MAX];
    uint32_t require_line;
} ref_match;

static int32_t def_enclosing(const ref_walk *w, TSNode node) {
    return graph_fragment_enclosing_def(w->frag, ts_node_start_byte(node));
}

static int is_require(const char *name) {
    return strcmp(name, "require") == 0 || strcmp(name, "require_relative") == 0;
}

/* Adds a call or reference edge, binding the callee through local scopes. */
static cberg_status add_call_ref(ref_walk *w, uint8_t kind, TSNode node, uint32_t line) {
    cberg_graph_binding binding;
    cberg_graph_bind_call(w->frag, w->root, node, w->src, w->src_len, w->scopes, &binding);
    return add_bound_ref(w->frag, w->dedupe, kind, 0, def_enclosing(w, node), binding.name, line, &binding);
}

/* Adds the edge for one capture, or records it in m for the match's end. */
static cberg_status apply_ref_capture(ref_walk *w, ref_capture kind, TSNode node, ref_match *m) {
    uint32_t line = ts_node_start_point(node).row + 1;
    char text[CBERG_GRAPH_NAME_MAX];

    switch (kind) {
    case CAP_REFERENCE:
        return cberg_graph_reference_use(node) ? add_call_ref(w, CBERG_GEDGE_REFERENCES, node, line) : CBERG_OK;
    case CAP_CALL:
        /* require/require_relative become IMPORTS once the match is read. */
        capture_text(w->src, w->src_len, node, 0, text, sizeof text);
        return is_require(text) ? CBERG_OK : add_call_ref(w, CBERG_GEDGE_CALLS, node, line);
    case CAP_IMPORT:
        capture_text(w->src, w->src_len, node, 1, text, sizeof text);
        return add_named_ref(w->frag, w->dedupe, CBERG_GEDGE_IMPORTS, 0, -1, text, line);
    case CAP_REQUIRE_METHOD:
        capture_text(w->src, w->src_len, node, 0, m->require_method, sizeof m->require_method);
        m->require_line = line;
        return CBERG_OK;
    case CAP_REQUIRE_PATH:
        capture_text(w->src, w->src_len, node, 0, m->require_path, sizeof m->require_path);
        m->require_line = line;
        return CBERG_OK;
    case CAP_INHERIT:
        capture_text(w->src, w->src_len, node, 0, text, sizeof text);
        return add_named_ref(w->frag, w->dedupe, CBERG_GEDGE_INHERITS, 0, def_enclosing(w, node), text, line);
    case CAP_MEMBER_CONTAINER:
        capture_text(w->src, w->src_len, node, 0, m->container, sizeof m->container);
        return CBERG_OK;
    case CAP_MEMBER_NAME:
        m->member_name = node;
        m->has_member_name = 1;
        return CBERG_OK;
    default:
        return CBERG_OK;
    }
}

/* Adds the edges that need the whole match. */
static cberg_status finish_ref_match(ref_walk *w, const ref_match *m) {
    /* Out-of-body membership: the enclosing def of the member's name is
     * the method itself; the edge (container -> method) resolves the
     * container by name at query time (it may live in another file). */
    if (m->has_member_name && m->container[0] != '\0') {
        int32_t method_def = def_enclosing(w, m->member_name);
        if (method_def >= 0) {
            uint32_t line = ts_node_start_point(m->member_name).row + 1;
            cberg_status st = add_named_ref(w->frag, w->dedupe, CBERG_GEDGE_CONTAINS, 1, method_def, m->container, line);
            if (st != CBERG_OK) {
                return st;
            }
        }
    }

    /* Ruby require / require_relative "path" → IMPORTS (argument-aware). */
    if (m->require_path[0] != '\0' && is_require(m->require_method)) {
        uint32_t line = m->require_line != 0 ? m->require_line : 1;
        return add_named_ref(w->frag, w->dedupe, CBERG_GEDGE_IMPORTS, 0, -1, m->require_path, line);
    }

    return CBERG_OK;
}

static cberg_status walk_match(ref_walk *w, const TSQuery *query, const TSQueryMatch *match) {
    ref_match m = {0};
    cberg_status st = CBERG_OK;

    for (uint16_t i = 0; i < match->capture_count && st == CBERG_OK; i++) {
        TSQueryCapture cap = match->captures[i];
        uint32_t name_len = 0;
        const char *cap_name = ts_query_capture_name_for_id(query, cap.index, &name_len);
        st = apply_ref_capture(w, capture_kind(cap_name, name_len), cap.node, &m);
    }

    return st == CBERG_OK ? finish_ref_match(w, &m) : st;
}

cberg_status graph_walk_refs(cberg_graph_fragment *frag, const TSQuery *query, TSNode root, const char *src, size_t src_len) {
    TSQueryCursor *cursor = ts_query_cursor_new();
    if (cursor == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    ref_walk w = {.frag = frag, .root = root, .src = src, .src_len = src_len};
    w.dedupe = cberg_strmap_new(256);
    if (w.dedupe == NULL) {
        ts_query_cursor_delete(cursor);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w.scopes = cberg_graph_scope_cache_new();

    cberg_status st = CBERG_OK;
    ts_query_cursor_exec(cursor, query, root);

    TSQueryMatch match;
    while (st == CBERG_OK && ts_query_cursor_next_match(cursor, &match)) {
        st = walk_match(&w, query, &match);
    }

    cberg_graph_scope_cache_free(w.scopes);
    cberg_strmap_free(w.dedupe);
    ts_query_cursor_delete(cursor);
    return st;
}
