#!/bin/sh
# Twin Dial round 3b, package B6: every font atlas and every pictogram of the app, from the repository, one command.
#   sh tools/twin-dial/b6/bake_b6.sh            (run from anywhere; needs uv and node)
#   sh tools/twin-dial/b6/bake_b6.sh --check    nothing is written: fails when a committed file differs from what the bake writes
# Writes apps/twin_dial/hud/fonts/*.json (tools/bake_fonts.py, the TWIN_FONTS list), shared/twin_icons.js and
# apps/twin_dial/hud/icons/icons.json (tools/twin-dial/a1/build_twin_icons.js, from design/twin-dial/vt/pictograms.js).
# --sheet <dir> also writes the review sheets icons_1x.png / icons_4x.png (git-ignored places only, e.g. bake/work/...).
set -e
cd "$(dirname "$0")/../../.."
export UV_CACHE_DIR="${UV_CACHE_DIR:-$PWD/bake/work/.uvcache}"
if [ "$1" = "--check" ]; then
  uv run -q --no-project --with numpy --with pillow --with fonttools python -I tools/twin-dial/a1/test_bake.py
  node tools/twin-dial/a1/build_twin_icons.js --check
  exit 0
fi
uv run -q --no-project --with numpy --with pillow python -I tools/bake_fonts.py twin_dial
node tools/twin-dial/a1/build_twin_icons.js
if [ "$1" = "--sheet" ] && [ -n "$2" ]; then
  node tools/twin-dial/b6/icon_sheet.js "$2/_dump" 1 4
  uv run -q --no-project --with pillow python -I tools/twin-dial/b6/icon_sheet.py "$2/_dump" "$2"
  rm -rf "$2/_dump"
fi
