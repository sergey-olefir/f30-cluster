#!/usr/bin/env bash
# The car side of the performance audit (docs/PERF-AUDIT.md): what the head unit's CPU, our app and cluster-render
# do while the theme shows, measured on the car, so the bench numbers can be scaled to it.
#
# READ ONLY. Over ONE ssh session it runs only cat, grep, tr, cut, head, tail, top -b -n 1 and sleep: it reads /proc,
# /sys/fs/cgroup, the app's log and cluster-render's status file and log. Nothing is written on the car, and no
# process is started, stopped, restarted or killed. (The opt-in perf log is a separate step the owner takes by
# hand; see docs/PERF-AUDIT.md "Car measurement kit".)
#
#   ./scripts/perf_probe.sh root@<car> [seconds]     sample for <seconds> (default 30) while driving or idling
#
# Run it twice if you can: once with our page closed on the centre screen, once with it open. Output:
#   reference/perf/probe-<date>.raw.txt   everything the car printed (git-ignored, like all of reference/)
#   reference/perf/probe-<date>.txt       the summary this prints (send this one back)
set -euo pipefail

APP_ID="f30_cluster"
OAP_ROOT="/var/opt/public/oap"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
OUTDIR="${PERF_PROBE_OUT:-$ROOT/reference/perf}"
SSH_OPTS=(-o ConnectTimeout=10)

[ $# -ge 1 ] || { echo "Usage: $(basename "$0") root@<car> [seconds]" >&2; exit 1; }
CAR="$1"; SECS="${2:-30}"
case "$SECS" in ''|*[!0-9]*) echo "seconds must be a whole number" >&2; exit 1 ;; esac
mkdir -p "$OUTDIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
RAW="$OUTDIR/probe-$STAMP.raw.txt"; SUM="$OUTDIR/probe-$STAMP.txt"

echo "Sampling $CAR for $SECS s (read only) ..."
# The remote part, fed to the unit's sh on stdin: plain POSIX sh, read-only commands only. Every section starts "### name".
ssh "${SSH_OPTS[@]}" "$CAR" "sh -s -- '$APP_ID' '$OAP_ROOT' '$SECS'" > "$RAW" <<'EOS'
APP_ID="$1"; OAP_ROOT="$2"; SECS="$3"
echo "### uname"; cat /proc/version 2>/dev/null
echo "### cpuinfo"; grep -E '^(model name|processor|cpu MHz|Hardware|CPU part|CPU implementer|BogoMIPS)' /proc/cpuinfo 2>/dev/null
echo "### meminfo"; grep -E '^(MemTotal|MemFree|MemAvailable)' /proc/meminfo 2>/dev/null
echo "### loadavg"; cat /proc/loadavg
# our app: the node process whose command line names its OAP folder (the folder whose data/ holds <id>.log)
APPDIR=""
for d in "$OAP_ROOT"/oap_*; do [ -f "$d/data/$APP_ID.log" ] && APPDIR="$d"; done
echo "### appdir"; echo "$APPDIR"
APPPID=""; CRPID=""; RDPID=""
for p in /proc/[0-9]*; do
  pid="${p#/proc/}"
  cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null) || continue
  case "$cmd" in
    *"$APPDIR"*node*|*node*"$APPDIR"*) [ -n "$APPDIR" ] && APPPID="$APPPID $pid" ;;
  esac
  comm=$(cat "$p/comm" 2>/dev/null) || continue
  [ "$comm" = "cluster-render" ] && CRPID="$CRPID $pid"
  case "$comm" in mgu-renderd*|renderd*) RDPID="$RDPID $pid" ;; esac
done
echo "### pids"; echo "app:$APPPID"; echo "cluster-render:$CRPID"; echo "renderd:$RDPID"
for pid in $APPPID $CRPID; do
  echo "### cmdline $pid"; tr '\0' ' ' < /proc/$pid/cmdline; echo
  echo "### status $pid"; grep -E '^(Name|State|Threads|VmRSS|VmHWM|voluntary_ctxt_switches|nonvoluntary_ctxt_switches|Cpus_allowed_list)' /proc/$pid/status
  echo "### cgroup $pid"; cat /proc/$pid/cgroup
  echo "### sched $pid"; grep -E '^(se.sum_exec_runtime|nr_switches|nr_involuntary_switches|prio|policy)' /proc/$pid/sched 2>/dev/null
done
# the cpu cgroup of the app (v1 cpu / cpu,cpuacct, or v2): quota, period, shares and throttling, before and after
CG=""
for pid in $APPPID; do
  CG=$(grep -E ':(cpu,cpuacct|cpuacct,cpu|cpu):' /proc/$pid/cgroup 2>/dev/null | head -n 1 | cut -d: -f3)
  [ -z "$CG" ] && CG=$(grep -E '^0::' /proc/$pid/cgroup 2>/dev/null | head -n 1 | cut -d: -f3)
  break
done
CGDIR=""
for base in /sys/fs/cgroup/cpu,cpuacct /sys/fs/cgroup/cpu /sys/fs/cgroup; do
  [ -n "$CG" ] && [ -d "$base$CG" ] && { CGDIR="$base$CG"; break; }
done
echo "### cgdir"; echo "$CGDIR"
cgread() { for f in cpu.cfs_quota_us cpu.cfs_period_us cpu.shares cpu.max cpu.weight cpu.stat cpuacct.usage; do [ -r "$CGDIR/$f" ] && echo "$f: $(tr '\n' ' ' < "$CGDIR/$f")"; done; }
sample() {
  echo "### sample $1"; cat /proc/uptime; grep '^cpu ' /proc/stat
  for pid in $APPPID $CRPID; do echo "pid $pid $(cat /proc/$pid/stat 2>/dev/null)"; done
  [ -n "$CGDIR" ] && cgread
}
sample A
echo "### top"; top -b -n 1 2>/dev/null | head -n 30
sleep "$SECS"
sample B
echo "### applog"
if [ -n "$APPDIR" ]; then
  tail -n 4000 "$APPDIR/data/$APP_ID.log" | grep -E 'perf:|loop MAIN|layout "|app started|cluster-render (ready|status)|budget|WARN|ERROR|uncaught' | tail -n 120
fi
echo "### crstatus"; cat /run/cluster-render/status.txt 2>/dev/null
echo "### crlog"; tail -n 3000 /var/opt/cluster-render/log/cluster-render.log 2>/dev/null | grep -E 'in the last|slow|flush|budget|cap |refused|too many|pixel memory|evidence|Periodic|fps|FPS|renderer console' | tail -n 80
echo "### end"
EOS
echo "Raw output: $RAW"
python3 -I "$ROOT/tools/perf/probe_report.py" "$RAW" "$SECS" | tee "$SUM"
echo
echo "Summary saved: $SUM (send it back; reference/ stays out of git)."
