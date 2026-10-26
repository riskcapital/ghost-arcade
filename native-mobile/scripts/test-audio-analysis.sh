#!/bin/sh
# Builds and runs the audio analysis tests on the Mac (no device or simulator needed):
# the native spectrum must match the web AnalyserNode the visuals were tuned on.
# Usage: native-mobile/scripts/test-audio-analysis.sh [output folder]
set -e
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../ios/App"
out="${1:-${TMPDIR:-/tmp}/ghost-audio-analysis-tests}"
mkdir -p "$out"
swiftc -O -o "$out/audio-analysis-tests" "$app/App/AudioAnalysisCore.swift" "$app/AudioAnalysisTests/main.swift"
"$out/audio-analysis-tests"
