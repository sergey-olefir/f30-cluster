#!/bin/sh
# Bench-only: what each layout switch costs (docs/PERF-AUDIT.md "Rebuild and switch"): bytes written per
# connection in the 4 s after the switch, the rebuild's JS time, the pixel memory before / at its peak / after.
# Same bench and preload as bench_sweep.sh.   tools/perf/switch_sweep.sh <dir> [port]
set -eu
DIR="$1"; PORT="${2:-8100}"
B="http://localhost:$PORT"
SEQ=$(date +%s)
ctl() { SEQ=$((SEQ + 1)); printf '{"seq":%s,"cmd":"%s","label":"%s"}' "$SEQ" "$1" "$2" > "$DIR/ctl.json"; sleep 0.6; }
post() { curl -s -X POST "$B/$1" -d "$2" > /dev/null; }
post signals '{"mode":"demo"}'
post setting '{"key":"byMode","value":false}'
post setting '{"key":"hudLayout","value":"wb_comfort"}'
sleep 5
PREV=wb_comfort
for L in wb_sport wb_eco wb_comfort wb_dials wb_sport_dials g20_comfort f30 wb_comfort g20_comfort wb_comfort; do
  echo "== $PREV -> $L"
  ctl reset "sw_${PREV}_to_$L"
  post setting "{\"key\":\"hudLayout\",\"value\":\"$L\"}"
  sleep 4
  ctl dump "sw_${PREV}_to_$L"
  PREV=$L
done
echo done
