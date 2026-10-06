package projects

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
)

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
