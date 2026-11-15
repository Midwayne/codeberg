package supervisor

import (
	"bytes"
	"strings"
	"sync"
)

const maxTailLine = 300

// lastLine keeps the most recent non-empty line written to it. The zero value
// is ready to use and safe for the concurrent stdout and stderr copies.
type lastLine struct {
	mu      sync.Mutex
	partial []byte
	line    string
}

func (l *lastLine) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.partial = append(l.partial, p...)

	for {
		end := bytes.IndexByte(l.partial, '\n')
		if end < 0 {
			break
		}

		if line := strings.TrimSpace(string(l.partial[:end])); line != "" {
			l.line = clip(line)
		}

		l.partial = l.partial[end+1:]
	}

	// An unterminated flood must not grow without bound.
	if len(l.partial) > maxTailLine {
		l.partial = l.partial[len(l.partial)-maxTailLine:]
	}

	return len(p), nil
}

// String returns the last complete line, or the unfinished one after it.
func (l *lastLine) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()

	if rest := strings.TrimSpace(string(l.partial)); rest != "" {
		return clip(rest)
	}

	return l.line
}

func clip(line string) string {
	if len(line) > maxTailLine {
		return line[:maxTailLine]
	}

	return line
}
