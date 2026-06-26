#!/usr/bin/env sh
# The VERSION file is the single source of truth for the release version. CMake
# reads it when configuring core/ and defines CBERG_VERSION for cberg_version().
#
# Usage:
#   scripts/set-version.sh v0.2.0   # update VERSION
#   scripts/set-version.sh          # re-print the current VERSION
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
old_version=$(cat "$repo_root/VERSION")
version="${1:-$old_version}"

case "$version" in
v[0-9]*.[0-9]*.[0-9]*) ;;
*)
	echo "usage: set-version.sh vMAJOR.MINOR.PATCH (got '$version')" >&2
	exit 1
	;;
esac

printf '%s\n' "$version" >"$repo_root/VERSION"
echo "version set to $version in VERSION (run make build-core to propagate to libcodeberg)"
