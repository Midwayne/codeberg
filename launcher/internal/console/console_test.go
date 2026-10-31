package console

import (
	"bytes"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// syncBuffer lets the spinner goroutine and the test share one buffer safely.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.String()
}

func TestPlainStatusPrintsOneLineWithoutControlCodes(t *testing.T) {
	var out syncBuffer
	term := New(&out, false)

	stop := term.Start("Starting Codeberg")
	fmt.Fprintln(term, "notice")
	stop()
	stop()

	want := "› Starting Codeberg…\nnotice\n"
	if got := out.String(); got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}

func TestAnimatedStatusRedrawsAroundOtherOutputAndClearsOnStop(t *testing.T) {
	var out syncBuffer
	term := New(&out, true)
	term.interval = time.Millisecond

	stop := term.Start("Starting Codeberg")
	time.Sleep(20 * time.Millisecond)

	fmt.Fprint(term, "update available\n")
	stop()
	stop()

	got := out.String()

	if !strings.Contains(got, clearLine+"update available\n"+clearLine) {
		t.Fatalf("notice was not printed on a cleared line followed by a redraw: %q", got)
	}

	if strings.Count(got, "Starting Codeberg…") < 2 {
		t.Fatalf("spinner did not animate: %q", got)
	}

	if !strings.HasSuffix(got, clearLine) {
		t.Fatalf("stop did not clear the status line: %q", got)
	}

	before := out.String()
	time.Sleep(10 * time.Millisecond)

	if out.String() != before {
		t.Fatal("spinner kept drawing after stop")
	}
}

func TestWritesAfterStopPassThroughUnchanged(t *testing.T) {
	var out syncBuffer
	term := New(&out, true)

	term.Start("Starting Codeberg")()
	out.mu.Lock()
	out.buf.Reset()
	out.mu.Unlock()

	fmt.Fprint(term, "✓ Ready\n")

	if got := out.String(); got != "✓ Ready\n" {
		t.Fatalf("output = %q", got)
	}
}

func TestElapsedIsHiddenBrieflyThenRounded(t *testing.T) {
	cases := map[time.Duration]string{
		500 * time.Millisecond:   "",
		1999 * time.Millisecond:  "",
		12400 * time.Millisecond: "  12s",
		185 * time.Second:        "  3m5s",
	}

	for d, want := range cases {
		if got := elapsed(d); got != want {
			t.Errorf("elapsed(%s) = %q, want %q", d, got, want)
		}
	}
}
