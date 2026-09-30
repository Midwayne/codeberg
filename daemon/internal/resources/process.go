package resources

import (
	"context"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var excludedProcess = regexp.MustCompile(`(?i)^(ps|open|xdg-open|firefox|chrome|chromium(-browser)?|safari|google chrome( helper.*)?|microsoft edge( helper.*)?)(\.exe)?$`)

func selectTree(rows []ProcessCounter, roots []int) []ProcessCounter {
	selected, blocked := map[int]bool{}, map[int]bool{}
	for _, pid := range roots {
		selected[pid] = true
	}
	for _, row := range rows {
		if excludedProcess.MatchString(filepath.Base(row.Command)) {
			blocked[row.PID] = true
		}
	}
	for changed := true; changed; {
		changed = false
		for _, row := range rows {
			if blocked[row.PPID] && !blocked[row.PID] {
				blocked[row.PID] = true
				changed = true
			}
			if selected[row.PPID] && !selected[row.PID] && !blocked[row.PID] {
				selected[row.PID] = true
				changed = true
			}
		}
	}
	result := make([]ProcessCounter, 0)
	for _, row := range rows {
		if selected[row.PID] && !blocked[row.PID] {
			result = append(result, row)
		}
	}
	return result
}

func psProcesses(ctx context.Context) ([]ProcessCounter, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ps", "-ax", "-o", "pid=,ppid=,time=,rss=,lstart=,comm=")
	cmd.Env = append(cmd.Environ(), "LC_ALL=C")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return parsePS(string(output)), nil
}

func psArguments(ctx context.Context, pid int) string {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	output, err := exec.CommandContext(ctx, "ps", "-p", strconv.Itoa(pid), "-o", "args=").Output()
	if err != nil {
		return ""
	}
	if len(output) > 8192 {
		output = output[:8192]
	}
	return strings.TrimSpace(string(output))
}

func parsePS(output string) []ProcessCounter {
	rows := make([]ProcessCounter, 0)
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		pid, e1 := strconv.Atoi(fields[0])
		ppid, e2 := strconv.Atoi(fields[1])
		rss, e3 := strconv.ParseInt(fields[3], 10, 64)
		start, e4 := time.ParseInLocation("Mon Jan 2 15:04:05 2006", strings.Join(fields[4:9], " "), time.Local)
		cpu, ok := cpuTimeMS(fields[2])
		if e1 != nil || e2 != nil || e3 != nil || e4 != nil || !ok {
			continue
		}
		rows = append(rows, ProcessCounter{PID: pid, PPID: ppid, Command: strings.Join(fields[9:], " "),
			CPUTimeMS: cpu, MemoryBytes: rss * 1024, StartedAt: start.UnixMilli()})
	}
	return rows
}

func cpuTimeMS(raw string) (float64, bool) {
	days := 0.0
	if day, rest, ok := strings.Cut(raw, "-"); ok {
		var err error
		days, err = strconv.ParseFloat(day, 64)
		if err != nil {
			return 0, false
		}
		raw = rest
	}
	parts := strings.Split(raw, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, false
	}
	seconds := 0.0
	for _, part := range parts {
		value, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return 0, false
		}
		seconds = seconds*60 + value
	}
	return (days*86400 + seconds) * 1000, true
}
