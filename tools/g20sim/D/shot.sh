#!/bin/sh
# Package D's headless Chrome helper (own user-data-dir; kills only its own Chrome).
#   shot.sh png  OUT.png  URL      screenshot 1920x720
#   shot.sh dom  OUT.html URL      DOM after the scripts ran (the harness writes its JSON into <pre id=out>)
# Needs the harness server:  python3 -m http.server 8093 --bind 127.0.0.1 --directory <worktree>
WT=/Users/solefir/projects/f30-cluster/.claude/worktrees/agent-abde5d7d15416f564
UD=$WT/bake/work/g20sim/D/chrome
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
kind=$1; out=$2; url=$3; budget=${4:-20000}
rm -f "$out"
mkdir -p "$UD"
if [ "$kind" = png ]; then
  "$CH" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=$budget \
    --window-size=1920,720 --hide-scrollbars --user-data-dir="$UD" --screenshot="$out" "$url" >/dev/null 2>&1 &
else
  "$CH" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=$budget \
    --window-size=1920,720 --hide-scrollbars --user-data-dir="$UD" --dump-dom "$url" > "$out.tmp" 2>/dev/null &
fi
i=0
while [ $i -lt 240 ]; do
  sleep 0.5
  if [ "$kind" = png ] && [ -s "$out" ]; then break; fi
  if [ "$kind" = dom ] && grep -q "</html>" "$out.tmp" 2>/dev/null; then mv "$out.tmp" "$out"; break; fi
  i=$((i+1))
done
sleep 0.3
pkill -f "user-data-dir=$UD" 2>/dev/null
[ -s "$out" ] && echo "ok $out" || echo "FAILED $out"
