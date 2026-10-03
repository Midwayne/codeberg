package projects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
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
	if r.Method != "POST" {
		respond(w, 405, map[string]string{"message": "method not allowed"})
		return
	}
	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin folder selection is not allowed"})
		return
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		respond(w, 415, map[string]string{"message": "application/json required"})
		return
	}
	var body struct {
		InitialPath string `json:"initialPath"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		respond(w, 400, map[string]string{"message": "invalid folder selection request"})
		return
	}
	initial := body.InitialPath
	if initial != "" {
		if !filepath.IsAbs(initial) || strings.ContainsAny(initial, "\x00\n\r\t") {
			respond(w, 400, map[string]string{"message": "Choose an absolute directory path"})
			return
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
	p.mu.Lock()
	if p.active {
		p.mu.Unlock()
		respond(w, 409, map[string]string{"message": "A folder picker is already open. Finish or cancel it, then try again"})
		return
	}
	p.active = true
	p.mu.Unlock()
	defer func() { p.mu.Lock(); p.active = false; p.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	path, err := p.choose(ctx, initial)
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

func existingDirectory(path string) (string, error) {
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\n\r\t") {
		return "", fmt.Errorf("invalid directory path")
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(canonical)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory")
	}
	return canonical, nil
}

func chooseNativeFolder(ctx context.Context, initial string) (string, error) {
	if goruntime.GOOS == "linux" && os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return "", errPickerUnavailable
	}
	cmd, cancelExitOne, err := nativeFolderCommand(ctx, goruntime.GOOS, initial, exec.LookPath)
	if err != nil {
		return "", err
	}
	output, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if ctx.Err() == nil && cancelExitOne && errors.As(err, &exit) && exit.ExitCode() == 1 {
			return "", nil
		}
		return "", err
	}
	// Preserve spaces in directory names; strip only the helper's line ending.
	return strings.TrimSuffix(strings.TrimSuffix(string(output), "\n"), "\r"), nil
}

// Paths are passed as an argument or environment value, never script source.
func nativeFolderCommand(ctx context.Context, platform, initial string, lookup func(string) (string, error)) (*exec.Cmd, bool, error) {
	switch platform {
	case "darwin":
		script := `on run argv
try
activate
return POSIX path of (choose folder with prompt "Choose a Codeberg project folder" default location (POSIX file (item 1 of argv)))
on error number -128
return ""
end try
end run`
		return exec.CommandContext(ctx, "/usr/bin/osascript", "-e", script, initial), false, nil
	case "windows":
		bin, err := lookup("powershell.exe")
		if err != nil {
			return nil, false, errPickerUnavailable
		}
		script := `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'Choose a Codeberg project folder'
$picker.SelectedPath = $env:CODEBERG_PICKER_START
$picker.ShowNewFolderButton = $false
try { if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($picker.SelectedPath) } } finally { $picker.Dispose() }`
		cmd := exec.CommandContext(ctx, bin, "-NoProfile", "-STA", "-Command", script)
		cmd.Env = append(os.Environ(), "CODEBERG_PICKER_START="+initial)
		return cmd, false, nil
	case "linux":
		if bin, err := lookup("zenity"); err == nil {
			return exec.CommandContext(ctx, bin, "--file-selection", "--directory", "--title=Choose a Codeberg project folder", "--filename="+initial+string(filepath.Separator)), true, nil
		}
		if bin, err := lookup("kdialog"); err == nil {
			return exec.CommandContext(ctx, bin, "--title", "Choose a Codeberg project folder", "--getexistingdirectory", initial), true, nil
		}
		return nil, false, errPickerUnavailable
	default:
		return nil, false, errPickerUnavailable
	}
}
