# Overlay report: stock G20 cluster vs our 6WB Comfort (panel)

Scope: Comfort only, the `panel` target, the current `wb_comfort` layout. Section 7 adds the G20 parts: which G20 elements we already have as our own textures. Brief: `docs/AGENT-BRIEF-overlay-constructor.md`. Data: `design/overlay/` (start with its `README.md`). Constructor: `python3 -m http.server` from the repo root, then open `http://localhost:8000/tools/overlay/constructor/`.

## 1. The answer in one table

| Can I… | G20 elements | Why |
|---|---|---|
| **Not hide; must stay clear** (BMW draws them on top of us) | `tt.parking_brake` (red (P), right column), `bottom.belt_driver`, `assist.gear` (bottom-row P), `overlay.black_box` | Seen on top of our opaque theme in 11, 12, 13 (strong). The (P) is **new**: `shared/visible.js` does not know about it yet. |
| **Keep, or hide, as I choose** (BMW still draws them under us: `reveal` to keep, `cover` to hide) | `bottom.range`, `bottom.clock`, `bottom.street`, `bottom.temperature`, `assist.speed_limit`, `assist.mode_label` (bottom-row COMFORT PLUS), `assist.digital_speed` ("0 km/h"), `assist.rpm_label` ("1/min x1000"), `assist.cold` (medium), `map.region`, `map.position_arrow`, and the stock dials themselves (`structure.*`: scales, needles, rev band, fuel and oil minis) | Seen in 10 (our grid drawn over them) and 14 (our text only), hidden in 11–13 where we are opaque. 19 elements: 17 strong, 2 medium (`assist.cold`, `structure.speedo_info_line`). |
| **Must draw myself** (BMW does not draw them while a custom theme is up) | `assist.mode_label_centre` (big COMFORT PLUS left of the tacho hub), `assist.gear_centre` (big gear letter in the tacho hub; weak), `structure.tacho_info_line` | BMW switches to a different layout with a custom theme: the label and the gear move to the bottom row, and the black box covers the old gear spot. None of them is safety-relevant. |
| **Not settled yet** (needs the photo session in `docs/OVERLAY-PHOTO-PROTOCOL.md`) | `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `bottom.belt_rear`, `bottom.airbag`, `assist.cc_panel` (all **critical**), `tt.auto_h`, `bottom.cc_info`, `assist.info_tacho`, `assist.off` | Lit only in 08 (stock). In 10 and 14 they were off, and in 11–13 a lamp hidden under us looks the same as one that is off. |

What this means for the theme today:

- **Errors in the current layout (default plan, 23).**
  - 7 are our tacho drawn under BMW's own items. The black box covers our tacho hub (`C2.tacho.static`, `w.tacho`, hub and inner ring). The bottom-row "P" sits on our tacho's lower disc and bezel (81 % of the P's area over `C2.tacho.static`). Both are known and harmless to the driver, but anything we put there is invisible.
  - 16 are the 8 critical unknowns, covered by our background (and, for the rear belts, by the speedo's lower disc; for the check-control panel, by the info bar and the `row_b0`/`row_b1` texts).
- **The safe interim plan** (`design/overlay/plan.safe.json`) reveals the 8 critical unknowns: 8 holes, and no critical errors are left. Its cost is 5 warnings:
  - the rear-belt hole `[499, 675, 580, 719]` cuts 44 % into the speedo's lower disc;
  - the check-control hole `[708, 597, 1244, 695]` cuts the `row_b0`/`row_b1` texts.
  - The four left lamps, the steering lamp and the airbag hole sit in our plain background and cost nothing.
- **To keep BMW's own range, clock, street, temperature, speed-limit sign or map:** set `reveal` in the constructor. Their conflicts (info `under-covered`) show which of our layers would have to move. The map needs our speedo and tacho discs cleared off its 840 × 457 px bbox, or the stockMap hole that already exists. Range, clock and the 30 sign sit under the speedo's lower disc; the temperature under the tacho's.

## 2. Per-element table

Relation, evidence and safety come from `design/overlay/g20_comfort.json`. The default decisions follow the brief: over → keep-clear, critical + under → reveal, critical + gone → redraw, the rest → cover. Conflicts are from `design/overlay/plan.default.json`: E error, W warning, i info, with the first three of our elements involved (`w.bg` first).

| id | group | relation | evidence | safety | default decision | conflicts with current 6WB Comfort (default plan) | keep / hide / draw |
|---|---|---|---|---|---|---|---|
| `tt.brake` | telltale | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `tt.tpms` | telltale | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `tt.abs` | telltale | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `tt.dsc` | telltale | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `tt.auto_h` | telltale | **unknown** | none | info | cover | i unknown-covered (w.bg, C2.tacho.bezel, C2.tacho.static +1) | unsettled (photo 19) |
| `tt.parking_brake` | telltale | **over** | strong | critical | keep-clear | — | BMW keeps it; stay clear |
| `tt.steering` | telltale | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `bottom.range` | bottom-row | **under** | strong | info | cover | i under-covered (w.bg, C1.speedo.base, C1.speedo.bezel +1) | keep (reveal) or hide (cover) |
| `bottom.clock` | bottom-row | **under** | strong | info | cover | i under-covered (w.bg, C1.speedo.base, C1.speedo.bezel +2) | keep (reveal) or hide (cover) |
| `bottom.belt_rear` | bottom-row | **unknown** | none | critical | cover | E critical-covered (w.bg, C1.speedo.base, C1.speedo.bezel +1) | unsettled (photo 16/18) |
| `bottom.belt_driver` | bottom-row | **over** | strong | critical | keep-clear | — | BMW keeps it; stay clear |
| `bottom.airbag` | bottom-row | **unknown** | none | critical | cover | E critical-covered (w.bg) | unsettled (photo 16) |
| `bottom.cc_info` | bottom-row | **unknown** | none | info | cover | i unknown-covered (w.bg, C6.infobar.body) | unsettled (photo 16/17/21) |
| `bottom.street` | bottom-row | **under** | strong | info | cover | i under-covered (w.bg, w.row_b0, w.row_b1) | keep (reveal) or hide (cover) |
| `bottom.temperature` | bottom-row | **under** | strong | info | cover | i under-covered (w.bg, C2.tacho.bezel, C2.tacho.static +2) | keep (reveal) or hide (cover) |
| `assist.speed_limit` | assist-message | **under** | strong | info | cover | i under-covered (w.bg, C1.speedo.base, C1.speedo.tick-groove-rim +3) | keep (reveal) or hide (cover) |
| `assist.cc_panel` | assist-message | **unknown** | none | critical | cover | E critical-covered (w.bg, C5.window.base, C6.infobar.body +3) | unsettled (photo 16/17/21) |
| `assist.info_tacho` | assist-message | **unknown** | none | info | cover | i unknown-covered (w.bg, C2.tacho.bezel, C2.tacho.static +2) | unsettled (photo 16/17/21) |
| `assist.mode_label_centre` | assist-message | **gone** | strong | info | cover | — | draw it ourselves or drop |
| `assist.mode_label` | assist-message | **under** | strong | info | cover | i under-covered (w.bg, C2.tacho.bezel, C2.tacho.static +1) | keep (reveal) or hide (cover) |
| `assist.gear_centre` | assist-message | **gone** | weak | info | cover | — | draw it ourselves or drop |
| `assist.gear` | assist-message | **over** | strong | info | keep-clear | E content-under-over (C2.tacho.bezel, C2.tacho.static, w.tacho) | BMW keeps it; stay clear |
| `assist.digital_speed` | assist-message | **under** | strong | info | cover | i under-covered (w.bg, C1.speedo.base, C1.speedo.inner-disc +3) | keep (reveal) or hide (cover) |
| `assist.rpm_label` | assist-message | **under** | strong | cosmetic | cover | i under-covered (w.bg, C2.tacho.p-box, C2.tacho.static +3) | keep (reveal) or hide (cover) |
| `assist.off` | assist-message | **unknown** | none | info | cover | i unknown-covered (w.bg, C2.tacho.p-box, C2.tacho.static +1) | unsettled (photo 16/17) |
| `assist.cold` | assist-message | **under** | medium | info | cover | i under-covered (w.bg, C4.oil.face, C4.oil.inner-arc +2) | keep (reveal) or hide (cover) |
| `map.region` | map-nav | **under** | strong | info | cover | i under-covered (w.bg, C1.speedo.base, C1.speedo.bezel +27) | keep (reveal) or hide (cover) |
| `map.position_arrow` | map-nav | **under** | strong | info | cover | i under-covered (w.bg, C5.window.base) | keep (reveal) or hide (cover) |
| `overlay.black_box` | overlay | **over** | strong | cosmetic | keep-clear | E content-under-over (C2.tacho.hub-ring, C2.tacho.inner-ring, C2.tacho.static +1) | BMW keeps it; stay clear |
| `structure.speedo` | structure | **under** | strong | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.speedo_needle` | structure | **under** | strong | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.speedo_info_line` | structure | **under** | medium | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.tacho` | structure | **under** | strong | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.tacho_needle` | structure | **under** | strong | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.tacho_info_line` | structure | **gone** | medium | cosmetic | cover | — | draw it ourselves or drop |
| `structure.rev_band` | structure | **under** | strong | cosmetic | cover | — | keep (reveal) or hide (cover) |
| `structure.fuel_mini` | structure | **under** | strong | info | cover | — | keep (reveal) or hide (cover) |
| `structure.oil_mini` | structure | **under** | strong | info | cover | — | keep (reveal) or hide (cover) |

`structure.*` elements are context (a ghost of the stock dials) and raise no conflicts by rule.

## 3. Open unknowns and the photo protocol

The full protocol, with the reasoning per element and the diagnostic layout, is in `docs/OVERLAY-PHOTO-PROTOCOL.md`. It is one evening with the car parked, about 30 minutes. Photos are numbered from 15 and saved as `reference/g20/NN_<what>_<yyyy-mm-dd>.jpg`.

| Photo | Setting | Action | Settles |
|---|---|---|---|
| 15 | stock theme (app stopped) | START-STOP without the brake (ignition on, engine off); burst over the first 4 s | the reference: which lamps the start-up check lights |
| 16 | `diag_overlay` layout | engine off, then START-STOP without the brake; burst | `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `bottom.airbag`, `bottom.belt_rear`, `assist.off`, `assist.cc_panel`, `bottom.cc_info`, `assist.info_tacho`, both info lines |
| 17 | `diag_overlay` | 10–20 s later ("press the brake" message) | check-control panel, its "i", `assist.off` |
| 18 / 18b | `diag_overlay`, then stock | rear door open and close; rear belt buckle, then unbuckle | `bottom.belt_rear` |
| 19 | `diag_overlay` | AUTO H on; then a hold in D | `tt.auto_h` (and re-checks the (P)) |
| 20 / 20b | `diag_overlay`, then stock | DSC short (DTC), then long (DSC OFF) | `tt.dsc` |
| 21 | `diag_overlay` | open a door or the bonnet (check-control message) | fallback for the check-control items |
| 22 | `diag_overlay` | cold start (optional) | `assist.cold` |
| 23 | stock | repeat any action whose cell stayed empty | tells `gone` from not lit |

**The test pattern `diag_overlay`** (design only; nothing is built). The layout is transparent except for 18 split cells. Each cell is opaque over the left half of one element's bbox (plus 6 px), with the right half clear. Read a cell like this:

- the whole glyph visible means `over`;
- only the right half, cut at the cell edge, means `under`;
- nothing, while the stock repeat shows it lit, means `gone`.

Four control cells have known answers: the (P), the driver belt, range and temperature. The budget is 1 effect layer (21 of 32 uniforms, no textures) plus up to 4 text sheets.

**Risk:** if the cluster drops our connection when the ignition changes, photo 16 misses the start-up lamp check. Then the brake, TPMS, ABS, steering and airbag lamps stay unknown, because no safe action lights them outside that check. Until then, `plan.safe.json` (reveal them all) is the conservative choice.

`assist.gear_centre` cannot be settled by any photo: BMW's black box is always on top of that spot. It makes no difference to a design.

## 4. How this was made, and how sure it is

| Package | Output | Check |
|---|---|---|
| A: schema | `design/overlay/schema.json`, `constraints.json`, `README.md`, `sample/`, `tools/overlay/validate.py` | every file validates |
| B: photo rectification | `tools/overlay/rectify.py` gives `bake/work/overlay/rect/08…14.png` and `H.json` (local) | rms in panel px: 08 1.11, 09 1.02, 10 1.21, 11 0.16, 12 0.82, 14 0.81. Photo 13 (480×360) is not usable for geometry. Lens distortion is fitted with a homography plus k1. |
| C: 6WB export | `tools/overlay/export_wb.py` gives `wb_comfort.json` (96 elements: 44 baked, 52 live) and 48 masks (≈ 250 KB) | IoU against the P10 bench render: speedo 0.999, tacho 0.999, fuel 0.992, oil 0.991 |
| D: constructor | `tools/overlay/constructor/` (static, offline, no build) | sample conflicts equal the hand-made `sample/expected_conflicts.json` (15 of 15); 38-check self-test (`?selftest=1`) |
| E: G20 catalogue | `tools/overlay/catalogue_g20.py` gives `g20_comfort.json` (38 elements) and 38 schematic SVGs | every lit or drawn item in 08 is catalogued or excluded with a reason; positions within 1–3 px of C9 once C9's old-rect offset is accounted for (B showed C9's 08 rect was off by up to 5 px in the right column) |
| F: relations | `tools/overlay/relations_g20.py` and `.json`, `docs/OVERLAY-PHOTO-PROTOCOL.md` | every element has a relation, evidence and basis; every unknown has a protocol step |
| G: integration | `tools/overlay/headless.py` gives `plan.default.json`, `plan.safe.json` and the screenshots | both plans validate |

To re-run everything:

```sh
export UV_CACHE_DIR=bake/work/.uvcache
PY="uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python"
$PY tools/overlay/rectify.py            # needs reference/g20 (local)
$PY tools/overlay/export_wb.py
$PY tools/overlay/catalogue_g20.py      # also applies relations_g20.json
uv run -q --no-project --with jsonschema --with pillow python tools/overlay/validate.py
python3 tools/overlay/headless.py       # plans + screenshots (Chrome)
```

**Choices made along the way.** The owner may want to revisit these.

- **`content-under-over` ignores our plain backgrounds:** a background under BMW's lamp hides nothing. Our dials and texts still count.
- **`drawn_on_car: false`** marks elements the car does not draw with the default settings, and they raise no conflicts:
  - `C10.panel.background` and `C7.bar.range` are not packed into any scene texture;
  - the `!baked`-toggled widgets are off by default.
- **The stockMap hole is cut from every background,** and the plan stores the setting in `settings.stockMap`. The default plan has it off.
- **Safety:**
  - `tt.steering` is critical, though it is not on the brief's list (steering-fault warning).
  - `assist.cc_panel` is raised to critical: it carries the oil-pressure and coolant warnings, and no lamp of ours covers those.
- **Lamp colours are as measured.** The (P) and the steering lamp read red in 08; C9 had called them amber.

**Side findings for the main thread** (not acted on, since §2 forbids those paths):

1. **`shared/visible.js` lacks BMW's red (P)** at about `[1838, 217, 1900, 260]`. It is `over`, with strong evidence. It also lacks the gear letter, which was dropped in cb28ce7 but is still `over` at `[1398, 668, 1424, 703]`.
2. **Our clock seems to show UTC:**
   - 14: ours 08:16 next to BMW's 10:15;
   - 12: ours 20:29, with EXIF 22:29 +02:00.
3. **The baked `C1.speedo.bezel` reaches 2,764 px outside the speedo disc,** and `C6.infobar.body` 23,040 px below the window texture (y > 648). The car clips both.

## 5. Package H (proposal only; nothing is built, it needs the owner's approval)

The goal: let the theme read `plan.json`, so the owner's decisions take effect without hand-editing layouts.

1. **Holes.**
   - WBBACK today takes one `hole` rect plus `holeWhen` and `holeRadius`. Generalise it to `holes: [{x, y, w, h, r, when?}]`, at most 8, passed as one `vec4 u_holes[8]` plus one `vec4 u_holeR[2]` (radii). That is 10 uniform slots, which fits the 32-uniform budget only if WBBACK's current count allows it: check `docs/BAKE-P10-levels.md` and cd6ac29, which got WBBACK under 32.
   - If it does not fit, pack the holes into a tiny R8 mask asset (for example 240×90, 1 px = 8 panel px). It must stay bound at all times: every sampler needs an asset, or RAMSES skips the layer.
   - The dials and other widgets keep drawing over holes, so a hole that cuts dial content needs that widget moved. That is the constructor's `hole-cuts-content` warning.
2. **Keep-clear boxes.**
   - `shared/visible.js` gets `BMW_OVER = [{id, rect}]`, loaded from `design/overlay/constraints.json` + `plan.keep_clear` at build time. It is not read at run time on the car.
   - `check()` warns per widget, exactly as for `BLACK_BOX` and `BELT` today, and the bench's car view draws them.
   - The (P) should be added first.
3. **Where the plan lives.**
   - A generator step (like `design/gen_6wb.py`) reads `plan.json` and writes the layout's `bg.holes`, plus a `planVersion` with the plan's `based_on` hashes.
   - The app never parses `plan.json` on the car.
4. **Test.**
   - The bench's car view shows the holes.
   - A car photo after the protocol session (`diag_overlay` vs the real layout) confirms each revealed lamp shows through.

## 6. Screenshots

These are the constructor on the real data, default plan, without photo underlays. The same views with photo 08 under them are in `bake/work/overlay/shots/` (local only).

![Default view](overlay/constructor_default.png)

![Conflicts](overlay/constructor_conflicts.png)

![Decisions](overlay/constructor_decisions.png)

![Canvas with labels](overlay/constructor_canvas_labels.png)

## 7. G20 parts: what we already have as our own drawings

Since this report was first written the G20 has been taken apart into real parts: the bench simulation (`bench/g20/`, `docs/G20SIM-REPORT.md`) and the app's own G20 textures (`apps/f30_cluster/hud/scene/g20_*.json`, `collar.json`). `design/overlay/g20_parts.json` lists them, one record per part, and every catalogue element now has a `parts` list (`design/overlay/README.md` section 6). Brief: `docs/AGENT-BRIEF-overlay-parts.md`; work report: `docs/OVERLAY-PARTS-REPORT.md`.

**The answer: every one of the 39 catalogue elements already exists as our own drawing, in the day and the night look.** Nothing has to be drawn from scratch. What is left is evidence: parts fitted to one photo, or with a weak model, and variants nobody photographed (the last column, and point 9 below).

89 parts:

| Kind | Count | Drawn in the constructor |
|---|---|---|
| B raster layers (`bench/g20/structure/*.png`, 21 layers × day and night) | 42 | as textures, at their placement |
| C procedural items (`bench/g20/c.js`): telltales, bottom row, sign, check-control panel, texts | 28 | alone, through `G20C.drawUnder` / `drawOver` |
| The black area (`g20sim.js` draws it itself; not a manifest entry) | 1 | alone, through `G20Sim.drawOver` |
| D live items (`bench/g20/live/live.js`): map, arrow, pointers, glows, rev band, mini needles | 9 | alone, through `G20Live.drawMap` and its `_debug.draw*` |
| The font (`c.font`) | 1 | not a picture |
| App textures: `g20_speedo`, `g20_tacho`, `g20_fuel` (+ fill), `g20_oil` (+ fill), `collar` | 7 | decoded from the scene JSON, at their layout boxes |
| `g20_lut` | 1 | data, not a picture |

87 parts draw as textures; the font and the LUT are marked "not a picture"; **no part falls back** to its schematic. B's two tacho "0" rasters are skipped by the simulation (C draws the "0" live) and show only with lamps "all".

### 7.1 Element by element

Raster names drop the `.day` / `.night` suffix (both exist for each). "App texture": the app's own texture of that element, or "under X": an app texture that hides at least 5 % of it (`covers` in the file has every overlap of 10 px or more). The app's textures are all night looks; the app draws the pointers, glows, rev band and mini needles live from `g20_lut`, and the digital speed and "1/min x1000" as text (`design/gen_g20.py`). Everything else in the G20 Comfort layout is BMW's own, through see-through areas.

| Element | Rel. | Raster (B) | Procedural (C) | Live (D) | App texture | Day / night | Missing: still to draw or settle |
|---|---|---|---|---|---|---|---|
| `tt.brake` | unknown | – | `tt.brake` | – | – | day / night | nothing |
| `tt.tpms` | unknown | – | `tt.tpms` | – | – | day / night | nothing |
| `tt.abs` | unknown | – | `tt.abs` | – | – | day / night | nothing |
| `tt.dsc` | unknown | – | `tt.dsc` | – | – | day / night | nothing |
| `tt.auto_h` | unknown | – | `tt.auto_h` | – | – | day / night | nothing |
| `tt.parking_brake` | over | – | `tt.parking_brake`, `tt.parking_brake.hold` | – | – | day / night | nothing |
| `tt.steering` | unknown | – | `tt.steering` | – | – | day / night | nothing |
| `bottom.range` | under | – | `bottom.range` | – | – | day / night | nothing |
| `bottom.clock` | under | – | `bottom.clock` | – | – | day / night | nothing |
| `bottom.belt_rear` | unknown | – | `bottom.belt_rear` | – | – | day / night | nothing |
| `bottom.belt_driver` | over | – | `bottom.belt_driver` | – | – | day / night | nothing |
| `bottom.airbag` | unknown | – | `bottom.airbag` | – | – | day / night | nothing |
| `bottom.cc_info` | unknown | – | `bottom.cc_info` | – | – | day / night | nothing |
| `bottom.street` | under | – | `bottom.street` | – | – | day / night | nothing |
| `bottom.temperature` | under | – | `bottom.temperature` | – | – | day / night | nothing |
| `assist.speed_limit` | under | – | `assist.speed_limit` | – | – | day / night | nothing |
| `assist.cc_panel` | unknown | – | `assist.cc_panel` | – | – | day / night | nothing |
| `assist.info_tacho` | unknown | – | `assist.info_tacho` | – | under `collar` | day / night | evidence none: c.assist.info_tacho |
| `assist.mode_label_centre` | gone | – | `assist.mode_label_centre` | – | – | day / night | stock layout only |
| `assist.mode_label` | under | – | `assist.mode_label` | – | – | day / night | theme connected only |
| `assist.gear_centre` | gone | – | `assist.gear_centre` | – | under `g20_tacho` | day / night | stock layout only |
| `assist.gear` | over | – | `assist.gear` | – | – | day / night | theme connected only |
| `assist.digital_speed` | under | – | `assist.digital_speed` | – | – | day / night | nothing |
| `assist.rpm_label` | under | – | `assist.rpm_label` | – | under `g20_tacho` | day / night | nothing |
| `assist.off` | unknown | – | `assist.off`, `assist.tacho_zero` | – | under `g20_tacho` | day / night | evidence weak: c.assist.off |
| `assist.cold` | under | – | `assist.cold` | – | under `collar` | day / night | evidence weak: c.assist.cold |
| `map.region` | under | `map_veil` | – | `map` | – | day / night | evidence weak: structure.map_veil.day, structure.map_veil.night |
| `map.position_arrow` | under | – | – | `map.arrow` | – | day / night | nothing |
| `structure.speedo` | under | `speedo.bottom_end`, `speedo.frame`, `speedo.glow`, `speedo.wing`, `speedo_numerals`, `speedo_scale_label` | – | – | `g20_speedo`, under `collar` | day / night | nothing |
| `structure.speedo_needle` | under | – | – | `glow.speedo`, `pointer.speedo` | under `g20_speedo` | day / night | evidence weak: live.glow.speedo, live.pointer.speedo |
| `structure.speedo_info_line` | under | `speedo_info_line` | – | – | under `g20_speedo` | day / night | nothing |
| `structure.tacho` | under | `tacho.bottom_end`, `tacho.frame`, `tacho.glow`, `tacho.wing`, `tacho_numerals`, `tacho_zero (skip)` | – | – | `g20_tacho`, under `collar` | day / night | nothing |
| `structure.tacho_needle` | under | – | – | `glow.tacho`, `band.tacho`, `pointer.tacho` | under `g20_tacho` | day / night | evidence weak: live.pointer.tacho |
| `structure.tacho_info_line` | gone | `tacho_info_line` | – | – | under `g20_tacho` | day / night | stock layout only |
| `structure.rev_band` | under | `rev_band` | – | – | under `collar`, under `g20_tacho` | day / night | nothing |
| `structure.fuel_mini` | under | `fuel_mini`, `fuel_mini.fill` | – | `mini.fuel` | `g20_fuel`, `g20_fuel_fill`, under `collar`, under `g20_speedo` | day / night | evidence weak: live.mini.fuel |
| `structure.oil_mini` | under | `oil_mini`, `oil_mini.fill` | – | `mini.oil` | `g20_oil`, `g20_oil_fill`, under `collar`, under `g20_tacho` | day / night | evidence weak: structure.oil_mini.fill.day, structure.oil_mini.fill.night, live.mini.oil |
| `overlay.black_box` | over | – | `sim.black_box` | – | under `g20_tacho` | day / night | theme connected only |
| `panel.background` (new) | under | `bg` | – | – | under `collar`, under `g20_speedo`, under `g20_tacho` | day / night | nothing |

Never photographed, so drawn from a model or not at all (`docs/G20SIM-REPORT.md` section 7.6): the SPORT / ECO PRO labels, a three-digit sign, minus temperatures, a one-digit hour, other check-control messages, what lights `assist.info_tacho`, the gear letters R / N / S, a cold engine in the stock layout. The stock pointers were only seen at rest.

### 7.2 Cross-checks (simulation against catalogue)

Findings only: no existing element's relation, evidence, bbox or poly was changed. Proposed corrections are marked as such.

1. **A suspicious link: the tacho "0".** C's `c.assist.tacho_zero` (the tacho scale's "0", drawn when the engine runs) is linked to `assist.off`; B's raster `structure.tacho_zero.day/.night` (skipped by the simulation) at the same spot (97.7 % overlap) is linked to `structure.tacho`. The "0" and OFF swap at one spot, but the "0" is a scale numeral, not the OFF text: with it, `assist.off`'s parts reach 8 px above and 11 px below the catalogue box `[1516, 580, 1568, 604]`. *Proposal:* link both "0"s to `structure.tacho` (or give the "0" its own element), and keep `assist.off` for OFF.
2. **Unresolved parts** (no single element): `c.font` (the font), `app.g20_lut` (data), `app.collar` (it spans the rev band, both minis, both dials, `assist.cold`, `assist.info_tacho` and the background).
3. **One new element:** `panel.background` (group `structure`, so context only and no conflicts): B's opaque background, which the simulation draws in every state. Relation `under`, evidence `medium`, on one basis row: photo 14, around our text-only theme (B's background scores SSIM 0.812 there, `docs/G20SIM-REPORT.md` section 5). Photos 10–13 were not assessed for it. Not added: the numerals and scale labels (the simulation links them to `structure.speedo` / `structure.tacho`, and the catalogue's `excluded` already counts them in those outlines), and the map veil (linked to `map.region`, which covers "the lighter map background seen in 14").
4. **Relation and state: no conflict.** Every `over` element has only `over` parts (`tt.parking_brake` red and green, `bottom.belt_driver`, `assist.gear`, the black area), every `gone` element only stock-layout parts (`assist.mode_label_centre`, `assist.gear_centre`, `structure.tacho_info_line`), and the connected-only parts belong to `assist.mode_label` (under), `assist.gear` and `overlay.black_box` (over). **13 assumptions:** the simulation draws 12 elements the catalogue lists as `unknown` under a connected theme: `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.auto_h`, `tt.steering`, `bottom.belt_rear`, `bottom.airbag`, `bottom.cc_info`, `assist.cc_panel`, `assist.info_tacho` and `assist.off` (with the "0"). That is the simulation's modelling choice, not evidence; the photo protocol (section 3) still settles them.
5. **Boxes** (parts' union against the catalogue box, px as x0, y0, x1, y1; the glows are left out: they spread by design; "core" is alpha ≥ 128):
   - `structure.speedo` x1 +56 (core +54) and `structure.tacho` x0 −46 (core −44): the bottom-line end hooks (`*.bottom_end`, drawn only without a check-control message) lie outside the hulls, which were measured on 08, where the panel covered them.
   - `structure.speedo_info_line` x1 +85 (core +82) and `structure.tacho_info_line` x0 −85 (core −83): each info line is two segments (`docs/G20SIM-REPORT.md` section 5); the catalogue has one.
   - `structure.fuel_mini` x1 −11 (core −13) and `structure.oil_mini` x0 +12 (core +15): the catalogue hulls include the needles; B's frames follow the white line.
   - `structure.rev_band` y1 +7 (core +5): the band's bottom is lower than the hull, as B reports.
   - `structure.speedo_needle`: the pointer's alpha > 0 box is +51 px wide (its faint shadow); its core is within 5 px. `structure.tacho_needle`: core x1 +91, from the live rev band `live.band.tacho` (linked to the needle), which runs from 0 to the pointer (measured at idle, x 1554–1643); the catalogue's needle hull holds only the bar.
   - Parts mostly outside their element's shape: the four bottom-end hooks (0 %), the info lines (33–37 %), `structure.map_veil.night` (48 %: a box over the map, against the hull of the roads), the "0" (50 %).
6. **App against simulation:** the app bakes statically what the simulation draws on a condition: B's tacho "0" (skipped by the simulation, which swaps "0" and OFF live) and the bottom-end hooks (hidden in the simulation while a check-control message shows); the minis' fills are clipped live at the needle in the simulation and lit by the shader from 0 up to the needle in the app.
7. **What the app's textures cover** (alpha ≥ 128): `g20_tacho` hides `assist.off` (100 %) and `assist.rpm_label` (98 %; the app redraws "1/min x1000" as text, but not OFF: it shows the baked "0"), `assist.gear_centre` (56 %, gone anyway) and 56 % of `overlay.black_box` (BMW draws that on top). `g20_speedo` hides 18 px of `bottom.cc_info` and 1.6 % of `assist.cc_panel`. **The collar** (quarter size, so its edges are good to about 2 px) hides 21 % of `assist.info_tacho`, for which `docs/OVERLAY-PLAN-DIALS.md` opened a small window in our tacho rim: `tools/bake_scene.py` grows the collar by 4 px and blurs it, into the 3 px clearance `plan_dials.py` keeps around revealed elements. It also touches `tt.dsc` (10 px) and `assist.speed_limit` (29 px). Check the "i" on the bench (open point).
8. **The four housing LEDs** (low beam, side lights, check engine, DSC OFF; `c.js` LAMPS with `onPanel: false`, the catalogue's `excluded`) are outside the panel: no part, never drawn.

### 7.3 The plans, regenerated

`plan.default.json` and `plan.safe.json` (`tools/overlay/headless.py`) and `plan.dials.json` (`tools/overlay/plan_dials.py`, then `headless.py --plan`) were regenerated against the linked catalogue. `tools/overlay/plan_diff.py` compares them with `main`:

| Plan | Changed | Decisions | Conflicts |
|---|---|---|---|
| `plan.default.json` | `based_on.g20` | unchanged; `panel.background` added: cover | 114 → 114, identical |
| `plan.safe.json` | `based_on.g20` | unchanged; `panel.background` added: cover | 99 → 99, identical |
| `plan.dials.json` | `based_on.g20` | unchanged; `panel.background` added: cover, with a note | 47 → 47, identical |

**The new element brings no conflict:** it is in the `structure` group, which is context only. `plan_dials.py` keeps it out of the collar (`NOT_IN_COLLAR`): as an `under` element covered by our dials it would otherwise have made the whole panel collar. `collar.dials.png` and `docs/overlay/dials_scheme.png` are byte-identical.

### 7.4 Screenshots

Our own drawings only (no photo underlay). The constructor in texture mode, theme connected, start-up lamps, at night and by day:

![Texture mode, night, connected](overlay/parts_night_connected.png)

![Texture mode, day, connected](overlay/parts_day_connected.png)

The tree on the telltales and the speedo's parts, one part selected (inspector with its thumbnail, cross-links and its element below it):

![The tree and a part](overlay/parts_tree.png)

"Ours: G20 parts in the app": the `g20_comfort` textures with `g20_speedo` selected (the elements it covers dashed), and the `wb_dials` collar alone:

![Ours, g20_comfort](overlay/parts_ours.png)

![Ours, the collar](overlay/parts_ours_collar.png)
