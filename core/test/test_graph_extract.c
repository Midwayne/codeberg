/*
 * Per-language graph extraction: each fixture indexes a small snippet and
 * asserts the calls / imports / inheritance / containment the language's
 * reference query must capture.
 */
#include <stdio.h>
#include <string.h>

#include "codeberg/codeberg.h"
#include "test_common.h"
#include "test_graph_common.h"

/* Edge between two named nodes, or NULL. kind_mask filters the query. */
static const cberg_graph_edge *named_edge(graph_corpus *c, const char *src_name, const char *dst_name, cberg_graph_edge_kind kind) {
    const cberg_graph_node *src = corpus_node(c, src_name, 0);
    const cberg_graph_node *dst = corpus_node(c, dst_name, 0);
    if (src == NULL || dst == NULL) {
        return NULL;
    }
    static cberg_graph_edge edges[32];
    size_t n = 0;
    if (cberg_graph_edges_from(c->graph, src->id, kind, edges, 32, &n) != CBERG_OK) {
        return NULL;
    }
    return edges_find(edges, n, src->id, dst->id, kind);
}

static int module_imported(graph_corpus *c, const char *file, const char *module) {
    const cberg_graph_node *f = corpus_node(c, file, CBERG_GNODE_MASK(CBERG_GNODE_FILE));
    const cberg_graph_node *m = corpus_node(c, module, CBERG_GNODE_MASK(CBERG_GNODE_MODULE));
    if (f == NULL || m == NULL) {
        return 0;
    }
    cberg_graph_edge edges[32];
    size_t n = 0;
    if (cberg_graph_edges_from(c->graph, f->id, CBERG_GEDGE_IMPORTS, edges, 32, &n) != CBERG_OK) {
        return 0;
    }
    return edges_find(edges, n, f->id, m->id, CBERG_GEDGE_IMPORTS) != NULL;
}

static void test_go(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "go corpus");
    const char *src =
        "package p\n"
        "import \"net/http\"\n"
        "type Box struct{}\n"
        "func (b Box) Get() { b.Put() }\n"
        "func (b *Box) Put() {}\n";
    CHECK(corpus_index(&c, CBERG_LANG_GO, "box.go", src) == CBERG_OK, "index go");
    CHECK(module_imported(&c, "box.go", "net/http"), "go import captured");
    CHECK(named_edge(&c, "Box", "Get", CBERG_GEDGE_CONTAINS) != NULL, "go value receiver contains");
    CHECK(named_edge(&c, "Box", "Put", CBERG_GEDGE_CONTAINS) != NULL, "go pointer receiver contains");
    CHECK(named_edge(&c, "Get", "Put", CBERG_GEDGE_CALLS) != NULL, "go selector call captured");
    corpus_close(&c);
}

static void test_c_lang(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "c corpus");
    const char *src =
        "#include <stdio.h>\n"
        "#include \"local.h\"\n"
        "static void helper(void) {}\n"
        "int main(void) { helper(); return 0; }\n";
    CHECK(corpus_index(&c, CBERG_LANG_C, "main.c", src) == CBERG_OK, "index c");
    CHECK(module_imported(&c, "main.c", "stdio.h"), "c system include captured (brackets stripped)");
    CHECK(module_imported(&c, "main.c", "local.h"), "c quoted include captured");
    CHECK(named_edge(&c, "main", "helper", CBERG_GEDGE_CALLS) != NULL, "c call captured");
    corpus_close(&c);
}

static void test_python(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "python corpus");
    const char *src =
        "import os\n"
        "from collections import abc\n"
        "\n"
        "class Base:\n"
        "    def ping(self):\n"
        "        pass\n"
        "\n"
        "class Sub(Base):\n"
        "    def pong(self):\n"
        "        self.ping()\n";
    CHECK(corpus_index(&c, CBERG_LANG_PYTHON, "m.py", src) == CBERG_OK, "index python");
    CHECK(module_imported(&c, "m.py", "os"), "python import captured");
    CHECK(module_imported(&c, "m.py", "collections"), "python from-import captured");
    const cberg_graph_edge *inherits = named_edge(&c, "Sub", "Base", CBERG_GEDGE_INHERITS);
    CHECK(inherits != NULL, "python inheritance captured");
    if (inherits != NULL) {
        CHECK(inherits->confidence > 0.89f, "same-file supertype scores 0.90");
    }
    CHECK(named_edge(&c, "Base", "ping", CBERG_GEDGE_CONTAINS) != NULL, "python nesting contains");
    CHECK(named_edge(&c, "pong", "ping", CBERG_GEDGE_CALLS) != NULL, "python attribute call captured");
    corpus_close(&c);
}

static void test_javascript(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "js corpus");
    const char *src =
        "import util from './util';\n"
        "class Base {}\n"
        "class Sub extends Base {\n"
        "  go() { build(); }\n"
        "}\n"
        "function build() { return new Sub(); }\n";
    CHECK(corpus_index(&c, CBERG_LANG_JAVASCRIPT, "app.js", src) == CBERG_OK, "index js");
    CHECK(module_imported(&c, "app.js", "./util"), "js import captured");
    CHECK(named_edge(&c, "Sub", "Base", CBERG_GEDGE_INHERITS) != NULL, "js extends captured");
    CHECK(named_edge(&c, "go", "build", CBERG_GEDGE_CALLS) != NULL, "js call captured");
    CHECK(named_edge(&c, "build", "Sub", CBERG_GEDGE_CALLS) != NULL, "js new-expression captured");
    CHECK(named_edge(&c, "Sub", "go", CBERG_GEDGE_CONTAINS) != NULL, "js class contains method");
    corpus_close(&c);
}

static void test_typescript(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "ts corpus");
    const char *src =
        "import { x } from './dep';\n"
        "interface Runner { run(): void; }\n"
        "class Base {}\n"
        "class Job extends Base implements Runner {\n"
        "  run() { helper(); }\n"
        "}\n"
        "function helper() {}\n";
    CHECK(corpus_index(&c, CBERG_LANG_TYPESCRIPT, "job.ts", src) == CBERG_OK, "index ts");
    CHECK(module_imported(&c, "job.ts", "./dep"), "ts import captured");
    CHECK(named_edge(&c, "Job", "Base", CBERG_GEDGE_INHERITS) != NULL, "ts extends captured");
    CHECK(named_edge(&c, "Job", "Runner", CBERG_GEDGE_INHERITS) != NULL, "ts implements captured");
    CHECK(named_edge(&c, "run", "helper", CBERG_GEDGE_CALLS) != NULL, "ts call captured");
    corpus_close(&c);
}

static void test_java(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "java corpus");
    const char *src =
        "import java.util.List;\n"
        "interface Runner {}\n"
        "class Base {}\n"
        "class Job extends Base implements Runner {\n"
        "  void run() { helper(); }\n"
        "  void helper() {}\n"
        "}\n";
    CHECK(corpus_index(&c, CBERG_LANG_JAVA, "Job.java", src) == CBERG_OK, "index java");
    CHECK(module_imported(&c, "Job.java", "java.util.List"), "java import captured");
    CHECK(named_edge(&c, "Job", "Base", CBERG_GEDGE_INHERITS) != NULL, "java extends captured");
    CHECK(named_edge(&c, "Job", "Runner", CBERG_GEDGE_INHERITS) != NULL, "java implements captured");
    CHECK(named_edge(&c, "run", "helper", CBERG_GEDGE_CALLS) != NULL, "java call captured");
    CHECK(named_edge(&c, "Job", "run", CBERG_GEDGE_CONTAINS) != NULL, "java class contains method");
    corpus_close(&c);
}

static void test_kotlin(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "kotlin corpus");
    const char *src =
        "import a.b.c\n"
        "open class Base\n"
        "class Sub : Base() {\n"
        "  fun go() { helper() }\n"
        "}\n"
        "fun helper() {}\n";
    CHECK(corpus_index(&c, CBERG_LANG_KOTLIN, "s.kt", src) == CBERG_OK, "index kotlin");
    CHECK(module_imported(&c, "s.kt", "a.b.c"), "kotlin import captured");
    CHECK(named_edge(&c, "Sub", "Base", CBERG_GEDGE_INHERITS) != NULL, "kotlin supertype captured");
    CHECK(named_edge(&c, "go", "helper", CBERG_GEDGE_CALLS) != NULL, "kotlin call captured");
    corpus_close(&c);
}

static void test_rust(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "rust corpus");
    const char *src =
        "use std::fmt::Debug;\n"
        "struct Engine;\n"
        "impl Engine {\n"
        "    fn start(&self) { ignite(); }\n"
        "}\n"
        "fn ignite() {}\n";
    CHECK(corpus_index(&c, CBERG_LANG_RUST, "e.rs", src) == CBERG_OK, "index rust");
    CHECK(module_imported(&c, "e.rs", "std::fmt::Debug"), "rust use captured");
    CHECK(named_edge(&c, "Engine", "start", CBERG_GEDGE_CONTAINS) != NULL, "rust impl membership captured");
    CHECK(named_edge(&c, "start", "ignite", CBERG_GEDGE_CALLS) != NULL, "rust call captured");
    corpus_close(&c);
}

static void test_ruby(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "ruby corpus");
    const char *src =
        "class Base\n"
        "end\n"
        "class Sub < Base\n"
        "  def go\n"
        "    helper()\n"
        "  end\n"
        "  def helper\n"
        "  end\n"
        "end\n";
    CHECK(corpus_index(&c, CBERG_LANG_RUBY, "s.rb", src) == CBERG_OK, "index ruby");
    CHECK(named_edge(&c, "Sub", "Base", CBERG_GEDGE_INHERITS) != NULL, "ruby superclass captured");
    CHECK(named_edge(&c, "go", "helper", CBERG_GEDGE_CALLS) != NULL, "ruby call captured");
    CHECK(named_edge(&c, "Sub", "go", CBERG_GEDGE_CONTAINS) != NULL, "ruby class contains method");
    corpus_close(&c);
}

/* Markdown and config formats carry chunks but no graph fragment. */
static void test_non_code(void) {
    cberg_chunker *ch = NULL;
    CHECK(cberg_chunker_open(&ch) == CBERG_OK, "chunker open");
    const char *md = "# Title\n\nBody text.\n";
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    CHECK(cberg_chunker_analyze(ch, CBERG_LANG_MARKDOWN, "README.md", md, strlen(md), &list, &frag) == CBERG_OK, "analyze markdown");
    CHECK(list != NULL && cberg_chunk_list_len(list) > 0, "markdown still chunks");
    CHECK(frag == NULL, "markdown yields no fragment");
    cberg_chunk_list_free(list);

    const char *go = "package p\nfunc f() {}\n";
    CHECK(cberg_chunker_analyze(ch, CBERG_LANG_GO, "f.go", go, strlen(go), &list, &frag) == CBERG_OK, "analyze go");
    CHECK(frag != NULL, "code yields a fragment");
    CHECK(strcmp(cberg_graph_fragment_path(frag), "f.go") == 0, "fragment remembers its path");
    cberg_graph_fragment_free(frag);
    cberg_chunk_list_free(list);
    cberg_chunker_close(ch);
}

int main(void) {
    test_go();
    test_c_lang();
    test_python();
    test_javascript();
    test_typescript();
    test_java();
    test_kotlin();
    test_rust();
    test_ruby();
    test_non_code();
    TEST_MAIN_RETURN
}
