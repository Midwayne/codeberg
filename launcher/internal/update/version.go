package update

import (
	"strconv"
	"strings"
)

// Only stable MAJOR.MINOR.PATCH versions participate; development builds and
// prereleases cannot be ordered reliably against the installer's latest release.
func stableVersion(raw string) ([3]uint64, bool) {
	var version [3]uint64
	parts := strings.Split(strings.TrimPrefix(raw, "v"), ".")
	if len(parts) != len(version) {
		return version, false
	}

	for i, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return version, false
		}
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				return version, false
			}
		}

		value, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return version, false
		}
		version[i] = value
	}

	return version, true
}

func newerStableVersion(current, latest string) bool {
	installed, currentOK := stableVersion(current)
	released, latestOK := stableVersion(latest)
	if !currentOK || !latestOK {
		return false
	}

	for i := range installed {
		if released[i] != installed[i] {
			return released[i] > installed[i]
		}
	}

	return false
}
