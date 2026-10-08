#!/bin/sh
# Builds and runs the LiDAR scan pipeline tests on the Mac (no device or simulator needed), then
# loads the PLY files they write with the desktop's PLY loader.
# Usage: native-mobile/scripts/test-scan-core.sh [output folder] [path to desktop plyLoader.ts]
set -e
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../ios/App"
out="${1:-${TMPDIR:-/tmp}/ghost-scan-core-tests}"
mkdir -p "$out"
swiftc -O -o "$out/scan-core-tests" "$app/App/ScanCore.swift" "$app/ScanCoreTests/main.swift"
"$out/scan-core-tests" "$out"
node "$here/verify-scan-ply.mjs" "$out" ${2:+"$2"}
