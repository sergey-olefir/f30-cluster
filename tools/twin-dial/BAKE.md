# Twin Dial bake (package R2-A2)

One command from the repo root regenerates every baked file (needs `uv`; fonts from `tools/fonts-src/` once package A1 has
put them there, else `bake/work/twin-dial/refs/vt-fonts/`):

    sh tools/twin-dial/bake_all.sh [--stretch 1.0]      # faces + panel mask + bake/manifest/twin_dial.json
    sh tools/twin-dial/bake_all.sh --check              # tools/twin-dial/test_bake.py + node bench/test-twin-bake.js

| Output (`apps/twin_dial/hud/scene/`) | What | Made by |
|---|---|---|
| `face_tacho.json`, `face_speedo.json` | R8 616 x 560 scene textures (the engine's scene format), luma faces | `bake_face.py` |
| `face_tacho.regions.json`, `face_speedo.regions.json` | region ranges, numerals, ticks, bar segments, decode rules for the shader | `bake_face.py` |
| `panel_mask.json` | R8 536 x 112, the fallback window, 255 = BMW's panel shows through | `bake_mask.py` |
| `bake/manifest/twin_dial.json` | sha256 of every payload, tool versions, font hashes | `_bakecommon.record()` |

Other tools: `face_shade.py` (numpy reference of the `tdial` decode: tint, wedge, bar fills), `compare_face.py` (baked faces
against the mockup's dial crops; pictures in the git-ignored `bake/work/twin-dial/r2/A2/`), `test_bake.py`.

Every drawing is ours, from the numbers of `docs/twin-dial/SPEC.md` §4-§5; no reference image or photo is an input. Saira
(scale numerals, OFF) and Noto Sans (unit labels, bar ends) are the OFL fonts of SPEC §9; the icons under the dials are our
own pictograms (`design/twin-dial/vt/pictograms/baked/`). `--stretch` is Saira's horizontal stretch (SPEC §9: 1.06 default;
1.0 = the mockup).
