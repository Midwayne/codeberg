package resources

import (
	"context"
	"time"
)

// CPU and disk have independent loops. A long filesystem walk never delays CPU
// samples, cached reads, or daemon search handlers. Neither loop can overlap itself.
func (c *Collector) Start(ctx context.Context) {
	c.started.Do(func() {
		go c.sampleLoop(ctx)
		go c.diskLoop(ctx)
	})
}

func (c *Collector) sampleLoop(ctx context.Context) {
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
}

func (c *Collector) diskLoop(ctx context.Context) {
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
}
