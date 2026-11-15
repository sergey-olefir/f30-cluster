# design/g20-spec — the measured specification of BMW's stock G20 bottom strip

Research package behind `docs/G20-DESIGN-SPEC.md`: what the stock G20 Comfort cluster draws in the
bottom strip (bottom row, street label, speed-limit sign, check-control message), measured in panel
px so we can redraw it instead of leaving transparent windows for BMW.

| File | What |
|---|---|
| `measured.json` | every measured number, with the photo and the method behind it; the tools and the document read it |
| `schematic/bottom-strip.svg` | our own schematic of the strip at the measured numbers, y 560–720, to scale |
| `fonts/*.png` | the shortlisted free faces rendered at the measured height, with the photo's measured ink box drawn around each (so the width error is visible) |

**No photo pixels are stored here.** The reference photos (`reference/`) and everything derived from
them pixel-wise are third-party and git-ignored, as in `design/overlay/README.md`. The photo-side
review sheets — the annotated crops and the photo-above-candidate font comparisons — are written to
`bake/work/g20spec/` by `tools/g20spec/sheets.py`.

## Tools (`tools/g20spec/`)

| Tool | What it does |
|---|---|
| `zoom.py` | warps one panel box out of an original photo at n× panel resolution, using the rectification models in `bake/work/overlay/rect/H.json` |
| `crops.py` | the same for a list of boxes |
| `measure.py` | ink measurements on such a crop: per-glyph boxes, half-max extents, stroke runs, colour, a circle fit, a line trace |
| `table.py` | runs `measure.py` over a job list and prints a compact table |
| `fit_strip.py` | ties photos 34, 41, 42, 43 (our theme up, BMW's row showing) to panel px by composing photo 39's model with a partial affine fitted on the common content |
| `rectify_spec.py` | the plain SIFT route for extra photos, kept for the ones where `fit_strip.py` is not needed |
| `fontfit.py` | sizes each candidate face to a measured run's height and reports the width deviation |
| `fingerprint.py` | size-independent shape ratios (x/cap, stem/cap, figure/cap, advance/figure, "1" against "0") for every candidate |
| `figures.py` | writes `fonts/*.png` here (no photo pixels) |
| `sheets.py` | writes the photo review sheets to `bake/work/g20spec/` |

All of them run from the **main checkout** (they need `reference/` and `bake/work/`):

```sh
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
    --with pillow python -I tools/g20spec/<tool>.py --root . ...
```

No BMW font file is used, downloaded, committed or shipped by anything here.
