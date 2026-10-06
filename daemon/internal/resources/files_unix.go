//go:build darwin || linux

package resources

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func fileAllocation(info os.FileInfo) (int64, string) {
	stat := info.Sys().(*syscall.Stat_t)
	return stat.Blocks * 512, fmt.Sprintf("%d:%d", stat.Dev, stat.Ino)
}

func volume(path string) (*Disk, error) {
	if path == "" {
		path = "."
	}

	for {
		var stat syscall.Statfs_t
		err := syscall.Statfs(path, &stat)
		if err == nil {
			return &Disk{TotalBytes: int64(stat.Blocks) * int64(stat.Bsize), AvailableBytes: int64(stat.Bavail) * int64(stat.Bsize)}, nil
		}

		if !errors.Is(err, os.ErrNotExist) || filepath.Dir(path) == path {
			return nil, err
		}

		path = filepath.Dir(path)
	}
}
