# bake/: decompose the 6WB references and bake static layers

Brief: `docs/AGENT-BRIEF-bake-6wb.md`. P0 results: `docs/BAKE-P0-inventory.md`.

## Python

No project environment. Always run the following from `bake/src`:

```sh
cd /Users/solefir/projects/f30-cluster/bake/src
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
PY="uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python"
$PY qc.py --help
```

Allowed extras: `--with scikit-image` if you need it (e.g.
`uv run -q --no-project --with opencv-python-headless --with numpy --with pillow --with scikit-image python ...`).
`qc.py` and the helpers do not need it. `libpng warning: iCCP` lines on stderr come from the reference PNGs and are harmless.

## Layout

```
bake/
  README.md
  manifest/
    schema.json        the manifest contract (JSON Schema): one file per cluster, bake/manifest/<cluster>.json
    refs.json          P0: per reference image -> per dial transform, residual, quality, exposure, light, outputs
    inventory.json     P0: clusters, best refs, the dial stack (z order) checked against the refs, P0 measurements
    C1.json ...        written by the packages (P1 -> C1.json, P2 -> C2.json, P3 -> C3.json + C4.json, ...)
  src/
    common/            shared helpers (import from bake/src: `from common import geom, color, raster, imageio`)
      geom.py          panel / dial frames, G20 + OLD geometry, theme radii, crop boxes, cw12 angles
      color.py         sRGB <-> linear <-> Lab, CIEDE2000 (self-test: `$PY -m common.color`), luma
      raster.py        supersampled coverage in R units: ring, arc, wedge (tick), radial_profile, polar
      imageio.py       straight-alpha PNG write (TPDF dither), read, half_res (@0.5x), upscale2, over, bytes_by_8wh
    qc.py              THE QC tool every package must call
    validate_manifest.py
    p0/                alignment code (align.py, g20.py, build_refs.py, run.py, seeds.json, overrides.json)
    <cluster>/         your package's code (one command regenerates its assets)
  report/<cluster>.md  your fit report
  work/                scratch, git-ignored: rect/ (reference crops), <cluster>/ (QC sheets), p0/ (fit overlays)
apps/f30_cluster/hud/baked/<cluster>/<element>.<kind>[@0.5x].png    the shipped (not wired) assets
```

## Frames

- Panel: 1920x720, origin top-left, y down. Dials (COMFORT, G20): R 335, speedo (412,380), tacho (1508,380);
  minis R 70 at (80,628) / (1840,628); window x 720-1200, y 79-688 (`common.geom.G20`, `geom.WINDOW`).
- R is the bezel's OUTER edge (the shader's R). Dial frame: (u, v) = ((x-cx)/R, (y-cy)/R), y down.
- Angles: `cw12` = degrees clockwise from 12 o'clock (theme convention). Light directions: math degrees
  (0 right, 90 up, 135 upper left).

## Reference crops (`bake/work/rect/`)

Name: `<image stem>.<mode>.<cluster>[@<k>x].<suffix>`, for example
`17_physical-cluster_full.comfort.C1.png`, `13_ticks_closeup.comfort.C2@4x.png`, `ours_bench.comfort.C2.png`,
`10_grid_over-stock.g20.PANEL.png`.

| suffix | content |
|---|---|
| `.png` | RGB in panel px, rectified dial-to-dial and exposure-normalised (white -> 235). Pixels outside the photo are 0. |
| `.raw.png` | the same geometry without the exposure step (6WB only) |
| `.mask.png` | 255 = usable (no mask bit set) |
| `.maskbits.png` | 1 outside the photo, 2 glare, 4 watermark/UI chrome, 8 occlusion (needle corridor, wheel), 16 live text (approximate) |
| `.json` | box `[x, y, w, h]` in panel px, transform, exposure, quality |

Crop pixel (i, j) is panel (box.x + i + 0.5, box.y + j + 0.5). For `@kx` crops it is (box.x + (i+0.5)/k, ...).
Boxes: C1 `[50,18,724,702]`, C2 `[1146,18,724,702]`, C3 `[4,552,152,152]`, C4 `[1764,552,152,152]`,
C5 `[680,39,560,669]`, PANEL `[0,0,1920,720]`.
Which crop to use, and how good its alignment is: `bake/manifest/refs.json` (`summary_table`, and per image
`sections.<mode>.dials.<C>.quality`, `residual_rms_panel_px`, `visual_check`) and `inventory.json` (`best_refs`).
Quality: good / ok / poor / partial. If a crop is poor for your element, say so and fall back to the next best one.

Regenerate everything P0 made (about 1 minute): `$PY -m p0.run`

## Drawing helpers

```python
import sys; sys.path.insert(0, "/Users/solefir/projects/f30-cluster/bake/src")
from common import geom, raster, imageio
R = 335; x0, y0, w, h = geom.crop_box("C1", 1.0)            # dial box in panel px
cx, cy = geom.G20["C1"]["c"][0] - x0, geom.G20["C1"]["c"][1] - y0
groove = raster.ring(w, h, cx, cy, R, 0.80, 0.915, ss=4)    # coverage 0..1
tick = raster.wedge(w, h, cx, cy, R, 230.0, 0.82, 0.905, 0.0075, 0.0135, ss=4)
img = imageio.rgba((0.05, 0.06, 0.08), groove * 0.6)          # straight alpha, float
imageio.write_png(".../baked/C1/speedo.tick-groove.albedo.png", img)      # TPDF-dithered 8-bit
imageio.write_png(".../baked/C1/speedo.face.shadow@0.5x.png", imageio.half_res(img))
imageio.bytes_by_8wh(w, h)
```

Soft layers go at @0.5x (QC upsamples them bilinearly, premultiplied, like the GPU). Crisp ones stay at 1x.
Always dither (the default in `write_png`).

## QC (every package, every element, and the composed stack)

```sh
$PY qc.py --ref ../work/rect/17_physical-cluster_full.comfort.C1 \
   --layer ../../apps/f30_cluster/hud/baked/C1/speedo.face.albedo@0.5x.png:50:18:0.5 \
   --layer ../../apps/f30_cluster/hud/baked/C1/speedo.tick-groove.albedo.png:94:62 \
   --cluster C1 --name speedo.tick-groove --roi ring:0.78:0.93 --roi-angle 220:280 --edges --json ../work/C1/groove.json
# or take the stack from your manifest (sorted by z, dynamic skipped):
$PY qc.py --ref ../work/rect/05_comfort_tach-closeup.comfort.C2 --manifest ../manifest/C2.json --cluster C2 --name stack --roi ring:0:0.97
```

- `--layer FILE:X:Y[:SCALE]`: X, Y = panel position of the layer's top-left corner; SCALE 0.5 for @0.5x files.
- ROI: `ring:R0:R1` (+ `--roi-angle A0:SPAN` in cw12 degrees), `box:X:Y:W:H` (panel px), `mask:FILE` (crop- or
  panel-sized L8). Several `--roi` flags are intersected with the reference mask.
- `--ignore-bits N` chooses which mask bits exclude pixels (default 31 = all; 15 keeps text pixels; 23 keeps the
  needle corridor).
- `--edges` (or `--crisp`) adds the edge error: the symmetric chamfer distance between Canny edges, in panel px.
  `--canny lo,hi` defaults to 20,60.
- Output (stdout / `--json`): `fit` = {ssim (luma, Gaussian window), dE2000_mean, edge_px_err}, plus dE2000_p95,
  luma bias / rmse, valid_px and banding (plateau fraction in smooth ramps: 0 when dithered; flag > 0.25).
  Copy `fit` (with `ref`, `roi`, `sheet`) into the manifest entry.
- Review sheet: `bake/work/<cluster>/qc_<name>__<ref>.png` (reference | ours | diff, 2x zoom, numbers under it).
  Link it from `bake/report/<cluster>.md`.
- Importable: `import qc; qc.run(ref_base, [(path_or_rgba, x, y, scale), ...], "C1", "name", rois=["ring:0.8:0.92"])`.
- Targets (brief section 8): soft layers SSIM >= 0.85 and dE2000 <= 6; crisp shapes edge <= 1.0 px; no banding.
- A/B baseline: `ours_bench.comfort.C1` / `.C2` / `.C3` / `.C4` are the current theme, mapped from the OLD bench
  geometry into the G20 dial frame. As a check, `ours_bench.comfort.C1` scored SSIM 0.105, dE 23.8 and edge error
  5.4 px against `17...C1` (ring 0-0.95). The 17 face is hazy (veiling glare), so take face levels from 05 / 03 / 04.

## Manifest: register your layers

Write `bake/manifest/<cluster>.json` following `bake/manifest/schema.json`:

```json
{"cluster": "C1", "package": "P1", "mode": "comfort", "R": 335,
 "generator": "cd bake/src && $PY -m C1.build",
 "layers": [
  {"id": "speedo.tick-groove", "cluster": "C1", "z": 3, "kind": "albedo", "class": "baked", "frame": "panel",
   "x": 94, "y": 62, "w": 636, "h": 636, "scale": 1.0, "file": "C1/speedo.tick-groove.albedo.png",
   "bytes_by_8wh": 3236352, "stack_below": ["speedo.face"], "stack_above": ["speedo.ticks"],
   "sources": ["13_ticks_closeup.png", "05_comfort_tach-closeup.png"], "evidence": "strong",
   "light": {"dir_deg": 135, "key": 1.0},
   "fit": {"ssim": 0.91, "dE2000_mean": 3.2, "edge_px_err": 0.7, "ref": "bake/work/rect/17_physical-cluster_full.comfort.C1", "roi": "ring:0.78:0.93"},
   "params": {"r_in": 0.80, "r_out": 0.915}}],
 "composition": {"images": [], "layer_count": 0, "bytes_by_8wh_total": 0},
 "open_questions": []}
```

Validate the manifest with `$PY validate_manifest.py ../manifest/C1.json`. The command exits 1 on errors and prints
the image count and the memory used (w*h*8).
`file` is relative to `apps/f30_cluster/hud/baked/`. `bytes_by_8wh` is the FILE's width x height x 8, so an @0.5x
file counts at its own size. Procedural and dynamic entries have `"file": null` and keep their numbers in `params`.

## Rules (from the brief)

- Do not edit `shared/`, `apps/f30_cluster/main.js`, `apps/f30_cluster/app.json`,
  `apps/f30_cluster/hud/layouts/`, `design/gen_6wb.py`, `kit/` or `bench/`.
- Do not commit to `main` and do not push.
- Never copy reference pixels into a shipped asset. Draw it yourself and fit the drawing.
- Mark weak evidence as `evidence: "weak"`.
- Write only under your own `bake/src/<cluster>/`, `bake/manifest/<cluster>.json`, `bake/report/<cluster>.md`,
  `bake/work/<cluster>/`, `apps/f30_cluster/hud/baked/<cluster>/` and `docs/BAKE-<cluster>.md`.
