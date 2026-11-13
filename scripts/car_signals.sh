#!/usr/bin/env bash
# The car's SOME/IP catalogue, fetched once and ranked for every field this app still needs: the drive mode (today's FES
# field gave nothing on the owner's car), the speed limit (with BMW's "---"), no overtaking, auto start/stop (MSA), the
# local time / time zone, and "a check-control message is showing". It also checks app.json's declared signals against it.
#
# READ ONLY. Over SSH it runs `cat` and `grep` and nothing else: nothing is written to the car, and no process there is
# started, stopped or killed.
#
#   ./scripts/car_signals.sh root@<car>               copy the catalogue (and /etc/localtime), rank, save the report
#   ./scripts/car_signals.sh root@<car> --log         the same, then the app's raw-value log lines (after wiring)
#   ./scripts/car_signals.sh --file <catalogue.json>  a catalogue copied before (no SSH)
#
# Output, all in reference/ (git-ignored: BMW's file and what it says, never commit them):
#   someip-interfaces.json   the catalogue (/etc/oap/someip/someip-interfaces.json on the head unit)
#   car-localtime.tzif       the unit's /etc/localtime (tells whether its system clock is set to UTC)
#   car-signals.txt          the ranked report this prints (send this one back)
#   car-signals.json         every candidate in full
# tools/signals/catalog.py does the ranking (docs/CAR3-I-REPORT.md).
set -euo pipefail

CATALOG_ON_CAR="/etc/oap/someip/someip-interfaces.json"
OAP_ROOT="/var/opt/public/oap"
APP_ID="f30_cluster"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
REF="${CAR_SIGNALS_OUT:-$ROOT/reference}"      # CAR_SIGNALS_OUT: another folder (tests)
OUT="$REF/someip-interfaces.json"
SSH_OPTS=(-o ConnectTimeout=10)      # a key login is quietest; with a password, ssh asks once per call (3 calls)

usage() {
    echo "Usage: $(basename "$0") root@<car> [--log] | --file <someip-interfaces.json>" >&2
    exit 1
}
[ $# -ge 1 ] || usage
mkdir -p "$REF"

TZF=""
if [ "$1" = "--file" ]; then
    [ $# -ge 2 ] || usage
    CAT="$2"; CAR=""; shift 2
    [ -f "$REF/car-localtime.tzif" ] && TZF="$REF/car-localtime.tzif"
else
    CAR="$1"; shift
    echo "Reading $CATALOG_ON_CAR from $CAR (read only: cat) ..."
    ssh "${SSH_OPTS[@]}" "$CAR" "cat '$CATALOG_ON_CAR'" > "$OUT.part"
    python3 -I -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$OUT.part" \
        || { echo "The copy is not valid JSON: $OUT.part" >&2; exit 1; }
    mv "$OUT.part" "$OUT"
    echo "Saved $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes; git-ignored, do not commit)."
    # the unit's time zone file (a small binary TZif; its last line names the zone rule, e.g. UTC0) and, if present, /etc/timezone
    if ssh "${SSH_OPTS[@]}" "$CAR" "cat /etc/localtime" > "$REF/car-localtime.tzif" 2>/dev/null; then TZF="$REF/car-localtime.tzif"; fi
    ssh "${SSH_OPTS[@]}" "$CAR" "cat /etc/timezone 2>/dev/null; grep -s -h -E '^(TZ|ZONE)=' /etc/profile /etc/environment 2>/dev/null" \
        > "$REF/car-timezone.txt" 2>/dev/null || true
    CAT="$OUT"
fi

ARGS=("$CAT" --app "$ROOT/apps/$APP_ID/app.json" --json "$REF/car-signals.json")
[ -n "$TZF" ] && ARGS+=(--localtime "$TZF")
{
    python3 -I "$ROOT/tools/signals/catalog.py" "${ARGS[@]}"
    if [ -s "$REF/car-timezone.txt" ]; then echo; echo "== the unit's /etc/timezone and TZ lines:"; cat "$REF/car-timezone.txt"; fi
} | tee "$REF/car-signals.txt"
echo
echo "Report saved: $REF/car-signals.txt (send it back; it stays out of git)."

if [ -n "$CAR" ] && [ "${1:-}" = "--log" ]; then
    echo
    echo "The app's raw-value log lines (newest last; empty until app.json config names the fields):"
    ssh "${SSH_OPTS[@]}" "$CAR" \
        "grep -h -e 'speed limit raw' -e 'no-passing raw' -e 'msa raw' -e 'clock raw' -e 'check-control raw' -e 'drive mode' -e 'signals de.bmw' -e 'subscribe de.bmw' $OAP_ROOT/oap_*/data/$APP_ID.log 2>/dev/null" \
        | tail -n 60 || true      # tail runs here, not on the car
fi
