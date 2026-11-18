#!/bin/sh
# research3 MT: test-scene-tex (this package), the seven f30_cluster suites and the eight twin_dial suites, one at a time on this worktree, on package
# MT's port (8302), each line "<suite> <passed>/<failed> exit <code>". Logs in $1 (default bake/work/research3/MT/suites).
#   sh tools/research3/mt/run_suites.sh [log dir]
cd "$(dirname "$0")/../../.." || exit 2
LOG=${1:-bake/work/research3/MT/suites}
mkdir -p "$LOG"
for t in scene-tex bottom-row native-ui strip-mask fonts probes daynight night twin-bake twin-budget twin-cc twin-fonts twin-layout twin-pages twin-probe twin-sim; do
    BENCH_PORT=8302 node bench/test-$t.js > "$LOG/$t.log" 2>&1
    code=$?
    p=$(grep -c "^ok\|^  ok\|✓\|PASS" "$LOG/$t.log")
    echo "$t exit $code | $(tail -1 "$LOG/$t.log" | cut -c1-150)"
done
