# Package VG: the Twin Dial on the G20 panel, the render plan, the app, the centre, safety

Branch `twin-dial/vg` from `main` (`95892f5`). No car, no push, no app code. Tracked outputs:
`design/twin-dial/vg/{layout,dial_units,budget}.json`, `tools/twin-dial/vg/{fit_layout,ring_fit,budget}.py`.
Published for the other packages: `bake/work/twin-dial/pub/VG/layout.json` (rev 2) + `READY`.

Inputs: VR's rectified frames and `index.json` (published), VD's `dials.json` v1 (published 12:04), VS's report and
signals (published), VF's `frame_spec.json` and `message_panel.json` (published last; VF placed its message on
VG rev 2, so the two agree). Re-run
`python3 tools/twin-dial/vg/fit_layout.py` when VD or VF change a number; it prints every clearance.

Evidence labels: **verified** = computed from measured numbers; **hypothesis** = a reading by eye, a design choice
not yet tried, or a platform behaviour not seen on the car.

## 1. Layout on 1920 × 720

### 1.1 The answer

| Item | Value | Status |
|---|---|---|
| R (bezel ring centre line) | **300 px** | verified fit; ±5 px if VD's ring width or ends move |
| Tachometer (left) centre | **(380, 400)** | verified fit |
| Speedometer (right) centre | **(1540, 400)** | verified fit |
| Centre distance | 1160 px = **3.867 R** (ref 02: 3.875, 04: 3.796, 05: 3.625) | kept at ref 02 |
| Ring outer edge | 303.9 px (1.0 + 0.021/2 + AA) | VD |
| Ring ends / foot | ±144°, foot at y 645.9 | VD |
| Scale for type (VT) | 1 R = 300 px | — |

The search (`fit_layout.py`): both dials symmetric about x 960, the full bezel arc must stay ≥ 4 px under the hood
line, the dial's disc (arc + chord) ≥ 3 px from every BMW item that stays, inside the panel. Largest R wins; ties go
to the centre distance nearest ref 02, then to y nearest 370 (ref 05's 0.51 of the height).

- With the centre distance fixed at ref 02 (3.87 R): **R 300, y 400**.
- With it free in 3.60–3.90 R: R 313 at 3.60 R (ref 05's spacing), y 400. 4 % bigger dials, 7 % closer together.
  The spec should take the first: "as close to the references as possible" is about proportion, and ref 02 is the
  only in-car photo.

### 1.2 What binds it

| Constraint | Clearance at the answer | Note |
|---|---|---|
| BMW auto-hold lamp `tt.auto_h` [1777, 179, 1870, 205] vs the right ring | **3.7 px** | the limit on R and on moving the dials up |
| BMW ABS lamp `tt.abs` [14, 327, 73, 369] vs the left ring | **4.3 px** | the limit on spreading the dials |
| Hood (shared/visible.js) | 51.8 left / 48.5 right | not binding once the lamps are respected |
| Belt group [497, 660, 688, 720], gear gap [1380, 660, 1460, 720] vs the ring's foot | 14.1 px | |
| Other lamps (brake 24, TPMS 11, DSC 13, parking brake 25, steering 14) | ≥ 10 px | |
| BMW message panel `zc.panel` vs the rings | 70.7 px | |

At the references' own proportion (R/height 0.46, y 0.51 → R ≈ 330, centres 358 / 1562, y 370) every left and right
lamp is inside a dial and the top-outer arcs are 21–24 px under the hood. So **the dials are 9 % smaller than
the references' proportion and sit 30 px lower**: the one thing of the references that cannot be kept.

### 1.3 The frame (VF's published `frame_spec.json`, lead ref 02, converted at R 300: x = 960 + 300 u, y = 400 + 300 v)

| Item | Panel px | Dial units (from the midpoint) |
|---|---|---|
| Tab bar | [618, 127, 1302, 172]; separators x 744, 812, 1168, 1237; text baseline y 156, icons centred y 143 | u ±1.139, cell top v −0.911, rule v −0.761 |
| Telltale strip above the bar (02) | [564, 58, 981, 115] | stays black on the G20: BMW's lamps are at the sides and we draw none |
| Centre window (no border in the facelift) | [729, 172, 1191, 613] | v −0.761..+0.71, content u ±0.77 |
| Centre title / rule | y 251–289 / y 296, x 741–1180 | |
| Rule above the bottom row | y 613, x 629–1292 | v +0.710 (level to 0.003°) |
| Bottom row (2 lines, numbers right-aligned) | [723, 626, 1197, 705]; baselines y 656, 703; right edges x 846, 1153 | L1 odometer, R1 trip, L2 clock, R2 temperature |
| Our message (VF M2 "bottom plate") | [694.5, 592, 1230, 720] | replaces the bottom row |

All clear the hood (≥ 100 px at the bar) and every lamp; the tab bar floats 0.19 R off both rings, the bottom rule
0.13 R. VF's plate clears the belt group by 6.5 px and the gear gap by 150 px.

### 1.4 Conflicts and choices

1. **The bottom row and BMW's message panel are the same place.** Ref 02's bottom row (odometer, trip, clock,
   temperature) lies at y 626–705, wholly inside BMW's panel footprint [699, 598.7, 1223, 701]. Choice: keep it
   there (as the references), drawn by us; **our message design replaces the bottom row** while a message shows,
   and the fallback window opens over exactly that area (section 5). This is also why the bottom row's sheet is a
   "cc:" layer that steps aside.
2. **Dial furniture vs the belt group and the gear gap.** VD's rev strip ("8" at x +0.378 R, right edge ≈ 501) and
   the curved "1/min x 1000" (θ 149–164°, x 458–524, y 640–667) cross the belt group [497, 660, 688, 720].
   Rule: nothing of a dial below y 657 where x is in 494–691 (left) or 1377–1463 (right). Move the rev strip 8 px
   left (or narrow it to −0.39..+0.36 R) and set the label on θ 146–156° or above y 657. The right dial's coolant bar
   (y 619) and end labels (y 605) are clear.
3. **BMW's gear letter stays.** [1398, 668, 1424, 703] is drawn over us (relation "over"); our gear is in the
   tacho's hub (VD: centre (−0.02, 0.39) R → (374, 517)). Two gear displays while driving: cannot be avoided without
   bringing back BMW's black box.
4. **The gear gap is kept as a hole in our layer rectangles, not only in pixels.** Why the KOMBI draws its box is not
   known (docs/AGENT-BRIEF-boxes.md: the KOMBI cannot see our pixels; the public themes that avoid it "leave a
   window"). So no layer of ours has a rectangle that intersects [1380, 660, 1460, 720]: the background is split
   into three effect layers (section 2) and the right dial's layer ends at y 660. Cost: 2 extra effect layers, no
   pixel memory. A car test may later show that transparent pixels are enough, and then the split can go.
5. **Telltales: holes, not keep-clear only.** Six of the seven side lamps have relation "unknown" (photo 16 of
   docs/OVERLAY-PHOTO-PROTOCOL.md never taken). Since the theme is fully opaque, our background gets a see-through
   hole at each lamp's box + 3 px (plan.safe), and nothing of ours is inside. When photo 16 proves a lamp "over",
   its hole can close.
6. **The lamp strip above the tab bar** (02's light row) has nothing to show on the G20 and stays black.
7. **The hood's top band** (y < 100 between the dials) is visible but empty — the references' screen starts there.

## 2. Rendering plan and budget

### 2.1 What is what

| Part | How | Why |
|---|---|---|
| Dial faces (band and its shading/texture, tick strip, ticks, numerals, rim, bezel, feet, end labels, "1/min x 1000") | **baked R8 texture** per dial (luma only), coloured by region in the dial shader | every static part is grey/white on black: luma is enough; R8 costs ¼ of RGBA8 |
| Red wedge (from the redline setting), red numerals 7–8, the bars' fill, the needle, the rev strip's lit part | **shader** in the dial layer (uniforms: angle, redline, fuel, coolant, rpm) | data-driven; the wedge start moves with the redline |
| Background, frame lines, tab-bar plates and the highlight, rules, lamp holes, belt hole, gear gap, the fallback window | **shader** (three background layers) + one R8 mask of BMW's panel outline | flat shapes; the panel outline is 137 points, cheaper as a ~536×112 R8 mask than as a polygon in GLSL |
| Digital speed, gear | **gpu atext** (shared/shaders.js ATEXT, 1.2 k chars) | a new value is one uniform message |
| Tab icons and text, hub labels, centre panels, bottom row, our message | **image sheets** (hud.js packing, wb_road / wb_msg fonts for car text) | car-supplied text in Ukrainian/Russian/Latin needs the CPU font path |
| Car picture (proposal d) | baked RGBA8 scene texture, doors as shader quads | colour artwork |

### 2.2 Layers per connection, pixel memory, switch peak (`tools/twin-dial/vg/budget.py`)

| Conn | Layers | What | Pixel memory |
|---|---|---|---|
| 0 | 6 of 8 | bgL [0,0,1380,720], bgRT [1380,0,1920,660], bgRB [1460,660,1920,720], tacho, speedo, speed atext | 1.48 MiB (2 faces R8 616×560, panel mask R8, speed atlas) |
| 1 | 4 of 8 | gear atext, tabs sheet 552×52, centre sheet 540×400, hub labels 300×60 | 2.04 MiB |
| 2 | 2 of 8 | bottom row sheet 524×88, **our message sheet 536×128** (VF's plate) | 0.87 MiB |
| **All** | **12 of 24** | assets ≤ 5 per client (limit 16) | **4.40 MiB steady, 4.95 with the car picture** |

- **Switch peak**: scene textures are dropped before new ones are made (hud.js `_sceneNeeds`, memory note); sheets
  are re-made whole: old + new sheets ≈ **7.8 MiB** worst case. Budget rule for round 2: ≤ 6 MiB steady, ≤ 8 MiB
  peak — half of the service's 16 MiB stays free for other apps (it is service-wide).
- The faces as RGBA8 would cost 2.63 MiB each (5.3 MiB both): only if VC proves a colour that luma + region tint
  cannot give.
- The message is on its own connection and layer, as in package X (text, backdrop and window on different
  connections; hence `CC_SETTLE_MS`).
- **Shader bytes** (the KOMBI resets past some size; 13 KB known good, 25.4 k worked, 26.7 k reset): targets after
  `compact()` — dial ≤ 8 KB (one source per look, day/night by uniforms or a resolved `#if`, never both looks in one
  source), background ≤ 6 KB, atext 1.2 KB. Every sampler bound (`_bindBlanks`); `highp` for any length in panel
  px > 256 (fp16 `mediump` overflows: the needle and the ring distances are up to 304 px).
- **Uniforms**: ≤ 32 per effect layer. bgL needs 4 lamp holes + belt hole + panel-window state + tab highlight +
  colours ≈ 14; dial ≈ 12.

## 3. The app `twin_dial`

**Reuses unchanged** (`app.json` "shared"): `hud.js`, `hud_text.js`, `hud_data.js`, `layouts.js`, `shaders.js`
(ATEXT, fill, and the strip-mask sampling), `icons.js`, `cluster_render_client.js`, `visible.js`, `sun.js`,
`sensors.js`, `screen.js`, `menu.js`, `gallery.js`, `previews.js`. Not carried: `waze.js`, `shift_score.js`,
`calibration.js`, `runs.js`, `strip_icons.js` (unless VT's message symbols live there).

**New**:
- shaders (in `shared/shaders.js`, beside the 6WB ones): `tdial` (face sample + region tint + wedge + needle + bars +
  rev strip), `tdback` (frame, tab plates, holes, panel-mask window). Both with STYLE blocks resolved in JS.
- hud.js widget types `tdial`, `tdback` (≈ the `dial look:wb` / `wbback` paths: `_sceneNeeds`, `_wbCcSend` /
  `_maskLanes` reused for the window), and one `panel` concept: a centre panel = a named group of text widgets in the
  centre sheet with a `toggle: "centre=<name>"`.
- `design/gen_twin.py`: writes `apps/twin_dial/hud/layouts/twin.json` from `design/twin-dial/vg/layout.json` + VD + VF
  (the gen_6wb pattern: baseline placement with `base_at`).
- `tools/twin-dial/bake_face.py`: the two R8 faces (our own drawing from VD's numbers, VT's numerals, VC's tones);
  the panel mask with `tools/strip/bake_mask.py`'s "msg" lane code; fonts with `tools/bake_fonts.py` (wb_msg / wb_road
  CAR_TEXT set for every car string).

**Settings (few)**: `centre` (trip / date-clock / car / media / guidance / map / auto), `units` follow the car,
`redline` (wedge start, default 6500 rpm from VD), `nightLook` (auto/on/off), `demo`. Nothing else in round 2.

**app.json skeleton**:
```json
{ "id": "twin_dial", "title": "Twin Dial", "version": "0.1.0", "vendor": "custom", "loggingId": "OATD",
  "iconGlyph": "TD", "shared": ["hud.js", "..."],
  "signals": "<VS: design/twin-dial/vs/signals.json, check_signals.py passes>",
  "screens": "<shared/menu.js MAIN: picture, centre, redline, night>",
  "settings": [ "centre", "redline", "nightLook", "demo" ],
  "config": { "target": "panel", "ccList": "<as f30_cluster>", "ccActive": "<as f30_cluster, plus 'strict': true>",
              "ccDisplayed": "<Vehicle2.statusDisplayedCCMessage, VS item 4>", "ccMarker": null } }
```
(`ccm` / `newCCMessage` not declared: it is proven silent on this car.)

**Bench and gallery**: `node bench/server.js twin_dial` (the G20 simulation draws BMW's lamps, belt, gear letter and
message panel beneath and over us); `tools/shots/` matrix with the states {day, night} × {no message, message with
our text, message unreadable, blind} × each centre panel; `tools/strip/O/` replay for the pixel checks below.

**Tests** (bench, no car): `test-twin-layout.js` (every widget clears `visible.check`, the keep-outs of
`layout.json`, no layer rect in the gear gap), `test-twin-budget.js` (layers per connection ≤ 8, pixel memory ≤ 6
MiB, switch peak ≤ 8 MiB on the bench's 16 MiB enforcement, shader source sizes ≤ targets, every sampler bound),
`test-twin-cc.js` (section 5.4), `test-fonts.js` on the new layout, `test-daynight.js`.

## 4. The centre: proposals for the owner

| | Proposal | Needs (VS) | Cost | Sketch |
|---|---|---|---|---|
| a | **BMW's map through a window** (ref 01) | none (BMW's own map slot, ~1088×480, under us) | 1 hole in bgL; 0 MiB | the centre window [729, 250, 1191, 565] becomes see-through with VF's frame drawn round it; BMW's map is wider than the gap, so we see its middle only. **Hypothesis**: BMW draws its map while a custom theme is up (f30_cluster's `stockMap` hole relies on it; not re-checked here) |
| b | **Trip computer** (ref 02) | statusBordcomputerAverage / TravelData / TravelStart (**unseen**, probe P4), odometer from statusRangeTankStatus.mileageKilometre (arrives, member unread, P3) | centre sheet; text only | title "Since start", rule, two rows: pump ⌀ consumption, ⌀ speed; time; distance |
| c | **Date and clock** | timeDateUTC / statusShowTimeDate (arrive) | centre sheet | large clock, weekday and date below, outside temperature (ambient, arrives) |
| d | **Car picture with doors** (ref 04) | CentralLockingSystemAndPanelStatus2 (notifier-only, **unseen**, P7), bonnet A4A lids | +0.55 MiB RGBA texture, doors as shader quads in the dial-free centre | our own top-view drawing, open doors drawn as lines swung out; battery voltage below **only if** P10 finds a real voltage |
| e | **Media** | HmiMediaState.playerMetadata, MediaSource (**unseen**, P8) | centre sheet, Cyrillic text | source icon, title, artist; text never logged |
| f | **Guidance** | currentRoad / guidingState (arrive), Guidance.nextIntersection (**unseen**, P12) | centre sheet + one icon | our arrow, distance, road label |

**Switching**: (1) a setting `centre` (works today); (2) an automatic rule on top: guidance while a route is
guided (f), back to the chosen panel after; a check-control message never takes the centre — it has its own place
(the bottom row); (3) **following the stalk button** only after probe P11 shows that `HMIContext.currentICWidget` or
`statusKombiSelection` moves on a press — nothing in the catalogue is the button itself.
Recommendation for round 2: build **c** and **b** first (b falls back to c where the trip fields stay silent), **a**
as the second choice the owner can try at no cost; d and e after their probes.

## 5. Safety

### 5.1 Where BMW's items show through, and the proof

| Item | Treatment | Proof |
|---|---|---|
| Belt and airbag group [500.5, 664.25, 684.25, 715.5] | hole [497, 660, 688, 720] in bgL in every state; nothing of ours there; closest ours: the left ring foot, 14 px | `fit_layout.py` clearances; `test-twin-layout.js` |
| Gear letter [1398, 668, 1424, 703] (over) | no layer rectangle intersects the gap [1380, 660, 1460, 720] | budget.json rects; test |
| Side lamps (7) | holes = box + 3 px in bgL / bgRT; ring ≥ 3.7 px off | same |
| BMW's black box | not provoked (gear gap) | car photo after a layout switch and a drive-mode switch |
| BMW's stored-message marker [1240, 588, 1288, 630] | covered (decision 7) until a signal is confirmed | — |
| BMW's message panel | covered by our message; **fallback window** below | 5.4 |

### 5.2 The fallback window

- **Shape**: BMW's own panel outline, `zc.panel` of `design/strip/ZC/mask_proposal.json` (137 points, frame
  included) dilated by 3 px, as VF's `message_panel.json` `fallback_window.polygon_px` (bbox [696, 595.75, 1226,
  704]); baked once as an R8 mask (≈ 536 × 112) and sampled by **bgL** — the only effect layer of ours that is
  opaque there. VF's message plate [694.5, 592, 1230, 720] covers it with 1.5–16 px to spare.
- **Which layer opens it**: bgL, by one uniform (as WBBACK `u_cc` / the strip mask's "msg" lane). Our two layers that
  also cover that area — the bottom-row sheet and our message sheet — are "cc:" toggled and step aside first
  (`_ccLiveSync(true)`), so no frame shows half of BMW's panel under our text.
- **Open, from the signal handler** (`_ccPush`, not the tick): a ccList / active-number change → `_ccListEval` →
  texts step aside → window opens. **Close only after ours has been on screen**: our message raster (symbol +
  headline + 2nd line in ONE paint) is sent in a tick, `_ccPainted` stamps it, and the window closes in a later tick
  once `_ccOnScreen()` (same headline, ≥ `CC_SETTLE_MS` = 150 ms) — exactly `_ccOpen`'s see-through-with-row-ours
  path of f30_cluster, which twin_dial takes for its single layout.

### 5.3 Every condition that keeps it open

1. The message signals not readable yet (`_ccWired()` false: ccList has never delivered a list that fits).
2. **Twin Dial's stricter rule (proposed):** "shown now" not known — `statusActiveCCMessage` (or
   `Vehicle2.statusDisplayedCCMessage`) has never notified. ccList alone also lists stored messages (id 987 stayed
   after BMW hid it), so drawing ours from ccList's heuristic could cover message X with text for message Y. Until
   probe P1 confirms the active number, **our message design is not drawn over BMW's panel at all**: the window
   opens whenever the 0.7.20 heuristic says something may show. (f30_cluster 0.7.20 covers under the heuristic.)
3. The active number has no ccList entry (`ccNoMatch`).
4. The entry has no name (`ccListUnread`).
5. A character of the name is missing from wb_msg (`_missingGlyphs` → `_rowFail`, latched).
6. Drawing our message throws (`_guard` → `_rowFail`, latched).
7. The message changed (new id, or the same id with other words): `_ccOnScreen` is keyed on the headline.
8. Our message sheet failed to be created (asset refused, pixel memory full): treat as 6.
9. Any id we have no symbol for still draws (VT's generic triangle / "i" by colour) — not an open condition.

### 5.4 Tests that prove it (bench, `test-twin-cc.js`, frame by frame from the bench's cluster-render model)

1. Blind start (no ccList yet): window open; nothing of ours over the panel.
2. ccList fits but no active number ever: any listed entry → window open, our message never drawn over it (rule 2).
3. Active number N with a named entry: window open in the frame the number arrives, our text painted in a later
   tick, window closed ≥ 150 ms after that paint and never earlier; at no frame is BMW's panel covered while our
   text for N is absent.
4. N with no entry; empty name; a Greek letter in the name; a throw injected in the paint: window stays open; the
   latch holds until the message ends.
5. N → M switch: window re-opens at once, closes only after M's text.
6. Message ends (number 0): our message goes, bottom row returns only after the window has shut.
7. Sheet creation refused (bench 16 MiB filled): window open.
8. Layout switch and day/night with a message showing: window state carried across the rebuild (open first).
9. Pixel audit (`tools/strip/O` replay): for every frame of 1–8, the panel outline is either BMW's pixels or our text
   for the shown number; belt group and gear gap never ours; lamp holes never ours.

## 6. What VD / VF / VT should take from this

- VT: 1 R = 300 px (e.g. tacho numerals 0.135 R → 40.5 px tall; speedo large 0.071 R → 21.3 px, small 0.054 R →
  16.2 px; speed digits 0.23 R → 69 px).
- VD: the furniture rule of 1.4 item 2.
- VF: the bottom row and our message share the panel footprint; the message design must cover [699, 598.7, 1223,
  701] completely and leave the bottom row's sheet as the thing it replaces.
