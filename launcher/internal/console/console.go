// Package console draws the launcher's terminal status: a one-line spinner
// that other output, such as an update notice, can interleave with without
// garbling the line.
package console

import (
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

const clearLine = "\r\033[K"

var frames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

// Terminal serializes launcher output. While a status is active, each write
// clears the status line first and redraws it afterwards.
type Terminal struct {
	mu       sync.Mutex
	out      io.Writer
	animate  bool
	interval time.Duration
	status   *status
}

type status struct {
	label   string
	started time.Time
	frame   int
}

// New wraps out. Without animate, statuses print as a single plain line, which
// suits pipes, log files and dumb terminals.
func New(out io.Writer, animate bool) *Terminal {
	return &Terminal{out: out, animate: animate, interval: 100 * time.Millisecond}
}

// Interactive reports whether f is a terminal that can redraw a status line.
func Interactive(f *os.File) bool {
	info, err := f.Stat()
	if err != nil || info.Mode()&os.ModeCharDevice == 0 {
		return false
	}

	return os.Getenv("TERM") != "dumb"
}

func (t *Terminal) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.clear()
	n, err := t.out.Write(p)
	t.draw()

	return n, err
}

// Start shows label until the returned function is called. The stop function
// clears the status line and is safe to call more than once.
func (t *Terminal) Start(label string) (stop func()) {
	if !t.animate {
		fmt.Fprintf(t, "› %s…\n", label)

		return func() {}
	}

	t.mu.Lock()
	t.status = &status{label: label, started: time.Now()}
	t.draw()
	t.mu.Unlock()

	done := make(chan struct{})
	finished := make(chan struct{})
	go t.spin(done, finished)

	var once sync.Once

	return func() {
		once.Do(func() {
			close(done)
			<-finished

			t.mu.Lock()
			t.clear()
			t.status = nil
			t.mu.Unlock()
		})
	}
}

func (t *Terminal) spin(done <-chan struct{}, finished chan<- struct{}) {
	defer close(finished)

	ticker := time.NewTicker(t.interval)
	defer ticker.Stop()

	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			t.mu.Lock()
			t.status.frame++
			t.draw()
			t.mu.Unlock()
		}
	}
}

// draw and clear require t.mu.
func (t *Terminal) draw() {
	if t.status == nil {
		return
	}

	frame := frames[t.status.frame%len(frames)]
	fmt.Fprintf(t.out, "%s%s %s…%s", clearLine, frame, t.status.label, elapsed(time.Since(t.status.started)))
}

func (t *Terminal) clear() {
	if t.status != nil {
		_, _ = io.WriteString(t.out, clearLine)
	}
}

// elapsed reassures users during slow first indexes without flickering a
// counter for the usual quick start.
func elapsed(d time.Duration) string {
	if d < 2*time.Second {
		return ""
	}

	return "  " + d.Truncate(time.Second).String()
}
