package resources

import (
	"context"
	"path/filepath"
)

func processName(command string) string {
	switch name := filepath.Base(command); name {
	case "codeberg":
		return "Launcher"
	case "codeberg-d":
		return "Daemon"
	case "cberg-index":
		return "Indexer"
	default:
		return name
	}
}

func (c *Collector) captureName(ctx context.Context, row ProcessCounter) (string, string) {
	key := identity(row)
	nameKey := key + ":" + row.Command
	name, cached := c.names[nameKey]
	if !cached {
		name = workerName(row.Command, "", c.opts.ModelPath, c.opts.EmbeddingBackend)
		if pythonProcess.MatchString(filepath.Base(row.Command)) && name == filepath.Base(row.Command) {
			name = workerName(row.Command, nativeArguments(ctx, row.PID), c.opts.ModelPath, c.opts.EmbeddingBackend)
		}
	}

	return nameKey, name
}

func (c *Collector) captureProcesses(ctx context.Context, selected []ProcessCounter, webPIDs map[int]bool, sample *Sample, now int64) {
	current := make(map[string]float64, len(selected))
	names := make(map[string]string, len(selected))
	complete := c.previousAt > 0 && now > c.previousAt
	corePercent := 0.0

	for _, row := range selected {
		key := identity(row)
		previous, known := c.previous[key]
		if !known && c.previousAt > 0 && row.StartedAt >= c.previousAt {
			previous, known = 0, true
		}

		nameKey, name := c.captureName(ctx, row)
		names[nameKey] = name
		item := Process{PID: row.PID, Name: name, MemoryBytes: row.MemoryBytes}
		if webPIDs[row.PID] {
			item.Name = "Web server & learning"
		}

		if known && c.previousAt > 0 && now > c.previousAt {
			value := max(0, row.CPUTimeMS-previous) / float64(now-c.previousAt) * 100
			item.CPUPercent = &value
			corePercent += value
		} else {
			complete = false
		}

		current[key] = row.CPUTimeMS
		sample.Processes = append(sample.Processes, item)
		sample.Memory.UsedBytes += row.MemoryBytes
	}

	if complete {
		capacity := corePercent / float64(c.opts.Cores)
		sample.CPU.CorePercent, sample.CPU.UsedPercent = &corePercent, &capacity
	}

	c.previous, c.previousAt = current, now
	c.names = names
}
