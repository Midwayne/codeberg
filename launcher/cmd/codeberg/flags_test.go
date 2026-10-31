package main

import "testing"

func TestVerboseFlagOverridesStartupOutput(t *testing.T) {
	o, err := parseShared("run", []string{"--verbose"})
	if err != nil {
		t.Fatal(err)
	}
	if o.Verbose == nil || !*o.Verbose {
		t.Fatal("--verbose did not set the override")
	}

	o, err = parseShared("run", nil)
	if err != nil {
		t.Fatal(err)
	}
	if o.Verbose != nil {
		t.Fatal("without --verbose the saved setting must apply")
	}
}
