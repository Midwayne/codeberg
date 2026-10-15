package run

import (
	"context"
	"fmt"
	"io"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

// Installation and startup run only after Settings or explicit configuration
// opts into search. The UI can cancel either operation without a restart.
func searchControl(c *config.Config, logw io.Writer) (*searxng.ControlServer, error) {
	controller := searxng.NewController(func(ctx context.Context) (searxng.ManagedService, error) {
		if err := searxng.EnsureInstalled(ctx, c.Home, false, logw); err != nil {
			fmt.Fprintf(logw, "web search setup failed: %v\n", err)

			return nil, err
		}

		return searxng.Start(ctx, c.Home, c.SearxngPort, logw)
	})

	return searxng.ListenControl(controller)
}
