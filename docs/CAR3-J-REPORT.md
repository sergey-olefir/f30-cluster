# Car 3, package J: "G20 Comfort" refitted on the high-resolution photos 39 and 40

Brief: `docs/AGENT-BRIEF-car3.md` §6. Branch `car3/j`. The photos are not in git and no photo crop is committed: the sheets in `docs/car3/j/` are our own bench renders, and the photo side of every comparison is given as numbers below.

## 1. Photo 39 is the stock cluster, not our "G20 Comfort"

| Detail in 39 | Stock | Our "G20 Comfort" |
|---|---|---|
| "COMFORT PLUS" and a big "D" in the tacho's centre, over a line | yes: the stock layout (08, 09) | no: with any theme layer connected BMW moves the mode label and gear to its bottom row (10, 14, 41), and 0.7.7 drew neither |
| "A START STOP" crossed out left of the tacho's 0 | BMW's MSA-off sign, in the place of its "1/min x1000" | we always draw "1/min x1000" there, over an opaque baked tacho, so BMW's sign could not show through |
| Fuel mini: thin frame, the top segment ending at the "1" | yes | 0.7.7 drew a frame 6-8 px thick that ran under the "1" (a "T") |
| Dial numerals grey, the one by the pointer white | yes | 0.7.7 drew them all near-white |
| Time | 10:52, one minute before 41 (10:53, "6WB Dials + G20" running) | |

So 39 (and 40, the same scene up close) is the stock look. They are the best reference we have: 39 is the only photo whose whites do not clip (the digital 0 at 254, the frame at 235, the numerals at 165), and 40 has 5 photo px per panel px.

## 2. Registration

`rectify.py`'s model (a homography plus one radial term), SIFT from the 08 and 09 rects, masked map, then gated and refitted on both:

| Photo | Inliers | rms (panel px) | Photo px per panel px | Covers |
|---|---|---|---|---|
| 39 | 549 | 1.28 | 1.84 | the whole panel |
| 40 | 324 | 1.05 | 5.09 | x 26-700, y 204-701 (fuel mini, speedo's lower half, sign) |

(08 and 09: 0.86-0.89 photo px per panel px. That difference explains most of what follows: anything soft in 08/09, such as the halo round bright lines or a lifted face, spread twice as far in panel px.)

## 3. What changed, element by element

Measured = on 39 / 40; "ours" = the bench render before and after (headless Chrome, `g20_comfort`, rest = 0 km/h, 720 rpm, D).

| Element | Measured on 39 / 40 | Before (0.7.7) | After | Where |
|---|---|---|---|---|
| **Pointer glow** (the orange round the needles) | an angular wedge round the pointer, inside the band line; (420, 560): 71, 27, 19 (39); none over the ticks | a 20 px gaussian round the bar: the port read the simulation's sigma_hi (20 **degrees**) as px. A thin smear; (420, 560): 54, 35, 38 | the simulation's wedge (σ 20° / 26° by side, depth window 80-220 px) in G20DIAL, starting inside the band (none outside 34 px in from the tick ring); (420, 560): 79, 34, 28, (1600, 580): 58, 24, 20 against 56, 22, 17 | `shaders.js` G20DIAL, `bake_g20.py` (LUT entry 9: the tick ring's radius per angle), `live.js` `q_in` |
| **Speedo band glow** | outward of the line: 0.39 / 0.14 / 0.05 of its peak at 6 / 12 / 18 px (40); fades along the top: 0.8 of the sides' at 160 km/h, 0.55 at 190, gone past 210 (39); the line 2 px (sides) to 5 px (bottom) further in | 0.62 / 0.36 / 0.15 (08's lens halo); even to 260; the peak 2-5 px out | 0.46 / 0.08 / 0 at 6 / 12 / 18 px; faded along the top; the line moved in | `render_soft.py` `GLOW_K`, `GLOW_ALONG`, `GLOW_SHIFT` |
| **Band line by the pointer** | lit pink-white near the pointer: 225-251, 134-175, 120-149, against 120-141, 56-83, 56-79 away from it | red everywhere | lit live by angle from the pointer (σ 28° above, 15° below the value) | G20DIAL `u_bl` (weak: one pointer position photographed per dial) |
| **Numerals: weight** | strokes 4.1-4.3 px (speedo), 4.3-4.6 (tacho) | Roboto 550: 5.5-6 px | Roboto 430: 4.1-4.6 | `render.py` `NUMERAL_WGHT` |
| **Numerals: colour** | grey, 162-179 against the frame's 245 (0.68); km/h the same | 249, 217, 220 (0.97 of the frame): 08/09 clipped them | 0.68 x the frame's white | `render.py` `NUMERAL_GREY` |
| **Numeral by the pointer** | speedo 0 at 238 (pointer on it), tacho 1 at 217 (7° away), tacho 0 at 177 (21° away) | static | lit live to white (gain 1.47, σ 8°); the speedo's "0" lies over the needle, as in 40 | G20DIAL `u_nl` |
| **Frame** | half-max width 6.1-6.7 px at the bottom, 7.0-7.7 on the sides, 3.4-3.5 at the top ends; brightness 155 at the bottom, 220-235 on the sides, 177-184 at the top | 7.1 / 9.6 / 4.3 px, flat 240 | 6.4 / 7.6 / 3.4 px; 158 / 233 / 205 | `render.py` `FRAME_W`, `FRAME_GAIN` |
| **Ticks** | minors 30-60 above the face, majors 145-215 | minors 0.55 of majors, blurred (σ 0.9) | minors 0.55 x the frame colour, edges σ 0.5 | `render.py` `MINOR_TICK`, `SIGMA_DRAW` |
| **Crisp edges** (frame, ticks, lines, numerals, minis) | ~1 px transitions on 40 | blurred σ 0.9 (08's camera) | σ 0.5 | `render.py`, `minis.py` |
| **Wing faces** | 10-37 levels above the panel's black (frame 219 above it): 0.05-0.17 | 0.15-0.27 (08/09's glare) | x 0.6: (250, 400) 19, 21, 27; (1700, 300) 20, 22, 28 | `render_soft.py` `FACE_GAIN` |
| **Fuel / oil mini: frame** | 4.6 px (white), 4.0 (red, blue); centre 1-1.5 px off the old trace; the top segment ends at the "1" (x 61.5), thinning to 3 px and dimming to half; at 1/2 the upper piece ends in a foot to the right, the lower starts with a stroke up to the right | 6.3 / 7.8 px; the top ran under the "1" (a "T"); round ends meeting in a blob | as measured | `minis.py` `FRAME_WIDTH`, `OFFSET_*`, `TOP_*`, `NOTCH_*` |
| **Fuel mini: numerals** | "1" at [62, 433, 73, 456], "0" at [174, 596, 191, 621], light strokes | 08's boxes (the "1" took in the frame), weight 550 | the 39/40 boxes, weight 430 | `minis.py` `NUM_BOX`, `NUM_WGHT` |
| **Mini needles** | thick at the frame end (9 px), 7.5 px a quarter from the inner end, fading out there; core 245, 92, 80 | **swapped**: 4.5 px at the frame, 10 at the inner end, the dim colour at the frame end; 255, 112, 98 | 9 → 5.5 px, the colour at the frame end, dimming and fading over the inner 30 % | G20DIAL, `gen_g20.py`, `live.js` / `build_params.py` `fuel.needle` |
| **Mini area** | | BMW's needle stub showed beside ours when the levels differed (tank size 60 L against BMW's) | the minis' area also covers every place BMW's needle can be | `bake_g20.py` `mini_tex` |
| **Speedo needle** | core 6 px, 238-254, 97-137, 69-107 | 5 px, 240, 126, 99 | unchanged (within the photos' spread) | |
| **Digital speed underline** | y 414.1, 4 px, x 370-693, the step at 611-614 | y 413.4, 4 px, same ends and step | unchanged (within 1 px) | |
| **Sign with the line behind it** | the bottom line runs on behind BMW's sign | BMW's sign and its line show through our round window | unchanged | |
| **COMFORT PLUS** | stock: two lines at x 1223, baselines 366.6 / 394.6, cap 22 px, 142 px wide, strokes 3.8, grey (113, 103, 106 against 254); the "D" 75 px tall, 53 wide, strokes 13.8; the line under both at y 414 | not drawn by us; BMW's in its bottom row | ours in the centre (Roboto 500 / width 94; the gear Roboto 650), the line baked into the tacho, BMW's bottom-row label covered by a black patch (x 1224-1364, y 657-714, clear of the check-control panel and the gear letter). The label is empty in plain Comfort (41: BMW showed none then) | `gen_g20.py`, `bake_fonts.py` (`g20_mode`, `g20_gear`), `hud.js` tokens `g20mode1/2`, `bake_g20.py` `mode_patch` |
| **Start/stop sign** | MSA off: BMW replaces "1/min x1000" with a crossed "A START STOP", ink box [1405, 570, 1506, 612] | not drawn | **not drawn** (open item 1) | |
| **"1/min x1000"** | grey as the numerals | theme white | 172, 160, 163 | `gen_g20.py` |

The sheets: `docs/car3/j/part_*.jpg` (before above after, our renders), `bench_g20c_rest_*.jpg`, `bench_g20c_80_*.jpg`, `bench_g20c_80_comfort_sign50_after.jpg` (plain Comfort: no label, BMW's 50 through the window), `bench_sim_stock_rest_*.jpg` (the simulation alone).

The after shots use `?g20bb=0`, a new bench flag that leaves out BMW's black area, as the car does when the theme is on at start-up. With the area drawn, it covers our "D" (x 1496-1543 lies in 1420-1611); the label and the line stay visible. Per the brief, nothing is placed to suit it.

## 4. Budgets

| | Before | After |
|---|---|---|
| Pixel memory | 8.0 MiB | 8.7 MiB: `g20_tacho` 684x623 → 684x681 (+0.3, for the mode-label patch); two glyph atlases, `g20_mode` 1024x31 and `g20_gear` 1024x81 |
| Layers | 6 (4 effects, 2 sheets), 2 + 2 + 2 per connection | 8 (4 effects, 4 sheets), 2 + 2 + 4 |
| Scene textures | 7 | 7 (`g20_lut` 256x18 → 256x20) |
| G20DIAL uniforms | 16 | 19 (`u_glow2`, `u_nl`, `u_bl`); every sampler still bound |
| `bench/g20/` | 1.88 MB | 1.83 MB |

The shader keeps the fp16 rules: lengths on scaled offsets, angles from `atan` on offsets, and the gaussians' squares stay below 33 000.

## 5. The bench simulation changes with it

`bench/g20/structure/` and `live.js` are shared by the simulation under every layout, so "6WB Dials + G20" over it now shows:
- the thinner frames;
- the grey numerals;
- the narrower band glow;
- dimmer faces;
- the minis as above;
- no pointer glow over the ticks.

Package G measures stock pixels outside its drawing against this simulation, so the lead should re-run G's checks after the merge. The simulation does not draw the live numeral light or the band light: those are G20DIAL only.

## 6. Open

1. **Auto start/stop in "G20 Comfort".** Stock behaviour (39): with MSA off, the crossed "A START STOP" replaces "1/min x1000" at [1405, 570, 1506, 612]. Our tacho is opaque there, so BMW's sign never shows through. Once package I's `msa` signal is merged, `gen_g20.py` needs an indicator at that box. It shows in state 2 (off) and hides our "1/min x1000" then. The other states are not photographed.
2. **When the numerals and the band line light up** comes from one pointer position per dial (speedo at 0, tacho at idle): the angular widths are a guess elsewhere. A photo at about 60 km/h and 3000 rpm would settle them.
3. **The mode label in plain Comfort** is left empty on one piece of evidence (41). If BMW prints "COMFORT" there, change the `g20mode1` token.
4. **The fuel tank size.** The app's default is 60 L and the simulation's 65 L, so our needle and BMW's disagree. BMW's no longer shows, but the owner's tank size setting still decides where ours points.
5. **The tacho frame's right side** sits 2-3 px further out on 39 than ours. This may be 39's lens model at the photo's edge. It was not changed.
6. **The day look** (the simulation's `day=1`) got the same factors; no day photo of this quality exists.

## 7. What the owner must check on the car

1. In Comfort+, "G20 Comfort" shows "COMFORT / PLUS" left of a big gear letter in the tacho's centre, over a line. BMW's own "COMFORT PLUS" in the bottom row is gone; its bottom-row gear letter is still there.
2. In plain Comfort, no label. Say if BMW prints one there.
3. The orange glow round both needles at rest: about like 39, and none over the ticks below the bands.
4. The numeral next to each needle is white, the others grey. Speedo's "0" lies over the needle at rest.
5. The fuel and oil minis: thin frames; the fuel needle thick at the frame end and fading inward. No second red stub beside it.
6. With MSA switched off, our "1/min x1000" still shows; BMW's crossed sign does not (open item 1).
7. After a layout or drive-mode switch, BMW's black area may cover our "D". Report whether it does.
