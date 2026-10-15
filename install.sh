#!/bin/sh
# Install a verified prebuilt release; no checkout, compiler, or sudo required.
set -eu

fail() { printf 'codeberg install: %s\n' "$*" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
case "$os/$arch" in
    Darwin/arm64) platform=darwin-arm64 ;;
    Darwin/x86_64) platform=darwin-x64 ;;
    Linux/x86_64) platform=linux-x64 ;;
    *) fail "unsupported platform: $os/$arch (macOS or Linux x64 required)" ;;
esac

for tool in curl tar awk mktemp; do
    command -v "$tool" >/dev/null 2>&1 || fail "missing required utility: $tool"
done
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    fail 'sha256sum or shasum is required to verify downloads'
fi

base=https://github.com/Midwayne/codeberg/releases
version=${CODEBERG_VERSION:-}
prefix=${CODEBERG_INSTALL_DIR:-$HOME/.local/share/codeberg}
bindir=${CODEBERG_BIN_DIR:-$HOME/.local/bin}
case "$prefix" in /*) ;; *) fail 'CODEBERG_INSTALL_DIR must be absolute' ;; esac
case "$bindir" in /*) ;; *) fail 'CODEBERG_BIN_DIR must be absolute' ;; esac

work=$(mktemp -d)
stage=
link=
cleanup() {
    rm -rf "$work"
    [ -z "$stage" ] || rm -rf "$stage"
    [ -z "$link" ] || rm -f "$link"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fetch() {
    curl --fail --silent --show-error --location --retry 3 \
        --proto '=https' --tlsv1.2 "$1" -o "$2" || fail "download failed: $1"
}

if [ -z "$version" ]; then
    # Resolve the redirect once, then pin both downloads to that exact release.
    url=$(curl --fail --silent --show-error --location --retry 3 \
        --proto '=https' --tlsv1.2 --output /dev/null --write-out '%{url_effective}' "$base/latest") \
        || fail 'cannot find latest release; has a release been published?'
    version=${url##*/}
fi
case "$version" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "invalid release version: $version (expected vMAJOR.MINOR.PATCH)" ;;
esac
case "$version" in *[!a-zA-Z0-9._-]*) fail 'invalid characters in release version' ;; esac

asset="codeberg-$version-$platform.tar.gz"
printf '› downloading Codeberg %s (%s)…\n' "$version" "$platform"
fetch "$base/download/$version/$asset" "$work/$asset"
fetch "$base/download/$version/SHA256SUMS" "$work/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name {print $1; count++} END {if (count != 1) exit 1}' "$work/SHA256SUMS") \
    || fail "checksum missing or duplicated for $asset"
actual=$(checksum "$work/$asset")
[ "$actual" = "$expected" ] || fail "checksum mismatch for $asset; existing installation kept"

# Extract into a fresh sibling directory; update the command only after validation.
mkdir -p "$prefix/releases" "$bindir"
[ ! -d "$bindir/codeberg" ] || fail "$bindir/codeberg is a directory"
[ ! -e "$bindir/codeberg" ] || [ -L "$bindir/codeberg" ] \
    || fail "$bindir/codeberg is an existing regular file; choose CODEBERG_BIN_DIR"
stage=$(mktemp -d "$prefix/releases/.install.XXXXXX")
tar -xzf "$work/$asset" -C "$stage"
for file in bin/codeberg libexec/core/build/bin/codeberg-d libexec/core/build/bin/cberg-index \
    libexec/runtime/bin/node libexec/runtime/bin/rg; do
    [ -x "$stage/$file" ] || fail "incomplete release: missing executable $file"
done
for file in libexec/agent/dist/web.js libexec/agent/web-ui/dist/index.html; do
    [ -f "$stage/$file" ] || fail "incomplete release: missing $file"
done
"$stage/bin/codeberg" version || fail 'release cannot run on this system'

release="$prefix/releases/$version-$platform-${stage##*.}"
mv "$stage" "$release"
stage=
link=$(mktemp "$bindir/.codeberg.XXXXXX")
rm -f "$link"
ln -s "$release/bin/codeberg" "$link"
mv -f "$link" "$bindir/codeberg"
link=

printf '✓ installed %s\n' "$bindir/codeberg"
case ":$PATH:" in
    *":$bindir:"*) printf 'Run: codeberg\n' ;;
    *) printf 'Add this directory to PATH, then run codeberg:\n  export PATH="%s:$PATH"\n' "$bindir" ;;
esac
printf 'Start without embedding downloads: codeberg --no-vector\n'
printf 'Re-run this installer to upgrade. Configuration and models are kept.\n'
