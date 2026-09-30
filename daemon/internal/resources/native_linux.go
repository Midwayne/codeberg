package resources

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var linuxClock struct {
	sync.Once
	ticks, bootMS float64
}

func nativeProcesses(ctx context.Context) ([]ProcessCounter, error) {
	linuxClock.Do(func() {
		clockCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		output, err := exec.CommandContext(clockCtx, "getconf", "CLK_TCK").Output()
		if err == nil {
			linuxClock.ticks, _ = strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
		}
		stat, _ := os.ReadFile("/proc/stat")
		for _, line := range strings.Split(string(stat), "\n") {
			if strings.HasPrefix(line, "btime ") {
				linuxClock.bootMS, _ = strconv.ParseFloat(strings.TrimPrefix(line, "btime "), 64)
				linuxClock.bootMS *= 1000
			}
		}
	})
	if linuxClock.ticks <= 0 || linuxClock.bootMS <= 0 {
		return psProcesses(ctx)
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	rows := make([]ProcessCounter, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		data, err := os.ReadFile("/proc/" + entry.Name() + "/stat")
		if err != nil {
			continue
		} // Processes may exit between enumeration and read.
		raw := string(data)
		left, right := strings.IndexByte(raw, '('), strings.LastIndexByte(raw, ')')
		if left < 0 || right <= left {
			continue
		}
		fields := strings.Fields(raw[right+1:])
		if len(fields) < 22 {
			continue
		}
		ppid, _ := strconv.Atoi(fields[1])
		user, _ := strconv.ParseFloat(fields[11], 64)
		system, _ := strconv.ParseFloat(fields[12], 64)
		start, _ := strconv.ParseFloat(fields[19], 64)
		rss, _ := strconv.ParseInt(fields[21], 10, 64)
		rows = append(rows, ProcessCounter{PID: pid, PPID: ppid, Command: raw[left+1 : right],
			CPUTimeMS: (user + system) / linuxClock.ticks * 1000, StartedAt: int64(linuxClock.bootMS + start/linuxClock.ticks*1000),
			MemoryBytes: rss * int64(os.Getpagesize())})
	}
	return rows, nil
}

func systemMemory() int64 {
	var info syscall.Sysinfo_t
	_ = syscall.Sysinfo(&info)
	return int64(uint64(info.Totalram) * uint64(info.Unit))
}
