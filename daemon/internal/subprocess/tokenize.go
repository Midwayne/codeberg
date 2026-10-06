package subprocess

import (
	"fmt"
	"strings"
)

// TokenizePipeline splits a command string into per-stage argv lists.
func TokenizePipeline(command string) ([][]string, error) {
	if strings.TrimSpace(command) == "" {
		return nil, fmt.Errorf("%w: empty command", ErrInvalid)
	}

	p := pipelineTokenizer{}
	r := []rune(command)

	for i := 0; i < len(r); i++ {
		next, err := p.consume(r, i)
		if err != nil {
			return nil, err
		}

		i = next
	}

	if err := p.flushStage(); err != nil {
		return nil, err
	}

	return p.stages, nil
}

type pipelineTokenizer struct {
	stages [][]string
	cur    []string
	tok    strings.Builder
	hasTok bool
}

func (p *pipelineTokenizer) flushToken() {
	if p.hasTok {
		p.cur = append(p.cur, p.tok.String())
		p.tok.Reset()
		p.hasTok = false
	}
}

func (p *pipelineTokenizer) flushStage() error {
	p.flushToken()

	if len(p.cur) == 0 {
		return fmt.Errorf("%w: empty pipeline stage", ErrUnsafe)
	}

	p.stages = append(p.stages, p.cur)
	p.cur = nil
	return nil
}

func (p *pipelineTokenizer) consume(r []rune, i int) (int, error) {
	switch c := r[i]; c {
	case '\'', '"':
		return p.quoted(r, i, c)
	case '\\':
		if i+1 < len(r) {
			p.tok.WriteRune(r[i+1])
			p.hasTok = true
			i++
		}
	case ' ', '\t':
		p.flushToken()
	case '|':
		if err := p.flushStage(); err != nil {
			return i, err
		}
	case '>', '<', ';', '&', '$', '`', '(', ')', '{', '}', '\n', '\r':
		return i, fmt.Errorf("%w: shell operator %q", ErrUnsafe, string(c))
	default:
		p.tok.WriteRune(c)
		p.hasTok = true
	}

	return i, nil
}

func (p *pipelineTokenizer) quoted(r []rune, i int, quote rune) (int, error) {
	p.hasTok = true
	i++

	for i < len(r) && r[i] != quote {
		if quote == '"' && r[i] == '\\' && i+1 < len(r) && (r[i+1] == '"' || r[i+1] == '\\') {
			p.tok.WriteRune(r[i+1])
			i += 2
			continue
		}

		p.tok.WriteRune(r[i])
		i++
	}

	if i >= len(r) {
		kind := "single"
		if quote == '"' {
			kind = "double"
		}
		return i, fmt.Errorf("%w: unterminated %s quote", ErrInvalid, kind)
	}
	return i, nil
}
