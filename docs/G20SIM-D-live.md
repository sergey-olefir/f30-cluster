# G20 bench simulation, package D: the live model (pointers, minis, map)

Scope: the parts of BMW's stock G20 Comfort cluster that move: the speedo and tacho pointers with their glow, the tacho rev band, the fuel and oil-temperature mini needles with their lit fill, and our own synthetic map with the position arrow.
It is bench only (`bench/g20/`). It contains no photo pixels and no BMW map data.
The brief is `docs/AGENT-BRIEF-g20-sim.md` §4 and §7 D; the interface is `bake/work/g20sim/CONTRACT.md`.

## 1. Delivered

| Path | What |
|---|---|
| `bench/g20/live/live.js` (66 KB) | `window.G20Live`. All drawing is procedural; there are no assets. |
| `bench/g20/live/manifest.part.json` | 9 procedural entries (z, composite, evidence, sources, the PARAMS keys each one uses) |
| `bake/src/G20/live/common_live.py` | Photo loading, tick detection, a guided ridge fit for bars, least-squares meeting point |
| `bake/src/G20/live/fit_scales.py` | Every tick of both scales; the pointer bars on 08/09/10/14; the three pointer models compared |
| `bake/src/G20/live/fit_bar_profile.py` | The bar's cross profile (colour, width, dark rim) and its caps |
| `bake/src/G20/live/fit_glow.py` | The pointer glow, from 08 (tacho at 0) and 09 (idle) together |
| `bake/src/G20/live/fit_minis.py` | The mini needles |
| `bake/src/G20/live/fit_map.py` | Map background, road colours and widths, the edge fade |
| `bake/src/G20/live/build_params.py` | Collects the fits and writes `G20Live.PARAMS` into `live.js` (between `/*<PARAMS>*/` markers) |
| `tools/g20sim/D/` | `py` (uv wrapper), `shot.sh` (headless Chrome with its own profile), `crop.py`, `dials_mask.py`, and the acceptance checks `qc_ticks.py`, `qc_rest.py`, `qc_sweep.py`, `map_sheet.py` |
| `bake/work/g20sim/D/` (git-ignored) | The fit JSONs, the harness (`harness/index.html`), screenshots, review sheets. Photo crops live only here. |

To reproduce, run `fit_scales`, `fit_bar_profile`, `fit_minis`, `fit_glow`, `fit_map` and then `build_params`, each with `tools/g20sim/D/py`.
Then start `python3 -m http.server 8093 --directory <worktree>` and run the `qc_*` scripts.

## 2. API, as implemented

```js
G20Live.init(base)          // -> Promise. No assets; builds the per-pixel glow and fill buffers and the map mask.
G20Live.drawMap(ctx, s)     // z 10: map tile (offscreen, redrawn when it drifts >= 0.25 px or the look changes), the fade, the arrow
G20Live.drawGauges(ctx, s)  // z 50-59: glow (lighter) -> tacho rev band -> pointers (shadow, rim, core) -> mini fill -> mini needles
G20Live.wantsFrame(s)       // true while a smoothed value is still moving, or while s.values.speed > 0.5 (the map drifts)
G20Live.PARAMS              // every model number as {v, ev, src, note}
G20Live.pointerAt(which, value, opts)
  // which: 'speed' (km/h) | 'rpm' (1/min) | 'fuel' (litres of the 65 L tank) | 'oil' (degC)
  // opts.connected: the theme-connected tacho bar (short)
  // -> { tip: [x,y] (outer visual end, at the scale), tail: [x,y] (inner visual end), angle (deg, atan2 of the outward
  //      direction), glowBox: [x0,y0,x1,y1] (null for the minis), scalePt, u, width, value }
```

- Smoothing: each value approaches its target exponentially, with τ = 70 ms and the clock taken from `s.t`. The harness measured 90 % in 165 ms and 95 % in about 210 ms.
- A null value falls back to `PARAMS.defaults`: speed 0, rpm 0, fuel at f 0.83 and oil 110 °C, as in 08.
- Cost: 1.3 ms per frame while both pointers move and the map drifts (headless swiftshader). It is near zero at rest, because the glow and fill buffers are cached by value.
- The canvas state never leaks: every function uses `save()` and `restore()`.

## 3. Scales and the pointer model

### 3.1 Ticks

Ticks were found as white short dashes on 08 and 09. Each tick's outer end is its centroid plus half its length, outward. Values were assigned from the scale structure:

- **Speedo:** minor ticks every 2 km/h up to 60, every 5 up to 140, every 10 up to 260. Majors at 0–60 by 10, then 80, 100, 120, 140, 170, 200, 230 and 260.
- **Tacho:** 0 to 7 in steps of 0.1, with majors every 0.5.

| Scale | Ticks | Measured | Filled in |
|---|---|---|---|
| Speedo | 59 | 56 | 0 km/h is under the pointer; 240 and 250 are hidden by "260" |
| Tacho | 71 | 63 | The minor ticks in the red band above 6 |

- 08 and 09 agree: median spread 0.34 px (speedo) and 0.17 px (tacho).
- A value maps to a point by piecewise-linear interpolation between ticks along this "tick ring".
- The speedo's 0 point is where the 0 km/h bar crosses the ring. That is 0.41 px from the 0 tick extrapolated from 2, 4, 6 and 8.

### 3.2 Which model

There are three tacho poses: 0 in 08, and idle in 09 and 14. Their bars cross the ring at 0.00, 0.70 and 0.72 × 1000.

| Model | 08 (0) | 09 (0.70) | 14 (0.72) |
|---|---|---|---|
| **A: rays from one virtual centre** | 0.00° | 0.29° | 0.29° |
| B: parallel to the local tick axis | 0.28° | 2.7° | 2.8° |
| C: normal to the scale polyline | 4.45° | 1.3° | 1.2° |

**A was chosen.** The three bars meet at (1476.8, 384.1), rms 1.25 px; the 10 bar (under the grid) agrees within its noise. The tacho centre's evidence is medium.

- **The ticks themselves are not concurrent.** The majors miss any common point by 41–45 px rms. The lower majors meet near the bar centre, at (1468.6, 368.8) for the tacho and (482.3, 349.5) for the speedo, but above 1.5 × 1000 or 40 km/h the ticks turn up to 25° away from the centre's rays.
- So above idle, A and B disagree. Only a photo in motion can decide. `PARAMS.*.orient = 'tick'` switches to B, and its `ev` is **weak**.
- **Speedo centre (441.0, 384.1), weak.** The speedo was only seen at 0. The centre lies on its measured 0-bar, at the tacho centre's y. The mirror of the tacho centre is 2.2 px away (the layout is mirror-symmetric about x 960 within ~4 px).
- **The rectified speedo bar is slightly bent.** The upper part fits 13.8°, the lower part (below the "0 km/h" digits) 14.6°. The joined line is 14.9°.

### 3.3 The bar

| Parameter | Value | Evidence |
|---|---|---|
| Length, stock | 187.5 px (08: 189.5, 09: 185.4) | |
| Length, theme connected | **109.0 px** (14; 10 agrees) | BMW draws a short tacho bar while a theme is connected, plausibly to clear the black box |
| Speedo length | 182.8 px | Its own; 14 shows it full length |
| Outer end past the tick ring | 4.6 px (6.2 / 3.1 / 4.5) | |
| Core width | 6.0 px | |
| Core colour | night (240, 126, 99), day (248, 122, 94) | |
| Caps | Round | |
| Dark rim | A thin dark-red line 5.5 px to the **low-value side**, plus a fainter one on the high side | |
| Shadow | A soft dark band on the low side: alpha 0.62 to 8 px, then exp(−(d − 8) / 14) | |

The shadow was fitted from the ratio of the photo to (stand-in + our glow) across the bars: 0.32–0.50 at 8 px, 0.52–0.62 at 14, 0.72–0.75 at 20, 0.87–0.92 at 30, about 1 at 40.

### 3.4 Tick-hit table

The table comes from the headless Chrome screenshot of the module's bars over black (`qc_ticks.py`). Each rendered bar was re-fitted on the screenshot and compared with the tick measured on the photos.

- **perp:** the distance from the tick to the rendered bar axis.
- **along:** the distance along the ring between the tick and the rendered crossing.

| Dial | Value | Tick (photo) | Rendered crossing | perp px | along px |
|---|---|---|---|---|---|
| speed | 0 | (373.2, 636.8) extrap. | (373.0, 636.8) | 0.23 | 0.23 |
| speed | 20 | (234.3, 602.1) | (234.0, 601.5) | 0.63 | 0.66 |
| speed | 40 | (146.5, 480.1) | (146.3, 479.5) | 0.63 | 0.63 |
| speed | 60 | (93.1, 340.4) | (93.2, 340.0) | 0.38 | 0.38 |
| speed | 100 | (184.5, 196.5) | (184.5, 196.4) | 0.13 | 0.13 |
| speed | 140 | (329.2, 95.6) | (328.9, 95.7) | 0.29 | 0.30 |
| speed | 200 | (513.3, 58.7) | (512.6, 58.9) | 0.62 | 0.71 |
| speed | 260 | (701.3, 41.8) | (700.5, 41.9) | 0.63 | 0.85 |
| rpm | 0 | (1546.3, 641.6) | (1545.9, 641.8) | 0.38 | 0.38 |
| rpm | 1000 | (1685.0, 602.7) | (1684.9, 602.8) | 0.05 | 0.05 |
| rpm | 2000 | (1771.9, 480.3) | (1772.0, 479.9) | 0.32 | 0.32 |
| rpm | 3000 | (1824.8, 340.3) | (1824.6, 339.7) | 0.56 | 0.57 |
| rpm | 4000 | (1731.2, 194.5) | (1730.6, 194.1) | 0.66 | 0.72 |
| rpm | 5000 | (1583.5, 92.9) | (1582.9, 92.9) | 0.62 | 0.65 |
| rpm | 6000 | (1400.4, 58.0) | (1400.0, 58.0) | 0.37 | 0.40 |
| rpm | 7000 | (1213.7, 41.4) | (1213.6, 41.4) | 0.13 | 0.17 |

**Every value is within 0.85 px.** This shows that the table and the drawing are right. Whether the real pointer crosses its tick at its value is confirmed only at 0 and at idle.

At rest, the model's ends match the photos:

| Pose | Outer end, model vs photo | Inner end, model vs photo |
|---|---|---|
| Tacho at 0 (08) | (1547.5, 646.1) vs (1548.1, 647.5) | (1498.6, 465.1) vs (1498.6, 464.6) |
| Tacho at idle (09) | (1650.0, 631.6) vs (1649.3, 630.3) | (1542.5, 478.0) vs (1542.1, 479.0) |
| Tacho at idle, connected (14) | | (1589.0, 541.1) vs (1589.7, 540.5) |
| Speedo at 0 | | (419.5, 464.7), exact |

## 4. The glow and the rev band

### 4.1 The glow

The glow is additive (`lighter`), in the pointer's polar frame about the dial centre:

```
g = rgb · gain · A(φ) · W(q) · face
```

- **φ:** the angle from the bar, positive toward higher values.
- **A(φ):** a Gaussian with σ_hi = 20° and σ_lo = 26°.
- **q:** the depth inside the tick ring along the ray. W is 1 down to q0 = 80 px, then falls by smoothstep to 0 at q1 = 220 px.
- **face:** a clip polygon. It is the tick ring pushed 7 px out to the bezel, plus the dial face's inner edge. That edge was measured row by row on 09 and mirrored for the speedo; its middle (y 240–430) is interpolated to a vertex at (1525, 339). In the photos the glow stops sharply at that edge.

**Fit (`fit_glow.py`):** o09 = a·(o08 − glow08) + b + glow09, per channel. This is linear in (a, b, a·c08, c09), and the shape was grid-searched.

| Result | Value |
|---|---|
| Night colour at full strength | (140, 39, 17) |
| Day colour at full strength | (109, 27, 13) |
| Exposure a | (0.816, 0.982, 1.108) |
| Exposure b | (23, 12, 3) |
| rms | 13.8 (18.5 without glow) over 75 520 px: the glow explains 45 % of what exposure alone leaves |

Rendering: the buffer is half resolution with ψ and W(q)·face precomputed per pixel; each frame recomputes only A(φ), and only when the bar moved.

- **Evidence:** medium for the tacho from 0 to about 1.7 × 1000, where both glows were seen. Weak above that, and weak for the speedo, which is a mirror of the tacho.
- **`glow.gain` is for the lead to calibrate** against B's faces. The ratio analysis suggests about 1.1–1.2× for the tacho and the day speedo, and about 0.8× for the night speedo.

### 4.2 The rev band

The tacho has a pink rev band inside the ticks, running from 0 to the pointer.

| Parameter | Value |
|---|---|
| Depth inside the tick ring | 18.5 px |
| Width | 6.5 px |
| Colour | (250, 58, 92) |
| Path | Follows the tick ring smoothed over ±2 ticks |

- It is seen in 09 and 14 at idle and is absent in 08 at 0 (medium).
- Beyond 0.7 × 1000 it is extrapolated (weak).
- There is no speedo band: none was ever visible, because the speed is 0 in every photo (evidence none).

## 5. Rest-position QC

There is no static layer from B yet, so `qc_rest.py` uses a **cross stand-in**:

- **For 08:** 09, mapped to 08's exposure, with 09's bars and band inpainted and our day glow at 09's pose taken out.
- **For 09:** 08, mapped the other way.

Our layers are then drawn by the module in Chrome over that stand-in, and the result is compared with the photo.

- The glow was fitted on the same two photos, so this test is in-sample.
- The ROIs mask the catalogue's text and lamps (OFF vs 0, P vs D) and the speedo's "0 km/h" label.

| Case | Part | SSIM | ΔE2000 mean | ΔE p95 | Stand-in alone: SSIM / ΔE |
|---|---|---|---|---|---|
| 08 night, tacho at 0 | bar | 0.697 | 11.1 | 30.7 | 0.294 / 32.5 |
| 08 night, tacho at 0 | glow | 0.727 | 11.4 | 29.7 | 0.595 / 15.4 |
| 09 day, tacho idle 0.70 | bar (+ band) | 0.642 | 12.4 | 30.2 | 0.221 / 26.0 |
| 09 day, tacho idle 0.70 | glow | 0.795 | 8.7 | 23.5 | 0.745 / 13.8 |
| 08 night, speedo at 0 | bar | 0.519 | 12.5 | 36.2 | 0.213 / 26.9 |
| 08 night, speedo at 0 | glow | 0.822 | 9.6 | 29.0 | 0.735 / 9.7 |
| 09 day, speedo at 0 | bar | 0.519 | 13.4 | 37.8 | 0.211 / 28.7 |
| 09 day, speedo at 0 | glow | 0.862 | 8.6 | 23.5 | 0.712 / 14.5 |

Why the bar SSIM is below 0.85:

- The bar is a 6 px high-contrast line. The camera blurs it to about 7.5 px, and we draw it crisp: what the eye sees on the LCD, not what the camera recorded.
- About 1 px of position error makes a red/blue edge pair. The speedo's rectified bar is bent by about 1.5 px.
- The inpainted stand-in leaves smears.

The glow ROIs (36–46 k px) reach 0.73–0.86. The review sheets are `bake/work/g20sim/D/qc_rest_*.png`.

## 6. The minis

### 6.1 Fuel and oil needles

The oil mini is the fuel mini mirrored about x 960: its frame ticks, zones, notch and needles all sit at the mirrored spots within about 3 px (medium).

**Fuel ring (weak):** f = 1/4, 1/2 and 3/4 are frame ticks read on 4× crops (±1.5 px). The ends, f = 0 (the frame's bottom end, where the red reserve mark starts) and f = 1 (the top-left corner), are weak; no tick was seen there.

Each photo needle was extended back to the ring to get its f, its inset and its length. Inset, length and direction are interpolated by f.

| Needle | f | Inset | Length | Direction |
|---|---|---|---|---|
| Oil 14 (cold end) | 0.01 | 16.8 px | 57.7 px | −25.0° |
| Oil 08/09 (at the notch) | 0.51 | 7.8 px | 84.3 px | −14.2° |
| Fuel 08/09/14 | 0.84–0.87 | 2.4 px | 77.8 px | −6.4° |

- **Shape:** a tapered red bar, 10 → 4.5 px wide, colour (255, 112, 98), dimming to (190, 78, 74) at a round tip.
- **The fill moves with the value.** The lit fill (205, 175, 180) sits below the needle and falls off with depth: alpha 1 to 8 px, then exp(−((d − 8) / 36)²). In 08 it reads 1.0 at 8 px, 0.56 at 35 and 0.21 at 55. It is gone above the needle and in 14's cold oil mini.
- **Model vs photo:** the needle ends are within 1.3 px for fuel 08, 09 and 14, and within 1.9 px for oil 08, 09 and 14.

### 6.2 The oil range

The oil scale has no numerals. **70..150 °C is a guess (weak).**

- 14 shows COLD with the needle at its bottom end.
- In 08 and 09 the engine is warm and the needle sits on the notch (f 0.5).
- The red zone starts at f ≈ 0.81.

With 70..150, warm oil (≈ 110 °C) lands on the notch and the red zone starts at about 135 °C.

## 7. The map

- **Layout:** our own seeded layout, in world bands of 360 px.
  - A main road under the arrow.
  - Continuous secondary roads at ±170–340 px.
  - Cross streets with hooked ends.
  - Combs of short stubs, as in 08.
  - Occasional curves, diagonals and a rare roundabout, as in 09.
- **Background:** night (46, 46, 56), day (65, 62, 66). This is the median more than 150 px inside the region edge.
- **Roads:** night (220, 210, 212), day (232, 221, 223); the 90th percentile of the road cores, because the median is pulled down by antialiasing.
- **Road widths (minor / main):** night 3.6 / 5.0 px; day 4.6 / 8.5 px (09 is zoomed in).
- **Edge fade:** alpha = 1 − (1 − min(d / 120, 1))². The measured background reaches about 0.4 of the centre at 35 px and about 0.9 at 110 px, in both looks.
- **Arrow:** a two-tone red chevron at `map.position_arrow`. It does not move.
- **Drift:** the streets move down at speed (m/s) × 1 px/m. The scale is weak; the gain is in `map.drift_gain`.
- Photo 14's much lighter map background is not modelled.

The review sheet is `bake/work/g20sim/D/map_sheet.png`: rect 08 against our night look, rect 09 against our day look, rect 14, and a frame after 3 s at 50 km/h.

## 8. The owner's question: the cut at y 656 and the collar

Our wb_dials shapes were rebuilt exactly as `tools/overlay/plan_dials.py` builds them (`tools/g20sim/D/dials_mask.py`). The brief's numbers check out:

- The big discs are centred at (411.5, 380) and (1507.5, 380), R 334 (drawn to R − 1), cut at y 656. The big dials' lowest row is 655.
- The minis are at (80, 608) and (1840, 608), R 70, and are not cut (they reach y 676).
- The sign window and the "i" window are cut out.

**The sweep:** our module drew each item alone in Chrome:

- speed 0..260 in steps of 2, rpm 0..7000 in steps of 50 (stock bar and connected bar), fuel 0..65 L, oil 60..150 °C;
- bar or needle pixels: alpha > 25/255;
- glow pixels: added light ≥ 8/255. A threshold of 3/255 gives the same picture.

Each item's pixels were counted against the collar (`design/overlay/collar.dials.png`) and against our dials.

| Item | Max y (at value) | px at y ≥ 656 | Max px outside our dials (all under the collar) | Max px visible (outside dials and collar) |
|---|---|---|---|---|
| Speedo bar | 644 (10 km/h) | 0 | 1442 | **0** |
| Speedo glow | 649 (0) | 0 | 8004 | **0** |
| Tacho bar, stock | 646 (0) | 0 | 1476 | **1** at 7000 |
| Tacho bar, connected | 646 (0) | 0 | 1342 | **1** at 7000 |
| Tacho glow | 650 (0) | 0 | 8459 | **4** at 5650–7000 |
| Fuel needle | 643 | 0 | 626 | 0 |
| Oil needle | 643 | 0 | 623 | 0 |

- **Nothing of the stock pointers, their glow or the mini needles reaches the cut at y 656** anywhere in their travel. The lowest is the bar and glow at rest (y ≤ 650).
- The pointers move **up and away from the cut**.
- Everything that leaves our dials (at high values, near the stock top arcs) stays under the collar.
- The only leak is a 1-px column at (1209, 35–38): the tacho bar tip and glow at 7000, just past the stock outline hull by the "7". It lies above our tacho's top (y 46) and likely under the hood.
- With the 'tick' orientation the result is the same: nothing at y ≥ 656, and at most 20 px visible, at 7000.

## 9. Evidence per parameter

Each parameter's evidence is in `PARAMS` (`ev` and `note`); `manifest.part.json` repeats it per element.

| Evidence | Parameters |
|---|---|
| Strong | The tick tables and positions; bar width, colour and caps; map region and arrow |
| Medium | Tacho centre, beyond, lengths (stock and connected), rim and shadow; glow shape, colour and face (tacho from 0 to about 1.7); rev band near idle; mini inset, length, direction, needle and fill; map colours, widths and fade |
| Weak | Pointer orientation in motion; speedo centre; speedo glow; glow gain; band beyond idle; fuel ring ends; oil range; map scale (px/m); defaults |
| None | Map seed and layout (ours by design), drift gain, smoothing τ, glow buffer resolution, a speedo band |

## 10. Open points

1. **The pointers in motion.** One owner photo at about 50 km/h and 2000 rpm settles three things: 'centre' vs 'tick' orientation, the length away from the bottom, and the glow above idle. Correct the numbers in `PARAMS`, or in `build_params.py`, and re-run.
2. **Package B must not bake** the pointer glow, the pointers, the rev band or the mini fill into its static faces. Our glow is additive over a glow-free face.
   - At night, the face beside the tacho without glow is about (20–30, 18–22, 27–30).
   - In the photos the glow at the rest pose is part of the face. B needs a glow-free face, for example from the side away from the pointer, or by subtracting this model.
3. **Draw order.** In 08 and 09 the speedo's "0 km/h" scale label (B's) is drawn **over** the stock pointer. With z 20–49 under D's 50–59, our bar would cross over it. The fix is for B to ship that label as its own layer, drawn after D.
4. The speedo rev band: unknown, so it is not drawn. It would show at any speed above 0.
5. Photo 14's map is lighter than either look (its clock reads 10:15, which suggests day). It was not modelled.
6. The fuel ring ends (f 0 and f 1) and the oil temperature range are guesses.

## 11. Deviations from the contract

- `pointerAt` takes an optional third argument, `{connected}`, because the tacho bar is short while a theme is connected.
- `pointerAt` returns extra fields: `scalePt`, `u`, `width`, `value`.
- `glowBox` is `null` for the minis.
- `drawGauges` also draws the tacho rev band and the minis' lit fill. Both move with their values, so they are D's.
- There is a `G20Live._debug` hook, used by the harness.
- `PARAMS` leaves are `{v, ev, src, note}` objects. Code reads `.v`.
