// Package resources collects this Codeberg instance's footprint off request paths.
package resources

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
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
	PID, RootPID, Cores                int
	TotalMemory                        int64
	Now                                func() time.Time
	ReadProcesses                      func(context.Context) ([]ProcessCounter, error)
	ReadDisk                           func(context.Context) (*Disk, error)
}

type Collector struct {
	opts        Options
	id          string
	mu          sync.RWMutex
	history     []*Sample
	disk        *Disk
	clients     map[int]string
	captureMu   sync.Mutex
	previous    map[string]float64
	previousAt  int64
	started     sync.Once
	refresh     chan struct{}
	refreshDisk chan struct{}
}

func New(opts Options) *Collector {
	if opts.PID == 0 {
		opts.PID = os.Getpid()
	}
	if opts.Cores <= 0 {
		opts.Cores = runtime.NumCPU()
	}
	if opts.TotalMemory == 0 {
		opts.TotalMemory = systemMemory()
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.ReadProcesses == nil {
		opts.ReadProcesses = nativeProcesses
	}
	if opts.ReadDisk == nil {
		opts.ReadDisk = func(ctx context.Context) (*Disk, error) { return ScanDisk(ctx, opts) }
	}
	return &Collector{opts: opts, id: fmt.Sprintf("%d:%d", opts.PID, opts.Now().UnixNano()), clients: make(map[int]string), previous: make(map[string]float64),
		refresh: make(chan struct{}, 1), refreshDisk: make(chan struct{}, 1)}
}

// CPU and disk have independent loops. A long filesystem walk never delays CPU
// samples, cached reads, or daemon search handlers. Neither loop can overlap itself.
func (c *Collector) Start(ctx context.Context) {
	c.started.Do(func() {
		go func() {
			ticker := time.NewTicker(SampleInterval)
			defer ticker.Stop()
			for {
				_ = c.Capture(ctx)
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				case <-c.refresh:
				}
			}
		}()
		go func() {
			ticker := time.NewTicker(DiskInterval)
			defer ticker.Stop()
			for {
				scanCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				disk, err := c.opts.ReadDisk(scanCtx)
				cancel()
				if err == nil && disk != nil {
					disk.SampledAt = c.opts.Now().UnixMilli()
					c.mu.Lock()
					c.disk = disk
					if len(c.history) > 0 {
						latest := *c.history[len(c.history)-1]
						latest.Disk = disk
						c.history[len(c.history)-1] = &latest
					}
					c.mu.Unlock()
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				case <-c.refreshDisk:
					// Coalesce bursts of cleanup notifications without repeated walks.
					select {
					case <-ctx.Done():
						return
					case <-time.After(5 * time.Second):
					}
				}
			}
		}()
	})
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

func (c *Collector) Register(pid int) error {
	if pid <= 0 || pid == c.opts.PID {
		return fmt.Errorf("invalid web process PID")
	}
	c.mu.Lock()
	if len(c.clients) >= 32 {
		if _, exists := c.clients[pid]; !exists {
			c.mu.Unlock()
			return fmt.Errorf("too many web processes")
		}
	}
	c.clients[pid] = ""
	c.mu.Unlock()
	select {
	case c.refresh <- struct{}{}:
	default:
	}
	return nil
}

func (c *Collector) InvalidateDisk() {
	select {
	case c.refreshDisk <- struct{}{}:
	default:
	}
}

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
	selected := selectTree(rows, roots)
	sample := &Sample{Timestamp: now, CPU: CPU{Cores: c.opts.Cores}, Memory: Memory{TotalBytes: c.opts.TotalMemory},
		Processes: make([]Process, 0, len(selected)), Scope: "daemon-process-tree", Disk: disk}
	if managed {
		sample.Scope = "managed-stack"
	} else if clientCount > 0 {
		sample.Scope = "web-and-daemon"
	}
	current := make(map[string]float64, len(selected))
	complete := c.previousAt > 0 && now > c.previousAt
	corePercent := 0.0
	for _, row := range selected {
		key := identity(row)
		previous, known := c.previous[key]
		if !known && c.previousAt > 0 && row.StartedAt >= c.previousAt {
			previous, known = 0, true
		}
		item := Process{PID: row.PID, Name: processName(row.Command), MemoryBytes: row.MemoryBytes}
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
	return nil
}

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
