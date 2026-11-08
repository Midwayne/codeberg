package projects

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"codeberg.org/codeberg/daemon/internal/httpserver"
)

var errPickerUnavailable = errors.New("Native folder picker is unavailable. Enter the directory path manually")

// A desktop has one picker at a time, even when multiple browser tabs request it.
// Selection itself never registers a project or changes the active workspace.
type folderPicker struct {
	mu     sync.Mutex
	active bool
	choose func(context.Context, string) (string, error)
}

var desktopFolderPicker = &folderPicker{choose: chooseNativeFolder}

func (p *folderPicker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	initial, ok := pickerInitialPath(w, r)
	if !ok {
		return
	}

	p.mu.Lock()

	if p.active {
		p.mu.Unlock()
		respondError(w, 409, "A folder picker is already open. Finish or cancel it, then try again")
		return
	}

	p.active = true
	p.mu.Unlock()
	defer func() {
		p.mu.Lock()
		p.active = false
		p.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	path, err := p.choose(ctx, initial)
	respondPickerChoice(ctx, w, path, err)
}

func pickerInitialPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	if r.Method != "POST" {
		respondError(w, 405, "method not allowed")
		return "", false
	}

	if !sameOrigin(r) {
		respondError(w, 403, "cross-origin folder selection is not allowed")
		return "", false
	}

	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		respondError(w, 415, "application/json required")
		return "", false
	}

	var body struct {
		InitialPath string `json:"initialPath"`
	}
	if err := readProjectJSON(w, r, &body); err != nil {
		respondError(w, 400, "invalid folder selection request")
		return "", false
	}

	initial := body.InitialPath
	if initial != "" {
		if !filepath.IsAbs(initial) || strings.ContainsAny(initial, "\x00\n\r\t") {
			respondError(w, 400, "Choose an absolute directory path")
			return "", false
		}

		// A removed project directory must not prevent opening the native picker.
		if canonical, err := existingDirectory(initial); err == nil {
			initial = canonical
		} else {
			initial = ""
		}
	}

	if initial == "" {
		initial, _ = os.UserHomeDir()
	}

	return initial, true
}

func respondPickerChoice(ctx context.Context, w http.ResponseWriter, path string, err error) {
	if err != nil {
		status, message := 503, "Could not open the folder picker. Enter the directory path manually"
		if errors.Is(err, errPickerUnavailable) {
			status, message = 501, errPickerUnavailable.Error()
		}

		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			status, message = 408, "Folder selection timed out. Choose a folder again or enter the path manually"
		}

		respondError(w, status, message)
		return
	}

	if path == "" {
		httpserver.WriteJSON(w, 200, map[string]bool{"cancelled": true})
		return
	}

	canonical, err := existingDirectory(path)
	if err != nil {
		respondError(w, 502, "The selected folder is unavailable. Choose another folder or enter its path manually")
		return
	}

	httpserver.WriteJSON(w, 200, map[string]string{"path": canonical})
}
