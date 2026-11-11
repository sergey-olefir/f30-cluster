#!/bin/sh
# P9 python wrapper: runs from bake/src so `common`, `qc` and the package modules import.
cd "$(dirname "$0")/.." || exit 1
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
exec uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python "$@"
