package registry

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUpsertIsIdempotent(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()

	e1, err := Upsert(home, root)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if e1.Key != filepath.Base(e1.Root) {
		t.Fatalf("key = %q, want basename of %q", e1.Key, e1.Root)
	}

	e2, err := Upsert(home, root)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if e1 != e2 {
		t.Fatalf("second upsert changed entry: %+v != %+v", e1, e2)
	}

	entries, err := Load(home)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(entries) != 1 || entries[0] != e1 {
		t.Fatalf("entries = %+v, want exactly [%+v]", entries, e1)
	}
}

func TestUpsertDisambiguatesBasenameCollision(t *testing.T) {
	home := t.TempDir()
	parentA, parentB := t.TempDir(), t.TempDir()
	rootA := filepath.Join(parentA, "proj")
	rootB := filepath.Join(parentB, "proj")
	for _, d := range []string{rootA, rootB} {
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	eA, err := Upsert(home, rootA)
	if err != nil {
		t.Fatal(err)
	}
	eB, err := Upsert(home, rootB)
	if err != nil {
		t.Fatal(err)
	}
	if eA.Key != "proj" {
		t.Fatalf("first key = %q, want %q", eA.Key, "proj")
	}
	if eB.Key == eA.Key {
		t.Fatalf("colliding roots share key %q", eB.Key)
	}
	if want := "proj-"; len(eB.Key) != len(want)+6 || eB.Key[:len(want)] != want {
		t.Fatalf("second key = %q, want %q + 6 hex chars", eB.Key, want)
	}

	// The suffixed key must be stable: re-upserting B returns the same entry.
	again, err := Upsert(home, rootB)
	if err != nil {
		t.Fatal(err)
	}
	if again != eB {
		t.Fatalf("re-upsert changed entry: %+v != %+v", again, eB)
	}
}

func TestUpsertResolvesSymlinkAlias(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	link := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(root, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	e1, err := Upsert(home, root)
	if err != nil {
		t.Fatal(err)
	}
	e2, err := Upsert(home, link)
	if err != nil {
		t.Fatal(err)
	}
	if e1 != e2 {
		t.Fatalf("alias created a second entry: %+v != %+v", e1, e2)
	}
}

func TestUpsertRejectsMissingOrFileRoot(t *testing.T) {
	home := t.TempDir()
	if _, err := Upsert(home, filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Fatal("missing dir: want error")
	}
	f := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(f, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Upsert(home, f); err == nil {
		t.Fatal("plain file: want error")
	}
}

func TestLoadSkipsMalformedAndDuplicates(t *testing.T) {
	home := t.TempDir()
	raw := "# comment\n" +
		"\n" +
		"good\t/tmp/a\n" +
		"no-tab-here\n" +
		"\t/tmp/missing-key\n" +
		"good\t/tmp/dup-key\n" +
		"other\t/tmp/a\n" +
		"fine\t/tmp/b\n"
	if err := os.WriteFile(Path(home), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	entries, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	want := []Entry{{"good", "/tmp/a"}, {"fine", "/tmp/b"}}
	if len(entries) != len(want) {
		t.Fatalf("entries = %+v, want %+v", entries, want)
	}
	for i := range want {
		if entries[i] != want[i] {
			t.Fatalf("entries[%d] = %+v, want %+v", i, entries[i], want[i])
		}
	}
}

func TestUpsertPreservesCommentsAndDeadPaths(t *testing.T) {
	home := t.TempDir()
	dead := "gone\t/does/not/exist\n"
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(Path(home), []byte("# my repos\n"+dead), 0o644); err != nil {
		t.Fatal(err)
	}

	root := t.TempDir()
	if _, err := Upsert(home, root); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(Path(home))
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if got[:len("# my repos\n")] != "# my repos\n" {
		t.Fatalf("comment not preserved:\n%s", got)
	}
	entries, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Key != "gone" {
		t.Fatalf("dead path dropped: %+v", entries)
	}
}

func TestLoadMissingFile(t *testing.T) {
	entries, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("missing registry: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("entries = %+v, want none", entries)
	}
}

func TestSelectRegistersDirsAndResolvesKeys(t *testing.T) {
	home := t.TempDir()
	rootA, rootB := t.TempDir(), t.TempDir()

	// Pre-register B so it can be selected by key.
	eB, err := Upsert(home, rootB)
	if err != nil {
		t.Fatal(err)
	}

	out, err := Select(home, []string{rootA, eB.Key}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out[1] != eB {
		t.Fatalf("select: %+v", out)
	}
	// The directory item got registered.
	entries, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("dir not registered: %+v", entries)
	}
}

func TestSelectNoRegisterLeavesRegistryUntouched(t *testing.T) {
	home := t.TempDir()
	rootA := t.TempDir()
	registered := t.TempDir()
	eReg, err := Upsert(home, registered)
	if err != nil {
		t.Fatal(err)
	}

	out, err := Select(home, []string{rootA, registered}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("select: %+v", out)
	}
	if out[0].Key == "" || out[0].Root == "" {
		t.Fatalf("session entry malformed: %+v", out[0])
	}
	// A known path reuses its registered key even without registering.
	if out[1] != eReg {
		t.Fatalf("registered path should reuse its entry: %+v vs %+v", out[1], eReg)
	}
	entries, err := Load(home)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("registry must stay untouched: %+v", entries)
	}
}

func TestSelectDedupsAndErrors(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()

	out, err := Select(home, []string{root, root}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("duplicate selection not deduped: %+v", out)
	}

	if _, err := Select(home, []string{"no-such-key-or-dir"}, true); err == nil {
		t.Fatal("unknown item: want error")
	}
	if _, err := Select(home, nil, true); err == nil {
		t.Fatal("empty selection: want error")
	}

	// A registered key whose root vanished errors rather than serving nothing.
	gone := filepath.Join(t.TempDir(), "gone")
	if err := os.Mkdir(gone, 0o755); err != nil {
		t.Fatal(err)
	}
	eGone, err := Upsert(home, gone)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(gone); err != nil {
		t.Fatal(err)
	}
	if _, err := Select(home, []string{eGone.Key}, true); err == nil {
		t.Fatal("dead key: want error")
	}
}
