#include "../provider.h"
#include "../common.h"

#ifdef CBERG_WITH_PGVECTOR

#include <libpq-fe.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "strutil.h"

typedef struct pgvector_backend {
    PGconn *conn;
    char *conninfo;
    char *table;
    char *table_ident;
    size_t dim;
} pgvector_backend;

static PGconn *pgvector_connect(const char *conninfo) {
    PGconn *conn = PQconnectdb(conninfo);
    if (conn == NULL || PQstatus(conn) != CONNECTION_OK) {
        if (conn != NULL) {
            PQfinish(conn);
        }
        return NULL;
    }
    return conn;
}

static cberg_status pgvector_ensure_conn(pgvector_backend *b) {
    if (b == NULL || b->conninfo == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (b->conn != NULL && PQstatus(b->conn) == CONNECTION_OK) {
        return CBERG_OK;
    }
    if (b->conn != NULL) {
        PQreset(b->conn);
        if (PQstatus(b->conn) == CONNECTION_OK) {
            return CBERG_OK;
        }
        PQfinish(b->conn);
        b->conn = NULL;
    }
    b->conn = pgvector_connect(b->conninfo);
    return b->conn != NULL ? CBERG_OK : CBERG_ERR_IO;
}

static cberg_status pg_exec_result(PGresult *res) {
    if (res == NULL) {
        return CBERG_ERR_IO;
    }
    ExecStatusType st = PQresultStatus(res);
    if (st != PGRES_COMMAND_OK && st != PGRES_TUPLES_OK) {
        PQclear(res);
        return CBERG_ERR_IO;
    }
    PQclear(res);
    return CBERG_OK;
}

static cberg_status pg_exec(pgvector_backend *b, const char *sql) {
    cberg_status st = pgvector_ensure_conn(b);
    if (st != CBERG_OK) {
        return st;
    }
    PGresult *res = PQexec(b->conn, sql);
    return pg_exec_result(res);
}

static void pgvector_backend_destroy(void *impl) {
    pgvector_backend *b = impl;
    if (b == NULL) {
        return;
    }
    if (b->conn != NULL) {
        PQfinish(b->conn);
    }
    free(b->conninfo);
    free(b->table);
    free(b->table_ident);
    free(b);
}

static cberg_status pgvector_ensure_hnsw(pgvector_backend *b) {
    char sql[512];
    snprintf(sql, sizeof sql,
             "CREATE INDEX IF NOT EXISTS %s_embedding_hnsw ON %s USING hnsw (embedding vector_cosine_ops)",
             b->table, b->table_ident);
    return pg_exec(b, sql);
}

static cberg_status pgvector_ensure_schema(pgvector_backend *b) {
    cberg_status st = pg_exec(b, "CREATE EXTENSION IF NOT EXISTS vector");
    if (st != CBERG_OK) {
        return st;
    }

    char exists_sql[1024];
    snprintf(exists_sql, sizeof exists_sql,
             "SELECT a.atttypmod FROM pg_attribute a "
             "JOIN pg_class c ON c.oid = a.attrelid "
             "WHERE c.oid = to_regclass('%s') AND a.attname = 'embedding' AND NOT a.attisdropped",
             b->table);
    cberg_status conn_st = pgvector_ensure_conn(b);
    if (conn_st != CBERG_OK) {
        return conn_st;
    }
    PGresult *res = PQexec(b->conn, exists_sql);
    if (res == NULL) {
        return CBERG_ERR_IO;
    }
    ExecStatusType qst = PQresultStatus(res);
    if (qst == PGRES_TUPLES_OK && PQntuples(res) > 0) {
        int typmod = atoi(PQgetvalue(res, 0, 0));
        PQclear(res);
        if (typmod > 0 && (size_t)typmod != b->dim) {
            return CBERG_ERR_CORRUPT;
        }
        return pgvector_ensure_hnsw(b);
    }
    PQclear(res);

    char create_sql[512];
    snprintf(create_sql, sizeof create_sql,
             "CREATE TABLE IF NOT EXISTS %s (id BIGINT PRIMARY KEY, embedding vector(%zu))", b->table_ident, b->dim);
    st = pg_exec(b, create_sql);
    if (st != CBERG_OK) {
        return st;
    }
    return pgvector_ensure_hnsw(b);
}

static cberg_status pgvector_backend_add(void *impl, uint64_t id, const float *vector, size_t dim) {
    pgvector_backend *b = impl;
    if (b == NULL || vector == NULL || dim != b->dim) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char *literal = cberg_provider_vector_literal(vector, dim);
    if (literal == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t need = strlen(b->table_ident) + strlen(literal) + 128;
    char *sql = malloc(need);
    if (sql == NULL) {
        free(literal);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    int n = snprintf(sql, need,
                     "INSERT INTO %s (id, embedding) VALUES (%llu, '%s'::vector) "
                     "ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding",
                     b->table_ident, (unsigned long long)id, literal);
    free(literal);
    if (n < 0 || (size_t)n >= need) {
        free(sql);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = pg_exec(b, sql);
    free(sql);
    return st;
}

static cberg_status pgvector_backend_remove(void *impl, uint64_t id) {
    pgvector_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char sql[256];
    snprintf(sql, sizeof sql, "DELETE FROM %s WHERE id = %llu", b->table_ident, (unsigned long long)id);
    cberg_status conn_st = pgvector_ensure_conn(b);
    if (conn_st != CBERG_OK) {
        return conn_st;
    }
    PGresult *res = PQexec(b->conn, sql);
    if (res == NULL) {
        return CBERG_ERR_IO;
    }
    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        PQclear(res);
        return CBERG_ERR_IO;
    }
    char *affected = PQcmdTuples(res);
    int n = affected != NULL ? atoi(affected) : 0;
    PQclear(res);
    return n == 0 ? CBERG_ERR_NOT_FOUND : CBERG_OK;
}

static cberg_status pgvector_backend_search(void *impl, const float *query, size_t dim, size_t k,
                                            size_t expansion_search, uint64_t *out_ids, float *out_scores,
                                            size_t *out_found) {
    (void)expansion_search;
    pgvector_backend *b = impl;
    if (b == NULL || query == NULL || dim != b->dim || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;

    char *literal = cberg_provider_vector_literal(query, dim);
    if (literal == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t need = strlen(b->table_ident) + strlen(literal) * 2 + 128;
    char *sql = malloc(need);
    if (sql == NULL) {
        free(literal);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    int n = snprintf(sql, need,
                     "SELECT id, 1 - (embedding <=> '%s'::vector) AS score "
                     "FROM %s ORDER BY embedding <=> '%s'::vector LIMIT %zu",
                     literal, b->table_ident, literal, k);
    free(literal);
    if (n < 0 || (size_t)n >= need) {
        free(sql);
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    cberg_status conn_st = pgvector_ensure_conn(b);
    if (conn_st != CBERG_OK) {
        free(sql);
        return conn_st;
    }
    PGresult *res = PQexec(b->conn, sql);
    free(sql);
    if (res == NULL || PQresultStatus(res) != PGRES_TUPLES_OK) {
        PQclear(res);
        return CBERG_ERR_IO;
    }
    int rows = PQntuples(res);
    size_t found = 0;
    for (int i = 0; i < rows && found < k; i++) {
        out_ids[found] = (uint64_t)strtoull(PQgetvalue(res, i, 0), NULL, 10);
        out_scores[found] = (float)strtod(PQgetvalue(res, i, 1), NULL);
        found++;
    }
    PQclear(res);
    *out_found = found;
    return CBERG_OK;
}

static cberg_status pgvector_backend_save(void *impl) {
    (void)impl;
    return CBERG_OK;
}

static cberg_status pgvector_backend_clear(void *impl) {
    pgvector_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char sql[256];
    snprintf(sql, sizeof sql, "TRUNCATE %s", b->table_ident);
    return pg_exec(b, sql);
}

static cberg_status pgvector_open(const char *path, size_t dim, const cberg_index_config *config,
                                  cberg_index_backend **out_backend) {
    if (path == NULL || dim == 0 || config == NULL || config->postgres_url == NULL ||
        config->postgres_url[0] == '\0' || out_backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_backend = NULL;

    pgvector_backend *b = calloc(1, sizeof(*b));
    if (b == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    b->dim = dim;
    b->table = cberg_provider_name_from_path(path);
    b->conninfo = cberg_strdup(config->postgres_url);
    if (b->table == NULL || b->conninfo == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    b->conn = pgvector_connect(b->conninfo);
    if (b->conn == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_IO;
    }

    b->table_ident = PQescapeIdentifier(b->conn, b->table, strlen(b->table));
    if (b->table_ident == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = pgvector_ensure_schema(b);
    if (st != CBERG_OK) {
        pgvector_backend_destroy(b);
        return st;
    }

    cberg_index_backend *backend =
        cberg_index_backend_new(b, pgvector_backend_destroy, pgvector_backend_add, pgvector_backend_remove,
                                pgvector_backend_search, pgvector_backend_save, pgvector_backend_clear);
    if (backend == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_backend = backend;
    return CBERG_OK;
}

static cberg_status pgvector_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    (void)dim;
    if (path == NULL || config == NULL || config->postgres_url == NULL || config->postgres_url[0] == '\0') {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char *table = cberg_provider_name_from_path(path);
    if (table == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    PGconn *conn = pgvector_connect(config->postgres_url);
    if (conn == NULL) {
        free(table);
        return CBERG_ERR_IO;
    }
    char *table_ident = PQescapeIdentifier(conn, table, strlen(table));
    free(table);
    if (table_ident == NULL) {
        PQfinish(conn);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    char sql[256];
    snprintf(sql, sizeof sql, "DROP TABLE IF EXISTS %s", table_ident);
    cberg_status st = pg_exec_result(PQexec(conn, sql));
    PQfreemem(table_ident);
    PQfinish(conn);
    return st;
}

const cberg_index_provider_ops cberg_pgvector_provider = {
    .id = CBERG_INDEX_PGVECTOR,
    .name = "pgvector",
    .rebuild_inplace = 1,
    .open = pgvector_open,
    .wipe = pgvector_wipe,
};

#else /* !CBERG_WITH_PGVECTOR */

static cberg_status pgvector_open(const char *path, size_t dim, const cberg_index_config *config,
                                  cberg_index_backend **out_backend) {
    (void)path;
    (void)dim;
    (void)config;
    if (out_backend != NULL) {
        *out_backend = NULL;
    }
    return CBERG_ERR_NOT_IMPLEMENTED;
}

static cberg_status pgvector_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    (void)path;
    (void)dim;
    (void)config;
    return CBERG_ERR_NOT_IMPLEMENTED;
}

const cberg_index_provider_ops cberg_pgvector_provider = {
    .id = CBERG_INDEX_PGVECTOR,
    .name = "pgvector",
    .rebuild_inplace = 1,
    .open = pgvector_open,
    .wipe = pgvector_wipe,
};

#endif /* CBERG_WITH_PGVECTOR */
