# Overlay map: relations of the stock G20 elements and the photo protocol for the unknowns

Package F of `docs/AGENT-BRIEF-overlay-constructor.md` (Comfort, panel target). It covers:

- the relation, evidence and safety of all 38 elements in `design/overlay/g20_comfort.json`;
- a numbered photo session that settles every `unknown`, and the weak and medium ones that a photo can firm up;
- a diagnostic test-pattern layout. It is a design only: nothing is built.

The data lives in `tools/overlay/relations_g20.json`. `tools/overlay/relations_g20.py` applies it to the catalogue, and `tools/overlay/catalogue_g20.py` calls it at its end.

## 1. What the photos say: one row per element

Rules (brief §5):
- **over:** seen on top of our opaque pixels in 11, 12 or 13.
- **under:** seen in 10 or 14, and not seen in 11 to 13 where we were opaque, with the item plausibly in the same state.
  - In 10, an item is also shown to be beneath us when our grid lines or labels are drawn across it.
- **gone:** 10 or 14 show the spot uncovered, the state is the same, and the item is absent.
- **unknown:** everything else. A lamp that is not lit in 11 to 13 is not evidence.

Evidence:
- **strong:** two photos or more, or one very clear photo.
- **medium:** one clear photo.
- **weak:** an inference.

Where our pixels were opaque, per photo:

| Photo | Build | Where our pixels were opaque | Source |
|---|---|---|---|
| 11 | early build: eefecfd-era layout, old geometry | Everywhere. The `bg` wbback widget is a full-panel backdrop at z 0. | `shared/shaders.js` WBBACK: "opaque black over BMW's own gauges". Only BMW's over items show anywhere in 11. |
| 12, 13 | cb28ce7 | Everywhere. The C10 baked background plus WBBACK. The stockMap hole was off: our window is drawn. | |
| 14 | 0.7.2 | Only under our own glyphs: only our text layers drew. | |
| 10 | grid layout | Only on the grid lines, the yellow labels, the L1–L16 and ATLAS text, and the two swatch rows (250–1350 × 440–600). | |

| id | relation | evidence | safety | reason |
|---|---|---|---|---|
| `tt.brake` | unknown | none | critical | Lit only in 08 (stock); unlit at a visible spot in 10/14; 11-13 cannot tell hidden from off. |
| `tt.tpms` | unknown | none | critical | Lit only in 08; unlit in 10/14; 11-13 inconclusive. |
| `tt.abs` | unknown | none | critical | Lit only in 08; unlit in 10/14; 11-13 inconclusive. |
| `tt.dsc` | unknown | none | critical | Lit only in 08; unlit in 10/14; 11-13 inconclusive. |
| `tt.auto_h` | unknown | none | info | Drawn with a theme connected (10, 14), so not gone; 10 cannot show the z-order (green on our green grid line) and in 12/13 Auto Hold was evidently off (red (P), no green P). |
| `tt.parking_brake` | over | strong | critical | Red (P) seen on top of our opaque background in 12 and 13. |
| `tt.steering` | unknown | none | critical | Lit only in 08; unlit in 10/14; 11-13 inconclusive. |
| `bottom.range` | under | strong | info | Seen in 10 (our green x 200 grid line runs over the '4') and 14; hidden in 11-13 where we are opaque; always shown. |
| `bottom.clock` | under | strong | info | Seen in 10 and 14; hidden in 11-13 where we are opaque; always shown. |
| `bottom.belt_rear` | unknown | none | critical | Lit only in 08 (start-up check); unlit in 10/14; 11-13 inconclusive. |
| `bottom.belt_driver` | over | strong | critical | Seen on top of our opaque background in 11, 12, 13; in 10 it interrupts our grid lines (x 600, y 700). |
| `bottom.airbag` | unknown | none | critical | Lit only in 08 (start-up check); unlit in 10/14; 11-13 inconclusive. |
| `bottom.cc_info` | unknown | none | info | Shown only with a check-control message (08); no message in 10/14; in 14 our clock covers the spot. |
| `bottom.street` | under | strong | info | Seen in 10 (our x 950/1000 grid lines run over 'Lviv') and 14; hidden in 11-13 where we are opaque. |
| `bottom.temperature` | under | strong | info | Seen in 10 (our x 1600 grid line runs over it) and 14; hidden in 11-13 where we are opaque. |
| `assist.speed_limit` | under | strong | info | Seen in 10 with our yellow '500/600' label drawn over it, and in 14; hidden in 11-13. |
| `assist.cc_panel` | unknown | none | critical | Only seen in 08 (stock); never photographed with a check-control message while our theme was up. |
| `assist.info_tacho` | unknown | none | info | Only seen in 08 (with a pending message); absent in 14; 11-13 inconclusive. |
| `assist.mode_label_centre` | gone | strong | info | In 10 and 14 (theme connected, Comfort, same as 08/09) its spot is uncovered and empty; BMW shows the label in the bottom row instead. |
| `assist.mode_label` | under | strong | info | Shown in the bottom row with a theme connected (10: our x 1300 grid line runs over 'COMFORT'; 14); hidden in 11-13 although the P next to it is drawn over us. |
| `assist.gear_centre` | gone | weak | info | Inference: with a theme connected BMW shows the gear in the bottom row (10-14) and its black box (over) sits on this spot, so the centre letter is never visible; the spot itself is not uncovered in any photo. |
| `assist.gear` | over | strong | info | P seen on top of our opaque background in 11, 12, 13; in 10 it interrupts our x 1400 grid line. |
| `assist.digital_speed` | under | strong | info | Seen in 10 (our x 500 grid line runs over the '0') and 14; hidden in 11-13 where we are opaque. |
| `assist.rpm_label` | under | strong | cosmetic | Seen in 10 (our '1400/600' label drawn over 'x1000') and 14; hidden in 11-13. |
| `assist.off` | unknown | none | info | Shown only with the engine off (08); 10 and 14 show the tacho's '0' instead (engine on); engine state in 11-13 unknown. |
| `assist.cold` | under | medium | info | In 10 our grid lines (x 1850, x 1900, y 650) run over 'COLD'; seen in 14; 11-13 inconclusive (oil temperature then unknown). |
| `map.region` | under | strong | info | Seen in 10 (under our grid; hidden under our swatches) and 14; hidden in 11-13 behind our opaque window (hole off). |
| `map.position_arrow` | under | strong | info | Seen in 14; in 10 hidden under our opaque swatch row; hidden in 11-13. |
| `structure.speedo` | under | strong | cosmetic | Drawn in 10 (beneath our grid lines and swatches) and 14; hidden in 11-13. |
| `structure.speedo_needle` | under | strong | cosmetic | In 10 visible below y 600 and hidden by our opaque swatch above it; seen in 14; hidden in 11-13. |
| `structure.speedo_info_line` | under | medium | cosmetic | Seen in 14 only (10 covers it with labels); hidden in 11-13. |
| `structure.tacho` | under | strong | cosmetic | Drawn in 10 (beneath our grid) and 14; hidden in 11-13. |
| `structure.tacho_needle` | under | strong | cosmetic | Seen in 10 and 14 (at idle, so not at the 08 position); hidden in 11-13. |
| `structure.tacho_info_line` | gone | medium | cosmetic | In 14 its left part (x 1306-1419) is uncovered and empty while the speedo's line is drawn; the right part is under the black box; 10 covers it with labels. |
| `structure.rev_band` | under | strong | cosmetic | Seen in 10 and 14; hidden in 11-13. |
| `structure.fuel_mini` | under | strong | info | Seen in 10 (beneath our grid) and 14; hidden in 11-13 under our own mini/background. |
| `structure.oil_mini` | under | strong | info | Seen in 10 (beneath our grid) and 14; hidden in 11-13. |
| `overlay.black_box` | over | strong | cosmetic | Drawn on top of our opaque face in 11, 12, 13 (and cuts our grid in 10); only while a theme is connected. |

**Totals:** 4 over, 19 under, 3 gone, 12 unknown. Evidence: 22 strong, 3 medium, 1 weak, 12 none.

**One pattern behind the three gone elements.** With a custom theme connected, BMW switches the panel to a different layout:
- The mode label and the gear letter move to the bottom row: `assist.mode_label` is under, `assist.gear` is over.
- The tacho-centre block (`assist.mode_label_centre`, `assist.gear_centre`, `structure.tacho_info_line`) is no longer drawn there.
- The black box covers the old gear spot.

**Safety review**
- **`tt.steering`: kept critical.** §3's list does not name it, but in 08 it is red-orange like the brake lamp. A steering-system fault is a warning to stop or drive carefully, and UN R79 requires a steering-failure warning to be visible.
- **`assist.cc_panel`: raised from info to critical.** The panel is the channel for check-control warnings. These include the oil-pressure and coolant warnings that §3 lists, and those have no lamp among the catalogued telltales. So a plan must not hide the panel without a redraw.
  - `bottom.cc_info` stays info: it is the "i" of an information message, inside the panel's area.
- **Lamp colours as measured in 08.** (P) and the steering lamp measure hue 10–12°, like the red brake lamp. TPMS, ABS and DSC measure about 34° (amber). C9 had called (P) and steering amber.

## 2. Photo session (one evening, car parked, about 30 minutes)

### What needs settling

| Element | Status now | Settled by photo |
|---|---|---|
| `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `bottom.airbag`, `bottom.belt_rear` | unknown | 16 (17, 18 or 20 as fallbacks) |
| `assist.off` | unknown | 16 |
| `assist.cc_panel`, `bottom.cc_info`, `assist.info_tacho` | unknown | 16 or 17; 21 as fallback |
| `tt.auto_h` | unknown | 19 |
| `bottom.belt_rear` | unknown | 18 if the self-test does not light it |
| `tt.dsc` | unknown | 20 if the self-test does not light it |
| `assist.cold` | under, medium | 22 (cold engine) |
| `structure.speedo_info_line` | under, medium | 16 (controls cell 13) |
| `structure.tacho_info_line` | gone, medium | 16 (cell 14) |
| `assist.gear_centre` | gone, weak | **Cannot be settled by a photo.** BMW's black box (over) sits on the spot whenever a theme is up. It makes no difference to a design. |

### Before you start

- Build the diagnostic layout `diag_overlay` (section 3). This is package H's job or the main thread's; it is not built here. Make it selectable like `grid` was for photo 10.
- Set the camera up as for photos 08–14:
  - from the driver's eye position, with the whole panel in frame;
  - no flash, exposure set for the screen;
  - use burst or 4K video for the timed steps (the self-test lamps last about 2 to 4 s).
- Save the photos as `reference/g20/NN_<what>_<yyyy-mm-dd>.jpg`, numbered from 15. Video frames are fine; save the chosen frame as the .jpg.
- In every photo keep the physical LEDs at the left and right of the panel visible (low beam, check engine, DSC OFF). They show whether the start-up lamp check was running when the photo was taken.

### Steps

**15. Stock reference for the self-test**
- Setting: our app stopped or disconnected, so the stock theme shows.
- Action:
  1. Engine off.
  2. Press START-STOP **without** the brake. This is ignition on, engine off.
  3. Burst over the first 4 s.
- Settles: nothing by itself. It records which lamps this sequence lights, so that 16 can tell "gone" from "not lit": `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `bottom.airbag`, `bottom.belt_rear`, plus `assist.off` and the check-control panel "Ready to drive: press the brake" as in 08.

**16. Diagnostic layout at ignition-on (the key photo)**
- Setting: app running with `diag_overlay`.
- Action:
  1. Start the engine and wait until the layout is drawn on the panel.
  2. Switch the engine off with START-STOP. The head unit stays up.
  3. Wait 5 s, then press START-STOP once **without** the brake.
  4. Burst over the first 4 s, then keep shooting until the diagnostic cells are visible again.
- Settles `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc`, `tt.steering`, `bottom.airbag`, `bottom.belt_rear`, `assist.off`, `assist.cc_panel`, `bottom.cc_info`, `assist.info_tacho`, `structure.speedo_info_line` and `structure.tacho_info_line`. Read each cell by the rule in section 3.
- **Risk:** if the cluster drops our connection when the ignition changes, the lamp check may finish before our layout is back. In that case use steps 17–21: their lamps stay lit.

**17. Same layout, 10–20 s later**
- Action: the check-control message "press the brake" usually persists. Take one photo.
- Settles `assist.cc_panel`, `bottom.cc_info`, `assist.info_tacho` (if 16 missed them) and `assist.off` (the engine is still off).

**18. Rear seat belts**
- Setting: `diag_overlay`, engine running, in P.
- Action:
  1. Open and close a rear door.
  2. Buckle, then unbuckle, a rear belt. The rear-belt status shows in the bottom row; unbuckled is red.
  3. Photo.
- Then repeat with the stock theme (app stopped) as **18b**.
- Settles `bottom.belt_rear`.

**19. AUTO H**
- Setting: `diag_overlay`, engine running.
- Action:
  1. Press the AUTO H button: green "AUTO H".
  2. Photo.
  3. Then, foot on the brake, select D and come to a hold. A green (P) appears as Auto Hold holds; this also serves as a second check on `tt.parking_brake`.
  4. Photo.
- Settles `tt.auto_h`.

**20. DSC / DTC**
- Setting: `diag_overlay`, engine running, in P.
- Action:
  1. Press the DSC button briefly (DTC). Photo.
  2. Hold it for 3 s or more (DSC OFF). Photo.
  3. Press again to restore DSC.
- Then repeat with the stock theme as **20b**.
- Settles `tt.dsc`, if the skid lamp lights in either mode. If it does not light even in 20b, `tt.dsc` stays unknown for the self-test (16) to settle.

**21. A check-control message with the engine running (fallback for 16/17)**
- Setting: `diag_overlay`, ignition on.
- Action: open the driver's door or the bonnet. Expect a check-control message such as "door open". Photo.
- Settles `assist.cc_panel`, `bottom.cc_info`, `assist.info_tacho`.

**22. Cold engine (next morning, optional)**
- Setting: `diag_overlay`.
- Action: cold start. Photo with "COLD" shown.
- Settles `assist.cold` (medium to strong).

**23. Stock repeats for anything that did not appear**
- For every step where a cell showed nothing, repeat the same action with the stock theme once.
- If the item shows in the stock repeat but not under `diag_overlay`, its spot was transparent there, and the state is the same, it is `gone`.

## 3. Diagnostic test pattern `diag_overlay` (design only; nothing in `apps/` or `shared/` is changed)

**Idea: split cells.** The layout is transparent everywhere except the cells, so the stock theme shows through as in 10 and 14. Each target element gets one cell that is **opaque over the left half of its bbox**, plus a 6 px margin. Its right half stays transparent. One photo then gives three outcomes per lit element:

| What the photo shows at the element | Relation |
|---|---|
| The whole glyph, drawn across the opaque half | **over** |
| Only the right half, cut sharply at the cell edge | **under** |
| Nothing at all, while the same action lights it in the stock reference (15, 18b, 20b, 23) | **gone** |
| Nothing at all, and nothing in the stock reference either | not lit: no conclusion |

Cells 15–18 are controls whose relation is already known: `tt.parking_brake` and `bottom.belt_driver` should show whole (over); `bottom.range` and `bottom.temperature` should show half (under). If a control reads wrong, the photo is not trusted.

**Look.**
- Opaque cells: solid dark blue `#1b2a6b`, alpha 1. Red, amber, green and white glyphs all stand out against it, as in 12.
- Cell numbers: white, bold, 14 px, in the label box (20 × 16) at `label_xy`. Every label box is placed outside every element's bbox.
- No backdrop: no `bg` or wbback widget, so nothing else is opaque.
- Keep the layout's own text out of the cells. No READY, OFF, clock and so on.

**Budget** (`design/overlay/constraints.json`):
- **Cells:** one effect layer, a rect-list shader.
  - Uniforms: `u_size`, `u_color`, `u_n` and `u_rect[18]` = 21 of the 32 allowed.
  - No `sampler2D`, so no asset needs binding.
  - The existing `boxes` and `tiles` effects show the pattern; a minimal "cells" shader (fill inside any of `u_rect[i]`, transparent elsewhere) is enough.
- **Numbers:** 18 small text widgets, which hud.js packs into sheets. Placed in four bands, they fit in about 4 sheets, each well under the quarter-panel sheet limit:
  - the left column, x 92–112;
  - the right column, x 1747–1837;
  - the bottom row, y 641–673;
  - the centre, y 388–404 and y 556–595.
- **Totals:** 1 effect layer and at most 4 sheet layers, so at most 5 of the 8 layers on one connection. No image assets. Pixel memory is only the sheets, at w·h·8 each, a few MiB at most.

**Cells** (panel px, `[x0, y0, x1, y1]`, exclusive right and bottom edges; generated from the catalogue bboxes):

```json
{
  "layout": "diag_overlay",
  "opaque_colour": "#1b2a6b",
  "label": { "colour": "#ffffff", "size_px": 14, "box": [20, 16] },
  "rule": "opaque = left half of the element bbox + 6 px margin; transparent_half = the rest (nothing drawn there); whole glyph visible = over, right half only = under, nothing while lit in the stock reference = gone",
  "cells": [
    { "n": 1,  "for": "tt.brake",                   "purpose": "unknown",        "opaque": [19, 208, 55, 261],    "transparent_half": [55, 208, 91, 261],    "label_xy": [92, 226] },
    { "n": 2,  "for": "tt.tpms",                    "purpose": "unknown",        "opaque": [18, 261, 50, 320],    "transparent_half": [50, 261, 83, 320],    "label_xy": [92, 282] },
    { "n": 3,  "for": "tt.abs",                     "purpose": "unknown",        "opaque": [8, 321, 43, 375],     "transparent_half": [43, 321, 79, 375],    "label_xy": [92, 340] },
    { "n": 4,  "for": "tt.dsc",                     "purpose": "unknown",        "opaque": [13, 375, 41, 435],    "transparent_half": [41, 375, 69, 435],    "label_xy": [92, 397] },
    { "n": 5,  "for": "tt.auto_h",                  "purpose": "unknown",        "opaque": [1771, 173, 1823, 211], "transparent_half": [1823, 173, 1876, 211], "label_xy": [1747, 184] },
    { "n": 6,  "for": "tt.steering",                "purpose": "unknown",        "opaque": [1841, 263, 1876, 321], "transparent_half": [1876, 263, 1911, 321], "label_xy": [1817, 282] },
    { "n": 7,  "for": "bottom.belt_rear",           "purpose": "unknown",        "opaque": [497, 673, 539, 720],  "transparent_half": [539, 673, 582, 720],  "label_xy": [497, 655] },
    { "n": 8,  "for": "bottom.airbag",              "purpose": "unknown",        "opaque": [631, 659, 657, 720],  "transparent_half": [657, 659, 685, 720],  "label_xy": [631, 641] },
    { "n": 9,  "for": "assist.cc_panel",            "purpose": "unknown; bottom.cc_info lies inside the opaque half (visible = over)", "opaque": [706, 595, 976, 697], "transparent_half": [976, 595, 1246, 697], "label_xy": [706, 577] },
    { "n": 10, "for": "assist.info_tacho",          "purpose": "unknown",        "opaque": [1250, 585, 1263, 633], "transparent_half": [1263, 585, 1276, 633], "label_xy": [1250, 567] },
    { "n": 11, "for": "assist.off",                 "purpose": "unknown",        "opaque": [1514, 574, 1542, 610], "transparent_half": [1542, 574, 1574, 610], "label_xy": [1514, 556] },
    { "n": 12, "for": "assist.cold",                "purpose": "under, medium",  "opaque": [1837, 629, 1873, 664], "transparent_half": [1873, 629, 1909, 664], "label_xy": [1813, 638] },
    { "n": 13, "for": "structure.speedo_info_line", "purpose": "under, medium",  "opaque": [364, 406, 491, 423],  "transparent_half": [491, 406, 619, 423],  "label_xy": [364, 388] },
    { "n": 14, "for": "structure.tacho_info_line",  "purpose": "gone, medium (left part only; its right part is under the black box)", "opaque": [1300, 406, 1362, 423], "transparent_half": [1362, 406, 1419, 423], "label_xy": [1300, 388] },
    { "n": 15, "for": "tt.parking_brake",           "purpose": "control: over",  "opaque": [1832, 211, 1869, 262], "transparent_half": [1869, 211, 1906, 262], "label_xy": [1808, 230] },
    { "n": 16, "for": "bottom.belt_driver",         "purpose": "control: over",  "opaque": [587, 660, 608, 720],  "transparent_half": [608, 660, 630, 720],  "label_xy": [587, 642] },
    { "n": 17, "for": "bottom.range",               "purpose": "control: under", "opaque": [130, 660, 219, 705],  "transparent_half": [219, 660, 309, 705],  "label_xy": [130, 642] },
    { "n": 18, "for": "bottom.temperature",         "purpose": "control: under", "opaque": [1534, 660, 1601, 707], "transparent_half": [1601, 660, 1669, 707], "label_xy": [1534, 642] }
  ]
}
```

Notes on the cells:
- No two cells overlap, and no opaque half covers another cell's transparent half.
  - The steering cell starts at y 263, just below the (P) cell, which ends at 262.
  - The airbag cell starts at x 631, just right of the driver-belt cell, which ends at 630.
- The cells use the catalogue bboxes, which are within about 2 px on the 08 rect. A 6 px margin covers that error and the lamp halo.
- To read a photo, rectify it as package B did, using the cells' own edges and our labels as control points. The cut-at-the-edge test needs about 3 px.
- Anything outside the cells shows the stock theme (transparent), so the same photo also re-confirms the gone elements in the centre block.

## 4. Doubts

- **Photo 11's exact build is unknown.** It predates bc2fc0d's G20 fit and matches `reference/ours/ref_comfort_bench_1920x720.png`. Its full-panel opacity rests on the eefecfd-era `bg` wbback widget, and on 11 showing no stock content except BMW's over items.
- **`assist.mode_label`, `bottom.street`, `assist.speed_limit` and `assist.cold`** are assumed to be in the same state in 11–13: the car in Comfort, a street and a limit known, the engine state unknown for COLD. COLD therefore stays at medium, resting on the z-order seen in 10.
- **The gone verdicts** depend on BMW's custom-theme layout being the same in every session. 10 (Nov 11) and 14 (Nov 12) agree.
- **`tt.auto_h`:** 10 shows it drawn while our grid was up, but its green-on-green crossing with our green grid line cannot show which is on top.
- **Ignition-on lamp check vs our connection (step 16):** it is not known whether our layout is up during the lamp check after an ignition change. Steps 17–21 cover that case, except for `tt.brake`, `tt.tpms`, `tt.abs`, `tt.steering` and `bottom.airbag`. For those, no safe action lights them outside the lamp check.
