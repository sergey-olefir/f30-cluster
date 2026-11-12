# Overlay constructor: the G20 parts (report)

Brief: `docs/AGENT-BRIEF-overlay-parts.md`. Branch: `overlay/parts` (local, not merged). The findings are in `docs/OVERLAY-REPORT.md` section 7; the data format in `design/overlay/README.md` section 6.

## 1. What changed

- **Inventory.** `tools/overlay/inventory_parts.py` writes `design/overlay/g20_parts.json` (schema kind `g20-parts`): 89 parts.
  - All 80 entries of `bench/g20/manifest.json`, and the black area `g20sim.js` draws itself.
  - The app's 7 G20 scene textures and the collar (decoded: size, alpha extent, layout box).
  - For each: file or entry point, box, look, state, layer, evidence, sources, `used_by`, `baked_into` / `baked_from` (parsed from `tools/bake_g20.py` and `tools/bake_scene.py`), what each app texture covers.
  - The 9 live parts have no box in the manifest. The constructor draws each alone in headless Chrome (`?probe=parts`) and the script records the extent.
  - A `report` section holds the cross-checks.
- **Catalogue.**
  - `tools/overlay/link_parts.py` gives each element of `design/overlay/g20_comfort.json` a `parts` list. It runs from the inventory and from `catalogue_g20.py`, so a re-run keeps the links.
  - It adds one element, `panel.background`, judged in `tools/overlay/parts_elements.json`.
  - No existing relation, evidence, bbox or poly changed.
- **Validator.** `tools/overlay/validate.py` checks the new kind:
  - ids, files and entry points exist;
  - every `element` resolves or is listed in `report.unresolved`;
  - `baked_into` / `baked_from` match;
  - every manifest entry and every `g20_*` / `collar` scene texture has a record;
  - the catalogue's `parts` lists match the file both ways.
- **Constructor** (`tools/overlay/constructor/`, new `parts.js`):
  - **Part nodes.** Every G20 element has its parts as child nodes: show/hide, solo, opacity, lock and mode, like the other nodes. Each node has tags:
    - B / C / D / E / app: the source;
    - N / D: the look;
    - stk / con: the state;
    - U / O: the layer;
    - L: lit by a lamp;
    - `!`: a fallback, with the reason in the tooltip;
    - `∅`: empty at these values.
  - **Texture mode.** The render mode `texture` draws the real parts, in the simulation's z order:
    - B's rasters at their placement;
    - C's and D's items one at a time, through the simulation's own entry points (`G20Sim.init`, `G20C.drawUnder` / `drawOver`, `G20Live.drawMap`, `G20Live._debug.drawGlow` / `drawBar` / `drawBand` / `drawFill` / `drawNeedle`, `G20Sim.drawOver` for the black area). Each is cropped to the part and cached per state.
    - A part that cannot be drawn shows its element's schematic and is marked `!`.
    - Fill, outline, photo and diff work as before; in diff and photo the parts take part too.
  - **Top-bar controls.** G20 schematic / texture, night / day, theme connected / stock layout, and the lamps: start-up check, driving, or all. "All" lights every lamp and forces every condition, part by part. The states follow `bench/g20/g20sim.js` and `c.js`.
  - **The new root "Ours: G20 parts in the app".** It shows the app's textures at their layout boxes, grouped by layout (`g20_comfort`, `wb_dials`). It is view only and raises no conflicts.
  - **Selection.** A selected app texture outlines the G20 elements it covers. A selected G20 element outlines the app textures over it.
  - **The part inspector** shows:
    - the file or entry point, size, placement, bbox and the measured state;
    - evidence and sources, `used_by`;
    - "baked into" / "baked from" links, covers, the comparison with the catalogue;
    - a thumbnail.
  - **The element's inspector** lists its parts ("have it / must draw it") and the app textures over it.
  - **URL flags:** `g20mode=texture`, `look=day`, `conn=0|1`, `lamps=startup|driving|all`, `ours=1`, `open=g20:<id>,group:<g>,ours`, `hide=layout:<name>`, `sel=<part id>`, `probe=parts`.
- **Plans.**
  - `plan.default`, `plan.safe` and `plan.dials` were regenerated. Their decisions and conflict lists are unchanged; only `based_on` and the new element (cover) differ.
  - `plan_dials.py` keeps `panel.background` out of the collar, so `collar.dials.png` is unchanged.
  - `tools/overlay/plan_diff.py` shows this.
- **Tests and shots.**
  - `selftest.js` has the new checks below.
  - `headless.py` gains `--selftest` and `--parts-shots`.
  - The screenshots are `docs/overlay/parts_*.png`.

## 2. Open the page

```sh
python3 -m http.server 8091          # from the repo root (or a worktree)
open 'http://localhost:8091/tools/overlay/constructor/?data=real&g20mode=texture'
```

The page needs no build step and loads nothing from the network.
- Without `design/overlay/g20_parts.json` it shows a banner ("G20 parts not shown: … run tools/overlay/inventory_parts.py") and works as before.
- Without `bench/g20/` the procedural and live parts are marked `!` and fall back to the schematic.
- Without a raster or a scene JSON that part is marked `!` with the missing path.
- The photos are optional as before.

## 3. Regenerate

```sh
export F30_MAIN=/Users/solefir/projects/f30-cluster
py() { UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with jsonschema python -I "$@"; }
py tools/overlay/inventory_parts.py --markdown        # g20_parts.json + the catalogue's parts lists (Chrome measures the live parts)
python3 tools/overlay/headless.py --no-shots            # plan.default / plan.safe
py tools/overlay/plan_dials.py                         # plan.dials, collar, scheme
python3 tools/overlay/headless.py --plan design/overlay/plan.dials.json --no-shots
python3 tools/overlay/plan_diff.py                      # vs main: only hashes and new elements?
py tools/overlay/validate.py
python3 tools/overlay/headless.py --selftest            # sample and real data
python3 tools/overlay/headless.py --parts-shots         # docs/overlay/parts_*.png
```

Results on this branch:
- `validate.py`: every file ok. The only warnings are the existing three "gone, so cover does nothing" in the two default plans.
- Selftest: ALL PASS on the sample and the real data.
  - The tree has 89 part nodes for 89 records (81 under G20 stock, 8 under Ours), and all 80 manifest entries are nodes.
  - 87 parts draw as textures, 2 are marked "not a picture", and there are 0 fallbacks.
  - A simulated missing simulation or image marks the nodes `!` with the reason.
  - The conflicts are unchanged with texture mode and Ours on.

## 4. Open points

1. **The tacho "0" link** (`docs/OVERLAY-REPORT.md` 7.2, point 1). It is a proposal and was not applied: the brief forbids changing existing elements.
2. **The collar over the check-control "i".** The app's collar hides about 21 % of `assist.info_tacho` (7.2, point 7). Check it on the bench before trusting the `wb_dials` window.
3. **`panel.background` rests on one photo.** Its relation (`under`, medium) has only 14 as a basis; 10–13 were not looked at for it.
4. **C parts are crops.** Each C part is drawn by `G20C.drawUnder` / `drawOver` for the whole panel in a state with only its own lamp or condition, then cropped to its box (plus 3 px, or 6 px for a lamp's halo). The crop of `bottom.cc_info` holds the check-control panel's fill behind the "i", and the panel's crop holds the "i". c.js has no single-item entry point.
5. **The minis' fills are drawn unclipped.** The simulation clips them live at D's needle line. That clip lives inside `g20sim.js` and is not exported, and copying it was out of scope, so the inspector says so.
6. **The live parts' boxes depend on the state measured.** The probe used stock, night and the start-up values (rpm 0, fuel 54 L, oil 110 °C); the rev band was measured at idle (750 rpm), because at 0 it is empty. `measured.state` records it per part. Their alpha > 0 boxes include soft shadows; `core` (alpha ≥ 128) does not.
7. **The older screenshots were not retaken.** `docs/overlay/constructor_*.png` come from before this work. The canvas is unchanged by default (texture mode is opt-in), but the tree now shows carets and part counts under the elements.
8. **Re-measuring needs Chrome.** `inventory_parts.py --no-measure` keeps the previous live boxes.
