# Brief: bring the overlay constructor up to date with the G20 "parts"

Audience: one agent working alone, in its own git worktree. Read the whole brief before starting.
Project root (main checkout): `/Users/solefir/projects/f30-cluster`. Your worktree has the same tree. Files that git ignores (`reference/`, `bake/work/`) exist only in the main checkout. Read them from there; `F30_MAIN=/Users/solefir/projects/f30-cluster` points to it.

## 1. Why

The overlay constructor (`tools/overlay/constructor/`, data in `design/overlay/`) was built before the G20 had been taken apart. It knows each stock G20 element only as a polygon or bbox and a simple schematic SVG (38 elements in `design/overlay/g20_comfort.json`).

Since then the G20 has been taken apart into real parts, all our own drawings fitted to the car photos:

1. **The bench simulation:** `bench/g20/`, written up in `docs/G20SIM-REPORT.md` and `docs/G20SIM-B/C/D-*.md`. `bench/g20/manifest.json` has 80 entries (built from `structure/`, `icons/` and `live/`, `manifest.part.json` each):
   - 42 raster layers in `bench/g20/structure/*.png`, each in a day and a night version: background, frames, wings, glows, bottom ends, info lines, numerals, scale labels, the rev band, the minis and their fills, and the map veil.
   - 29 procedural items drawn by `bench/g20/c.js`: telltales, bottom-row text and icons, the sign, the check-control panel, the gear letter, the digital speed, "1/min x1000", OFF.
   - 9 live items drawn by `bench/g20/live/live.js`: the map, the arrow, the pointers, their glows, the rev band, and the mini pointers.
   - The font is `bench/g20/fonts/`.

   Each entry has these fields:
   - `element`: the catalogue id;
   - `layer`: under or over;
   - `state`: any, stock or connected;
   - `look`: any, day or night;
   - `kind`;
   - `z`;
   - `evidence` and `sources`.
2. **The app's own G20 textures:** `apps/f30_cluster/hud/scene/g20_*.json`, baked by `tools/bake_g20.py` from the simulation's night layers. Each file is `{w, h, rgba: base64}` with straight alpha.
   - `g20_speedo`, `g20_tacho`, `g20_fuel` and `g20_fuel_fill`, `g20_oil` and `g20_oil_fill`;
   - `g20_lut` is data, not a picture.
   - The boxes are in `design/g20_geo.json` and in the layout `apps/f30_cluster/hud/layouts/g20_comfort.json` (made by `design/gen_g20.py`).
3. **The "6WB Dials + G20" collar:** `apps/f30_cluster/hud/scene/collar.json`. It comes from `design/overlay/collar.dials.png` and is at quarter size over the whole panel. Its layout is `wb_dials`, and `docs/OVERLAY-PLAN-DIALS.md` describes it.

The owner wants the constructor to show all of this as layers: real textures and not only outlines, so the owner can see exactly which G20 parts we already have and which we would still have to draw. Scan every collected texture, link each one to its element and update the tree.

## 2. Hard rules

1. **Read-only, do not edit:**
   - `shared/`;
   - `apps/`, which includes the layouts and the scene textures;
   - `bench/`, which includes `bench/g20/`;
   - `kit/`, `bake/src/`;
   - `design/gen_*.py`, `tools/bake_*.py`.
2. **What you may edit:**
   - `tools/overlay/`, which includes the constructor;
   - `design/overlay/`;
   - `docs/`.
3. **Git:**
   - work on branch `overlay/parts` in your worktree and commit there;
   - do not push, do not touch `main` and do not merge;
   - first commit this brief: copy it from the main checkout's `docs/AGENT-BRIEF-overlay-parts.md`.
4. **No photo pixels or BMW artwork go into git.** The parts are already our own drawings, so you may reference them in place.
   - Do not copy the PNGs into `design/overlay/`. The constructor loads them at run time from `bench/g20/` and `apps/f30_cluster/hud/scene/`.
   - Thumbnails or derived masks may go into `design/overlay/parts/` only if the constructor truly needs them. Keep them small: alpha or grey, and 1× bbox crops.
5. **Ports and processes:**
   - The owner's bench runs on **8078**. Do not stop it, restart it or post settings to it.
   - If you need a bench, run a second one from your worktree with `BENCH_PORT=8079`, after `rm -rf dist bench/.data` in your worktree only.
   - Serve the constructor with `python3 -m http.server 8091` from your worktree root.
6. **Tooling:**
   - Run Python as `UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with jsonschema python -I ...`.
   - macOS has no `timeout`.
   - For headless Chrome, add `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000 --window-size=1920,1080`.
   - Run it in the background, poll for the output file, then `pkill -f "Chrome.*headless"`.
   - `tools/overlay/headless.py` and `tools/g20sim/shot.sh` show the pattern.
7. **The constructor stays a static page:**
   - no build step, no npm, no CDN;
   - it must open offline;
   - it must still work, with a clear message, when an optional source (photos, scene JSON, `bench/g20`) is missing.
8. **No guessing.** Keep evidence as the sources state it. Where the simulation and the catalogue disagree (relation, bbox, state), list the disagreement. Do not silently pick a side.

## 3. Work

### A. Part inventory: `tools/overlay/inventory_parts.py` writes `design/overlay/g20_parts.json`

The script must be re-runnable, and its output must validate.

Write one record per part:

```json
{ "id": "structure.speedo.frame.night", "element": "structure.speedo", "source": "sim" | "app-scene",
  "file": "bench/g20/structure/speedo.frame.night.png" | "apps/f30_cluster/hud/scene/g20_speedo.json" | null,
  "procedural": null | {"module": "bench/g20/c.js", "id": "c.tt.abs"},
  "bbox": [x0, y0, x1, y1],            // panel px; for a raster: its placement plus the alpha>0 extent; for procedural: manifest x/y/w/h, or measured from a render
  "size": [w, h], "layer": "under"|"over", "state": "any"|"stock"|"connected", "look": "any"|"day"|"night",
  "kind": "...", "z": n, "evidence": "...", "sources": [...],
  "used_by": ["bench-sim", "layout:g20_comfort", "layout:wb_dials"], "notes": "" }
```

What to cover:
- **Every manifest entry.** The font and the LUT are records with `kind: "data"` or `"font"` and no bbox.
- **Every app scene texture** that starts with `g20_`, plus `collar`.
  - Decode the base64 to get the size and the alpha bbox.
  - Take the placement from `design/g20_geo.json` or the layouts.
  - Link `g20_speedo` and `g20_tacho` to their `structure.*` elements, and the minis to `structure.fuel_mini` / `structure.oil_mini`.
  - Record which sim parts each one was baked from: read `tools/bake_g20.py`.
- **Cross-checks,** written into the file's `report` section and into the report (§3 D):
  - catalogue elements with no part, which are what we would still have to draw;
  - parts whose `element` is not in the catalogue, such as `panel.background`;
  - suspicious links: for example `c.assist.tacho_zero` points to `assist.off` while a raster `structure.tacho_zero` exists;
  - relation or state disagreements between the part's `layer`/`state` and the element's `relation`;
  - the bbox disagreement between a part's alpha extent and the catalogue bbox or poly, in px;
  - the four housing LEDs, which sit off the panel and are never drawn.

Then:
- Extend `design/overlay/schema.json` with a `g20-parts` kind.
- Extend `tools/overlay/validate.py` to check it, including that every `element` resolves or is listed as unresolved.

### B. Catalogue: link the parts into `design/overlay/g20_comfort.json`

- Give each element a `parts` field: a list of part ids, filled by a script and not by hand. Extend the schema.
- **New elements.** Where the simulation has parts for something the catalogue lacks, add it as a new element with an honest relation, evidence and basis taken from the simulation's `sources`. Candidates: the panel background, the map veil, the numerals and scale labels as their own elements (if they are not already covered by `structure.*`). The `structure` group stays context only, so it raises no conflicts.
- **Do not change** any existing element's relation, evidence, bbox or poly. Put proposed corrections in the report.
- `plan.default.json`, `plan.safe.json` and `plan.dials.json` carry `based_on` hashes:
  - regenerate them with the same tools that made them (`tools/overlay/headless.py`, `tools/overlay/plan_dials.py`);
  - show that their decisions and conflict lists are unchanged apart from the new elements;
  - if the new elements bring new conflicts, list them.

### C. Constructor: the layer tree and texture rendering

The tree is in `ui.js`, the drawing in `view.js`, the loading in `data.js` and the model in `model.js`.

1. **G20 stock.** Under each element, add its parts as child nodes. Each part node has show/hide, solo, opacity and lock, the same as other nodes, with cascading group toggles.
   - Show each part's look, state, layer and source as small tags.
   - The element node keeps its relation, evidence and decision editor as it is today.
2. **Add the render mode `texture`.** It draws the real part:
   - **Raster PNGs:** draw them at their placement.
   - **Procedural and live parts:** load `bench/g20/c.js` and `live/live.js` and draw the single part into an offscreen canvas. First see how `bench/g20/g20sim.js` and `bench/page.html` call them, and reuse their entry points rather than copying their code.
   - **If a part cannot be drawn alone,** fall back to the element's schematic and mark the node.
   - Keep fill, outline, photo and diff working.
3. **Global controls:**
   - **look:** night (default) or day;
   - **theme connected:** stock or connected. This picks the parts whose `state` matches, as the simulation does.
   - **lamp preset:** start-up check, driving or all. This decides which telltale parts are lit.
   - Mirror the simulation's semantics, including `G20SIM-REPORT.md` §2.
4. **A new root: "Ours: G20 parts in the app".**
   - Its children are the `app-scene` textures at their layout boxes, decoded from the JSON in the browser.
   - Group them by layout: `g20_comfort` gets the speedo, tacho and the minis with their fills; `wb_dials` gets the collar.
   - Each one is linked, by selection highlight, to the G20 elements it covers.
   - These are view-only. They do not take part in conflicts, because the 6WB side is still `wb_comfort.json`.
5. **The inspector for a selected part** shows:
   - the file path, size and bbox;
   - evidence and sources;
   - `used_by`;
   - a "baked into" / "baked from" cross-link;
   - a thumbnail.
6. **Performance.** About 80 parts plus the scene textures. Decode once, cache an ImageBitmap per part, and redraw only what changed.
7. **Tests.**
   - `selftest.js` must still pass.
   - Add checks: every part node resolves to a drawable source or to the marked fallback, and the tree counts match `g20_parts.json`.

### D. Docs and proof

- **`design/overlay/README.md`:** add a section on `g20_parts.json` (what a design agent can use it for: "this G20 element already exists as our own texture at X"), and a line in the file table.
- **`docs/OVERLAY-REPORT.md`:** add a section "G20 parts". It has:
  - one table: element → parts (raster / procedural / live / app texture) → day/night present → what is missing;
  - the cross-check findings from §3 A;
  - the regenerated plans' diff.
- **Headless screenshots** go in `docs/overlay/` and are committed (they are our own drawings):
  - the constructor at night, connected, in texture mode;
  - the same in day mode;
  - the tree expanded on one dial and on the telltales;
  - the "Ours" root shown.
- **A short report** goes in `docs/OVERLAY-PARTS-REPORT.md`:
  - what changed;
  - how to open the page;
  - the commands to regenerate;
  - what is left open.

## 4. Acceptance

- `validate.py` passes on every file in `design/overlay/`.
- `selftest.js` passes.
- The constructor opens offline from `python3 -m http.server`.
- Every one of the 80 manifest entries and every `g20_*` and `collar` scene texture is a node in the tree. Each draws as a texture, or is marked as a fallback with the reason.
- The report's table answers the owner's question for every G20 catalogue element: whether we already have it as our own texture, as day and night, or whether we still have to draw it.
- The plans' existing decisions are unchanged, and any new conflicts are listed.
- Everything is committed on `overlay/parts`. In your final message, give:
  - the branch, the commits and the files;
  - anything you could not finish and why.
