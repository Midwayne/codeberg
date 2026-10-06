package resources

import (
	"context"
	"fmt"
	"path/filepath"
)

func identity(row ProcessCounter) string { return fmt.Sprintf("%d:%d", row.PID, row.StartedAt) }

func (c *Collector) Capture(ctx context.Context) error {
	c.captureMu.Lock()
	defer c.captureMu.Unlock()
	rows, err := c.opts.ReadProcesses(ctx)
	if err != nil {
		return err
	}

	now := c.opts.Now().UnixMilli()
	byPID := make(map[int]ProcessCounter, len(rows))

	for _, row := range rows {
		byPID[row.PID] = row
	}

	if _, exists := byPID[c.opts.PID]; !exists {
		return fmt.Errorf("daemon process missing from snapshot")
	}

	root := c.opts.RootPID
	if root == 0 {
		root = byPID[c.opts.PID].PPID
	}

	managed := filepath.Base(byPID[root].Command) == "codeberg"
	roots := []int{c.opts.PID}
	if managed {
		roots = append(roots, root)
	}

	roots, webPIDs, clientCount, disk := c.captureClients(byPID, roots)
	selected := selectTree(rows, roots)
	sample := &Sample{Timestamp: now, CPU: CPU{Cores: c.opts.Cores}, Memory: Memory{TotalBytes: c.opts.TotalMemory},
		Processes: make([]Process, 0, len(selected)), Scope: "daemon-process-tree", Disk: disk}
	if managed {
		sample.Scope = "managed-stack"
	} else if clientCount > 0 {
		sample.Scope = "web-and-daemon"
	}

	c.captureProcesses(ctx, selected, webPIDs, sample, now)
	c.appendSample(sample, now)
	return nil
}

func (c *Collector) captureClients(byPID map[int]ProcessCounter, roots []int) ([]int, map[int]bool, int, *Disk) {
	c.mu.Lock()
	webPIDs := make(map[int]bool, len(c.clients))

	for pid, bound := range c.clients {
		row, exists := byPID[pid]
		name := filepath.Base(row.Command)
		if !exists || (bound != "" && bound != identity(row)) || (name != "node" && name != "nodejs" && name != "codeberg-web") {
			delete(c.clients, pid)
			continue
		}

		c.clients[pid] = identity(row)
		webPIDs[pid] = true
		roots = append(roots, pid)
	}

	clientCount := len(c.clients)
	disk := c.disk
	c.mu.Unlock()
	return roots, webPIDs, clientCount, disk
}

func (c *Collector) appendSample(sample *Sample, now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cut := 0

	for cut < len(c.history) && c.history[cut].Timestamp <= now-Retention.Milliseconds() {
		cut++
	}

	if len(c.history) > 0 {
		point := *c.history[len(c.history)-1]
		point.Processes = []Process{}
		c.history[len(c.history)-1] = &point
	}

	c.history = append(c.history[cut:], sample)
	if len(c.history) > 360 {
		c.history = c.history[len(c.history)-360:]
	}
}
