# Brief: decompose the 6WB reference and bake its static layers

Audience: a lead agent that may split the work between parallel sub-agents. Read the whole brief first.
Project root: `/Users/solefir/projects/f30-cluster` (MGU cluster theme app; GitHub `sergey-olefir/f30-cluster`).

## 1. Goal

Take every reference image of BMW's F-series 6WB multifunctional instrument display and produce, **for each visible element, a decomposition and a baked, layered, nearly pixel-accurate re-creation** of everything that is static: shadows, fills, gradients, shapes, bezels, rings, tick marks, icons. From these baked layers we will later compose the scene (theme) and add live lighting, shadows and the needle on top.

Maximum similarity is the point: shadow falloff, fills, edge shapes, gradients, tick wedge shapes, icon outlines, colour and brightness should match the references as closely as the evidence allows.

**Out of scope for now:** wiring anything into the theme. Do not touch the existing layers or the theme code (see rules). The output of this job is assets plus a manifest plus reports.

## 2. Hard rules

1. **Do not edit** `shared/`, `apps/f30_cluster/main.js`, `apps/f30_cluster/app.json`, `apps/f30_cluster/hud/layouts/`, `design/gen_6wb.py`, `kit/`, `bench/`. You may *read* them and run the bench for A/B images.
2. New files only under: `bake/` (code, notes, reports), `apps/f30_cluster/hud/baked/` (the baked assets, not referenced by anything yet), `docs/` (reports), `tools/ref/` (helper scripts). Scratch output goes to `bake/work/` (git-ignored).
3. **Do not `git push`, do not create commits on `main`.** If you want history, commit to a local branch `bake/<package>`. Never publish anything.
4. **The reference photos are third-party material and are git-ignored** (`reference/`). Do not copy their pixels into any shipped asset. They are *measurement evidence*: you re-draw (procedurally or by hand-built vector/raster drawing) and **fit your drawing to them**. Shipped assets must be our own drawing, as stated in `apps/f30_cluster/NOTICE`. No BMW fonts, no BMW artwork traced as-is; icons are redrawn as generic shapes that match the photos' proportions.
5. No guessing: where the evidence is missing (a part is hidden, blurred, glared), say so in the manifest (`evidence: "weak"`) and the report instead of inventing detail silently.
6. macOS: no `timeout` command. Python via `UV_CACHE_DIR=<dir> uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python ...`. Headless Chrome screenshots need `--use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000`.
7. Do not run `node bench/server.js` and `node kit/tools/emu.js` at the same time (both rebuild `dist/`).

## 3. What the baked layers are for (design constraints)

- Target display: BMW iDrive 7 (MGU) instrument cluster, **panel 1920×720 px**, drawn through `cluster-render` (layers: `image` RGBA straight alpha, `effect` GLSL ES 1.00 shaders, assets R8/RGBA8 up to 2048 px a side that a shader can sample with `sampler2D`).
- Blending is normal alpha-over only (no multiply/screen/add for 2D layers). So **keep shadow, highlight and glow as separate alpha layers on top of an albedo layer**, so that light and shadow can be re-lit later without re-baking the base.
- **Pixel memory budget: 16 MiB for everything, each image counted twice (w × h × 8 bytes).** The whole existing theme already uses ~4.3 MiB. All baked layers of one mode together must stay **≤ 8 MiB** by that formula. Soft, low-frequency layers should be baked at half resolution (they upscale bilinearly without loss); crisp ones (ticks, bezel edge, icons, text-like shapes) stay at 1× or are left procedural (see §6).
- At most 8 layers per client connection, 32 in total; the theme already uses 18. So baked layers should be **merged into few images per cluster** where stacking allows (e.g. all of one dial's static albedo into one image) and you must report the layer count of your proposed composition.
- **Do not bake**: any text/numerals (fonts are live and localised), the needle and its shadow, hub ring state, red zones that depend on settings (shift point), over-speed wedge, signs' visibility, anything driven by data, BMW's own overlays (telltale lamps, gear letter, black area).

## 4. Reference inventory

All files are copied to stable paths. Original session paths are listed too.

### 4.1 6WB references (`reference/6wb/`)

Session image folder (original paths): `/private/tmp/claude-501/-Users-solefir-projects-f30-cluster/58a6a6d5-bf7a-4f8e-9917-720dc0cc1e96/images/` (shown as `…/images/`).

| File | Origin | Size | What it shows | Best used for | Reliability |
|---|---|---|---|---|---|
| `01_three-modes_small.png` | `…/images/1.png` | 447×447 | Three stacked photos of the same cluster: Eco Pro (blue, top), Sport (red, middle), Comfort (white, bottom) | overall layout/colour of each mode | low res, composition only |
| `02_three-modes_clean-render.png` | `…/images/2.png` | 1254×1254 | Three clean, glossy, render-like views: Comfort (top, car glyph, "Fasten seatbelt"), Sport (middle, red band, bridge, wings), Eco Pro (bottom, blue arcs, CHARGE/POWER, EfficientDynamics) | **cleanest source for gradients, glow, Sport band and wings, Eco arcs, bezel gloss** | high; few reflections |
| `03_three-modes_photo_bimmerstop.png` | `…/images/3.png` | 950×1200 | Three real photos in a car: Eco Pro "Door open", Comfort (watermark), Sport+ "Door open" | real-world contrast, glare behaviour | medium; watermark, glare |
| `04_comfort_whole-cluster_mph.png` | `…/images/4.png` | 1000×750 | Whole cluster, Comfort, mph scale 0–160, dark room | dial proportions, ring/disc layering, mini gauges | medium |
| `05_comfort_tach-closeup.png` | `…/images/5.png` | 1000×750 | Close-up of the tachometer: ticks, numerals, READY/OFF arc, P box, red zone, needle, hub | **tach geometry, OFF arc, P box shape, red zone fill, tick wedge shape** | high |
| `06_comfort_wide_with-wheel.png` | `…/images/6.png` | 1000×750 | Wide, steering wheel in front, both dials | proportions in context | low |
| `07_physical-cluster_all-lamps-lit.png` | `…/images/7.png` | 1456×824 | Physical cluster on a bench, all telltales lit, warm backlight | lamp positions and icon shapes (telltales are BMW-drawn: reference only), dial recess depth | medium |
| `12_speedo_signs_overspeed-wedge.png` | `…/images/12.png` | 374×344 | Speedo with speed-limit sign (60) and no-overtaking sign under the hub, red over-speed wedge on the scale, range arc 0–250 km at the bottom | **sign shapes and placement, wedge fill, range arc, numerals' style** | medium (small) |
| `13_ticks_closeup.png` | `…/images/13.png` | 768×926 | Macro of the rev-dial ticks around "6": wedge ticks, cool fringe, blurred light spot behind long ticks, recessed groove, bezel | **tick shape/glow/groove, bezel profile** | high |
| `14_inner-rings_closeup.png` | `…/images/14.png` | 264×232 | Speed dial inner rings (80/60/40 numerals, disc edges, hub area) | ring/tube profile, disc shading | medium (small) |
| `15_hub-needle_closeup.png` | `…/images/15.png` | 892×666 | Macro of hub and needle: thin red ring, dark middle with red fans, tube needle (dark edges, red body, white core), tail cap, shadow | **hub, needle look (for the dynamic layer), well shading** | high |
| `17_physical-cluster_full.png` | `…/images/17.png` | 2452×1110 | Whole physical cluster front view: both dials, mini gauges with pictograms, centre window with floor, bottom info bar (Time / trip / km / Temp), EfficientDynamics + l/100km arc at the bottom of the tach, fuel arc + "km" at the bottom of the speedo, telltales, housing | **full-scene layering, bottom arcs, mini gauge pictograms, info bar, window floor** | high; some glare |

### 4.2 Target car (G20) photos (`reference/g20/`): not 6WB, our target hardware

| File | Origin | Size | What it shows | Use |
|---|---|---|---|---|
| `08_stock_night_warnings-map.jpg` | `…/images/8.jpg` | 2048×1536 | G20 stock "Comfort Plus" theme, night, warnings lit, map in the middle | what BMW itself draws on this panel (lamps, gear letter, bottom row) |
| `09_stock_map_day.jpg` | `…/images/9.jpg` | 2048×1536 | Same, daytime, map | same |
| `10_grid_over-stock.jpg` | `…/images/10.jpg` | 2048×1536 | Our calibration grid (lines every 50, lit every 100 px, labels `x/y`) over the stock theme | **panel-to-photo homography**: `reference/g20/10_grid_homography_panel-to-photo.json` (matrix `Hm`, residual ≈3.5 px) |
| `11_our-theme_on-car.jpg` | `…/images/11.jpg` | 2048×1536 | Our current COMFORT theme on the G20, with BMW's black area, belt lamp and gear letter over it | where our render ends and BMW's overlays begin |

### 4.3 Ours (`reference/ours/`)

| File | Use |
|---|---|
| `ref_comfort_bench_1920x720.png` | the bench render of our current COMFORT at exact panel scale; the A/B baseline |
| `16_bench_signs_annotated.png` (origin `…/images/16.png`) | bench screenshot with layer outlines (shows how the current layers are split) |

## 5. Frames and alignment

- **Panel frame** = our 1920×720 px frame, origin top-left, y down. Everything you deliver is in panel pixels.
- **Dial frame** = units of the dial radius R, origin at the dial centre. Our current geometry (COMFORT, G20): R = 335 px; speed dial centre (412, 380), rev dial centre (1508, 380); mini gauges R = 70 at (80, 628) and (1840, 628); centre window x 720–1200, y 79–688. Source references are mapped **dial-to-dial** (their dial → our R), so one decomposition works at any R.
- Existing tools (read, adapt, put your adapted copy in `tools/ref/`):
  - `tools/ref/grid_homography.py`: detects the grid lines in the G20 grid photo and fits a homography (108 crossings).
  - `tools/ref/sift_align.py`: SIFT + RANSAC homography between a bench render and a photo, then `warpPerspective` to panel space (used for photo 11).
  - `tools/ref/measure_overlays.py`, `measure_hood_zoom.py`: measure BMW's overlays and the hood.
  They contain hard-coded session paths; adapt them, do not run them blindly.
- For the 6WB photos there is no grid. Establish a per-photo similarity/affine/homography **per dial** from the dial's own circular features (bezel circle, tick ring, numerals, hub). Report the residual. Refine per element with ECC (`cv2.findTransformECC`) on a mask, not globally.
- Normalise exposure per photo before comparing: fit gain/offset (and optionally gamma) on stable anchors (white numerals, pure black surround) and record the transform.

## 6. Decomposition

Definitions: a **cluster** is a group of spatially and semantically related pixels (a dial, a mini gauge, the centre window, the bottom bar, a sign pair, the housing). A **layer** is one stackable image inside a cluster. An **element** is one drawable thing (one ring, the tick set, one icon).

### 6.1 Clusters (spatial split)

C1 speed dial · C2 rev dial · C3 fuel mini gauge · C4 oil/coolant mini gauge · C5 centre window (frame, floor/horizon, glow) · C6 bottom info row and arcs (range arc under the speedo, EfficientDynamics + l/100km arc under the tach, Time/Trip/Temp bar) · C7 signs and icons (speed limit, no overtaking, pictograms) · C8 mode-specific parts (Sport: glowing band, bridge, wings; Eco Pro: CHARGE/POWER arc, EfficientDynamics inner arc) · C9 housing and glass (bezel crescent, reflections, black surround; documentation only, not shipped) · C10 background.

### 6.2 Layers per dial, bottom to top (default stacking, adjust to the evidence)

1. face base (albedo gradient, slightly lifted dark blue)
2. face shadow: ambient occlusion inside the bezel, falloff profile
3. tick groove (recess) with its two lit rims
4. red zone fill (static part: geometry and gradient; its start angle is a setting, so keep as a parametrised procedural layer or bake a full sweep mask)
5. ticks: major / half / minor as wedges, cool fringe, soft glow, the light spot behind the long ones (shadow/highlight/glow separated)
6. outer inner-disc (r ≈ 0.51 R): fill, lit edge, dark ring outside, shadow
7. inner ring (r ≈ 0.36 R): tube profile, halo
8. floor band (below the horizon line) and its edge
9. hub well (dark vignette) and hub ring base (the ring is static; its glow state may be dynamic)
10. [dynamic] needle shadow → needle → tail cap
11. bezel gloss: tube profile, lit from the upper left, second light low right, dark band inside the gloss, thin bright outer rim
12. glass reflection (documented, not shipped)

For each layer decide and record `class`: **baked** (static, soft) · **procedural** (crisp, keep as shader, but give the exact numeric parameters that reproduce the reference) · **dynamic** (data-driven). Default: soft shadows, glows, gradients, discs, groove, floor, hub well = baked; ticks, bezel edge, numerals, icons = procedural or 1× baked; needle, red/over-speed zones, signs visibility, texts = dynamic.

### 6.3 Light model (so later lights and shadows work)

Document the apparent light direction and intensity per photo (the references suggest a key light from the upper left; verify) and split each baked layer into: `albedo` (base colour), `shadow` (black with alpha), `highlight` (light with alpha), `glow` (coloured with alpha). Name them `<element>.albedo.png`, `.shadow.png`, `.highlight.png`, `.glow.png`.

## 7. Output contract (so parallel work merges)

```
apps/f30_cluster/hud/baked/
  <cluster>/<element>.<kind>.png        RGBA 8-bit, sRGB, straight alpha, tight crop
  <cluster>/<element>.<kind>@0.5x.png   optional half-resolution variant for soft layers
bake/
  manifest/<cluster>.json               the list of that cluster's layers (schema below)
  report/<cluster>.md                   fit report with images (links to bake/work/ diffs)
  src/<cluster>/                        the code that produced the assets (one command regenerates them)
docs/BAKE-<cluster>.md                  optional design notes
```

Manifest entry (JSON):

```json
{ "id": "speedo.tick-groove", "cluster": "C1", "z": 3, "kind": "albedo|shadow|highlight|glow|mask",
  "class": "baked|procedural|dynamic",
  "frame": "panel", "x": 77, "y": 45, "w": 670, "h": 670, "scale": 1.0,
  "file": "C1/speedo.tick-groove.albedo.png", "bytes_by_8wh": 3591200,
  "stack_below": ["speedo.face"], "stack_above": ["speedo.ticks"],
  "sources": ["13_ticks_closeup.png", "02_three-modes_clean-render.png"],
  "evidence": "strong|ok|weak", "light": {"dir_deg": 135, "key": 1.0},
  "fit": {"ssim": 0.0, "dE2000_mean": 0.0, "edge_px_err": 0.0},
  "params": { "notes": "numeric parameters that reproduce it procedurally, in R units" } }
```

All geometry is deterministic and generated by code in `bake/src/`, not hand-edited bitmaps, so a layer can be regenerated at another R or mode. Supersample 2–4× and downscale for clean edges.

## 8. Fidelity: how to compare and what counts as done

1. For every element, rasterise your layer stack over black in panel space and compare with the **rectified, exposure-normalised reference crop** of the same element: SSIM on luminance, CIEDE2000 mean on colour, edge position error in px (extract edges from both, measure distance). Save side-by-side and diff images in `bake/work/<cluster>/`.
2. Targets (per element, on the unmasked area): soft layers SSIM ≥ 0.85 and mean ΔE2000 ≤ 6; crisp shapes (ticks, bezel edge, icons) edge error ≤ 1.0 px at 1×; gradients monotone with no banding at 8 bit (dither if needed).
3. Photos have glare, perspective, compression and watermarks: **mask** those areas and state the mask. Compare structure and colour, do not chase noise. Where two references disagree (e.g. `02` clean render vs `17` photo), keep both numbers in the report and pick one with a reason.
4. Evaluate every layer **also in the composed stack** (not only alone): the sum must match the reference region, shadows included.
5. A human review sheet per cluster: reference | ours | diff, at 2× zoom, with the numbers under it.

## 9. Parallel work packages

Phase 0 is sequential and short; phases 1–2 run in parallel; phase 3 is sequential.

**P0 — Lead: alignment, inventory, contract (do first).**
Inputs: all references. Outputs: `bake/manifest/refs.json` (per image: per-dial transform to our frame, residuals, exposure fit, masks, light direction), rectified crops in `bake/work/rect/`, the cluster/element inventory with the stacking table (§6) confirmed against the references, the manifest schema (§7) and a QC script `bake/src/qc.py` (SSIM, ΔE2000, edge error, diff sheets) that every package must call.

**P1 — Speed dial (C1).** Layers 1–9, 11 for COMFORT. Primary sources: `04`, `05` (mirror/equivalent geometry), `13`, `14`, `15`, `17`, `02`.
**P2 — Rev dial (C2).** Same, plus the OFF arc and READY mark geometry, the red zone (parametrised), the P box, the arc at the bottom (l/100km). Primary: `05`, `13`, `17`, `04`.
**P3 — Mini gauges (C3, C4).** Fuel and oil/coolant: bezel, face, ticks, red/blue zones, pictograms as vectors. Primary: `04`, `17`, `07`.
**P4 — Centre window and bottom bar (C5, C6).** Window frame with chamfered top corners, floor/horizon light bars and glow, bottom bar, range arc under the speedo, EfficientDynamics arc under the tach. Primary: `17`, `02`, `04`.
**P5 — Signs and icons (C7).** Speed limit (white field, red ring, proportions), no overtaking (two cars), fuel pump, oil can, coolant, battery, seat belt etc. as **SVG + raster**, with the exact proportions measured from `12`, `17`, `07`. Deliver also their bounding boxes in the dial frame.
**P6 — Sport (C8 Sport).** Red glowing band between disc and bezel with radial hairlines, the bridge and the wings between the dials. Primary: `02` (middle), `03`, `01`.
**P7 — Eco Pro (C8 Eco).** CHARGE/POWER arc, EfficientDynamics inner arc, blue glow. Primary: `02` (bottom), `03`, `01`.
**P8 — Housing and glass (C9) and overlays map.** Document only: bezel crescent, glass reflections, black surround; and a map of what BMW draws over our panel on the G20 (belt lamp, gear letter, black area, lamps), from `08`–`11`.
**P9 — Lead: integration readiness (do last).** Compose all layers per mode into a panel-space preview, run QC on the composition, compute the **layer count and memory (w·h·8)** for the proposed scene (must fit §3), produce a single report `docs/BAKE-REPORT.md` with: element table, fit numbers, risks, open questions. **Do not wire it into the theme.**

Sub-agents must not edit each other's folders. A package depends only on P0 outputs. If P0's alignment for an image is poor, the package reports it and falls back to the next-best reference instead of forcing a fit.

## 10. Priorities

1. COMFORT first (P0–P5, P8, P9 for Comfort). Then Sport (P6) and Eco Pro (P7).
2. Within a dial: bezel and groove/ticks → discs and rings → hub well → floor.
3. Signs/icons and the bottom arcs after the dials.

## 11. Deliverables and "done"

- `apps/f30_cluster/hud/baked/**` and `bake/manifest/*.json`, regenerable with documented commands.
- `bake/report/*.md` per cluster and `docs/BAKE-REPORT.md` overall, with fit numbers and diff images.
- A proposed composition (stack order, layer merges, layer count, memory total) that fits the budget, **not applied**.
- A list of open questions and weak-evidence elements.
- No changes to the forbidden paths; `git status` shows only the allowed directories.

## 12. Facts about the current theme (for A/B)

- Current COMFORT is procedural: `shared/shaders.js` (`WBDIAL` style 0, `WBBACK`, `WBGEAR`, `WBSIGN`) driven by `design/gen_6wb.py` → `apps/f30_cluster/hud/layouts/wb_comfort.json`. Read these to reuse numbers (ring radii as fractions of R: inner disc 0.51, inner ring 0.36, floor 0.26, tick groove 0.80–0.915, major/half/minor tick starts 0.82/0.85/0.872, tick end 0.905, hub ring 0.135).
- Bench for A/B: `node bench/server.js f30_cluster` → http://localhost:8078; screenshot `http://localhost:8078/?only=1&clean=1&car=0` at 1920×720; set the drive mode with `POST /drive {"value":4}` (4 = COMFORT, 1 = SPORT, 7 = ECO PRO) and fixed signals with `POST /signals {"mode":"manual","values":{...}}`.
- Fonts used for numerals: Arimo Bold (own choice, not BMW's); text stays live.
- G20 specifics that affect composition: hood curve, BMW's black area (x 1420–1597, y 320–440), belt lamp (x 587–626, y 665–720), BMW's own gear letter (x 1392–1428, y 664–706) are in `shared/visible.js`.

## 13. Report format back to the user

Start with a short table: cluster, layers, baked/procedural/dynamic counts, memory by w·h·8, best/worst fit numbers. Then the open questions. Keep the detailed material in the files.
