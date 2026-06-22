package cberg

/*
#include <codeberg/codeberg.h>
#include <stdlib.h>
*/
import "C"

import (
	"unsafe"
)

type WatchKind int

const (
	WatchModify WatchKind = 1
	WatchCreate WatchKind = 2
	WatchDelete WatchKind = 3
	WatchRename WatchKind = 4
)

type WatchEvent struct {
	Kind WatchKind
	Path string
}

type Watcher struct {
	w *C.cberg_watcher
}

func OpenWatcher(root string) (*Watcher, error) {
	croot := cString(root)
	defer freeCString(croot)
	var w *C.cberg_watcher
	if err := Statusf(C.cberg_watcher_open(croot, &w), "watcher open"); err != nil {
		return nil, err
	}
	return &Watcher{w: w}, nil
}

func (w *Watcher) Close() {
	if w == nil || w.w == nil {
		return
	}
	C.cberg_watcher_close(w.w)
	w.w = nil
}

func (w *Watcher) Poll(timeoutMs int) ([]WatchEvent, error) {
	const cap = 256
	events := make([]C.cberg_watch_event, cap)
	var count C.size_t
	st := C.cberg_watcher_poll(w.w, &events[0], C.size_t(cap), &count, C.int(timeoutMs))
	if st == C.CBERG_ERR_TIMEOUT {
		return nil, nil
	}
	if err := Statusf(st, "watcher poll"); err != nil {
		return nil, err
	}
	out := make([]WatchEvent, 0, int(count))
	for i := 0; i < int(count); i++ {
		ev := events[i]
		out = append(out, WatchEvent{
			Kind: WatchKind(ev.kind),
			Path: goString(ev.path),
		})
		C.free(unsafe.Pointer(ev.path))
	}
	return out, nil
}

func SkipDir(name string) bool {
	cname := cString(name)
	defer freeCString(cname)
	return C.cberg_watch_skip_dir(cname) != 0
}
