#!/bin/sh
# Twin Dial: every baked file of package R2-A2 from the repo, one command (faces, panel mask, manifest record).
#   sh tools/twin-dial/bake_all.sh [--stretch 1.0]        (run from the repo root; needs uv)
# One command re-bakes every texture byte for byte (faces, regions JSON, panel mask, manifest). B1 (0.1.1): SPEC-R3 2, SHADOW_MODEL in
# bake_face.py. Writes apps/twin_dial/hud/scene/{face_tacho,face_speedo,panel_mask}.json, face_*.regions.json and
# bake/manifest/twin_dial.json. Fonts: tools/fonts-src/ (package A1) or bake/work/twin-dial/refs/vt-fonts/. No reference
# image is read. Afterwards: sh tools/twin-dial/bake_all.sh --check runs the bake tests.
set -e
cd "$(dirname "$0")/../.."
export UV_CACHE_DIR="${UV_CACHE_DIR:-$PWD/bake/work/.uvcache}"
PY="uv run -q --no-project --with numpy --with pillow python -I"
if [ "$1" = "--check" ]; then
  $PY tools/twin-dial/test_bake.py
  uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/twin-dial/test_shader.py     # the real tdial shader on the GPU
  node bench/test-twin-bake.js
  exit 0
fi
$PY tools/twin-dial/bake_face.py "$@"
$PY tools/twin-dial/bake_mask.py
