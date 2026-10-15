// Package update reports published releases without delaying launcher startup.
package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const releasesURL = "https://github.com/Midwayne/codeberg/releases"
const checkTimeout = 2 * time.Second

// Start checks for a newer stable release in the background. The returned
// function cancels outstanding work when the launcher exits. Failures are silent.
func Start(current string, prebuilt bool, out io.Writer) context.CancelFunc {
	return start(current, prebuilt, out, &http.Client{Timeout: checkTimeout}, releasesURL)
}

func start(current string, prebuilt bool, out io.Writer, client *http.Client, base string) context.CancelFunc {
	ctx, cancel := context.WithTimeout(context.Background(), checkTimeout)

	go func() {
		defer cancel()
		notify(ctx, client, base, current, prebuilt, out)
	}()

	return cancel
}

func notify(ctx context.Context, client *http.Client, base, current string, prebuilt bool, out io.Writer) {
	if _, ok := stableVersion(current); !ok {
		return
	}

	latest := latestRelease(ctx, client, base)
	if !newerStableVersion(current, latest) || ctx.Err() != nil {
		return
	}

	instructions := "Stop Codeberg, update your source checkout, then run ./launcher/update.sh."
	if prebuilt {
		instructions = "Stop Codeberg, then re-run the installer:\n  curl -fsSL " +
			releasesURL + "/latest/download/install.sh | sh"
	}

	fmt.Fprintf(out, "\n› Codeberg update available: %s → %s\n  %s/tag/%s\n  %s\n\n",
		current, latest, releasesURL, latest, instructions)
}

func latestRelease(ctx context.Context, client *http.Client, base string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, base+"/latest", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "codeberg-update-check")

	response, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return ""
	}

	// Resolve the same latest-release redirect used by the installer. Only
	// accept tags under this repository, never arbitrary redirect destinations.
	final := response.Request.URL
	prefix := base + "/tag/"
	if final.RawQuery != "" || final.Fragment != "" || !strings.HasPrefix(final.String(), prefix) {
		return ""
	}

	return strings.TrimPrefix(final.String(), prefix)
}
