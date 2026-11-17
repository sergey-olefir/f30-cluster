# Twin Dial — specification (round 1 result)

The new cluster app `twin_dial`: a facelift twin-round-dial cockpit drawn on the G20's 1920 × 720 panel, tachometer left, speedometer right. This file joins the seven round-1 reports (`docs/twin-dial/V?-REPORT.md`) into one specification for round 2 (drawing, baking, the app). Every number below is in the named JSON; the reports hold the evidence, the uncertainty and the alternatives. Status words: **verified** = measured or computed, **hypothesis** = needs the bench or the car. Decisions still open for the owner are marked **[D n]** and listed in §9.

## 1. References (VR)

- Five references, `reference/vc/01`–`05` (git-ignored). Facelift: **02** (real car, phone, the geometry master, 0.35 px rms), **04** (aftermarket bench unit, the tachometer face and the reds), **05** (seller render, the colour levels). Classic 01 and 03 only as cross-checks (03 confirms 02's centre distance on another car).
- Rectified frames at R = 400 px: `bake/work/twin-dial/pub/VR/`. Numbers: `design/twin-dial/vr/references.json`.
- **Gaps:** only two tachometer frames, both low resolution (about 107 source px per R); no night, warning or reduced-view frame of the facelift design exists in the set. The web search found nothing usable (`design/twin-dial/vr/web_search.json`). Everything in those states is our interpretation until a reference or a car photo turns up.

## 2. Dial units and the panel layout (VG)

- R is the centre line of the thin outer white ring. Angles clockwise from 12 o'clock.
- **On the G20: R = 300 px; tachometer centre (380, 400), speedometer centre (1540, 400);** centre distance 1160 px = 3.867 R (02: 3.875). `design/twin-dial/vg/layout.json`, `bake/work/twin-dial/pub/VG/layout.json` rev 3.
- The dials are about 9 % smaller and 30 px lower than the references' proportion: at the references' size BMW's side telltales fall inside the dials and the ring tops go under the hood. The tightest clearances: AUTO H lamp 3.7 px, ABS lamp 4.3 px.

## 3. The dials (VD; `design/twin-dial/vd/dials.json`)

- **Bezel ring:** r 1.000, width 0.021 R, white, open at the bottom between 144° and 216°.
- **Grey scale band:** 0.580–0.940 R; a lighter tick strip 0.893–0.940; black gap to the ring 0.940–0.989.
- **Inner disc rim:** 0.545 R, width 0.016 (02) **[D 2]**; black disc, no vignette.
- **Sweep:** ±125° for both dials **[D 1]** (02's speedometer: verified ±125°; 04's tachometer ±120°, 05 ±130°).
- **Speedometer:** non-linear law, 0 km/h at −125°, 100 at 0°, 300 at +125°: 20 km/h per major mark up to 100, 40 above; 4 minor ticks per major. Large numerals 0 20 40 60 80 100 140 180 220 260 300 (h 0.071 R, centre radius 0.76), small 10 30 50 70 90 120 160 200 240 280 (h 0.054, radius 0.775).
- **Tachometer:** 0–8 × 1000 rpm, linear, 1 minor tick per 1000; numerals 1–8, h 0.135 R, radius 0.745, upright; 7 and 8 red.
- **Ticks:** radius 0.896–0.934, minor width 0.012 R, major 0.018 R, white; a near-black line across the band at each major mark (0.580–0.893).
- **Red zone:** a solid wedge from the redline (setting, default 6500 rpm) to the scale end, radius 0.550–0.940, dark red fill and a bright red outline **[D 3]**; ticks and numerals on it red.
- **Needle:** white **[D 5]**, straight, no cap, from 0.465 R to 0.99 R, widest 0.039 R at 0.56 tapering to 0.016 at 0.89; no glow; a faint shadow on the band (hypothesis).
- **Hubs:** speedometer — digital speed (centre (0, +0.03), h 0.23 R) and unit; tachometer — gear (−0.02, +0.39), h 0.15, and program below it.
- **Under the dials:** fuel bar (left) and coolant bar (right) at y +0.73 R; the tachometer's unit label curved at 149–164°; a rev strip from 02 is optional.
- **VG's constraint:** nothing of a dial below y 657 px at x 494–691 (belt group) or x 1377–1463 (gear-letter gap): the rev strip moves 8 px left and the curved unit label sits at 146–156° or above y 657.

## 4. The frame (VF; `design/twin-dial/vf/frame_spec.json`)

Panel px from VG rev 3:
- **Tab bar** [618, 127, 1302, 172], vertical grey ramp, white rule under it; icon tabs 0.22 R wide, a wide media/text tab; the highlighted tab filled with its colour (red warning, green selected).
- **Centre window** [729, 172, 1191, 613], no border; a page = centred title, a thin rule, the body.
- **Bottom row** [723, 626, 1197, 705], two lines: left odometer and clock, right trip and outside temperature; rule above it at y 613.
- **No joining outline:** bar, centre and bottom rule float in black.
- BMW's telltale strip above the bar stays black: the G20's own lamps are at the sides and get see-through holes.

## 5. Colour (VC; `design/twin-dial/vc/palette.json`)

- All line elements white: bezel, rim, ticks, numerals, needle.
- **Band:** a two-way ramp, `Y = 0.010·exp(7.5(ρ−0.60))·exp(−0.85(cosθ−1))`, darker inside and at the top, lighter outward and toward the feet, slightly cool. The shape is verified; **the absolute level is uncertain by ×1.7** (02 and 05 differ by about ×2) — set it on the bench.
- **Tick strip** ≈ 0.25 of white. **Red** `#DA1030`; wedge fill about 0.3 of it (it may read slightly purple on the G20's bluish black — raise the fill if it does).
- **No texture** on the band: none is resolved in any reference **[D 4]**.
- **Night:** no reference exists; a hypothesis of per-material dimming with no tint (white × 0.8, band × 0.5–0.6, red × 0.85).
- Every value carries the G20 panel's black floor correction (`palette.json`).

## 6. Type and pictograms (VT; `design/twin-dial/vt/`)

- **Saira** (OFL; width 125, weight 550 ± 50) for the scale numerals, big readouts and dial labels; **Noto Sans** (OFL; weight 500 ± 50) for labels, text and our messages (the full car character set: Ukrainian, Russian, Belarusian, Latin accents). Saira's zero is still ≈ 7 % narrow: try a 1.05–1.07 horizontal stretch at bake time.
- Bake sizes per slot at R = 300: `design/twin-dial/vt/sizes.json` (for example speedometer numerals 28 px, tachometer numerals 57, digital speed 92, gear 64, bottom row 40, message 42).
- **25 pictograms of our own** in the `shared/icons.js` format (15 new, 10 from package P), including the message symbols; `message_symbols.json` maps known check-control meanings to them, and any other id to a generic triangle (red, yellow, orange) or "i" (white, green).

## 7. Signals (VS; `design/twin-dial/vs/signals.json`)

- 19 interfaces, all read-only, `check_signals.py`: 105 ok, 0 fail.
- **Known to arrive on this car:** speed, rpm, gear, drive mode, fuel level and range, coolant, ambient, day/night, vehicle condition, the clock, `ccList`. Probably arriving: the odometer (a member of the range field, never read).
- **Unseen until a probe:** the trip computer, doors and lids, media, phone, battery voltage, the driver's cluster view (stalk button), the next turn, and the message fields `statusActiveCCMessage` / `statusDisplayedCCMessage` / `statusMenuCCMessage`. VS lists ten probes with the action and the deciding check for each.

## 8. Rendering, budget, app, safety (VG)

- **Rendering:** dial faces baked R8 and coloured by region in the shader; wedge, needle, bars in the shader; background, frame, lamp holes, the gear-letter gap and BMW's panel window in the shader plus one R8 mask; digital speed and gear as GPU glyph text; tabs, centre pages, bottom row and messages as image sheets.
- **The gear-letter gap is a gap in the layer rectangles** (the background split into three layers), because the KOMBI's black box is not yet understood (`docs/boxes/`).
- **Budget:** 12 of 24 layers, 4.4 MiB steady, about 7.8 MiB at a layout switch; shader targets: dial ≤ 8 KB, background ≤ 6 KB; highp for distances above 256 px.
- **App:** `apps/twin_dial`, reusing `shared/` unchanged plus two new shaders (`tdial`, `tdback`), `design/gen_twin.py`, `tools/twin-dial/bake_face.py`; settings `centre`, `redline`, `nightLook`, `demo`.
- **Messages (decision 6):** ours, in the bottom row's place **[D 6]**; the fallback window over BMW's panel opens from the signal handler and closes only after our text for that exact message has been on screen 150 ms. **Stricter rule proposed [D 7]:** until the car has once said which message is shown now, we never draw over BMW's panel.
- **Centre pages [D 8]:** (a) BMW's map through a window; (b) trip computer; (c) date and clock; (d) car with doors; (e) media; (f) guidance. VG recommends c and b first, a as a free option; the rest after probes.

## 9. Decisions for the owner

1. **Sweep:** ±125° for both dials (proposed) — or each dial its reference's own.
2. **Inner disc rim:** 02's thin rim at 0.545 R (proposed) — or 04/05's at 0.531 R.
3. **Red zone:** 04's solid wedge on 02's band (proposed) — or 05's red arc on the bezel.
4. **Band texture:** none (proposed) — or a fine grain tried on the bench.
5. **Needle:** white (proposed) — red as an option.
6. **Our message:** M2, in the bottom row's place (proposed) — or M1, a card in the centre window.
7. **Stricter message rule:** never draw over BMW's panel until the car confirms the "shown now" signal (proposed).
8. **Centre pages:** which, and in what order — VG proposes date/clock first, trip computer second, BMW's map as an option.
9. **The rev strip** under the tachometer (from 02): keep or drop.
10. **Two gear letters:** ours in the tachometer's hub and BMW's in the bottom row (BMW draws it over us; hiding it brings the black box). Accept, or move ours.

## 10. What round 2 needs from the car

One log-only build, before or alongside round 2, with VS's probes: the message fields, the odometer member, the trip computer, doors, media, phone, the cluster view, the next turn. Then the band level and the night palette are set from one fixed-exposure photo on the car.
