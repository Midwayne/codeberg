package resources

import (
	"context"
	"encoding/binary"
	"syscall"
)

// Keep the daemon pure Go: macOS process counters come from one bounded ps call.
func nativeProcesses(ctx context.Context) ([]ProcessCounter, error) { return psProcesses(ctx) }
func nativeArguments(ctx context.Context, pid int) string           { return psArguments(ctx, pid) }
func systemMemory() int64 {
	// Sysctl's string helper trims a terminal zero byte; padding reconstructs the
	// uint64 value on supported little-endian macOS amd64/arm64 machines.
	raw, err := syscall.Sysctl("hw.memsize")
	if err != nil || len(raw) > 8 {
		return 0
	}
	var data [8]byte
	copy(data[:], raw)
	return int64(binary.LittleEndian.Uint64(data[:]))
}
