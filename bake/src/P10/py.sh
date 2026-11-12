#!/bin/sh
# P10 python wrapper: runs from bake/src with the shared uv cache (zsh does not word-split $PY).
cd "$(dirname "$0")/.." || exit 1
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
exec uv run -q --no-project --with opencv-python-headless --with numpy --with pillow --with scipy python "$@"
