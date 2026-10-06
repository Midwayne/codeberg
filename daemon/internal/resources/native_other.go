//go:build !darwin && !linux

package resources

import (
	"context"
	"fmt"
	"os"
)

func nativeProcesses(ctx context.Context) ([]ProcessCounter, error) { return psProcesses(ctx) }

func nativeArguments(ctx context.Context, pid int) string { return psArguments(ctx, pid) }

func systemMemory() int64 { return 0 }

func fileAllocation(info os.FileInfo) (int64, string) {
	return info.Size(), fmt.Sprintf("%v", info.Sys())
}

func volume(string) (*Disk, error) { return &Disk{}, nil }
