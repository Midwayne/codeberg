#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static void mkparents(const char *root, const char *rel) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", root, rel);
    for (char *p = path + strlen(root) + 1; *p != '\0'; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(path, 0777);
            *p = '/';
        }
    }
}

static void write_file(const char *root, const char *rel, const char *content) {
    mkparents(root, rel);
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", root, rel);
    FILE *f = fopen(path, "w");
    if (f == NULL) {
        return;
    }
    fputs(content, f);
    fclose(f);
}

static void remove_file(const char *root, const char *rel) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", root, rel);
    remove(path);
}

static int has_path(const char **list, size_t n, const char *p) {
    for (size_t i = 0; i < n; i++) {
        if (strcmp(list[i], p) == 0) {
            return 1;
        }
    }
    return 0;
}

static int hash_is_zero(const uint8_t h[CBERG_HASH_LEN]) {
    for (size_t i = 0; i < CBERG_HASH_LEN; i++) {
        if (h[i] != 0) {
            return 0;
        }
    }
    return 1;
}

int main(void) {
    /* Invalid args. */
    cberg_manifest *bad = NULL;
    CHECK(cberg_manifest_build(NULL, &bad) == CBERG_ERR_INVALID_ARGUMENT, "null root rejected");
    CHECK(cberg_manifest_build("/tmp/cberg-no-such-root-xyz", &bad) == CBERG_ERR_IO, "missing root is IO error");

    char tmpl[] = "/tmp/cberg-manifest-XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");

    write_file(root, "README.md", "readme\n");
    write_file(root, "docs/guide.md", "guide\n");
    write_file(root, "src/main.c", "int main(void){return 0;}\n");
    write_file(root, "src/util/helper.c", "void h(void){}\n");
    write_file(root, "src/util/helper.h", "void h(void);\n");

    /* Build + flat accessors. */
    cberg_manifest *m1 = NULL;
    CHECK(cberg_manifest_build(root, &m1) == CBERG_OK, "build m1");
    CHECK(cberg_manifest_len(m1) == 5, "five leaves");
    uint8_t root1[CBERG_HASH_LEN];
    cberg_manifest_root(m1, root1);
    CHECK(!hash_is_zero(root1), "non-empty root is non-zero");

    /* Leaves sorted by path. */
    const cberg_manifest_entry *e0 = cberg_manifest_at(m1, 0);
    CHECK(e0 != NULL && strcmp(e0->path, "README.md") == 0, "first leaf is README.md");
    CHECK(cberg_manifest_at(m1, 5) == NULL, "out-of-range leaf is NULL");
    int sorted = 1;
    for (size_t i = 1; i < cberg_manifest_len(m1); i++) {
        if (strcmp(cberg_manifest_at(m1, i - 1)->path, cberg_manifest_at(m1, i)->path) >= 0) {
            sorted = 0;
        }
    }
    CHECK(sorted, "leaves strictly sorted by path");

    /* Rebuild identical tree → equal root, empty diff. */
    cberg_manifest *m1b = NULL;
    CHECK(cberg_manifest_build(root, &m1b) == CBERG_OK, "build m1b");
    uint8_t root1b[CBERG_HASH_LEN];
    cberg_manifest_root(m1b, root1b);
    CHECK(memcmp(root1, root1b, CBERG_HASH_LEN) == 0, "identical content → identical root");

    cberg_manifest_changes diff = {0};
    CHECK(cberg_manifest_diff(m1, m1b, &diff) == CBERG_OK, "diff identical");
    CHECK(diff.added_len == 0 && diff.modified_len == 0 && diff.deleted_len == 0, "no changes between identical");
    cberg_manifest_diff_free(&diff);
    cberg_manifest_free(m1b);

    /* Modify one deep file → exactly one modified, root changes, siblings pruned. */
    write_file(root, "src/util/helper.c", "void h(void){return;}\n");
    cberg_manifest *m2 = NULL;
    CHECK(cberg_manifest_build(root, &m2) == CBERG_OK, "build m2");
    uint8_t root2[CBERG_HASH_LEN];
    cberg_manifest_root(m2, root2);
    CHECK(memcmp(root1, root2, CBERG_HASH_LEN) != 0, "content change → root changes");

    CHECK(cberg_manifest_diff(m1, m2, &diff) == CBERG_OK, "diff modify");
    CHECK(diff.modified_len == 1 && has_path(diff.modified, diff.modified_len, "src/util/helper.c"), "modified helper.c");
    CHECK(diff.added_len == 0 && diff.deleted_len == 0, "modify only");
    CHECK(!has_path(diff.modified, diff.modified_len, "src/main.c"), "unchanged sibling not reported");
    CHECK(!has_path(diff.modified, diff.modified_len, "README.md"), "unchanged subtree not reported");
    cberg_manifest_diff_free(&diff);

    /* Add a file. */
    write_file(root, "src/new.c", "int n;\n");
    cberg_manifest *m3 = NULL;
    CHECK(cberg_manifest_build(root, &m3) == CBERG_OK, "build m3");
    CHECK(cberg_manifest_diff(m2, m3, &diff) == CBERG_OK, "diff add");
    CHECK(diff.added_len == 1 && has_path(diff.added, diff.added_len, "src/new.c"), "added new.c");
    CHECK(diff.modified_len == 0 && diff.deleted_len == 0, "add only");
    cberg_manifest_diff_free(&diff);

    /* Delete a file (and its now-empty directory). */
    remove_file(root, "docs/guide.md");
    char docs[1024];
    snprintf(docs, sizeof(docs), "%s/docs", root);
    rmdir(docs);
    cberg_manifest *m4 = NULL;
    CHECK(cberg_manifest_build(root, &m4) == CBERG_OK, "build m4");
    CHECK(cberg_manifest_diff(m3, m4, &diff) == CBERG_OK, "diff delete");
    CHECK(diff.deleted_len == 1 && has_path(diff.deleted, diff.deleted_len, "docs/guide.md"), "deleted guide.md");
    CHECK(diff.added_len == 0 && diff.modified_len == 0, "delete only");
    cberg_manifest_diff_free(&diff);

    cberg_manifest_free(m1);
    cberg_manifest_free(m2);
    cberg_manifest_free(m3);
    cberg_manifest_free(m4);

    /* Empty repo: zero leaves, zero root, empty self-diff. */
    char etmpl[] = "/tmp/cberg-manifest-empty-XXXXXX";
    char *eroot = mkdtemp(etmpl);
    CHECK(eroot != NULL, "mkdtemp empty");
    cberg_manifest *em = NULL;
    CHECK(cberg_manifest_build(eroot, &em) == CBERG_OK, "build empty");
    CHECK(cberg_manifest_len(em) == 0, "empty repo has no leaves");
    uint8_t eroot_hash[CBERG_HASH_LEN];
    cberg_manifest_root(em, eroot_hash);
    CHECK(hash_is_zero(eroot_hash), "empty repo root is zero");
    CHECK(cberg_manifest_diff(em, em, &diff) == CBERG_OK, "diff empty");
    CHECK(diff.added_len == 0 && diff.modified_len == 0 && diff.deleted_len == 0, "empty self-diff");
    cberg_manifest_diff_free(&diff);
    cberg_manifest_free(em);

    char cmd[1100];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s' '%s'", root, eroot);
    if (system(cmd) != 0) {
        fprintf(stderr, "warning: cleanup failed\n");
    }

    if (failures == 0) {
        printf("test_manifest: ok\n");
    }
    return failures == 0 ? 0 : 1;
}
