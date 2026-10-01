package subprocess

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestUnsafeSedPrograms(t *testing.T) {
	for _, script := range []string{"{e id;}", "/x/{s/a/b/e;}", "/s/s/a/b/w out", "s;a;b;e", "s/a/b/;{e id}", "1{1{e id}}", "s/a/b/gee", "{r secret;}", "{W out;}", "s/a/b/\ne id"} {
		t.Run(script, func(t *testing.T) {
			if err := ValidateSedScript(script); err == nil {
				t.Fatal("accepted command-capable sed program")
			}
		})
	}
}

func TestReadOnlyPipelineStillRuns(t *testing.T) {
	for _, cmd := range []string{"cat", "sed", "sort", "uniq"} {
		if _, err := exec.LookPath(cmd); err != nil {
			t.Skipf("%s unavailable", cmd)
		}
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "input.txt"), []byte("b\na\na\n"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := RunPipeline(context.Background(), root, "cat input.txt | sed '1,3{s/a/c/;}' | sort -r | uniq")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stdout != "c\nb\n" || result.Truncated {
		t.Fatalf("unexpected result: %+v", result)
	}
	for _, command := range []string{"sed '{e id;}' input.txt", "sort --compress-program=id input.txt"} {
		if _, err := RunPipeline(context.Background(), root, command); err == nil {
			t.Errorf("accepted %s", command)
		}
	}
}

func TestReadOnlySedPrograms(t *testing.T) {
	for _, script := range []string{"s/a/b/g", "/start/,/end/p", "1,3{p;d;}", "s#x;y#safe#", "/s/s/a/b/g", "y/abc/ABC/", ":again;N;$!b again;s/\n/ /g"} {
		if err := ValidateSedScript(script); err != nil {
			t.Errorf("%q: %v", script, err)
		}
	}
	if err := ValidateSedArgs([]string{"-e", "{", "-e", "p", "-e", "}"}); err != nil {
		t.Fatalf("block across expressions: %v", err)
	}
	if err := ValidateSedArgs([]string{"-e", "{", "-e", "e id", "-e", "}"}); err == nil {
		t.Fatal("accepted unsafe command across expressions")
	}
}

func TestSortCannotLaunchHelpersOrWriteFiles(t *testing.T) {
	for _, arg := range []string{"--compress-program=id", "--compress=id", "--output=out", "-roout", "--files0-from=input", "--random-source=input"} {
		if err := ValidateStage([]string{"sort", arg}); err == nil {
			t.Errorf("accepted unsafe sort option %q", arg)
		}
	}
	if err := ValidateStage([]string{"sort", "-nr", "-k", "2,2", "input.txt"}); err != nil {
		t.Fatal(err)
	}
}
