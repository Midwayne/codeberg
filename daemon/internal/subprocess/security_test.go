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
		if err := validateStage([]string{"sort", arg}); err == nil {
			t.Errorf("accepted unsafe sort option %q", arg)
		}
	}

	if err := validateStage([]string{"sort", "-nr", "-k", "2,2", "input.txt"}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateStage(t *testing.T) {
	tests := []struct {
		name string
		argv []string
		ok   bool
	}{
		{"allowed rg", []string{"rg", "-l", "TODO"}, true},
		{"allowed head", []string{"head", "-5"}, true},
		{"allowed sed read-only", []string{"sed", "-n", "1,5p"}, true},
		{"allowed relative path", []string{"rg", "TODO", "src/"}, true},
		{"unknown command", []string{"python", "-c", "x"}, false},
		{"awk excluded", []string{"awk", "{print}"}, false},
		{"xargs excluded", []string{"xargs", "rm"}, false},
		{"rg pre flag", []string{"rg", "--pre", "sh", "x"}, false},
		{"rg pre eq flag", []string{"rg", "--pre=sh", "x"}, false},
		{"sort output flag", []string{"sort", "-o", "out"}, false},
		{"sed in-place", []string{"sed", "-i", "s/a/b/"}, false},
		{"sed write script", []string{"sed", "s/a/b/w file"}, false},
		{"absolute path", []string{"cat", "/etc/passwd"}, false},
		{"dotdot traversal", []string{"rg", "TODO", "../other"}, false},
		{"absolute via flag value", []string{"rg", "--glob=/etc/*", "x"}, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateStage(tc.argv)
			if tc.ok && err != nil {
				t.Fatalf("want ok, got %v", err)
			}

			if !tc.ok && err == nil {
				t.Fatal("want rejection, got nil")
			}
		})
	}
}
