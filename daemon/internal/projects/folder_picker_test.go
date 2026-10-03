package projects

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativePickerSelectionAndCancellation(t *testing.T) {
	root := t.TempDir()
	canonical, _ := filepath.EvalSymlinks(root)
	for _, cancel := range []bool{false, true} {
		picker := &folderPicker{choose: func(ctx context.Context, initial string) (string, error) {
			if initial != canonical {
				t.Fatalf("initial directory: %q", initial)
			}
			if cancel {
				return "", nil
			}
			return root, nil
		}}
		body, _ := json.Marshal(map[string]string{"initialPath": root})
		req := httptest.NewRequest("POST", "/projects/pick-directory", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		picker.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		var result struct {
			Path      string
			Cancelled bool
		}
		_ = json.Unmarshal(w.Body.Bytes(), &result)
		if result.Cancelled != cancel || (!cancel && result.Path != canonical) {
			t.Fatal(result)
		}
	}
}

func TestNativePickerRejectsUntrustedRequestsAndInvalidSelections(t *testing.T) {
	called := false
	picker := &folderPicker{choose: func(context.Context, string) (string, error) { called = true; return "/missing", nil }}
	for _, tc := range []struct {
		method, body, origin, contentType string
		status                            int
	}{
		{"GET", "", "", "", 405},
		{"POST", "{}", "https://other.example", "application/json", 403},
		{"POST", "{}", "", "text/plain", 415},
		{"POST", "{", "", "application/json", 400},
		{"POST", `{"initialPath":"relative"}`, "", "application/json", 400},
	} {
		req := httptest.NewRequest(tc.method, "/projects/pick-directory", strings.NewReader(tc.body))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", tc.contentType)
		w := httptest.NewRecorder()
		picker.ServeHTTP(w, req)
		if w.Code != tc.status || called {
			t.Fatalf("%+v: %d, called=%v", tc, w.Code, called)
		}
	}
	req := httptest.NewRequest("POST", "/projects/pick-directory", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	picker.ServeHTTP(w, req)
	if w.Code != 502 {
		t.Fatalf("accepted invalid selection: %d", w.Code)
	}
}

func TestNativePickerSingleDialogAcrossTabs(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	picker := &folderPicker{choose: func(context.Context, string) (string, error) { close(started); <-finish; return "", nil }}
	request := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/projects/pick-directory", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		picker.ServeHTTP(w, req)
		return w
	}
	done := make(chan *httptest.ResponseRecorder)
	go func() { done <- request() }()
	<-started
	if w := request(); w.Code != 409 {
		t.Fatalf("second dialog accepted: %d", w.Code)
	}
	close(finish)
	if w := <-done; w.Code != 200 {
		t.Fatal(w.Code)
	}
	picker.choose = func(context.Context, string) (string, error) { return "", errPickerUnavailable }
	if w := request(); w.Code != 501 {
		t.Fatal(w.Code)
	}
}

func TestNativePickerCommandsKeepPathsOutOfScripts(t *testing.T) {
	root := `/tmp/a 'quote'; $(touch unwanted)`
	lookup := func(name string) (string, error) { return "/usr/bin/" + name, nil }
	for _, platform := range []string{"darwin", "windows", "linux"} {
		cmd, _, err := nativeFolderCommand(context.Background(), platform, root, lookup)
		if err != nil {
			t.Fatal(err)
		}
		if platform == "darwin" {
			if cmd.Args[len(cmd.Args)-1] != root || strings.Contains(cmd.Args[2], root) {
				t.Fatal(cmd.Args)
			}
		} else if platform == "windows" {
			if strings.Contains(strings.Join(cmd.Args, " "), root) {
				t.Fatal("path interpolated into script")
			}
			found := false
			for _, env := range cmd.Env {
				if env == "CODEBERG_PICKER_START="+root {
					found = true
				}
			}
			if !found {
				t.Fatal("missing path environment")
			}
		} else if !strings.Contains(strings.Join(cmd.Args, " "), "--directory") {
			t.Fatal(cmd.Args)
		}
	}
	_, _, err := nativeFolderCommand(context.Background(), "linux", root, func(string) (string, error) { return "", os.ErrNotExist })
	if !errors.Is(err, errPickerUnavailable) {
		t.Fatal(err)
	}
	cmd, _, err := nativeFolderCommand(context.Background(), "linux", root, func(name string) (string, error) {
		if name == "zenity" {
			return "", os.ErrNotExist
		}
		return "/usr/bin/kdialog", nil
	})
	if err != nil || !strings.Contains(strings.Join(cmd.Args, " "), "--getexistingdirectory") {
		t.Fatal(cmd, err)
	}
}

func TestNativePickerDisconnectReleasesDialog(t *testing.T) {
	started := make(chan struct{})
	picker := &folderPicker{choose: func(ctx context.Context, initial string) (string, error) {
		close(started)
		<-ctx.Done()
		return "", ctx.Err()
	}}
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("POST", "/projects/pick-directory", strings.NewReader("{}")).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	done := make(chan struct{})
	go func() { picker.ServeHTTP(httptest.NewRecorder(), req); close(done) }()
	<-started
	cancel()
	<-done
	picker.choose = func(context.Context, string) (string, error) { return "", nil }
	req = httptest.NewRequest("POST", "/projects/pick-directory", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	picker.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("dialog still occupied after disconnect: %d", w.Code)
	}
}
