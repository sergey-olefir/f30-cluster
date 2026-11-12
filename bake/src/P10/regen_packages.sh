#!/bin/sh
# P10: re-run every package build (BAKE-REPORT 10), unmodified, so the level step starts from fresh package output.
# Then: ./P10/py.sh -m P10.apply   (the level transform, BAKE-P10-levels.md 4)
cd "$(dirname "$0")/.." || exit 1
PY=./P9/py.sh
set -x
$PY -m C1.build && $PY -m C2.build && $PY -m C3.build && $PY -m C6.build --all && $PY -m C7.build \
 && ./C8-sport/py.sh C8-sport/build.py && $PY C8-eco/build.py && $PY -m C9.build && $PY -m C10.build
