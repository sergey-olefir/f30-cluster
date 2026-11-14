#!/bin/sh
# Bench-only: every cluster layout's effect layers timed in WebGL (tools/perf/gpu_time.mjs), in two headless
# Chromes you started yourself with their own profiles: one on the Mac's GPU (ANGLE/Metal, DevTools port
# $METAL, default 9311) and one in SwiftShader (the CPU's software GL: its time follows the shader's arithmetic,
# DevTools port $SWIFT, default 9312). Writes <out>/<layout>.metal.json and <layout>.swift.json.
#   tools/perf/gpu_sweep.sh <out dir> [bench port]
set -eu
OUT="$1"; PORT="${2:-8100}"
METAL="${METAL:-9311}"; SWIFT="${SWIFT:-9312}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
curl -s -X POST "http://localhost:$PORT/setting" -d '{"key":"byMode","value":false}' > /dev/null
for L in wb_comfort wb_dials g20_comfort wb_sport wb_sport_dials wb_eco f30; do
  curl -s -X POST "http://localhost:$PORT/setting" -d "{\"key\":\"hudLayout\",\"value\":\"$L\"}" > /dev/null
  sleep 5
  node "$HERE/gpu_time.mjs" "$METAL" "$PORT" "$OUT/$L.metal.json" "$L" 200
  node "$HERE/gpu_time.mjs" "$SWIFT" "$PORT" "$OUT/$L.swift.json" "$L" 3
done
