# P0 hand-off for packages P1–P8

P0 (alignment, inventory, contract) is done. Read `bake/README.md`, `docs/BAKE-P0-inventory.md`, `bake/manifest/refs.json`, `bake/manifest/inventory.json` and `bake/manifest/schema.json` before you start.

## Files

- `bake/README.md`: commands, folder layout, frames, crop naming, how to use QC and the manifest, rules.
- `docs/BAKE-P0-inventory.md`: alignment table, exposure, disagreements with brief §6.2 with evidence, weak spots.
- `bake/manifest/refs.json`: per image → mode panel → dial. Each dial has the photo ellipse, `A_photo_to_panel` (2x3), `residual_rms_panel_px`, `quality`, `visual_check`, the exposure fit, the light estimate, the needle angle and the floor check, plus the output crop bases, `naming`, `masks` and `summary_table`.
- `bake/manifest/inventory.json`: clusters with their `best_refs`, the dial stacking table (z, class, evidence, whether it agrees with §6.2) and measured radii in R units.
- `bake/manifest/schema.json` and `bake/src/validate_manifest.py`. The validator checks the schema, file existence, RGBA, sizes, `bytes_by_8wh`, ids and stack refs. It prints the image count and memory and exits 1 on errors.
- `bake/src/qc.py`: the QC tool. Run it as a CLI or call `qc.run(...)`.
- `bake/src/common/` (import from `bake/src`):
  - `geom.py`: G20 and OLD geometry, theme radii, `crop_box`, cw12 angles, polar grids.
  - `color.py`: sRGB↔Lab and CIEDE2000.
  - `raster.py`: supersampled `ring`, `arc`, `wedge`, `radial_profile`, `polar`, in R units.
  - `imageio.py`: `write_png` (straight alpha, TPDF dither), `read_png`, `half_res`, `upscale2`, `over`, `tight_crop`, `bytes_by_8wh`.
- `bake/src/p0/`: the P0 code. `$PY -m p0.run` regenerates the P0 outputs. **Do not edit it.**
- `tools/ref/grid_homography_p.py` and `tools/ref/sift_align_p.py`: parametrised copies.
- Fit overlays: `bake/work/p0/fit_<stem>.png`. QC examples: `bake/work/p0/qc_example_*.png`.

## Commands (run from `bake/src`)

```sh
cd /Users/solefir/projects/f30-cluster/bake/src
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
PY="uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python"

$PY qc.py --ref ../work/rect/17_physical-cluster_full.comfort.C1 \
  --layer ../../apps/f30_cluster/hud/baked/C1/speedo.face.albedo@0.5x.png:50:18:0.5 \
  --layer ../../apps/f30_cluster/hud/baked/C1/speedo.tick-groove.albedo.png:94:62 \
  --cluster C1 --name speedo.tick-groove --roi ring:0.78:0.93 --roi-angle 220:280 --edges --json ../work/C1/groove.json

$PY qc.py --ref ../work/rect/05_comfort_tach-closeup.comfort.C2 --manifest ../manifest/C2.json --cluster C2 --name stack --roi ring:0:0.97

$PY validate_manifest.py ../manifest/C2.json
```

**Layers.** `--layer FILE:X:Y[:SCALE]` takes the panel x,y of the top-left corner. SCALE is 0.5 for @0.5x files. QC upsamples bilinearly (premultiplied) and composites bottom to top over black.

**ROIs** are intersected with the reference mask:
- `ring:R0:R1`, optionally with `--roi-angle A0:SPAN` (cw12 degrees)
- `box:X:Y:W:H`
- `mask:FILE`

**Mask bits.** `--ignore-bits` defaults to 31. Use 15 to keep text pixels, 23 to keep the needle corridor.

**Output.** JSON with `fit` = {ssim (luma), dE2000_mean, edge_px_err (panel px)}, plus dE2000_p95, luma bias/rmse and `banding.plateau_fraction` (flagged above 0.25). The review sheet goes to `bake/work/<cluster>/qc_<name>__<ref>.png`.

## Frames and crops

**Panel and dials.**
- Panel: 1920×720.
- Dials: R = 335 at (412,380) and (1508,380). R is the bezel's **outer** edge.
- Minis: R 70 at (80,628) and (1840,628).
- Window: x 720–1200, y 79–688.

Dial frame (u,v) = ((x−cx)/R, (y−cy)/R) with y down. Angles are cw12 (degrees clockwise from 12 o'clock). Light directions use math degrees (135 = upper left).

**Crop names.** `bake/work/rect/<image stem>.<mode>.<cluster>[@<k>x].{png, raw.png, mask.png, maskbits.png, json}`. Mode is comfort, sport, eco or g20; cluster is C1–C5 or PANEL.

**Boxes:**

| Cluster | Box [x, y, w, h] |
|---|---|
| C1 | [50,18,724,702] |
| C2 | [1146,18,724,702] |
| C3 | [4,552,152,152] |
| C4 | [1764,552,152,152] |
| C5 | [680,39,560,669] |
| PANEL | full panel |

Crop pixel (i,j) is panel (box.x+i+0.5, box.y+j+0.5).

**Supersampled crops.** `@4x` and `@2x` exist only for the close-ups: `13…C2@4x`, `15…C1@4x` and `17…C3@2x`.

**What each file holds:**
- `.png` is exposure-normalised: black is the 5th percentile outside the bezels, the white top 0.5% inside 0.95 R maps to 235, white balance is clamped to 0.8–1.25, gamma is not fitted.
- `.raw.png` has no normalisation.
- `.maskbits.png` bits: 1 outside the photo, 2 glare, 4 watermark/UI, 8 needle corridor (−0.42 R to 1.0 R, 0.12 R wide), 16 live text (approximate).
- The C6 bottom arcs are inside the C1/C2 crops; the info bar is inside C5.

**A/B baselines:**
- `ours_bench.comfort.C1–C4`: our bench render. It was rendered in the OLD geometry (R 290 at (496,360) and (1424,360)) and is mapped per dial into the G20 frame.
- `11_our-theme_on-car.g20.*`: rectified with a 4-point fix.
- `08` and `09`: SIFT to 10, then Hm.

## Alignment quality

Residual is the rms of the bezel ridge about the fitted ellipse, in panel px.

| Image | Mode | C1 | C2 | C3 | C4 | Use |
|---|---|---|---|---|---|---|
| 17 physical full | comfort | good 0.64 | good 0.59 | good 0.14 | good 0.21 | geometry and layering; **face hazed by veiling glare (face luma 52–72)**, don't take levels from it |
| 04 whole mph | comfort | ok | ok | ok | good | mph scale on C1; upsampled 2.4x |
| 05 tach close-up | comfort | – | ok 0.69 | – | – | best rev dial levels |
| 06 wide + wheel | comfort | good | good | skipped | skipped | composition only |
| 07 lamps lit | comfort | ok | ok by eye | ok | ok | warm cast and glare |
| 12 speedo signs | comfort | good 0.41 | – | – | – | a variant (orange range arc, black face) |
| 02 clean render | comfort / sport / eco | ok | ok | ok–good | ok–good | colour and gradients; **its proportions differ** (disc 0.568 R, floor 0.134 R) |
| 03 bimmerstop | eco / comfort / sport | good / ok / good | good | eco C3 poor | sport C4 poor | watermark masked; comfort C4 is an empty ring |
| 01 small | all | 1.2–2.3 | 1.3–2.3 | – | – | layout and colour only |
| 13 ticks | comfort | – | partial | – | – | radius from the 3.2° minor pitch; use `@4x` |
| 14 inner rings | comfort | partial | – | – | – | scale assumes disc edge 0.51 R; roll unknown |
| 15 hub | comfort | partial | – | – | – | scale assumes hub ring 0.135 R; use `@4x` |

## Findings and disagreements with brief §6.2

**Measured radii (R units):**

| Feature | 6WB | Theme |
|---|---|---|
| Bezel ridge | 0.99 | – |
| Groove inner rim | 0.80 | 0.80 |
| Tick band | 0.85–0.87 | – |
| Inner-disc edge | ~0.49 (0.473–0.51) | 0.51 |
| Inner ring | ~0.33 (weak) | 0.36 |
| Hub ring | 0.128–0.138 | 0.135 |
| Floor edge | 0.236–0.257 | 0.26 |

**Rev scale.** The rev major pitch is 32.2° (theme 32.1°), and the minor pitch is 3.2°.

**Stacking changes:**
- **New layer `floor-shade` at z 2.5.** Below the horizon the face is darker out to about 0.7 R. The crisp floor edge exists only inside about 0.45 R (z 8).
- **The inner disc and inner ring are arcs open at the bottom.** They end at the floor line.
- **The bottom arcs (C6)** sit in the dials' bottom gap within the tick band, at z 5.5. They differ per variant.
- **The "upper left" key light is NOT confirmed.** The bezel ridge peaks upper-left in 02 (130°) but at the bottom toward the window in 17, 04 and 03 (about 268°), with the two dials mirrored. That is likely reflections. Measure the highlight across the bezel tube in 13 and 05 before adopting a direction.
- **The 6WB dial spacing is 3.05–3.18 R; ours is 3.27 R.** Use C5 for shapes and profiles, not absolute x.

## Weak spots

- The 03 eco C3 and 03 sport C4 mini fits are poor, the 01 comfort C1 fit is weak, and the 06 minis were skipped.
- The 14 and 15 scales rest on theme radii. If 0.49 R is confirmed, rescale 14 by 0.49/0.51.
- The text mask is approximate, so add element ROIs.
- The Sport and Eco needle corridors were set by eye.

If a package's best crop is poor for its element, report it and fall back to the next entry in `inventory.json` `best_refs`.
