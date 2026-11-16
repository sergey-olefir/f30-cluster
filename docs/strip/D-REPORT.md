# Strip package D: the diagnostic matte

Brief: `docs/AGENT-BRIEF-strip.md` (not committed), package D. **Built and proven on the bench. Not on the car: it ships only on the owner's yes.**

## What was built

| File | What it is |
|---|---|
| `design/gen_matte.py` | The generator: `python3 design/gen_matte.py apps/f30_cluster/hud/layouts` |
| `apps/f30_cluster/hud/layouts/matte_{magenta,green,black}.json` | The three layouts. Each has four widgets: `matte`, a fill over the whole panel; `ruler_top` (y 540–552) and `ruler_bot` (y 708–720), grids with step 10 and major 10; `ruler_lab`, grid labels every 100 px at y 552–569, in font `wb_mini` |
| `apps/f30_cluster/app.json` | Three Theme-list entries, "Diagnostic matte: magenta / green / black", after "Map calibration" |
| `shared/hud.js` | A grid widget's layout may name `minorColor` and `majorColor`. This is a separate, commented block in the `grid` branch; without the keys the grid keeps its own colours, and the bench proves the calibration grid unchanged |
| `tools/previews.py` | The mattes added to `SKIP`: calibration layouts get no picture |
| `tools/strip/D/bench_matte.js` | The bench proof (35 checks). It starts and stops its own bench on port 8165 |
| `design/strip/D/matte_bench.json` | The proof's numbers |
| `docs/OVERLAY-PHOTO-PROTOCOL.md` §5 | How to read a matte photo, the budget, the camera setup and the shot list |

**Deviation from the brief: three Theme entries, not one.** The brief asked for "one theme-list entry" and "offer magenta, green and black". A single entry could only switch colour through a new setting, and `app.json` settings belong to package X. Three entries are three lines in the list this package owns. To keep only magenta, delete two entries (and their files).

## Bench proof (verified, from the engine's own output)

How the proof works:
- It runs `node tools/strip/D/bench_matte.js` on port 8165, with `BENCH_LAYER_CAP=8` and `BENCH_PIXEL_MIB=16`.
- It reads the scene (layers, shader sources, uniforms) from `GET /events` and the label sheet from `GET /px`.
- It re-implements FILL and GRID in JS, matching them by source text, and composites the 1920 × 720 panel in the service's order.

Results (verified):

- **Layers:** 4, all on one connection and all shown under the cap of 8: 3 effects (FILL, GRID, GRID) and 1 image sheet (the labels, 1900 × 17).
- **Pixel memory:** 258 400 bytes (0.246 MiB). That is the label sheet, counted twice. The proof also sees 8 bytes of 6WB Comfort's 1 × 1 blank asset, kept by `hud.js _blank`; no matte layer binds it.
- **Switch peak:** 6WB Comfort → the three mattes → 6WB Comfort peaks at 11.48 MiB, which is 6WB Comfort's own figure.
- **Samplers:** none. No `sampler2D` and nothing bound.
- **Shader source:** FILL 985 bytes, GRID 869 bytes. Both sources are unchanged and both have already run on the car: FILL in `wb_dials`, GRID in the calibration grid (photos 10 and 60).
- **Coverage:** all 1 382 400 panel pixels are opaque, in all three mattes.
- **Exact pixels:** off the label band, every pixel is exactly the matte or a ruler tick:
  - white 1 px ticks at x = 10k;
  - yellow 2 px ticks at x = 100k and 100k+1;
  - yellow frame rows 540, 541, 550, 551 and 708, 709, 718, 719, and columns 0, 1, 1918, 1919 inside the bands.
  - 0 wrong pixels.
- **Labels:** 19, at x 0..1800. Each label's ink starts 2–3 px right of its major tick; the ink box is x 2–1862, y 556–567.
- **Night colours:** with "Night colours: Always", the matte's `u_color` is still exactly (255, 0, 255, 255).
- **Log:** no refusal, layer-cap or memory warning for a matte. The 12 visibility warnings are expected for a full-panel matte (hood corner, belt lamp, (P) lamp).

Composites, our own render with no photo pixels: `bake/work/strip/pub/D/matte_<colour>_{panel,strip}.png`.

Test suites:
- `node bench/test-bottom-row.js`: 94 passed, 0 failed. It was 91; its "every layout still builds" loop now covers the three mattes.
- `node bench/test-native-ui.js`: 47 passed, 0 failed. It was 44, for the same reason.

## What the photos can settle (hypothesis until the car is photographed)

**Strip items:**
- `assist.cc_panel` and `bottom.cc_info`: whether BMW's message is drawn over a theme. This is the key shot for the safety rule.
- `assist.info_tacho`: the marker.
- `bottom.belt_rear`, `bottom.airbag`.
- `assist.off`.
- `bottom.odometer` and `assist.mode_label` in standby.
- `assist.msa`.

**Elsewhere on the panel:**
- `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `tt.auto_h`.

**Pads and glows:**
- whether BMW draws a dark pad under its over-items (magenta and green show it);
- the glow profiles (black shows them).

**What the photos cannot settle:**
- `assist.gear_centre`, which sits under the black box;
- any item not lit in the state shot;
- colour in linear light from a tone-mapped JPEG.

## For the owner

1. **Ship it to the car?** Separate yes needed.
2. **Keep all three colours, or only magenta?**
3. **Where to show it:** with "Change with the drive mode" on, the Theme setting is ignored, so it must be turned off to show a matte. The shot list says so.
