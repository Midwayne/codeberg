package search

import (
	"reflect"
	"testing"
)

func TestCodeTokensSplitsIdentifiers(t *testing.T) {
	// Expected values come from the Python tokenizer used in the benchmark
	// (core/bench/retrieval_lexical.py), so ranking matches what was measured.
	cases := map[string][]string{
		"parseJSONConfig":    {"parsejsonconfig", "parse", "json", "config"},
		"cberg_worker_embed": {"cberg", "worker", "embed"},
		"HTTPServer x2":      {"httpserver", "http", "server", "x2", "x", "2"},
		"retry(3, 'Ok')":     {"retry", "3", "ok"},
		"ÜberCache":          {"bercache", "ber", "cache"},
	}

	for input, want := range cases {
		if got := CodeTokens(input); !reflect.DeepEqual(got, want) {
			t.Errorf("CodeTokens(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestQueryTokensDropStopWordsAndSingleCharacters(t *testing.T) {
	got := QueryTokens("Where is the vector retry with a 3 second backoff?")
	want := []string{"vector", "retry", "second", "backoff"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("QueryTokens = %v, want %v", got, want)
	}
}
