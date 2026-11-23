package main

import "testing"

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
