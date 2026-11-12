#!/bin/sh
# Headless Chrome screenshot of a bench URL at 1920x720 (the panel at 1:1 with ?only=1).
#   tools/g20sim/shot.sh <out.png> '<url>' [budget_ms]
# Runs Chrome in the background with its own profile, waits for the file, then kills only that Chrome.
# G20SIM_PROFILE overrides the profile dir (one per agent: Chrome is killed by matching it).
OUT="$1"; URL="$2"; BUDGET="${3:-20000}"
PROFILE="${G20SIM_PROFILE:-$(cd "$(dirname "$0")/../.." && pwd)/bake/work/g20sim/E/chrome}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$PROFILE"; rm -f "$OUT"
"$CHROME" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget="$BUDGET" \
  --window-size=1920,720 --hide-scrollbars --user-data-dir="$PROFILE" --screenshot="$OUT" "$URL" >/dev/null 2>&1 &
i=0
while [ ! -s "$OUT" ] && [ $i -lt 120 ]; do sleep 1; i=$((i+1)); done
sleep 1
pkill -f "user-data-dir=$PROFILE" 2>/dev/null
[ -s "$OUT" ] && echo "shot $OUT" || { echo "no screenshot: $OUT"; exit 1; }
