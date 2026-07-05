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
    char *table;
    size_t dim;
} pgvector_backend;

static cberg_status pg_exec_ok(PGconn *conn, const char *sql) {
    PGresult *res = PQexec(conn, sql);
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

static void pgvector_backend_destroy(void *impl) {
    pgvector_backend *b = impl;
    if (b == NULL) {
        return;
    }
    if (b->conn != NULL) {
        PQfinish(b->conn);
    }
    free(b->table);
    free(b);
}

static cberg_status pgvector_ensure_schema(pgvector_backend *b) {
    cberg_status st = pg_exec_ok(b->conn, "CREATE EXTENSION IF NOT EXISTS vector");
    if (st != CBERG_OK) {
        return st;
    }

    char exists_sql[768];
    snprintf(exists_sql, sizeof exists_sql,
             "SELECT atttypmod FROM pg_attribute a "
             "JOIN pg_class c ON c.oid = a.attrelid "
             "WHERE c.relname = '%s' AND a.attname = 'embedding' AND NOT a.attisdropped",
             b->table);
    PGresult *res = PQexec(b->conn, exists_sql);
    if (res == NULL) {
        return CBERG_ERR_IO;
    }
    ExecStatusType qst = PQresultStatus(res);
    if (qst == PGRES_TUPLES_OK && PQntuples(res) > 0) {
        int typmod = atoi(PQgetvalue(res, 0, 0));
        PQclear(res);
        if (typmod > 0 && (size_t)typmod != b->dim) {
            return CBERG_ERR_IO;
        }
        return CBERG_OK;
    }
    PQclear(res);

    char create_sql[512];
    snprintf(create_sql, sizeof create_sql,
             "CREATE TABLE IF NOT EXISTS %s (id BIGINT PRIMARY KEY, embedding vector(%zu))",
             b->table, b->dim);
    return pg_exec_ok(b->conn, create_sql);
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
    char sql[8192];
    int n = snprintf(sql, sizeof sql,
                     "INSERT INTO %s (id, embedding) VALUES (%llu, '%s'::vector) "
                     "ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding",
                     b->table, (unsigned long long)id, literal);
    free(literal);
    if (n < 0 || (size_t)n >= sizeof sql) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return pg_exec_ok(b->conn, sql);
}

static cberg_status pgvector_backend_remove(void *impl, uint64_t id) {
    pgvector_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char sql[256];
    snprintf(sql, sizeof sql, "DELETE FROM %s WHERE id = %llu", b->table, (unsigned long long)id);
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
    char sql[8192];
    int n = snprintf(sql, sizeof sql,
                     "SELECT id, 1 - (embedding <=> '%s'::vector) AS score "
                     "FROM %s ORDER BY embedding <=> '%s'::vector LIMIT %zu",
                     literal, b->table, literal, k);
    free(literal);
    if (n < 0 || (size_t)n >= sizeof sql) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    PGresult *res = PQexec(b->conn, sql);
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
    snprintf(sql, sizeof sql, "TRUNCATE %s", b->table);
    return pg_exec_ok(b->conn, sql);
}

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
    if (b->table == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    b->conn = pgvector_connect(config->postgres_url);
    if (b->conn == NULL) {
        pgvector_backend_destroy(b);
        return CBERG_ERR_IO;
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
    char sql[256];
    snprintf(sql, sizeof sql, "DROP TABLE IF EXISTS %s", table);
    cberg_status st = pg_exec_ok(conn, sql);
    PQfinish(conn);
    free(table);
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
