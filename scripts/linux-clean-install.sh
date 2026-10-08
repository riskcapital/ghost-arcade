#!/usr/bin/env bash
# Resolve the real deb dependency graph on a clean supported distribution.
# Never install the package on the CI host or developer workstation.
set -euo pipefail
packages=$(cd "${1:-dist-electron}" && pwd)
release=${2:-24.04}
case "$release" in 22.04|24.04) ;; *) echo 'Expected Ubuntu 22.04 or 24.04' >&2; exit 2;; esac
docker run --rm -v "$packages:/packages:ro" "ubuntu:$release" bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends /packages/*.deb python3
  core=$(find /opt -path "*/resources/native-renderer/ghost-render-core" -type f -print -quit)
  test -n "$core" && test -x "$core"
  ldd "$core" > /tmp/core-ldd.txt
  cat /tmp/core-ldd.txt
  if grep -Eq "not found|version .* not found" /tmp/core-ldd.txt; then exit 1; fi
  python3 - <<"PY"
import ctypes
libraries = ["libvulkan.so.1", "libasound.so.2", "libX11.so.6", "libX11-xcb.so.1", "libxcb.so.1", "libXcursor.so.1", "libXrandr.so.2", "libXi.so.6", "libxkbcommon-x11.so.0"]
for library in libraries:
    ctypes.CDLL(library)
    print("PASS clean install loads", library)
PY
'
