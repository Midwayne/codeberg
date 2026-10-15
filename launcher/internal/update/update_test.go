package update

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewerStableVersion(t *testing.T) {
	for _, tc := range []struct {
		current string
		latest  string
		want    bool
	}{
		{"v1.2.3", "v1.2.4", true},
		{"1.2.3", "v1.10.0", true},
		{"v1.9.9", "v2.0.0", true},
		{"v1.2.3", "v1.2.3", false},
		{"v2.0.0", "v1.9.9", false},
		{"v1.10.0", "v1.9.0", false},
		{"dev", "v1.2.4", false},
		{"v1.2.3-rc.1", "v1.2.4", false},
		{"v1.2.3", "v1.2.4-beta.1", false},
		{"v1.2.3", "v1.2.4+build", false},
		{"v1.2.3", "v1.2", false},
		{"v1.2.3", "v1.02.4", false},
		{"v1.2.3", "v1.2.999999999999999999999999", false},
		{"v1.2.3", "v1.2.4\nforged notice", false},
	} {
		t.Run(tc.current+"/"+tc.latest, func(t *testing.T) {
			if got := newerStableVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("newerStableVersion(%q, %q) = %v", tc.current, tc.latest, got)
			}
		})
	}
}

func TestNoticeFollowsLatestReleaseRedirect(t *testing.T) {
	for _, prebuilt := range []bool{true, false} {
		t.Run(map[bool]string{true: "prebuilt", false: "source"}[prebuilt], func(t *testing.T) {
			server := releaseServer(t, "v1.10.0", http.StatusOK)
			var out bytes.Buffer

			notify(context.Background(), server.Client(), server.URL+"/releases", "v1.9.0", prebuilt, &out)

			message := out.String()
			for _, text := range []string{"update available", "v1.9.0", "v1.10.0", releasesURL + "/tag/v1.10.0"} {
				if !strings.Contains(message, text) {
					t.Fatalf("notice missing %q: %s", text, message)
				}
			}

			instruction := "./launcher/update.sh"
			if prebuilt {
				instruction = releasesURL + "/latest/download/install.sh | sh"
			}
			if !strings.Contains(message, instruction) || !strings.Contains(message, "Stop Codeberg") {
				t.Fatalf("missing upgrade instructions: %s", message)
			}
		})
	}
}

func TestNoNoticeForUnavailableOrUnchangedRelease(t *testing.T) {
	for _, tc := range []struct {
		tag    string
		status int
	}{
		{"v1.2.3", http.StatusOK},
		{"v1.2.2", http.StatusOK},
		{"v1.2.4-rc.1", http.StatusOK},
		{"not-a-version", http.StatusOK},
		{"v1.2.4", http.StatusNotFound},
		{"v1.2.4", http.StatusTooManyRequests},
		{"v1.2.4", http.StatusInternalServerError},
	} {
		t.Run(tc.tag+"/"+http.StatusText(tc.status), func(t *testing.T) {
			server := releaseServer(t, tc.tag, tc.status)
			var out bytes.Buffer

			notify(context.Background(), server.Client(), server.URL+"/releases", "v1.2.3", true, &out)

			if out.Len() != 0 {
				t.Fatalf("unexpected notice: %s", &out)
			}
		})
	}
}

func TestCheckFailureIsSilent(t *testing.T) {
	server := releaseServer(t, "v1.2.4", http.StatusOK)
	server.Close()
	var out bytes.Buffer

	notify(context.Background(), server.Client(), server.URL+"/releases", "v1.2.3", true, &out)

	if out.Len() != 0 {
		t.Fatalf("network failure printed a notice: %s", &out)
	}
}

func TestDevelopmentBuildDoesNotContactReleaseServer(t *testing.T) {
	var out bytes.Buffer

	// A nil client would panic if the check made a network request.
	notify(context.Background(), nil, "http://unused", "dev", false, &out)

	if out.Len() != 0 {
		t.Fatalf("development build printed a notice: %s", &out)
	}
}

func TestUnexpectedReleaseRedirectIsSilent(t *testing.T) {
	for _, destination := range []string{
		"/another-repo/releases/tag/v1.2.4",
		"/releases/latest",
		"/releases/tag/v1.2.4?unexpected=true",
	} {
		t.Run(destination, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/releases/latest" && destination != r.URL.Path {
					http.Redirect(w, r, destination, http.StatusFound)
					return
				}

				w.WriteHeader(http.StatusOK)
			}))
			t.Cleanup(server.Close)
			var out bytes.Buffer

			notify(context.Background(), server.Client(), server.URL+"/releases", "v1.2.3", true, &out)

			if out.Len() != 0 {
				t.Fatalf("unexpected redirect printed a notice: %s", &out)
			}
		})
	}
}

func TestBackgroundCheckDoesNotBlockStartupAndCanBeCancelled(t *testing.T) {
	requested := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requested)
		<-r.Context().Done()
		close(cancelled)
	}))
	t.Cleanup(server.Close)
	started := make(chan context.CancelFunc, 1)

	go func() {
		started <- start("v1.2.3", true, &bytes.Buffer{}, server.Client(), server.URL)
	}()

	select {
	case cancel := <-started:
		defer cancel()

		select {
		case <-requested:
		case <-time.After(time.Second):
			t.Fatal("update check did not start")
		}
		cancel()
	case <-time.After(time.Second):
		t.Fatal("update check blocked startup")
	}

	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("update check did not cancel its request")
	}
}

func TestCheckTimeoutIsSilent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(server.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	var out bytes.Buffer

	notify(ctx, server.Client(), server.URL, "v1.2.3", true, &out)

	if out.Len() != 0 {
		t.Fatalf("timeout printed a notice: %s", &out)
	}
}

func releaseServer(t *testing.T, tag string, status int) *httptest.Server {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Errorf("method = %s, want HEAD", r.Method)
		}
		if r.URL.Path == "/releases/latest" {
			http.Redirect(w, r, "/releases/tag/"+tag, http.StatusFound)
			return
		}

		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)

	return server
}
