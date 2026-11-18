#!/usr/bin/env bash
# Read-only collector for the car session (package CL).  Run ONLY by the lead, with the owner's word, on a car that is online.
#
#   tools/car/collect.sh <car-address> [--user root] [--label N] [--date YYYY-MM-DD] [--out DIR]
#                        [--apps f30_cluster,twin_dial,signal_probe,car_vitals] [--all-apps]
#                        [--since "1 day ago"] [--max-bytes 3000000] [--ssh-opt OPT]... [--dry-run]
#
# What it does: copies ONLY the apps' log files, their settings.json (and package.json for name / version / uid), cluster-render's
# log, journal, status text and version, into a NEW dated folder under reference/car/ (git-ignored) in this repository.
# What it never does: restart, write, kill, install, change a setting.  Every remote command is a read (cat, ls, tail -c, stat,
# date, journalctl with read options) and passes through `rd`, which REFUSES any command that is not on its list or that contains a
# shell metacharacter; each command is printed BEFORE it runs.  --dry-run prints them all and runs none.
# After the copy it runs the privacy scan (local): anything flagged is listed and a redacted copy is made under <folder>/redacted/.
set -u

die() { echo "collect.sh: $*" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

[ $# -ge 1 ] || { sed -n '2,16p' "$0"; exit 2; }
ADDR="$1"; shift
USER_="root"; LABEL=""; DATE_="$(date -u +%Y-%m-%d)"; OUT=""; APPS="f30_cluster,twin_dial,signal_probe,car_vitals"; ALL=0
SINCE="1 day ago"; MAXB=3000000; DRY=0; SSH_OPTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user) USER_="$2"; shift 2;;
    --label) LABEL="$2"; shift 2;;
    --date) DATE_="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --apps) APPS="$2"; shift 2;;
    --all-apps) ALL=1; shift;;
    --since) SINCE="$2"; shift 2;;
    --max-bytes) MAXB="$2"; shift 2;;
    --ssh-opt) SSH_OPTS="$SSH_OPTS $2"; shift 2;;
    --dry-run) DRY=1; shift;;
    *) die "unknown option $1";;
  esac
done
case "$ADDR" in *[!A-Za-z0-9._:-]*) die "the address has characters an address does not have";; esac
case "$DATE_" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) die "--date must be YYYY-MM-DD";; esac
case "$MAXB" in *[!0-9]*|"") die "--max-bytes must be a number";; esac

SUFFIX=""; [ -n "$LABEL" ] && SUFFIX="-collect$LABEL"
[ -z "$OUT" ] && OUT="$REPO/reference/car/$DATE_$SUFFIX"
n=1; BASE="$OUT"
while [ -e "$OUT" ] && [ "$DRY" = 0 ]; do n=$((n+1)); OUT="$BASE-$n"; done

# ---- the one door to the car ---------------------------------------------------------------------------------------------
# allowed: cat <path> | ls [-l|-ld|-1] <path>... | stat <path> | tail -c N <path> | date -u +FORMAT | uname -a | journalctl -u cluster-render ...
RD_OK='^(cat /(var|run|etc|proc)/[A-Za-z0-9_./*-]+|ls (-l |-ld |-1 |-l1 )?/(var|run)/[A-Za-z0-9_./*-]+|stat /(var|run)/[A-Za-z0-9_./*-]+|tail -c [0-9]+ /(var|run)/[A-Za-z0-9_./*-]+|date -u \+[A-Za-z0-9%:_-]+|uname -a|journalctl -u cluster-render --no-pager -o short-iso-precise --since "[A-Za-z0-9 :-]+")$'
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new$SSH_OPTS $USER_@$ADDR"
NCMD=0
rd() {                       # rd <dest-file-or--> <command...>
  local dest="$1"; shift
  local cmd="$*"
  case "$cmd" in *';'*|*'|'*|*'&'*|*'>'*|*'<'*|*'`'*|*'$('*|*'\'*) die "refused (shell metacharacter): $cmd";; esac
  echo "$cmd" | grep -Eq "$RD_OK" || die "refused (not a plain read): $cmd"
  NCMD=$((NCMD+1))
  echo "+ $SSH '$cmd'${dest:+  > ${dest#$OUT/}}" >&2
  [ "$DRY" = 1 ] && return 0
  if [ "$dest" = "-" ]; then $SSH "$cmd" 2>/dev/null; else mkdir -p "$(dirname "$dest")"; $SSH "$cmd" > "$dest" 2>"$dest.err"; rc=$?; [ -s "$dest.err" ] || rm -f "$dest.err"; [ $rc = 0 ] || echo "  (exit $rc - the file may be missing on the car)" >&2; fi
}

echo "collect.sh: car $USER_@$ADDR, into ${OUT#$REPO/}  ($([ "$DRY" = 1 ] && echo DRY RUN || echo reads only))" >&2
[ "$DRY" = 1 ] || mkdir -p "$OUT/system" "$OUT/cluster-render" "$OUT/apps"

# ---- 0. the car's clock, to place the logs in time -----------------------------------------------------------------------
rd "$OUT/system/date.txt" date -u +%Y-%m-%dT%H:%M:%SZ
rd "$OUT/system/uname.txt" uname -a

# ---- 1. which apps are installed, their uids and versions ----------------------------------------------------------------
rd "$OUT/system/oap-dirs.txt" ls -1 /var/opt/public/oap/
if [ "$DRY" = 1 ]; then
  UIDS="<uid of each oap_<uid> directory>"
  echo "  (per uid: ls -1 /var/opt/public/oap/oap_<uid>/data/ ; cat .../source/package.json ; then, for each selected app, tail -c $MAXB of its .log and .log.1, cat settings.json)" >&2
else
  UIDS="$(grep -E '^oap_[0-9]+$' "$OUT/system/oap-dirs.txt" | sed 's/^oap_//')"
fi
for u in $UIDS; do
  [ "$DRY" = 1 ] && break
  rd "$OUT/by-uid/$u/package.json" cat "/var/opt/public/oap/oap_$u/source/package.json"
done

# ---- 2. the apps' logs and settings ---------------------------------------------------------------------------------------
want_app() { [ "$ALL" = 1 ] && return 0; case ",$APPS," in *",$1,"*) return 0;; esac; return 1; }
if [ "$DRY" = 1 ]; then
  for a in $(echo "$APPS" | tr ',' ' '); do
    for s in .log .log.1; do echo "+ $SSH 'tail -c $MAXB /var/opt/public/oap/oap_<uid of $a>/data/$a$s'  > apps/$a/$a$s" >&2; done
    echo "+ $SSH 'cat /var/opt/public/oap/oap_<uid of $a>/data/settings.json'  > apps/$a/settings.json" >&2
  done
else
  for u in $UIDS; do
    pj="$OUT/by-uid/$u/package.json"; [ -s "$pj" ] || continue
    name="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("name",""))' "$pj" 2>/dev/null)"
    case "$name" in ""|*[!A-Za-z0-9_-]*) continue;; esac
    want_app "$name" || continue
    mkdir -p "$OUT/apps/$name"
    cp "$pj" "$OUT/apps/$name/package.json"
    rd "$OUT/apps/$name/data-ls.txt" ls -l "/var/opt/public/oap/oap_$u/data/"
    for s in .log .log.1; do
      rd "$OUT/apps/$name/$name$s" tail -c "$MAXB" "/var/opt/public/oap/oap_$u/data/$name$s"
      [ -s "$OUT/apps/$name/$name$s" ] || rm -f "$OUT/apps/$name/$name$s"
    done
    rd "$OUT/apps/$name/settings.json" cat "/var/opt/public/oap/oap_$u/data/settings.json"
    [ -s "$OUT/apps/$name/settings.json" ] || rm -f "$OUT/apps/$name/settings.json"
  done
fi

# ---- 3. cluster-render: its log, status text, version and journal ---------------------------------------------------------
for s in .log .log.1; do
  rd "$OUT/cluster-render/cluster-render$s" tail -c "$MAXB" "/var/opt/cluster-render/log/cluster-render$s"
  [ "$DRY" = 1 ] || [ -s "$OUT/cluster-render/cluster-render$s" ] || rm -f "$OUT/cluster-render/cluster-render$s"
done
rd "$OUT/cluster-render/status.txt" cat /run/cluster-render/status.txt
rd "$OUT/cluster-render/versions-ls.txt" ls -l /var/opt/cluster-render/versions/
if [ "$DRY" = 1 ]; then
  echo "+ $SSH 'cat /var/opt/cluster-render/versions/<newest version>/component.json'  > cluster-render/component.json" >&2
else
  v="$(grep -E ' [0-9]+\.[0-9]+\.[0-9]+$' "$OUT/cluster-render/versions-ls.txt" | awk '{print $NF}' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  case "$v" in [0-9]*.[0-9]*.[0-9]*) rd "$OUT/cluster-render/component.json" cat "/var/opt/cluster-render/versions/$v/component.json";; esac
fi
Q='"'
case "$SINCE" in *[!A-Za-z0-9\ :-]*) die "--since: letters, digits, spaces, colons and dashes only";; esac
rd "$OUT/cluster-render/journal.txt" journalctl -u cluster-render --no-pager -o short-iso-precise --since "$Q$SINCE$Q"

# ---- 4. the manifest of what was copied, and the privacy scan -------------------------------------------------------------
echo "collect.sh: $NCMD read command(s)" >&2
if [ "$DRY" = 1 ]; then echo "collect.sh: dry run: nothing was run" >&2; exit 0; fi
python3 -I "$HERE/collect_meta.py" "$OUT" "$LABEL" || echo "collect.sh: session.json not written" >&2
python3 -I "$HERE/privacy_check.py" "$OUT" --redact-to "$OUT/redacted" --quiet || echo "collect.sh: the privacy scan flagged lines: read $OUT/redacted/ and run privacy_check.py without --quiet" >&2
echo "collect.sh: done: ${OUT#$REPO/}"
echo "next: UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project python -I tools/car/parse_logs.py ${OUT#$REPO/}"
