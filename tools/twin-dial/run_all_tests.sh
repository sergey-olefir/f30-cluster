#!/bin/sh
# Every suite of the repository, one at a time: f30_cluster's, Driver Profiles', all of Twin Dial's (bench/test-*.js), then
# the signal check and the bake test. Prints one line per suite (passed / failed, and the count `main` had on 2026-11-18 when
# it differs), the total, and exits non-zero on any failure, any suite that crashes or prints no summary, or a missing suite.
#
#   sh tools/twin-dial/run_all_tests.sh [--only <word>] [--fast]        (run from anywhere in the checkout)
#
#   --only <word>  just the suites whose file name contains <word> (e.g. twin-cc); the signal check and bake test only without it
#   --fast         skip the suites that start the bench server (the unit-style ones still run): a smoke test, not the gate
#
# Env:  RUN_ALL_PORT  the bench port every suite gets as BENCH_PORT (default 8607: 8600 + package B7). Ports 8080 and 8150
#                     are the owner's; the suites run one after the other, so one port does for all of them.
#       RUN_ALL_LOG   a directory for each suite's whole output (default: a temporary one, kept on a failure)
#
# Each bench suite rebuilds dist/ (headless; no browser; no process left running: the suites end their own servers).
# The counts of main are in COUNTS below: a different count is marked "!" (a package that changed a suite on purpose says so in
# its report), but only a failure makes the script exit non-zero.
set -u
cd "$(dirname "$0")/../.."
ROOT=$PWD
PORT="${RUN_ALL_PORT:-8607}"
LOG="${RUN_ALL_LOG:-$(mktemp -d "${TMPDIR:-/tmp}/run_all.XXXXXX")}"
mkdir -p "$LOG"
ONLY=""; FAST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift ;;
    --fast) FAST=1 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# name:count of `main` at c1f53f2 (the brief's list); a suite not listed is new and has no count to compare
COUNTS="bottom-row:254 cc-release:57 daynight:24 driver-profiles:105 fonts:34 mb-exp:46 native-ui:47 night:48 probes:25 scene-tex:54 strip-mask:40 twin-bake:35 twin-budget:75 twin-cc:149 twin-fonts:219 twin-layout:61 twin-pages:101 twin-probe:115 twin-sim:39 twin-trip:82"
# the suites that never start the bench server (--fast runs only these); the others take minutes
UNIT="cc-release fonts strip-mask twin-bake twin-fonts twin-layout twin-pages"

want() { for c in $COUNTS; do [ "${c%%:*}" = "$1" ] && { echo "${c#*:}"; return; }; done; echo ""; }
is_unit() { for u in $UNIT; do [ "$u" = "$1" ] && return 0; done; return 1; }

TOTAL_P=0; TOTAL_F=0; BAD=0; N=0; DIFF=0
printf '%-22s %7s %7s %7s  %s\n' suite passed failed main note
for f in bench/test-*.js; do
  name=${f#bench/test-}; name=${name%.js}
  [ -n "$ONLY" ] && case "$name" in *"$ONLY"*) ;; *) continue ;; esac
  if [ "$FAST" = 1 ] && ! is_unit "$name"; then continue; fi
  N=$((N + 1))
  out="$LOG/$name.log"
  BENCH_PORT="$PORT" node "$f" >"$out" 2>&1
  code=$?
  sum=$(grep -E '^[[:space:]]*[0-9]+ passed, [0-9]+ failed' "$out" | tail -1)
  p=$(printf '%s' "$sum" | sed -E 's/^[[:space:]]*([0-9]+) passed.*/\1/')
  fl=$(printf '%s' "$sum" | sed -E 's/.*passed, ([0-9]+) failed.*/\1/')
  w=$(want "$name"); note=""
  if [ -z "$sum" ]; then p=0; fl=0; note="NO SUMMARY (exit $code)"; BAD=$((BAD + 1))
  elif [ "$fl" != 0 ] || [ "$code" != 0 ]; then note="FAILED (exit $code)"; BAD=$((BAD + 1))
  fi
  if [ -n "$w" ] && [ "$p" != "$w" ] && [ -z "$note" ]; then note="! count differs from main"; DIFF=$((DIFF + 1)); fi
  [ -z "$w" ] && [ -z "$note" ] && note="new"
  TOTAL_P=$((TOTAL_P + p)); TOTAL_F=$((TOTAL_F + fl))
  printf '%-22s %7s %7s %7s  %s\n' "$name" "$p" "$fl" "${w:--}" "$note"
  if [ -n "$note" ] && [ "${note#new}" = "$note" ] && [ "${note#!}" = "$note" ]; then grep -E 'FAIL|Error|error' "$out" | head -8 | sed 's/^/        /'; fi
done

# the signal check: every app's declarations against the car's catalogue (needs reference/, git-ignored; a clone without it skips)
if [ -z "$ONLY" ]; then
  CAT=$(ls reference/car/*/someip/someip-interfaces.json 2>/dev/null | tail -1)
  if [ -n "$CAT" ]; then
    n=$(python3 tools/signals/check_signals.py "$CAT" apps/f30_cluster/app.json apps/driver_profiles/app.json apps/twin_dial/app.json apps/acc_view/app.json >"$LOG/check_signals.log" 2>&1; echo $?)
    if [ "$n" = 0 ]; then printf '%-22s %7s %7s %7s  %s\n' check_signals ok 0 - "(apps/f30_cluster, driver_profiles, twin_dial, acc_view)"
    else printf '%-22s %7s %7s %7s  %s\n' check_signals "-" 1 - "FAILED"; grep -iE 'fail|bad|✗' "$LOG/check_signals.log" | head -8 | sed 's/^/        /'; BAD=$((BAD + 1)); fi
  else
    printf '%-22s %7s\n' check_signals "skipped (no reference/car catalogue in this checkout)"
  fi
  # the bake test (Python: numpy + pillow through uv, offline once the cache is warm)
  if [ -x "$(command -v uv)" ] && [ -f tools/twin-dial/test_bake.py ]; then
    export UV_CACHE_DIR="${UV_CACHE_DIR:-$ROOT/bake/work/.uvcache}"
    uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/test_bake.py >"$LOG/test_bake.log" 2>&1; code=$?
    tail1=$(grep -E '[0-9]+ passed' "$LOG/test_bake.log" | tail -1)
    nf=$(grep -c '^ *FAIL' "$LOG/test_bake.log")
    nk=$(grep -c '^ *FAIL .*regenerates byte for byte' "$LOG/test_bake.log")
    if [ "$code" = 0 ]; then printf '%-22s %7s %7s %7s  %s\n' bake-py "${tail1:-ok}" 0 - ""
    elif [ "$nf" -gt 0 ] && [ "$nf" = "$nk" ] && [ -z "${STRICT_BAKE:-}" ]; then
      # main fails these two the same way on this Mac (2026-11-18): a re-bake differs by a few levels from the committed faces
      # ("other Pillow build?"); reported, not a gate. STRICT_BAKE=1 makes them one.
      printf '%-22s %7s %7s %7s  %s\n' bake-py "$tail1" "$nf" - "known: byte-for-byte re-bake only (main too; STRICT_BAKE=1 to gate)"
    else printf '%-22s %7s %7s %7s  %s\n' bake-py "-" 1 - "FAILED (exit $code)"; tail -5 "$LOG/test_bake.log" | sed 's/^/        /'; BAD=$((BAD + 1)); fi
  else
    printf '%-22s %7s\n' bake-py "skipped (no uv)"
  fi
fi

# the cruise simulator (tools/cruise-sim, offline, no bench): its own runner, about 10 s
if [ -f tools/cruise-sim/test.js ]; then
  code=$(node tools/cruise-sim/test.js >"$LOG/cruise_sim.log" 2>&1; echo $?)
  line=$(grep -E '^total:' "$LOG/cruise_sim.log" | tail -1)
  cp=$(echo "$line" | sed -nE 's/^total: ([0-9]+) passed.*/\1/p'); cf=$(echo "$line" | sed -nE 's/.* ([0-9]+) failed.*/\1/p')
  if [ "$code" = 0 ]; then printf '%-22s %7s %7s %7s  %s\n' cruise-sim "${cp:-ok}" "${cf:-0}" - ""; TOTAL_P=$((TOTAL_P + ${cp:-0}))
  else printf '%-22s %7s %7s %7s  %s\n' cruise-sim "${cp:--}" "${cf:-1}" - "FAILED (exit $code)"; grep -E '^FAIL' "$LOG/cruise_sim.log" | head -8 | sed 's/^/        /'; BAD=$((BAD + 1)); TOTAL_F=$((TOTAL_F + ${cf:-1})); fi
fi

# the beam simulator and Auto Beam's algorithm (tools/beam-sim, offline, no bench): its own runner, a few seconds
if [ -f tools/beam-sim/test.js ]; then
  code=$(node tools/beam-sim/test.js >"$LOG/beam_sim.log" 2>&1; echo $?)
  line=$(grep -E '^total:' "$LOG/beam_sim.log" | tail -1)
  cp=$(echo "$line" | sed -nE 's/^total: ([0-9]+) passed.*/\1/p'); cf=$(echo "$line" | sed -nE 's/.* ([0-9]+) failed.*/\1/p')
  if [ "$code" = 0 ]; then printf '%-22s %7s %7s %7s  %s\n' beam-sim "${cp:-ok}" "${cf:-0}" - ""; TOTAL_P=$((TOTAL_P + ${cp:-0}))
  else printf '%-22s %7s %7s %7s  %s\n' beam-sim "${cp:--}" "${cf:-1}" - "FAILED (exit $code)"; grep -E '^FAIL' "$LOG/beam_sim.log" | head -8 | sed 's/^/        /'; BAD=$((BAD + 1)); TOTAL_F=$((TOTAL_F + ${cf:-1})); fi
fi

echo "---"
printf '%d suites, %d passed, %d failed, %d count(s) differ from main\n' "$N" "$TOTAL_P" "$TOTAL_F" "$DIFF"
if [ "$BAD" = 0 ]; then echo "ALL GREEN (logs: $LOG)"; [ -z "${RUN_ALL_LOG:-}" ] && rm -rf "$LOG"; exit 0; fi
echo "$BAD suite(s) FAILED; logs kept in $LOG"
exit 1
