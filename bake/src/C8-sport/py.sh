#!/bin/sh
# runs python with the bake deps, from bake/src
cd "$(dirname "$0")/.." || exit 1
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
exec uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python "$@"
