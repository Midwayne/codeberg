package workspace

import (
	"bytes"
	"io"
)

const lineWindowReadBuf = 64 * 1024

// lineWindow streams a file once, counting lines and keeping only the bytes a
// ReadFile response can return: the requested line range and the current
// (eventually last) line, each capped at max bytes.
type lineWindow struct {
	first uint32 // first line to capture (1-based)
	last  uint32 // last line to capture; 0 captures through EOF
	max   int

	line   uint32
	window []byte
	tail   []byte
}

func newLineWindow(first, last uint32, max int) *lineWindow {
	if first == 0 {
		first = 1
	}

	if last != 0 && last < first {
		last = first
	}

	return &lineWindow{first: first, last: last, max: max, line: 1}
}

func (lw *lineWindow) inWindow(n uint32) bool {
	return n >= lw.first && (lw.last == 0 || n <= lw.last)
}

func (lw *lineWindow) capped(dst, src []byte) []byte {
	room := lw.max - len(dst)
	if room <= 0 {
		return dst
	}

	if len(src) > room {
		src = src[:room]
	}

	return append(dst, src...)
}

func (lw *lineWindow) segment(seg []byte) {
	if lw.inWindow(lw.line) {
		lw.window = lw.capped(lw.window, seg)
	}

	lw.tail = lw.capped(lw.tail, seg)
}

func (lw *lineWindow) newline() {
	if lw.inWindow(lw.line) && lw.inWindow(lw.line+1) {
		lw.window = lw.capped(lw.window, []byte{'\n'})
	}

	lw.line++
	lw.tail = lw.tail[:0]
}

func (lw *lineWindow) consume(p []byte) {
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		if i < 0 {
			lw.segment(p)
			return
		}

		lw.segment(p[:i])
		lw.newline()
		p = p[i+1:]
	}
}

func (lw *lineWindow) readFrom(r io.Reader) error {
	buf := make([]byte, lineWindowReadBuf)

	for {
		n, err := r.Read(buf)
		lw.consume(buf[:n])

		if err == io.EOF {
			return nil
		}

		if err != nil {
			return err
		}
	}
}

// result applies ReadFile's clamping: a start past EOF collapses onto the last
// line, an end past EOF (or 0) runs to EOF, and end never precedes start.
func (lw *lineWindow) result(startLine, endLine uint32) FileContent {
	total := lw.line

	start := startLine
	if start == 0 {
		start = 1
	}

	end := endLine
	if end == 0 || end > total {
		end = total
	}

	content := lw.window
	if start > total {
		start = total
		content = lw.tail
	}

	if end < start {
		end = start
	}

	return FileContent{Content: string(content), StartLine: start, EndLine: end, TotalLines: total}
}
