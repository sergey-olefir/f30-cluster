#!/bin/sh
# Package ZC: run the whole zone-C pipeline from the repo root (reference/ and bake/work/ linked to the main checkout).
# Uses package R's rects where <id>.READY exists, else the provisional ones of quickreg.py.
set -e
F30_MAIN=${F30_MAIN:-$HOME/projects/f30-cluster}
export UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache
O=bake/work/strip/zone-c
py() { uv run -q --no-project --with opencv-python-headless --with numpy --with scipy python -I "$@"; }
py tools/strip/ZC/atlas.py > $O/atlas_raw.txt
(cd tools/strip/ZC && py geometry.py > ../../../$O/geometry.txt && py texts.py > ../../../$O/texts.txt)
py tools/strip/ZC/unattributed.py > $O/unattributed.txt
py tools/strip/ZC/diff.py > /dev/null
py tools/strip/ZC/diff_report.py 6 > $O/diff_report.txt
py tools/strip/ZC/mask.py > $O/mask_check.txt
echo done
