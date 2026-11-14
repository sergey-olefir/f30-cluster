#!/bin/sh
# Bench-only sweep for docs/PERF-AUDIT.md: every cluster layout in demo driving, with the probe preload
# (tools/perf/probe_preload.js) in the app. Needs a bench started with the preload:
#   rm -rf dist bench/.data
#   BENCH_PORT=8100 PERF_DIR=<dir> NODE_OPTIONS="--require $PWD/tools/perf/probe_preload.js" node bench/server.js f30_cluster
# then:  tools/perf/bench_sweep.sh <dir> [port] [layouts...]
# Writes <dir>/<layout>.dump.json (20 s of steady demo driving), <layout>.layers.json, <layout>.textcost.json,
# <layout>.cpuprofile (12 s, after the dump, so the profiler does not count in the CPU %).
# PAGE=on keeps the centre-screen page's loop running (as while the driver looks at our page); default: stopped first.
set -eu
DIR="$1"; PORT="${2:-8100}"; shift; [ $# -gt 0 ] && shift
LAYOUTS="${*:-wb_comfort wb_dials g20_comfort wb_sport wb_sport_dials wb_eco f30}"
B="http://localhost:$PORT"
SEQ=$(date +%s)
ctl() { SEQ=$((SEQ + 1)); printf '{"seq":%s,"cmd":"%s","label":"%s","ms":%s}' "$SEQ" "$1" "$2" "${3:-15000}" > "$DIR/ctl.json"; sleep 0.6; }
post() { curl -s -X POST "$B/$1" -d "$2" > /dev/null; }

post signals '{"mode":"demo"}'
post setting '{"key":"byMode","value":false}'
[ "${PAGE:-off}" = on ] || ctl pagestop x
for L in $LAYOUTS; do
  echo "== $L"
  post setting "{\"key\":\"hudLayout\",\"value\":\"$L\"}"
  sleep 5                                   # the rebuild and its uploads settle
  ctl reset "$L"
  sleep 20                                  # steady demo driving, no profiler (clean CPU %)
  ctl dump "$L"
  ctl layers "$L"
  ctl textcost "$L"
  ctl profile "$L" 12000                    # then a sampled profile on its own
  sleep 13
done
ctl pagecost page 50
echo done
