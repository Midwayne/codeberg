package searxng

import (
	"context"
	"sync"
)

// ManagedService is owned exclusively by the controller until it is stopped.
type ManagedService interface {
	URL() string
	Stop()
}

type SearchStatus struct {
	Status  string `json:"status"`
	URL     string `json:"url,omitempty"`
	Message string `json:"message,omitempty"`
}

// Controller starts nothing until enabled. Disable cancels installation and
// waits for the worker's process group to stop before returning.
type Controller struct {
	operation sync.Mutex
	mu        sync.Mutex
	status    SearchStatus
	start     func(context.Context) (ManagedService, error)
	cancel    context.CancelFunc
	done      chan struct{}
	closed    bool
}

func NewController(start func(context.Context) (ManagedService, error)) *Controller {
	return &Controller{start: start, status: SearchStatus{Status: "disabled"}}
}

func (c *Controller) Current() SearchStatus {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.status
}

func (c *Controller) publish(status SearchStatus) {
	c.mu.Lock()
	c.status = status
	c.mu.Unlock()
}

func (c *Controller) Configure(enabled bool) SearchStatus {
	c.operation.Lock()
	defer c.operation.Unlock()

	if !enabled || c.closed {
		if c.cancel != nil {
			c.cancel()
			<-c.done
			c.cancel = nil
		}
		c.publish(SearchStatus{Status: "disabled"})

		return c.Current()
	}
	if c.Current().Status != "disabled" {
		return c.Current()
	}

	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.done = make(chan struct{})
	c.publish(SearchStatus{Status: "starting"})
	go c.run(ctx, c.done)

	return c.Current()
}

func (c *Controller) run(ctx context.Context, done chan struct{}) {
	defer close(done)
	service, err := c.start(ctx)
	if err != nil {
		if ctx.Err() == nil {
			c.publish(SearchStatus{Status: "error", Message: err.Error()})
		}

		return
	}
	defer service.Stop()
	if ctx.Err() != nil {
		return
	}

	c.publish(SearchStatus{Status: "ready", URL: service.URL()})
	<-ctx.Done()
}

func (c *Controller) Close() {
	c.operation.Lock()
	c.closed = true
	c.operation.Unlock()
	c.Configure(false)
}
