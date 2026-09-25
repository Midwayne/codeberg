package search

import (
	"fmt"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestSignificantTerms(t *testing.T) {
	terms := SignificantTerms("How does the authentication handler work?")
	if len(terms) != 3 || terms[0] != "authentication" || terms[1] != "handler" || terms[2] != "work" {
		t.Fatalf("terms: %v", terms)
	}

	short := SignificantTerms("go io")
	if len(short) != 0 {
		t.Fatalf("short/stop words filtered: %v", short)
	}

	trimmed := SignificantTerms(`tokenize, "punctuation"!`)
	if len(trimmed) != 2 || trimmed[0] != "tokenize" || trimmed[1] != "punctuation" {
		t.Fatalf("trimmed: %v", trimmed)
	}
}

func TestFuseFindsLexicalOnlyAndPromotesOverlappingChunks(t *testing.T) {
	vectors := []indexctl.SearchResult{
		{ID: 1, Score: .95, Repo: "main", Path: "vector.go", StartLine: 10, EndLine: 20, Snippet: "vector"},
		{ID: 2, Score: .9, Repo: "main", Path: "both.go", StartLine: 30, EndLine: 40, Snippet: "vector"},
	}
	lexical := []workspace.GrepMatch{
		{Repo: "main", Path: "both.go", Line: 35, Text: "func exactIdentifier() {}"},
		{Repo: "main", Path: "exact.go", Line: 5, Text: "exactIdentifier()"},
	}
	out := Fuse(vectors, lexical, 3, "exactIdentifier")
	if len(out) != 3 || out[0].Hit.ID != 2 || out[0].GrepBoost != 1 {
		t.Fatalf("overlapping chunk should rank first: %+v", out)
	}
	if out[1].Hit.Path != "vector.go" || out[2].Hit.Path != "exact.go" || out[2].Hit.StartLine != 5 || out[2].Hit.ID != 0 {
		t.Fatalf("lexical-only line should be included without duplicating overlap: %+v", out)
	}
	if out[0].FinalScore <= out[1].FinalScore {
		t.Fatalf("combined evidence should outrank vector alone: %+v", out)
	}
}

func TestFuseLexicalOnlyAndRepoScopedDedup(t *testing.T) {
	lexical := []workspace.GrepMatch{
		{Repo: "alpha", Path: "same.go", Line: 2, Text: "exactIdentifier"},
		{Repo: "alpha", Path: "same.go", Line: 2, Text: "exactIdentifier"},
		{Repo: "beta", Path: "same.go", Line: 2, Text: "exactIdentifier"},
	}
	out := Fuse(nil, lexical, 10, "exactIdentifier")
	if len(out) != 2 || out[0].Hit.Repo != "alpha" || out[1].Hit.Repo != "beta" {
		t.Fatalf("dedupe within repo, not across repos: %+v", out)
	}
}

func TestFuseTruncatesToK(t *testing.T) {
	vectors := make([]indexctl.SearchResult, 5)
	for i := range vectors {
		vectors[i] = indexctl.SearchResult{ID: uint64(i + 1), Repo: "main", Path: "f.go"}
	}
	if got := len(Fuse(vectors, nil, 2, "xyz")); got != 2 {
		t.Fatalf("want 2 results, got %d", got)
	}
}

func TestFusePreservesVectorCoverageAgainstRepeatedLexicalLines(t *testing.T) {
	vectors := make([]indexctl.SearchResult, 8)
	for i := range vectors {
		vectors[i] = indexctl.SearchResult{ID: uint64(i + 1), Repo: "main", Path: fmt.Sprintf("vector%d.go", i)}
	}
	lexical := make([]workspace.GrepMatch, 20)
	for i := range lexical {
		lexical[i] = workspace.GrepMatch{Repo: "main", Path: "repeated.go", Line: uint32(i + 1), Text: "exactIdentifier"}
	}
	lexical = append(lexical, workspace.GrepMatch{Repo: "main", Path: "another.go", Line: 1, Text: "exactIdentifier"})
	out := Fuse(vectors, lexical, 8, "exactIdentifier")
	vectorCount, lexicalCount := 0, 0
	for _, item := range out {
		if item.Hit.ID == 0 {
			lexicalCount++
		} else {
			vectorCount++
		}
	}
	if vectorCount < 4 || lexicalCount != 2 {
		t.Fatalf("one lexical candidate per file, at least half vector evidence: %+v", out)
	}
}

func TestFusePromotesFileWithVectorAndLexicalEvidenceOnDifferentLines(t *testing.T) {
	vectors := []indexctl.SearchResult{
		{ID: 1, Repo: "main", Path: "unrelated.go", StartLine: 1, EndLine: 5},
		{ID: 2, Repo: "main", Path: "implementation.go", StartLine: 50, EndLine: 65},
	}
	lexical := []workspace.GrepMatch{
		{Repo: "main", Path: "model.go", Line: 3, Text: "obligation"},
		{Repo: "main", Path: "implementation.go", Line: 110, Text: "obligation"},
	}
	out := Fuse(vectors, lexical, 4, "obligation")
	if len(out) != 4 || out[0].Hit.Path != "implementation.go" {
		t.Fatalf("file with both signals should outrank single-source hits: %+v", out)
	}
}

func TestFuseDiversifiesFilesBeforeFillingFromOneFile(t *testing.T) {
	vectors := make([]indexctl.SearchResult, 8)
	for i := range vectors {
		path := "crowded.go"
		if i >= 5 {
			path = fmt.Sprintf("other%d.go", i)
		}
		vectors[i] = indexctl.SearchResult{ID: uint64(i + 1), Repo: "main", Path: path}
	}
	out := Fuse(vectors, nil, 5, "xyz")
	if len(out) != 5 || out[0].Hit.Path != "crowded.go" || out[1].Hit.Path != "crowded.go" ||
		out[2].Hit.Path != "crowded.go" || out[3].Hit.Path != "other5.go" {
		t.Fatalf("show other relevant files before a fourth chunk from one file: %+v", out)
	}
	// A file-scoped query can still return all requested chunks if there are no alternatives.
	if got := len(Fuse(vectors[:5], nil, 5, "xyz")); got != 5 {
		t.Fatalf("fill remaining slots from the same file: %d", got)
	}
}

func TestLexicalPatternPrefersIdentifierAndEscapesIt(t *testing.T) {
	if got := LexicalPattern("where is calculateOutstandingUnits defined?"); got != `(?i)\bcalculateoutstandingunits\b` {
		t.Fatalf("pattern: %q", got)
	}
	if got := LexicalPattern("go io"); got != "" {
		t.Fatalf("no useful terms should skip grep: %q", got)
	}
	if got := LexicalPattern("authentication goes through loadShipmentDetails"); got != `(?i)\bloadshipmentdetails\b` {
		t.Fatalf("prefer identifier over natural language: %q", got)
	}
}

func TestPrioritizeLexicalProductionWithoutHidingTests(t *testing.T) {
	matches := []workspace.GrepMatch{
		{Path: "service/build/generated/Foo.java", Line: 1},
		{Path: "service/src/test/FooSpec.groovy", Line: 2},
		{Path: "service/src/main/Foo.java", Line: 3},
	}
	got := PrioritizeLexical(matches, "where is Foo computed")
	if got[0].Path != "service/src/main/Foo.java" || got[2].Path != "service/build/generated/Foo.java" {
		t.Fatalf("production code should rank before generated/test code: %+v", got)
	}
	got = PrioritizeLexical(matches, "find tests for Foo")
	if got[0].Path != "service/src/test/FooSpec.groovy" {
		t.Fatalf("explicit tests query should promote test code: %+v", got)
	}
	unsorted := []workspace.GrepMatch{
		{Repo: "main", Path: "service/src/main/Z.go", Line: 4},
		{Repo: "main", Path: "service/src/main/A.go", Line: 8},
		{Repo: "main", Path: "service/src/main/A.go", Line: 2},
	}
	got = PrioritizeLexical(unsorted, "Foo")
	if got[0].Line != 2 || got[1].Line != 8 || got[2].Path != "service/src/main/Z.go" {
		t.Fatalf("ripgrep output order should not affect ranking: %+v", got)
	}
}

func TestFusePrefersSourceOverBuildAndTestArtifacts(t *testing.T) {
	vectors := []indexctl.SearchResult{
		{ID: 1, Repo: "main", Path: "service/build/snapshot/Foo.kt"},
		{ID: 2, Repo: "main", Path: "service/src/main/Foo.kt"},
	}
	lexical := []workspace.GrepMatch{{Repo: "main", Path: "service/src/test/FooSpec.groovy", Line: 1, Text: "exactIdentifier"}}
	out := Fuse(vectors, lexical, 3, "where is exactIdentifier used")
	if out[0].Hit.Path != "service/src/main/Foo.kt" || out[2].Hit.Path != "service/src/test/FooSpec.groovy" {
		t.Fatalf("generated/test hits should not crowd out production source: %+v", out)
	}
	forTests := Fuse(vectors, lexical, 3, "find tests for exactIdentifier")
	if forTests[0].Hit.Path != "service/src/test/FooSpec.groovy" {
		t.Fatalf("explicit test query should favor test result: %+v", forTests)
	}
}

func TestFuseDoesNotReplaceRelevantMethodsWithImports(t *testing.T) {
	vectors := []indexctl.SearchResult{
		{ID: 1, Repo: "main", Path: "transformer.go", StartLine: 50, EndLine: 80, Symbol: "sortOrdersByDeadline"},
		{ID: 2, Repo: "main", Path: "transformer.go", StartLine: 100, EndLine: 120, Symbol: "groupOrdersByDeadline"},
		{ID: 3, Repo: "main", Path: "model.go", StartLine: 1, EndLine: 30},
	}
	lexical := []workspace.GrepMatch{
		{Repo: "main", Path: "transformer.go", Line: 2, Text: "import OrderByDateView"},
		{Repo: "main", Path: "model.go", Line: 3, Text: "OrderByDateView"},
	}
	out := Fuse(vectors, lexical, 3, "OrderByDateView shipByDeadline")
	for _, hit := range out {
		if hit.Hit.Path == "transformer.go" && hit.Hit.ID == 0 {
			t.Fatalf("import line should not displace indexed methods: %+v", out)
		}
	}
	ids := make(map[uint64]bool)
	for _, hit := range out {
		ids[hit.Hit.ID] = true
	}
	if !ids[1] || !ids[2] {
		t.Fatalf("keep both relevant methods: %+v", out)
	}
}
