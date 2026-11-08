package search

import "testing"

func TestPathClassRanksBothSearchesTheSameWay(t *testing.T) {
	cases := []struct {
		path, query string
		priority    int
		weight      float64
	}{
		{"daemon/main.go", "server", 1, 1},
		{"java/src/main/App.java", "server", 1, 1},
		{"daemon/server_test.go", "server", 2, 0.85},
		{"web/app.spec.ts", "server", 2, 0.85},
		{"tests/fixture.go", "server tests", 0, 1.05},
		{"node_modules/x/index.js", "server", 3, 0.9},
		{"build/out.js", "the build output", 0, 1.05},
		{"build/out.js", "server specs", 3, 0.9},
	}

	for _, c := range cases {
		requested, asked := requestedClass(c.query)

		if got := lexicalPriority(c.path, requested, asked); got != c.priority {
			t.Errorf("lexicalPriority(%q, %q) = %d, want %d", c.path, c.query, got, c.priority)
		}

		if got := sourceWeight(c.path, c.query); got != c.weight {
			t.Errorf("sourceWeight(%q, %q) = %v, want %v", c.path, c.query, got, c.weight)
		}
	}
}
