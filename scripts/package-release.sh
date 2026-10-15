#!/usr/bin/env bash
# Build machines only: add runtimes to a `make dist` tree and make a release asset.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
dist="${1:-$repo/dist}"
output="${2:-$repo/build/release}"
version=$(tr -d '\n' < "$repo/VERSION")
node_version=v22.23.3
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64) arch=x64 ;;
    *) echo 'Unsupported release architecture' >&2; exit 1 ;;
esac
case "$os-$arch" in
    darwin-arm64|darwin-x64|linux-x64) ;;
    *) echo 'Unsupported release platform' >&2; exit 1 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node_asset="node-$node_version-$os-$arch.tar.gz"
node_url="https://nodejs.org/dist/$node_version"
curl -fSL --retry 3 "$node_url/$node_asset" -o "$work/$node_asset"
curl -fSL --retry 3 "$node_url/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
expected=$(awk -v name="$node_asset" '$2 == name {print $1}' "$work/SHASUMS256.txt")
actual=$(shasum -a 256 "$work/$node_asset" | awk '{print $1}')
[[ -n "$expected" && "$actual" == "$expected" ]] || { echo 'Node checksum mismatch' >&2; exit 1; }
tar -xzf "$work/$node_asset" -C "$work"

mkdir -p "$dist/libexec/runtime/bin" "$dist/licenses" "$output"
cp "$work/node-$node_version-$os-$arch/bin/node" "$dist/libexec/runtime/bin/node"
cp -L "$(command -v rg)" "$dist/libexec/runtime/bin/rg"
cp "$work/node-$node_version-$os-$arch/LICENSE" "$dist/licenses/node.txt"
cp "$repo/LICENSE" "$dist/licenses/codeberg.txt"
if [[ -n "${CODEBERG_ORT_DIR:-}" ]]; then
    cp "$CODEBERG_ORT_DIR/LICENSE" "$dist/licenses/onnxruntime.txt"
    cp "$CODEBERG_ORT_DIR/ThirdPartyNotices.txt" "$dist/licenses/onnxruntime-third-party.txt"
fi
python3 - "$repo" "$dist/licenses" <<'PYLICENSE'
from pathlib import Path
import shutil
import sys
source = Path(sys.argv[1]) / "core/third_party"
for path in source.rglob("*"):
    if path.is_file() and path.name.upper().startswith(("LICENSE", "COPYING", "NOTICE")):
        destination = Path(sys.argv[2]) / "core" / path.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
PYLICENSE
if [[ "$os" == darwin ]]; then
    cp "$(brew --prefix ripgrep)/COPYING" "$dist/licenses/ripgrep.txt"
else
    cp /usr/share/doc/ripgrep/copyright "$dist/licenses/ripgrep.txt"
fi

python3 "$repo/scripts/bundle-libraries.py" "$dist"
asset="codeberg-$version-$os-$arch.tar.gz"
tar -czf "$output/$asset" -C "$dist" .
(cd "$output" && shasum -a 256 "$asset" > "$asset.sha256")
printf '✓ release asset: %s/%s\n' "$output" "$asset"
