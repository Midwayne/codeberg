package indexctl

import (
	"context"
	"errors"
	"os"
	"syscall"
)

func (c *Client) statusReply(ctx context.Context, out *statusResponse) error {
	// A separate listener and slot queue keep model inference from starving
	// health probes. When CBERG_SOCKET is too long for the ".health" suffix,
	// the indexer does not create that socket and status stays on the main one.
	healthSocket := c.socket + ".health"
	if _, err := os.Stat(healthSocket); errors.Is(err, os.ErrNotExist) {
		return roundTrip(ctx, c.socket, "status", out)
	}

	err := roundTrip(ctx, healthSocket, "status", out)
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, syscall.ECONNREFUSED) {
		return roundTrip(ctx, c.socket, "status", out)
	}

	return err
}
