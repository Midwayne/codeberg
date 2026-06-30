#!/usr/bin/env sh
# Fetches or syncs repositories listed in a config file.
#
# Config format: one repo per line. Blank lines and lines beginning with # are
# ignored. Each line may be either a repo name or "name url". If a URL is not
# given, missing repos can only be cloned when --origin/CBERG_REPOS_ORIGIN is set.
#
# Usage:
#   scripts/sync-repos.sh [-c repos.txt] [-d dest_dir] [--origin git@github.com:org]
#
# Examples:
#   scripts/sync-repos.sh
#   scripts/sync-repos.sh -c repos.txt -d ~/src --origin git@github.com:my-org
#   scripts/sync-repos.sh -c repos.txt -d ~/src --origin https://github.com/my-org
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config="$repo_root/repos.txt"
dest_dir="${CBERG_REPOS_DIR:-$repo_root/repos}"
origin_base="${CBERG_REPOS_ORIGIN:-}"
usage() {
	cat >&2 <<EOF
Usage: scripts/sync-repos.sh [-c config] [-d dest_dir] [--origin origin_base]

Clones missing repos, or pulls existing repos from origin with --ff-only.
Missing repos need either a URL in the config file or --origin/CBERG_REPOS_ORIGIN.

Config format:
  # comments and blank lines are ignored
  repo-name
  other-repo https://github.com/example/other-repo.git

Environment:
  CBERG_REPOS_DIR     destination directory (default: ./repos)
  CBERG_REPOS_ORIGIN  origin base for repo-name entries, e.g. git@github.com:org
EOF
}

origin_url_for() {
	name=$1
	case "$origin_base" in
	"") return 1 ;;
	*.git) printf '%s\n' "$origin_base" ;;
	*:*) printf '%s/%s.git\n' "$origin_base" "$name" ;;
	*) printf '%s/%s.git\n' "${origin_base%/}" "$name" ;;
	esac
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	-c|--config)
		[ "$#" -ge 2 ] || { usage; exit 2; }
		config=$2
		shift 2
		;;
	-d|--dest)
		[ "$#" -ge 2 ] || { usage; exit 2; }
		dest_dir=$2
		shift 2
		;;
	--origin)
		[ "$#" -ge 2 ] || { usage; exit 2; }
		origin_base=$2
		shift 2
		;;
	-h|--help)
		usage
		exit 0
		;;
	*)
		usage
		exit 2
		;;
	esac
done

[ -f "$config" ] || { echo "config not found: $config" >&2; exit 1; }

mkdir -p "$dest_dir"

while IFS= read -r line || [ -n "$line" ]; do
	# Strip leading/trailing spaces and inline comments.
	line=$(printf '%s\n' "$line" | sed 's/[[:space:]]*#.*$//; s/^[[:space:]]*//; s/[[:space:]]*$//')
	[ -n "$line" ] || continue

	set -- $line
	name=$1
	url=${2:-}
	path="$dest_dir/$name"

	if [ -d "$path/.git" ]; then
		echo "Pulling $name from origin"
		git -C "$path" fetch --prune origin
		git -C "$path" pull --ff-only origin
		continue
	fi

	if [ -d "$path" ]; then
		echo "Skipping $name: $path exists but is not a git repo" >&2
		continue
	fi

	if [ -z "$url" ]; then
		if url=$(origin_url_for "$name"); then
			:
		else
			echo "Skipping $name: missing clone URL and no --origin provided" >&2
			continue
		fi
	fi

	echo "Cloning $name from $url"
	git clone "$url" "$path"
done < "$config"
