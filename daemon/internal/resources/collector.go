// Package resources collects this Codeberg instance's footprint off request paths.
package resources

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"
)

type Collector struct {
	opts        Options
	id          string
	mu          sync.RWMutex
	history     []*Sample
	disk        *Disk
	clients     map[int]string
	captureMu   sync.Mutex
	previous    map[string]float64
	names       map[string]string
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
	return &Collector{opts: opts, id: fmt.Sprintf("%d:%d", opts.PID, opts.Now().UnixNano()), clients: make(map[int]string), previous: make(map[string]float64), names: make(map[string]string),
		refresh: make(chan struct{}, 1), refreshDisk: make(chan struct{}, 1)}
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
