package resources

import (
	"context"
	"time"
)

const SampleInterval = 10 * time.Second

const DiskInterval = 5 * time.Minute

const Retention = time.Hour

type ProcessCounter struct {
	PID, PPID   int
	Command     string
	CPUTimeMS   float64
	MemoryBytes int64
	StartedAt   int64
}

type CPU struct {
	UsedPercent *float64 `json:"usedPercent"`
	CorePercent *float64 `json:"corePercent"`
	Cores       int      `json:"cores"`
}

type Memory struct {
	UsedBytes  int64 `json:"usedBytes"`
	TotalBytes int64 `json:"totalBytes"`
}

type Process struct {
	PID         int      `json:"pid"`
	Name        string   `json:"name"`
	CPUPercent  *float64 `json:"cpuPercent"`
	MemoryBytes int64    `json:"memoryBytes"`
}

type Disk struct {
	TotalBytes     int64 `json:"totalBytes"`
	AvailableBytes int64 `json:"availableBytes"`
	CodebergBytes  int64 `json:"codebergBytes"`
	SampledAt      int64 `json:"sampledAt"`
}

type Sample struct {
	Timestamp int64     `json:"timestamp"`
	CPU       CPU       `json:"cpu"`
	Memory    Memory    `json:"memory"`
	Processes []Process `json:"processes"`
	Scope     string    `json:"scope"`
	Disk      *Disk     `json:"disk"`
}

type Usage struct {
	Current          *Sample   `json:"current"`
	History          []*Sample `json:"history"`
	RetentionMS      int64     `json:"retentionMs"`
	SampleIntervalMS int64     `json:"sampleIntervalMs"`
	DiskIntervalMS   int64     `json:"diskIntervalMs"`
	Collector        string    `json:"collector"`
	CollectorID      string    `json:"collectorId"`
}

type Options struct {
	Home, ModelPath, IndexPath, LogDir string
	EmbeddingBackend                   string
	PID, RootPID, Cores                int
	TotalMemory                        int64
	Now                                func() time.Time
	ReadProcesses                      func(context.Context) ([]ProcessCounter, error)
	ReadDisk                           func(context.Context) (*Disk, error)
}

// Usage reads immutable cached samples. It performs no sampling, filesystem I/O,
// or subprocess work. after returns only new history points after the first load.
func (c *Collector) Usage(after int64) Usage {
	c.mu.RLock()
	defer c.mu.RUnlock()
	usage := Usage{History: make([]*Sample, 0), RetentionMS: Retention.Milliseconds(),
		SampleIntervalMS: SampleInterval.Milliseconds(), DiskIntervalMS: DiskInterval.Milliseconds(), Collector: "daemon", CollectorID: c.id}
	if len(c.history) > 0 {
		usage.Current = c.history[len(c.history)-1]
		if after > usage.Current.Timestamp {
			after = 0
		}
	}

	for _, sample := range c.history {
		if sample.Timestamp > after {
			point := *sample
			point.Processes = []Process{} // Only the current sample needs the PID table.
			usage.History = append(usage.History, &point)
		}
	}
	return usage
}
