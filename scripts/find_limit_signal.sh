#!/usr/bin/env bash
# Find the car's speed-limit / no-overtaking SOME/IP field. READ ONLY: nothing is written to the car and no
# process there is started, stopped or killed. Over SSH it only runs `cat` (the catalogue) and `grep` (the log).
#
#   ./scripts/find_limit_signal.sh root@<car>               copy the catalogue, list the candidates
#   ./scripts/find_limit_signal.sh root@<car> --log         also print the app's "speed limit raw" log lines
#   ./scripts/find_limit_signal.sh --file <catalogue.json>  a catalogue copied before (no SSH)
#
# The catalogue is /etc/oap/someip/someip-interfaces.json on the head unit. Its copy lands in
# reference/someip-interfaces.json (git-ignored: BMW's file, never commit it), where the kit's own
# check_signals.py / sigdoc.py also look. tools/signals/find_limit.py ranks the fields (docs/POLISH-E-REPORT.md).
set -euo pipefail

CATALOG_ON_CAR="/etc/oap/someip/someip-interfaces.json"
OAP_ROOT="/var/opt/public/oap"
APP_ID="f30_cluster"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$ROOT/reference/someip-interfaces.json"

usage() {
    echo "Usage: $(basename "$0") root@<car> [--log] | --file <someip-interfaces.json>" >&2
    exit 1
}
[ $# -ge 1 ] || usage

if [ "$1" = "--file" ]; then
    [ $# -ge 2 ] || usage
    CAT="$2"; CAR=""; shift 2
else
    CAR="$1"; shift
    mkdir -p "$(dirname "$OUT")"
    echo "Reading $CATALOG_ON_CAR from $CAR (read only) ..."
    # cat only; BatchMode: never prompt inside the script
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$CAR" "cat '$CATALOG_ON_CAR'" > "$OUT.part"
    python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$OUT.part" \
        || { echo "The copy is not valid JSON: $OUT.part" >&2; exit 1; }
    mv "$OUT.part" "$OUT"
    echo "Saved $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes; git-ignored, do not commit)."
    CAT="$OUT"
fi

python3 -I "$ROOT/tools/signals/find_limit.py" "$CAT" --json "${CAT%.json}.limit-candidates.json"

if [ -n "$CAR" ] && [ "${1:-}" = "--log" ]; then
    echo
    echo "The app's log lines about the signs (newest last; empty until app.json config.limit names a field):"
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$CAR" \
        "grep -h -e 'speed limit raw' -e 'no-passing raw' $OAP_ROOT/oap_*/data/$APP_ID.log 2>/dev/null | tail -n 40" || true
fi
