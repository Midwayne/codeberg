package projects

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
		respond(w, 409, map[string]string{"message": "A folder picker is already open. Finish or cancel it, then try again"})
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
		respond(w, 405, map[string]string{"message": "method not allowed"})
		return "", false
	}

	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin folder selection is not allowed"})
		return "", false
	}

	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		respond(w, 415, map[string]string{"message": "application/json required"})
		return "", false
	}

	var body struct {
		InitialPath string `json:"initialPath"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		respond(w, 400, map[string]string{"message": "invalid folder selection request"})
		return "", false
	}

	initial := body.InitialPath
	if initial != "" {
		if !filepath.IsAbs(initial) || strings.ContainsAny(initial, "\x00\n\r\t") {
			respond(w, 400, map[string]string{"message": "Choose an absolute directory path"})
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

		respond(w, status, map[string]string{"message": message})
		return
	}

	if path == "" {
		respond(w, 200, map[string]bool{"cancelled": true})
		return
	}

	canonical, err := existingDirectory(path)
	if err != nil {
		respond(w, 502, map[string]string{"message": "The selected folder is unavailable. Choose another folder or enter its path manually"})
		return
	}

	respond(w, 200, map[string]string{"path": canonical})
}
