#!/bin/sh
# Bench-only A/B of the needle prototype (hud.js PERF, <data>/perf.json): for each layout, 20 s of demo driving
# with the perf log only (today's needles) and 20 s with "needle": "smooth", each with an idle event loop and with
# a busy one (the probe's "load": busy-waits LOAD_MS every 100 ms, a stand-in for the page's software frame on the
# car's CPU). Same bench and preload as bench_sweep.sh; the app's data folder is bench/.data/f30_cluster.
#   tools/perf/needle_test.sh <dir> [port] [layouts...]      then: python3 -I tools/perf/needle.py <dir>/n_*.dump.json
set -eu
DIR="$1"; PORT="${2:-8100}"; shift; [ $# -gt 0 ] && shift
LAYOUTS="${*:-wb_comfort g20_comfort}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HERE/../../bench/.data/f30_cluster"
LOAD_MS="${LOAD_MS:-60}"
B="http://localhost:$PORT"
SEQ=$(date +%s)
ctl() { SEQ=$((SEQ + 1)); printf '{"seq":%s,"cmd":"%s","label":"%s","ms":%s,"every":100}' "$SEQ" "$1" "$2" "${3:-0}" > "$DIR/ctl.json"; sleep 0.6; }
post() { curl -s -X POST "$B/$1" -d "$2" > /dev/null; }
post signals '{"mode":"demo"}'
post setting '{"key":"byMode","value":false}'
ctl pagestop x
for L in $LAYOUTS; do
  post setting "{\"key\":\"hudLayout\",\"value\":\"$L\"}"
  for MODE in base smooth; do
    if [ $MODE = smooth ]; then echo '{ "log": true, "needle": "smooth" }' > "$DATA/perf.json"; else echo '{ "log": true }' > "$DATA/perf.json"; fi
    sleep 12                                  # hud.js reads perf.json every 10 s
    for LOAD in 0 "$LOAD_MS"; do
      echo "== $L $MODE load $LOAD"
      ctl load x "$LOAD"
      ctl reset "n_${L}_${MODE}_load$LOAD"
      sleep 20
      ctl dump "n_${L}_${MODE}_load$LOAD"
    done
    ctl load x 0
  done
done
rm -f "$DATA/perf.json"
echo done
