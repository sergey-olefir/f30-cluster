# Brief: a layered overlap map and constructor, stock G20 cluster vs our 6WB theme

Audience: a lead agent that splits the work between parallel sub-agents (packages in §7). Read the whole brief first.
Project root: `/Users/solefir/projects/f30-cluster` (an MGU cluster theme app; GitHub `sergey-olefir/f30-cluster`).
Scope: **Comfort mode only** (the G20's Comfort and our 6WB Comfort). Sport and Eco Pro come later in the same format.

## 1. Goal

The owner wants to **keep as many of the G20's own indicators as possible** under the 6WB-style theme. For every element the stock G20 cluster draws, the owner needs to know three things:

- whether the theme can hide it;
- whether BMW draws it over the theme anyway, so the theme must stay out of its way;
- whether it disappears under a custom theme, so the theme has to draw it itself.

The owner also wants to arrange the two clusters' layers against each other freely.

Deliverables:

1. **A machine-readable layer map.** It lists both clusters' elements, each with:
   - geometry (panel px);
   - layer relation (§3) and evidence;
   - safety flag;
   - a decision.

   A future design system or design agent consumes this map as-is, so it must be self-explanatory (schema plus README).
2. **A constructor.** This is a local web page that loads the map. It shows both clusters as layers over the measured panel, with:
   - photo underlays;
   - full control of visibility, opacity, order and position;
   - live detection of overlaps between the two clusters.

   The owner's decisions and adjustments are saved back to JSON.
3. **A report.** Per element: category, evidence, conflicts with the current 6WB Comfort layout, and the list of elements that still need a car photo to settle.

**Out of scope:** changing the theme itself (`shared/`, layouts, the app). §7 package H is an optional follow-up that needs the owner's approval first.

## 2. Hard rules

1. **Do not edit** the following. You may read them and run the bench.
   - `shared/`
   - `apps/f30_cluster/main.js`, `apps/f30_cluster/app.json`, `apps/f30_cluster/hud/layouts/`
   - `design/gen_6wb.py`
   - `kit/`, `bench/`
   - `bake/src/`, `apps/f30_cluster/hud/baked/`
2. **Where new files go:**
   - Tool code: `tools/overlay/`.
   - Constructor page: `tools/overlay/constructor/`.
   - Shipped data: `design/overlay/` (JSON, schema, our own schematic drawings).
   - Reports: `docs/`.
   - Scratch and anything derived from photos: `bake/work/overlay/` (git-ignored).
3. **Git:**
   - Do not `git push`, and do not commit on `main`.
   - Each package may commit to a local branch `overlay/<package>`. The lead merges them locally.
4. **Photos are third-party material and evidence only** (`reference/` and `bake/work/` are git-ignored).
   - No photo pixels go into `design/overlay/`.
   - G20 elements are stored as geometry: polygons, boxes and colour. They may also have a schematic redraw of our own.
   - The constructor may show photo underlays and crops only when it loads them from the git-ignored folders at run time. It must work without them.
5. **No guessing.** Every claim about a G20 element carries:
   - `evidence` (`strong` / `medium` / `weak` / `none`);
   - the photos it rests on.

   Where nothing is known, the category is `unknown`.
6. **Tooling:**
   - macOS has no `timeout` command.
   - Run Python as `UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python ...`.
   - For headless Chrome, add `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000 --window-size=1920,720`.
     - It sometimes hangs: run it in the background, poll for the file, then `pkill -f "Chrome.*headless"`.
   - Only one bench at a time, and `rm -rf dist bench/.data` before you start it.
7. **The constructor is a static page.** Constraints:
   - no build step and no npm install;
   - no CDN dependencies (it must open offline);
   - it opens via `python3 -m http.server` from the repo root.

## 3. Categories (the core of the job)

Every G20 element gets one **relation** to a custom theme on the `panel` target:

| Relation | Meaning | What the theme can do |
|---|---|---|
| `over` | BMW draws it **on top of** any custom theme | Nothing hides it. The theme must keep that area free of anything important (a hard constraint). |
| `under` | BMW still draws it while a custom theme is up, **beneath** the theme | Choose: cover it (hidden), cut a see-through hole to keep it (as we already do for the map, `holeWhen`), or redraw it ourselves. |
| `gone` | Drawn only by the stock theme. With a custom theme connected it is not drawn at all. | Drop it, or redraw it ourselves. |
| `unknown` | Not settled by the photos | Needs a car photo (§8). |

Each element also has **`safety`**: `critical` (a warning the driver must see, by law or for safety), `info` or `cosmetic`.
- `critical` covers: brake, ABS, DSC, airbag, seat belts, tyre pressure, engine/check, oil, coolant, turn signals, high beam, parking brake.
- A `critical` element that is `under` or `gone` must end up either revealed or redrawn. The constructor flags any plan that leaves one hidden.

Each element's **`decision`** is the owner's choice, edited in the constructor:
- `keep-clear` (forced for `over`);
- `reveal` (a hole in our theme);
- `cover`;
- `redraw` (our own drawing at a chosen spot);
- `drop`.

## 4. What is already known (start here, do not re-measure what is solid)

- **`docs/BAKE-C9-overlays.md`, with data in `bake/work/C9/overlays.json`:**
  - Measured positions of the black area, the gear letter "P" and the driver's belt lamp (all `over`, observed).
  - The telltale columns (left, right and bottom row) from photo 08, rms 1.8 px.
  - The bottom-row text groups, the check-control panel and the map's bounding box.
  - Note: C9 marked whether telltales are drawn over a custom theme as **not observed**.
- **`shared/visible.js`:** the HOOD polyline (the part of the panel the hood hides), `BLACK_BOX`, `BELT`.
- **`reference/g20/10_grid_homography_panel-to-photo.json`:** the panel↔photo homography of the grid photo 10 (108 crossings, residual 3.5 px).
- **`bake/work/C9/08_H.json` and `08_rect_panel.png`:** photo 08 rectified to panel px.
- **Our 6WB Comfort:**
  - Static layers: `bake/work/P9/stack_comfort.json`. It has 44 layers with `id, cluster (C1–C10), z, file, x, y, scale, opacity`; the files are under `apps/f30_cluster/hud/baked/` or `bake/work/C*/proc`.
  - Live widgets: `apps/f30_cluster/hud/layouts/wb_comfort.json`. These are the dials' needles, text, signs, arcs, the map hole and the minis; each widget has `x, y, w, h`, toggles and `conn`.
  - Geometry: R 335, speedo centre (412,380), tacho centre (1508,380). `docs/BAKE-REPORT.md` explains the clusters C1–C10.
- **Platform facts the design agent will need** (put them in `design/overlay/constraints.json`):
  - 1920×720 panel.
  - Layer limits: at most 8 layers per connection and 4 connections.
  - Pixel memory: 16 MiB service-wide, each image or asset counted as w·h·8, shared with other apps.
  - Asset limits: at most 16 assets per client and 32 in total.
  - Shaders: at most 32 uniforms per effect layer. **Every `sampler2D` must have an asset bound**, or the car does not draw the layer.
  - BMW draws the black area and the gear letter over us.

## 5. Reference photos (`reference/g20/`, all of the G20, Comfort)

| File | What it shows | Use it for |
|---|---|---|
| `08_stock_night_warnings-map.jpg` | Stock theme **just after start-up**: the most lamps lit (brake, TPMS, ABS, DSC, AUTO H, P, steering, check engine, DSC OFF, low beam, belts and airbag in the bottom row), the 50 sign, the map, the "ready to drive" check-control panel, range, clock and temperature | The **master inventory** of G20 elements |
| `09_stock_map_day.jpg` | Stock theme by day, with the map | Second positions; day colours |
| `10_grid_over-stock.jpg` (+ homography JSON) | Our calibration grid (transparent) over the stock theme | Panel coordinates; whatever shows **under** our transparent grid is `under` (map, temperature) |
| `11_our-theme_on-car.jpg` | Our opaque theme (early) | Elements that appear on top of opaque content are `over` (belt, P, black area) |
| `12_our-theme_night_2026-11-11.jpg` | Our theme at night | Same, at night |
| `13_our-theme_baked_on-car_2026-11-11.jpg` | Our baked theme on the car | Same, plus how we currently look |
| `14_stock-under-unbound-theme_2026-11-12.jpg` | Our theme 0.7.2 connected, but only our **text** layers drew (a renderer bug, since fixed). Everything stock is visible beneath our text. | Any stock element seen here is still drawn while a custom theme is connected, so it is `under` or `over`, **not** `gone`. Our text is in known panel positions, which makes good alignment points. |

6WB references (`reference/6wb/`) are not needed for categories. They serve only as optional underlays for the 6WB side.

**How to classify from the photos:**
- An element seen in 11, 12 or 13 on top of our opaque pixels is `over`.
- An element seen in 10 or 14 but not in 11–13 where our content is opaque is `under`.
- An element seen only in 08 or 09 is `gone`, but only when 10 or 14 show that spot uncovered and the element's state (lamp lit) was plausibly the same. Otherwise the element is `unknown`.
- Lamps are state-dependent. "Not lit in photo X" is not "not drawn". Write down each lamp's state in each photo.

## 6. Data model (package A defines it first; everyone else builds on it)

All coordinates are panel px (x right, y down, 1920×720), as in `visible.js`.

### `design/overlay/schema.json`

The JSON Schema for the files below.

### `design/overlay/g20_comfort.json`

The stock elements:

```json
{ "id": "tt.abs", "group": "telltale" | "bottom-row" | "map-nav" | "assist-message" | "structure",
  "name": "ABS", "safety": "critical" | "info" | "cosmetic",
  "bbox": [x0, y0, x1, y1], "poly": [[x, y], ...], "colour": {"name": "amber", "rgb": [r, g, b]},
  "states": [{"photo": "08", "lit": true, "colour": "amber"}, ...],
  "relation": "over" | "under" | "gone" | "unknown", "evidence": "strong" | "medium" | "weak" | "none",
  "relation_basis": [{"photo": "11", "seen": false, "our_pixels_opaque_there": true, "note": "..."}],
  "schematic": "design/overlay/schematic/tt.abs.svg" | null, "notes": "" }
```

- The `structure` group is the stock dials' outline, scale and needles. It is context only: a ghost layer showing where the stock cluster draws its dials.
- The `map-nav` group includes the map polygon (the hull from C9, extended where 09 or 14 show more), the route arrow and the turn hints if visible.
- The `assist-message` group includes the speed-limit sign, the check-control panel, the "i" markers, ACC and the lane assistant (if seen), the mode label "COMFORT PLUS" and the gear "P". Telltale-like items that are not lamps go here.

### `design/overlay/wb_comfort.json`

Our elements:

```json
{ "id": "C1.speedo.ticks" | "w.speedo" | "w.range_v", "source": "baked" | "live",
  "cluster": "C1".., "z": n, "bbox": [..], "mask": "design/overlay/masks/<id>.png" | null,
  "kind": "dial" | "text" | "icon" | "background" | "needle" | "sign" | "arc" | "hole",
  "movable": true, "anchor": "speedo" | "tacho" | "mini.fuel" | "mini.oil" | "window" | null, "notes": "" }
```

- Masks are the alpha of our own baked layers at 1× (they are ours, so they may be shipped). For live widgets, either render a mask from a bench screenshot of that widget alone, or use the bbox.
- Anchors group elements so that a whole dial moves or scales around its centre.

### `design/overlay/plan.json`

The constructor's output:
- per G20 element: `decision` and notes;
- per 6WB element or anchor: offset, scale, `hidden`, z;
- the derived **holes** (the rects or rounded rects our background must leave see-through for every `reveal`);
- the derived **keep-clear boxes** (every `over` element);
- the conflict list at save time.

Also `version` and `based_on` (hashes of the two element files).

### `design/overlay/constraints.json`

The platform facts listed in §4, plus HOOD, the visible area, `BLACK_BOX` and `BELT`, copied from `visible.js` with their source.

### `design/overlay/README.md`

How a design agent reads these files, what each category means for a design, and a worked example (one telltale per relation).

## 7. Work packages and parallelism

```
A schema + skeleton ──┬──> C 6WB export ───────────────┐
                      ├──> D constructor UI (on sample data) ──┤
B rectify photos ─────┴──> E G20 catalogue ──> F relations + safety ──> G integrate + QA + report ──> (H optional)
```

**Wave 1 (parallel): A and B.** A is small; finish it first, because C, D and E use its schema.
**Wave 2 (parallel): C, D and E.**
**Wave 3: F, then G.**

### A: schema, skeleton, sample data (lead)

- Write `schema.json` and `README.md` (a first draft), plus the empty files.
- Write ~5 hand-made sample elements per side, so that D can start.
- Write `constraints.json` from `visible.js` and §4.

**Accept:** every JSON validates against the schema (a `tools/overlay/validate.py`).

### B: rectify every G20 photo to panel px

- Reuse the homographies that exist (10, 08).
- Align 09, 11, 12, 13 and 14 by SIFT to the rectified 08 or 10. Follow C9's `align08.py` approach. For 11–14, also use our own known content as control points (dial centres, our text, the signs).
- Output to `bake/work/overlay/rect/<photo>.png` (1920×720), with `H.json` and the rms per photo.

**Accept:** rms ≤ 3 px per photo, or the photo is marked unusable for geometry with the reason.

### C: the 6WB element export

`tools/overlay/export_wb.py` reads `stack_comfort.json` and `wb_comfort.json` and writes `design/overlay/wb_comfort.json` and its masks:
- **Baked layers:** one element per stack layer, plus merged anchors per dial.
- **Live widgets:** their boxes, with a mask from a per-widget bench render where practical.

**Accept:**
- Re-composited masks match a bench screenshot of `wb_comfort` (IoU ≥ 0.95 per dial).
- The script is re-runnable.

### D: the constructor page

`tools/overlay/constructor/index.html`, plain JS and canvas or SVG. It loads the JSON files and works on the sample data first.

**Must have:**

1. **Canvas.** The panel at fit-to-window and at 1:1, with zoom and pan. A ruler and cursor read-out in panel px and in R units of the nearer dial.
2. **Layer tree,** grouped by source:
   - `Panel` (hood mask, visible area, `BLACK_BOX`, `BELT`, calibration grid);
   - `G20 stock` (by group, then element);
   - `6WB` (by anchor, then cluster, then element);
   - `Photos` (rectified underlays, loaded from `bake/work/overlay/rect/` when present).

   Per node: show/hide, solo, opacity slider, lock and z-order. Group toggles cascade.
3. **Rendering modes per layer:**
   - fill (the schematic or mask in its colour);
   - outline only;
   - the photo crop (when available);
   - a difference view against an underlay (for overlaps).

   `over` elements are always drawn on top of 6WB layers, whatever z the user sets. That is the physical truth; show a lock icon.
4. **Editing 6WB elements and anchors:**
   - drag to move and handles to resize or scale around the anchor centre;
   - numeric fields;
   - arrow-key nudge (1 px, 10 px with Shift);
   - snap to grid steps and to other elements' edges and centres;
   - undo and redo.
5. **Live conflicts panel.** Every overlap between a 6WB element and a G20 element, computed on masks or polygons (not only bboxes), with overlap px and %.
   - **Error:** our content under an `over` element.
   - **Error:** a `critical` element covered without `reveal` or `redraw`.
   - **Warning:** a `reveal` hole cuts through our dial content.
   - **Info:** an `under` element covered by us (a decision to make).

   Click a conflict to select both elements and zoom to them.
6. **Decision editor per G20 element.** The relation, evidence and photo basis are read-only; the decision dropdown and notes are editable. A filter by category, safety and decision.
7. **Holes.** Every `reveal` produces a hole (bbox plus margin, optional corner radius), which is editable and drawn as a see-through cut in the 6WB background preview.
8. **Save and load.** Export and import `plan.json` (download and file picker). The current state is kept in `localStorage` as a convenience; the file is the source of truth.
9. **Load errors.** It must work with no photos present, and show a clear message when a data file is missing or invalid.

**Accept:**
- It opens offline in Chrome via `python3 -m http.server`.
- A headless screenshot of the default view is in the report.
- On sample data, the conflict list matches a hand-checked expectation.

### E: the G20 element catalogue (needs B and A)

From the rectified 08 (the master) plus 09, 14 and 10, segment **every** stock element in the four groups the owner chose, plus `structure`:
- **telltales:** each lamp separately;
- **bottom row:** range with its pump icon, clock, belt and airbag group, check-control "i" and message, temperature;
- **map-nav:** the map region, the arrow, the north and route marks;
- **assist-message:** the speed-limit sign, the check-control panel, the "i" markers, COMFORT PLUS, P, "0 km/h" digital speed, "1/min x1000", OFF.

For each one write:
- the polygon and bbox (≤ 2 px on 08's rect);
- the colour;
- the per-photo state;
- the group;
- a `safety` proposal;
- a schematic SVG of our own (a simple generic redraw: no BMW artwork traced as-is).

Also write `design/overlay/g20_comfort.json` and an annotated sheet `bake/work/overlay/g20_catalogue.png` (local only).

**Accept:**
- Every lit or drawn item in 08 is in the catalogue, or listed as deliberately excluded with the reason.
- Positions agree with C9's measurements within 3 px where both exist.

### F: relations and safety (needs E)

- Fill in `relation`, `evidence` and `relation_basis` for every element using the rules at the end of §5. In each of 11, 12, 13 and 14, check whether our content was opaque at that spot: use our own layout and the bench render of the version in the photo, read from `git log` at the photo's date.
- Review the `safety` flags.
- Produce **§8's photo protocol** for everything that stays `unknown`.

**Accept:** no element is left without a relation, evidence and basis. Every `unknown` has a protocol entry.

### G: integrate, QA, report (lead)

- Load the real data into the constructor.
- Compute the conflicts of the **current** `wb_comfort` layout with default decisions:
  - `over` → `keep-clear`;
  - `critical` and `under` → `reveal`;
  - `critical` and `gone` → `redraw`;
  - the rest → `cover`.
- Save the result as `design/overlay/plan.default.json`.
- Write `docs/OVERLAY-REPORT.md`:
  - the per-element table (id, group, relation, evidence, safety, default decision, conflicts);
  - what can be hidden, what must stay clear, and what we must draw ourselves;
  - the open `unknown` list with the photo protocol;
  - screenshots of the constructor.

**Accept:** the report answers the owner's question in one table: "which G20 indicators can I keep, which can I hide, which must I draw".

### H (optional, only after the owner approves): wire the plan into the theme

Teach the theme to read `plan.json`'s holes (several see-through cuts in WBBACK instead of one) and its keep-clear boxes (a layout warning, like `visible.js`). This touches `shared/` and the layouts, which §2 forbids for this job. **Propose a design and stop.**

## 8. Photo protocol for unknowns (output of F)

Write a short, numbered list the owner can do on the car in one session.

- Each step gives:
  - the setting (which layout or test pattern);
  - the action that lights the lamp (for example: unbuckle, set the parking brake, open a door, DSC off, turn signal, high beam, ACC on);
  - which elements it settles.
- **Test pattern:** propose a diagnostic layout (a design only; package H or the main thread will build it). It is opaque in some panel areas and transparent in others, with numbered cells, so one photo settles `over`, `under` or `gone` for many elements at once.
- Number the photos from 15 onward and say where to save them (`reference/g20/`).

## 9. Assumptions (the owner may correct these)

- Comfort only. The G20 runs Comfort and our app shows `wb_comfort`. Sport and Eco Pro, and the map layout `wb_comfort_map`, come later in the same format.
- "Hide" means our opaque content covers an `under` element. A theme cannot hide `over` elements; it can only stay clear of them.
- Safety-critical lamps must remain visible, either BMW's own (revealed) or redrawn by us. The constructor enforces this as an error, not a choice.
- The future design agent consumes `design/overlay/*.json` plus the README. The constructor is the human's tool for producing and checking `plan.json`.
