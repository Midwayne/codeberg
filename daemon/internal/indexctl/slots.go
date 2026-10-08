package indexctl

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"syscall"
	"time"
)

// maxInflight bounds concurrent connections per indexer socket. cberg-index
// answers one connection at a time behind a short listen backlog, and a
// non-blocking connect past that backlog fails with EAGAIN instead of
// waiting. Parallel agent tool calls fan out well beyond it (one search_code
// is a search plus several chunk reads), so requests queue here instead.
const maxInflight = 4

const dialRetryDelay = 10 * time.Millisecond

var (
	slotsMu sync.Mutex
	slots   = map[string]chan struct{}{}
)

func socketSlots(socket string) chan struct{} {
	slotsMu.Lock()
	defer slotsMu.Unlock()

	ch, ok := slots[socket]
	if !ok {
		ch = make(chan struct{}, maxInflight)
		slots[socket] = ch
	}

	return ch
}

// acquireSlot waits for a free connection slot on socket or for ctx to end.
func acquireSlot(ctx context.Context, socket string) (func(), error) {
	ch := socketSlots(socket)

	select {
	case ch <- struct{}{}:
		return func() { <-ch }, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("indexer connect: %w", ctx.Err())
	}
}

// dialIndexer connects to socket, retrying while its backlog is full (other
// processes can still fill it) until ctx ends.
func dialIndexer(ctx context.Context, socket string) (net.Conn, error) {
	d := net.Dialer{Timeout: 5 * time.Second}

	for {
		conn, err := d.DialContext(ctx, "unix", socket)
		if err == nil || !errors.Is(err, syscall.EAGAIN) {
			return conn, err
		}

		select {
		case <-time.After(dialRetryDelay):
		case <-ctx.Done():
			return nil, err
		}
	}
}
