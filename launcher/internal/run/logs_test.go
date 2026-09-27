package run

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenLogAppendsWithoutTruncating(t *testing.T) {
	home := t.TempDir()
	for _, text := range []string{"first\n", "second\n"} {
		f, err := openLog(home, "daemon.log")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteString(text); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(home, "logs", "daemon.log"))
	if err != nil || string(data) != "first\nsecond\n" {
		t.Fatalf("log = %q, err = %v", data, err)
	}
}
