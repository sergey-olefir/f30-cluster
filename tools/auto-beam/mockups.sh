#!/bin/sh
# tools/auto-beam/mockups.sh - the whole park of Auto Beam mockups into bake/work/beam/ (git-ignored):
# the GPU layers (the app's own effect shaders on the Mac's GPU), then every picture, sheet and context picture.
set -e
cd "$(dirname "$0")/../.."
: "${UV_CACHE_DIR:=$(pwd)/bake/work/.uvcache}"
export UV_CACHE_DIR
node tools/auto-beam/mockups.js gl-jobs
uv run -q --no-project --with pillow --with numpy --with moderngl python -I tools/auto-beam/beam_gl.py --jobs bake/work/beam/gl/jobs.json
node tools/auto-beam/mockups.js "$@"
