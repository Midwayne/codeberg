package workspace

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

// readFileReference is the original whole-file ReadFile algorithm; the
// streaming implementation must match it exactly.
func readFileReference(data string, startLine, endLine uint32, maxBytes int) FileContent {
	lines := strings.Split(data, "\n")
	total := uint32(len(lines))

	start := startLine
	if start == 0 {
		start = 1
	}

	end := endLine
	if end == 0 || end > total {
		end = total
	}

	if start > total {
		start = total
	}

	if end < start {
		end = start
	}

	content := strings.Join(lines[start-1:end], "\n")
	if len(content) > maxBytes {
		content = content[:maxBytes]
	}

	return FileContent{Content: content, StartLine: start, EndLine: end, TotalLines: total}
}

func TestReadFileMatchesWholeFileSemantics(t *testing.T) {
	bodies := map[string]string{
		"empty":            "",
		"newline-only":     "\n",
		"no-trailing":      "one\ntwo\nthree",
		"trailing":         "one\ntwo\nthree\n",
		"blank-lines":      "\n\na\n\n\nb\n\n",
		"long-lines":       strings.Repeat(strings.Repeat("y", 40)+"\n", 30),
		"long-last-line":   "short\n" + strings.Repeat("z", 300),
		"crlf":             "a\r\nb\r\nc\r\n",
		"utf8-at-boundary": strings.Repeat("é", 100) + "\n" + strings.Repeat("ü", 100),
	}

	bounds := []uint32{0, 1, 2, 3, 5, 7, 30, 31, 32, 100}

	for name, body := range bodies {
		root := t.TempDir()
		if err := os.WriteFile(root+"/f.txt", []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}

		for _, maxBytes := range []int{64 * 1024, 37, 1} {
			w := New([]RepoInfo{{Key: "main", Root: root}}, "main")
			w.maxBytes = maxBytes

			for _, start := range bounds {
				for _, end := range bounds {
					got, err := w.ReadFile("main", "f.txt", start, end)
					if err != nil {
						t.Fatal(err)
					}

					want := readFileReference(body, start, end, maxBytes)
					if got != want {
						t.Fatalf("%s max=%d [%d,%d]:\n got %+v\nwant %+v", name, maxBytes, start, end, got, want)
					}
				}
			}
		}
	}
}

func TestReadFileLargeFileSpansReadBuffers(t *testing.T) {
	root := t.TempDir()

	var b strings.Builder
	for i := 1; i <= 20000; i++ {
		fmt.Fprintf(&b, "line %d %s\n", i, strings.Repeat("q", i%97))
	}
	body := b.String()

	if err := os.WriteFile(root+"/big.txt", []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	for _, r := range [][2]uint32{{0, 0}, {1, 10}, {9990, 10010}, {19999, 0}, {25000, 0}} {
		got, err := w.ReadFile("main", "big.txt", r[0], r[1])
		if err != nil {
			t.Fatal(err)
		}

		if want := readFileReference(body, r[0], r[1], w.maxBytes); got != want {
			t.Fatalf("range %v: got start=%d end=%d total=%d len=%d; want start=%d end=%d total=%d len=%d",
				r, got.StartLine, got.EndLine, got.TotalLines, len(got.Content),
				want.StartLine, want.EndLine, want.TotalLines, len(want.Content))
		}
	}
}

func TestReadFileErrors(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(root+"/dir", 0o755); err != nil {
		t.Fatal(err)
	}

	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	if _, err := w.ReadFile("main", "missing.txt", 0, 0); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("missing file: %v", err)
	}

	if _, err := w.ReadFile("main", "dir", 0, 0); err == nil || !strings.Contains(err.Error(), "codeberg: read file") {
		t.Fatalf("directory: %v", err)
	}
}

// BenchmarkReadFileWindow reports bytes allocated to read a short range of a
// large file.
func BenchmarkReadFileWindow(b *testing.B) {
	root := b.TempDir()
	body := strings.Repeat(strings.Repeat("x", 120)+"\n", 200000)

	if err := os.WriteFile(root+"/big.txt", []byte(body), 0o644); err != nil {
		b.Fatal(err)
	}

	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := w.ReadFile("main", "big.txt", 100, 160); err != nil {
			b.Fatal(err)
		}
	}
}
