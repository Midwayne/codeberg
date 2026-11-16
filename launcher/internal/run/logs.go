package run

import (
	"os"
	"path/filepath"
	"strings"
)

// sessionLogs are the per-component log files under <home>/logs.
type sessionLogs struct {
	daemon  *os.File
	searxng *os.File
	web     *os.File
}

func openLogs(home string) (*sessionLogs, error) {
	logs := &sessionLogs{}

	targets := []struct {
		name string
		file **os.File
	}{
		{"daemon.log", &logs.daemon},
		{"searxng.log", &logs.searxng},
		{"web.log", &logs.web},
	}

	for _, target := range targets {
		opened, err := openLog(home, target.name)
		if err != nil {
			logs.Close()
			return nil, err
		}
		*target.file = opened
	}

	return logs, nil
}

func (l *sessionLogs) Close() {
	for _, file := range []*os.File{l.daemon, l.searxng, l.web} {
		if file != nil {
			file.Close()
		}
	}
}

// openLog keeps output from previous sessions so intermittent failures remain
// available after a restart. Restrict new logs to the current user: subprocesses
// may print request details or other private data.
func openLog(home, name string) (*os.File, error) {
	dir := filepath.Join(home, "logs")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
}

// tailFile returns the last lines of the daemon log, for a failed startup.
func tailFile(path string, lines int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	all := splitLines(string(data))
	if len(all) > lines {
		all = all[len(all)-lines:]
	}

	var out strings.Builder
	out.WriteString("--- daemon.log (tail) ---\n")
	for _, line := range all {
		out.WriteString(line + "\n")
	}
	return out.String()
}

// splitLines splits on newlines; a final newline does not add an empty line.
func splitLines(s string) []string {
	if s == "" {
		return nil
	}

	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}
