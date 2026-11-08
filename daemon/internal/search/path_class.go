package search

import (
	"regexp"
	"strings"
)

// pathClass decides how ranking treats a path: generated artifacts and test
// fixtures are demoted unless the query asks for them.
type pathClass int

const (
	sourcePath pathClass = iota
	testPath
	generatedPath
)

var classRequest = regexp.MustCompile(`(?i)\b(tests?|specs?|generated|build)\b`)

func classifyPath(path string) pathClass {
	p := "/" + strings.ToLower(path)

	switch {
	case containsAny(p, "/build/", "/generated/", "/target/", "/node_modules/"):
		return generatedPath
	case containsAny(p, "/src/test/", "/tests/", "/test/"),
		strings.HasSuffix(p, "_test.go"), strings.HasSuffix(p, ".spec.ts"):
		return testPath
	default:
		return sourcePath
	}
}

// requestedClass is the class a query explicitly asks for, if any.
func requestedClass(query string) (pathClass, bool) {
	switch strings.ToLower(classRequest.FindString(query)) {
	case "generated", "build":
		return generatedPath, true
	case "test", "tests", "spec", "specs":
		return testPath, true
	default:
		return sourcePath, false
	}
}

func containsAny(s string, parts ...string) bool {
	for _, part := range parts {
		if strings.Contains(s, part) {
			return true
		}
	}

	return false
}
