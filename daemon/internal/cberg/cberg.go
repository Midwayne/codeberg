package cberg

/*
#cgo CFLAGS: -I${SRCDIR}/../../../core/include
#include <codeberg/codeberg.h>
#include <stdlib.h>
*/
import "C"

import (
	"fmt"
	"unsafe"
)

type Status int

const (
	StatusOK Status = iota
	StatusInvalidArgument
	StatusInternal
	StatusIO
	StatusUnsupportedLanguage
	StatusNotFound
	StatusOutOfMemory
	StatusTimeout
	StatusNotImplemented
)

func (s Status) Error() string {
	return C.GoString(C.cberg_status_str(C.cberg_status(s)))
}

func check(st C.cberg_status) error {
	if st == C.CBERG_OK {
		return nil
	}
	return Status(st)
}

func Version() string {
	return C.GoString(C.cberg_version())
}

func goString(s *C.char) string {
	if s == nil {
		return ""
	}
	return C.GoString(s)
}

func cString(s string) *C.char {
	return C.CString(s)
}

func freeCString(s *C.char) {
	C.free(unsafe.Pointer(s))
}

func Statusf(st C.cberg_status, op string) error {
	if st == C.CBERG_OK {
		return nil
	}
	return fmt.Errorf("%s: %w", op, Status(st))
}
