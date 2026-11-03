package main

import (
	"strings"
	"testing"
)

func TestNoVectorFlag(t *testing.T) {
	for _, command := range []string{"run", "build", "doctor"} {
		t.Run(command, func(t *testing.T) {
			o, err := parseShared(command, []string{"--no-vector"})
			if err != nil {
				t.Fatal(err)
			}

			if o.Vector == nil || *o.Vector {
				t.Fatal("flag must disable vector search")
			}
		})
	}
}

func TestRemovedNoEmbeddingFlagIsRejected(t *testing.T) {
	_, err := parseShared("run", []string{"--no-embedding"})
	if err == nil || !strings.Contains(err.Error(), "flag provided but not defined") {
		t.Fatalf("removed flag must be rejected, got %v", err)
	}
}
