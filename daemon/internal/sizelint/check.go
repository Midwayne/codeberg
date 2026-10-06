package sizelint

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"strings"
)

type Diagnostic struct {
	Path    string
	Line    int
	Rule    string
	Message string
}

func (d Diagnostic) String() string {
	return fmt.Sprintf("%s:%d: %s: %s", d.Path, d.Line, d.Rule, d.Message)
}

// CheckFile checks formatting in tests too; size rules exclude tests and generated
// code. Parsing source directly includes every platform and build-tag variant.
func CheckFile(path string, source []byte, limits Limits) ([]Diagnostic, error) {
	positions := token.NewFileSet()
	file, err := parser.ParseFile(positions, path, source, parser.ParseComments)
	if err != nil {
		return nil, err
	}

	if ast.IsGenerated(file) {
		return nil, nil
	}

	var diagnostics []Diagnostic
	formatted, err := format.Source(source)
	if err != nil {
		return nil, err
	}

	if !bytes.Equal(source, formatted) {
		diagnostics = append(diagnostics, Diagnostic{path, 1, "gofmt", "run gofmt on this file"})
	}

	if strings.HasSuffix(path, "_test.go") {
		return diagnostics, nil
	}

	lines := bytes.Count(bytes.TrimSuffix(source, []byte("\n")), []byte("\n")) + 1
	if lines > limits.MaxFileLines {
		diagnostics = append(diagnostics, Diagnostic{path, 1, "max-lines",
			fmt.Sprintf("file has %d lines; limit is %d", lines, limits.MaxFileLines)})
	}

	return append(diagnostics, checkFunctions(path, file, positions, limits)...), nil
}

func checkFunctions(path string, file *ast.File, positions *token.FileSet, limits Limits) []Diagnostic {
	var diagnostics []Diagnostic

	ast.Inspect(file, func(node ast.Node) bool {
		var start, end token.Pos
		name := "anonymous function"

		switch function := node.(type) {
		case *ast.FuncDecl:
			if function.Body == nil {
				return true
			}
			start, end, name = function.Pos(), function.End(), function.Name.Name
		case *ast.FuncLit:
			start, end = function.Pos(), function.End()
		default:
			return true
		}

		line := positions.Position(start).Line
		lines := positions.Position(end).Line - line + 1
		if lines > limits.MaxFunctionLines {
			diagnostics = append(diagnostics, Diagnostic{path, line, "max-lines-per-function",
				fmt.Sprintf("%s has %d lines; limit is %d", name, lines, limits.MaxFunctionLines)})
		}

		return true
	})

	return diagnostics
}
