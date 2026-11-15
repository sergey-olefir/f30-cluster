# design/f30-font — which typeface the 6WB themes should use

Research package behind `docs/F30-FONT-SPEC.md`: what the real F30 6WB cluster's text is shaped like,
measured on the reference images, and which freely licensed face reproduces it. The answer is
**Roboto variable at width 87.5, not Arimo** — Arimo's "1" carries a foot serif the 6WB's has not.

| File | What |
|---|---|
| `measured.json` | every measured number, with the image and the method behind it; the tools and the document read it. Also what each reference image **is** (photograph, video frame, or — for `02` — a synthetic picture that must not be measured) |
| `fonts/*.png` | the shortlisted faces set to the photographs' measured height, Arimo first as the control. **No photo pixels** |

**No photo pixels are stored here.** The reference images (`reference/`) and anything derived from
them pixel-wise are third-party and git-ignored, as in `design/overlay/README.md` and
`design/g20-spec/README.md`. The photo-side sheets — the same comparisons with the photograph on top,
plus the before/after bench shots and their diffs — go to `bake/work/f30font/` instead.

## Why the measurement needed its own method

`design/g20-spec` could rectify its photos to panel px, because they are photographs of *our* panel.
These are not: they are third-party pictures of someone else's car at their own scales, with no
common frame. So everything here is measured in the image's own pixels and compared as **ratios**,
which are scale-free. The method's own check: the rev scale's "6" measures w/h 0.6394 on image 05 and
0.6390 on image 13 — two photographs at a 4× scale difference agreeing to 0.1 %.

The second difference is **bloom**. Every reference is a bright LCD with its core clipped to 255, so
ink is dilated by a roughly constant amount. `fontfit.py` fits that dilation explicitly and pins it
with the glyph **counters**, which shrink by the same amount the ink grows — without them the fit
cannot tell a bold face photographed sharply from a light face bloomed, and picks the wrong one.

## Tools (`tools/f30font/`)

| Tool | What it does |
|---|---|
| `measure.py` | ink measurements on a box of an image: per-glyph boxes, half-max extents, stroke runs, colour. `--invert` finds the counters instead of the ink |
| `crop.py` | a zoomed crop, to look at |
| `table.py` | runs `measure.py` over a job list and prints a glyph table |
| `fontfit.py` | fits each candidate face's scale and the photograph's bloom together, with the stroke, advance and counters as further observations, and ranks the faces |
| `fingerprint.py` | the same evidence as plain ratios: a digit's w/figure, x/cap, advance/figure, stroke/figure — plus each face's variable axes and whether it has Cyrillic |
| `sheets.py` | the comparison sheets, candidates-only into `design/f30-font/fonts/` and photo-on-top into `bake/work/f30font/` |
| `wedge.py` | the speedo: finds the major ticks, fits the dial centre and the angle/speed calibration together, unwraps an annulus to polar, and profiles the red over-speed marking in angle and radius |
| `shots.py` | shoots every 6WB layout on the bench and pixel-compares two sets, to prove a re-bake |

All of them run from the **main checkout** (they need `reference/` and `bake/work/`); see
`docs/F30-FONT-SPEC.md` §11 for the exact command lines.

No BMW font file is used, downloaded, committed or shipped by anything here.
