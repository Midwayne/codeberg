package procenv

import (
	"slices"
	"testing"
)

func TestOverlayReplacesAndRemovesInheritedKeys(t *testing.T) {
	t.Setenv("PROCENV_KEEP", "inherited")
	t.Setenv("PROCENV_REPLACE", "inherited")
	t.Setenv("PROCENV_REMOVE", "inherited")

	env := Overlay(map[string]string{"PROCENV_REPLACE": "new", "PROCENV_REMOVE": ""})

	if !slices.Contains(env, "PROCENV_KEEP=inherited") || !slices.Contains(env, "PROCENV_REPLACE=new") {
		t.Fatalf("overlay lost values: %v", env)
	}

	for _, entry := range env {
		if entry == "PROCENV_REPLACE=inherited" || entry == "PROCENV_REMOVE=inherited" {
			t.Fatalf("overlay kept inherited %q", entry)
		}
	}
}
