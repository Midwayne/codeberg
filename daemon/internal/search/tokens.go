package search

import "strings"

// queryStopWords drops question phrasing so BM25 weighs the code-bearing
// terms. It matches the list the rescoring benchmark used.
var queryStopWords = toSet(strings.Fields(`a an and are as at be by can do does for from has have how i
if in into is it its of on or that the their then this to was what when where which while who why
will with find locate retrieve where's whose there them they should must only not no up out than so
such these those via per each every any all both after before during`))

func toSet(words []string) map[string]bool {
	set := make(map[string]bool, len(words))
	for _, w := range words {
		set[w] = true
	}
	return set
}

// CodeTokens lowercases ASCII alphanumeric runs and splits identifiers at
// camelCase and letter/digit boundaries. A multi-part identifier also keeps
// its whole form, so "parseJSON" yields parsejson, parse, json.
func CodeTokens(text string) []string {
	var out []string

	for _, word := range asciiWords(text) {
		parts := identifierParts(word)
		if len(parts) > 1 {
			out = append(out, strings.ToLower(word))
		}

		for _, p := range parts {
			out = append(out, strings.ToLower(p))
		}
	}
	return out
}

// QueryTokens is CodeTokens without stop words and single characters.
func QueryTokens(query string) []string {
	var out []string

	for _, t := range CodeTokens(query) {
		if len(t) > 1 && !queryStopWords[t] {
			out = append(out, t)
		}
	}
	return out
}

func asciiWords(text string) []string {
	return strings.FieldsFunc(text, func(r rune) bool {
		return !isASCIIAlnum(byte(r)) || r > 127
	})
}

func isASCIIAlnum(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

func isUpper(c byte) bool { return c >= 'A' && c <= 'Z' }
func isLower(c byte) bool { return c >= 'a' && c <= 'z' }
func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// identifierParts splits "HTTPServer2go" into HTTP, Server, 2, go: an upper
// run before an upper+lower pair ends one letter early, as in an acronym.
func identifierParts(word string) []string {
	var parts []string

	for i := 0; i < len(word); {
		j := i + 1
		switch c := word[i]; {
		case isDigit(c):
			for j < len(word) && isDigit(word[j]) {
				j++
			}
		case isUpper(c):
			j = upperRunEnd(word, i)
		default:
			for j < len(word) && isLower(word[j]) {
				j++
			}
		}

		parts = append(parts, word[i:j])
		i = j
	}
	return parts
}

// upperRunEnd returns where a part starting at an uppercase letter ends:
// "Server" (one capital and its lowercase tail) or "HTTP" in "HTTPServer".
func upperRunEnd(word string, i int) int {
	j := i
	for j < len(word) && isUpper(word[j]) {
		j++
	}

	if j-i == 1 || j == len(word) || !isLower(word[j]) {
		if j-i == 1 {
			for j < len(word) && isLower(word[j]) {
				j++
			}
		}
		return j
	}
	return j - 1
}
