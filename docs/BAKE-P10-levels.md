# Bake P10: levels (black floors, the G20 transfer, corrected baked levels)

Code: `bake/src/P10/`. Numbers and images: `bake/work/P10/` (git-ignored). The review sheets are `review_levels.png` and `review_panel.png`.

## 1. Which build photo 12 shows

`reference/g20/12_our-theme_night_2026-11-11.jpg` shows **cb28ce7 (HEAD = origin/main)**, with the baked scene on.

**How we know:**
- **Timing.** EXIF puts the photo at 22:29:23 +02:00. The commit was made and pushed at 22:24:40, so the photo was taken 5 min later. The car's clock reads 20:29.
- **Layout matches HEAD.** The photo has:
  - the G20 geometry (R 335);
  - the range figure "0 … 456 … km" and the "l/100 km 0 --" arc (both added in 3469042);
  - no gear box of our own, only BMW's P (that box was dropped in cb28ce7).
- **Alignment.** I aligned the photo with a homography from 8 text centres. The residual is 0.96 photo px, about 1.3 panel px (`align12.json`). SIFT on its own fell into degenerate fits. ECC disagreed with the hand points, so I did not use it.

**The car does not draw the dials the way the bench does.** In the photo:
- the face, the inner disc, the ring and the floor are there out to 0.79 R;
- the groove, the ticks, the bezel, the minis, the range-arc segments and the ED-arc segments are missing. Past 0.8 R the photo equals the background.

The bench draws all of them, both at HEAD and with the uncommitted uniform-packing work (renders in the scratchpad). The fallback with `baked` off still has ticks. Disabling WBDIAL removes the faces too. So WBDIAL runs on the car, but only partly as on the bench. The other session's work on the uniform limit is the likely place to look. **This has to be checked on the car before any level is judged by eye.**

## 2. The G20 + phone transfer (photo 12)

**Fit.** Matched pixels are the bench render vs the rectified photo, both low-passed with σ 3 and limited to smooth pixels. Excluded: text, needles, hubs, BMW's overlays, the hood, the minis, and the dial ring from 0.76 to 1.12 R (not drawn on the car). BMW's black area is the panel-0 anchor. The model is per channel, in linear light:

```
photo_lin = F + g * panel_lin ** gamma
```

| | F (floor, linear) | F as photo code | g | γ | rms (code) | p95 | Panel code where the photo clips |
|---|---|---|---|---|---|---|---|
| R | 0.0089 | 23.6 | 7.26 | 0.884 | 12.3 | 23 | 91 |
| G | 0.0060 | 18.0 | 6.93 | 0.862 | 11.1 | 20 | 91 |
| B | 0.0336 | 51.4 | 5.95 | 0.639 | 12.9 | 24 | 68 |

**Floor as a fraction of panel white:** F/(F+g) = **0.12 % / 0.09 % / 0.56 %** (R / G / B). The G20 black is neutral-dark in R and G (about 1000:1) and clearly blue (about 180:1 in B).

**The photo is heavily over-exposed.** It is an iPhone night-mode composite: 10 frames, 0.2 s, ISO 1000. Anything above panel code ~70–90 clips, so the photo shows the car about 2.8 EV brighter than an eye adapted to the white text.

**The residuals have structure.** Bias by region, in code values, is:
- dial faces +12 (the photo is brighter than the model);
- window −7;
- bar +10 to +14 in R/G;
- background −13 in R.

The photo background varies from 26 to 52 depending on how near the window it is. A veiling-glare term (photo blur at σ 40 / 160) only explained it in B (k 0.28). The rest is local tone mapping, or faces that are drawn differently on the car (§1). A monotone LUT per channel is in `g20model.json`; it is not monotone between regions, which is the same finding.

**Validation (old panel vs photo 12):**

| Region | Predicted | Photo |
|---|---|---|
| Background | (24, 29, 83) | (26, 28, 77) |
| Window floor | (113, 134, 215) | (118, 141, 213) |
| Faces | (57, 65, 137) | (45, 53, 129) |
| Window sky | (69, 70, 132) | (83, 83, 136) |

The background and the window floor match well. The faces and the sky are each off by about 12–14. The model is good to about ±12 codes, not better.

## 3. The 6WB's own LCD floor, and what P0 used

The display black is the groove floor between the ticks (0.925–0.955 R, p10, in 30° sectors) or the face's p10, whichever is lower. Groove sectors under 40 % of their dial's median lie on the housing (the dial runs off the LCD there) and are dropped. The spread over the remaining sectors is the veiling-glare range. Details are in `floors.json`.

| Ref | P0 black (luma) | LCD floor RGB (code) | Glare range (luma) | Window-side floor | P0's black was |
|---|---|---|---|---|---|
| 17 | 2.0 | 56, 57, 55 | 38–99 | 58, 63, 75 | **housing** (bottom sectors 165–225 cw12: p5 0–2, while the LCD is 40–60) |
| 07 | 0.0 | 36, 37, 38 | 14–150 | 50, 55, 58 | **housing** (ring p5 is 0 in 11 of 12 sectors) |
| 04 | 7.3 | 9, 11, 15 | 9–37 | 14, 15, 20 | slightly below the LCD (visor at the top left; ring p5 5–8 vs groove 9–10) |
| 05 | 12.9 | 12, 17, 24 (face p10) | 12–41 | 35, 37, 46 (glare from the left) | the LCD (right-hand sectors, p5 13) |
| 03 Comfort | 6.5 | 7, 8, 10 (face p10) | 7–40 | 16, 17, 18 | the LCD |
| 13 | 12.9 | 13, 16, 20 | 14–17 | – | the LCD |
| 06 | 0.3 | 6, 8, 11 | 4–37 | 12, 15, 20 | below the LCD |
| 02 render, 12 | 0 | 0 (render / crushed) | – | – | – |
| 15 | 17 | not measurable (no groove) | – | – | – |

**Verdict on the hypothesis.** It holds for 17 and 07: black 0–2 against an LCD at 36–57. Those two are the sources of the window, the bar and the arcs (P4), and of 17's 50–70 face luma. It holds mildly for 04. It is refuted for 05, 03 and 13, the references the face levels came from: there the ring outside the bezel is on the LCD.

**A second, smaller error everywhere.** P0 subtracted its black in sRGB code values, not in linear light.

Per element, the reference light above its own floor relative to white, as panel code:

| Element | Reference values (panel code) |
|---|---|
| Window sky | 04: 15/15/21 · 03: 3/3/3 · 06: 14/17/22 · 07: 0 · 17: 6/0/0 (haze) → **median 9/9/14** |
| Window lit floor band | 04: 90/109/108 · 03: 68/73/80 · 07: 175/198/208 · 06: 70/73/78 → **median 81/93/96** |
| Face (05) | 21/25/33 raw over floor 12/17/24 → about 9/8/8 code |

## 4. The correction, applied at the source

**One shared step** (`P10/levels.py`). A P0-normalised code c is first returned to the photo's own code value:

```
raw = c / (gain * wb) + black_P0
```

It is then turned into L, the light above the floor relative to white, and re-encoded as panel code with white kept at 235:

```
L  = (lin(raw) - lin(F_region)) / (lin(W) - lin(F_region))
c' = srgb(L * lin(235))
```

F_region is the floor plus the local glare offset: the dial itself, the window side or the outer side.

**Which references each package uses:**

| Package | References | Region |
|---|---|---|
| C1 | 05, 04, 03 (curves averaged) | dial |
| C2 | 05, 04, 03 (curves averaged) | dial |
| C3, C4, C7 | 04 | outer |
| C8-sport | 03 Sport | dial |
| C8-eco | 03 Eco | dial |
| C10 | 02 (render, floor 0) | – |

**C5 and C6 are re-fitted** (`P10/window.py`). 17's haze sits at the sky's own level, so 17 cannot place the sky. Instead there is one luminance curve that keeps the hue. It is piecewise linear in linear light through:
- 0 → 0;
- 17's sky (49, 51, 63) → the median of 04, 03, 07 and 06 (9, 9, 14);
- 17's lit floor (137, 173, 225) → that median (81, 93, 96);
- 235 → 235.

**The `apply` step:**
- It transforms albedo, glow, highlight and merged layers; the alpha is kept.
- It leaves shadow and mask files alone.
- It also covers the 1× procedural renders in `bake/work/C1/proc` and `bake/work/C2/proc`, which the scene stack uses.
- It is idempotent: package outputs are kept in `bake/work/P10/pristine/`, with hashes in `applied.json`.
- The package builds were re-run first (`P10/regen_packages.sh`). They reproduced the committed assets byte for byte; C9 failed on the changed `visible.js`, but C9 is documentation only.

Before → after, mean RGB over opaque pixels (all of them are in `applied.json`):

| Layer | Before | After |
|---|---|---|
| speedo face | 7.0, 9.9, 17.1 | 7.8, 8.8, 13.9 |
| speedo base | 5.4, 7.6, 13.4 | 6.3, 6.4, 9.2 |
| tacho static | 3.8, 7.1, 12.9 | 3.5, 4.7, 8.7 |
| tacho face | 3.6, 7.7, 15.0 | 3.2, 4.7, 10.3 |
| window base | 65.7, 75.8, 98.6 | 23.2, 28.4, 39.5 |
| horizon | 96.6, 119, 148 | 50.1, 63.3, 80.6 |
| infobar body | 2, 2, 27 | 0.2, 0.2, 3.0 (the blue strip goes) |
| infobar line | 223, 229, 233 | 218, 224, 228 |
| range-arc track | 88, 88, 92 | 52, 52, 54 |
| ED-arc track | 114, 96, 106 | 70, 61, 67 |
| inner disc / ring / floor (C1 proc) | 29, 34, 42 · 18.5, 23, 30.5 · 40, 44, 52 | 33, 37, 44 · 21.5, 25, 31 · 44, 47.5, 54 |
| mini faces | 3, 4, 6 | 2.1, 1.3, 1.1 |
| Whites, reds, signs, Sport / Eco glows | – | ±3 |

**Panel regions on the bench, old → new** (the new one with window gain 1.0, §6):

| Region | Old | New |
|---|---|---|
| speedo face | 7, 10, 17 | 8, 9, 14 |
| below the floor | 3, 5, 9 | 4, 3, 2 |
| tacho face | 2, 6, 13 | 1, 3, 7 |
| window sky | 12, 12, 15 | 9, 10, 14 |
| window lit floor (p90) | 30, 38, 49 | 66, 83, 110 |
| bar body | 2, 2, 27 | 0, 0, 3 |
| background | 0, 1, 2 | 0, 1, 2 |

Geometry is untouched. The manifests' `fit` numbers are the packages' pre-P10 QC.

## 5. Predicted car look (`predict.json`, `review_levels.png`)

**At photo 12's exposure.** The new face is (59, 62, 129) against the old (57, 65, 137). The sky is (62, 65, 129) against (69, 70, 132). The window floor is (198, 237, 255) against (113, 134, 215): brighter, and clipping in night mode. The bar is (24, 18, 90) against (38, 36, 163).

**White-matched, photo to photo:**

| Region | 6WB 04 | Car old | Car new | 6WB 03 | Car new |
|---|---|---|---|---|---|
| Face | 14, 17, 22 | 17, 21, 58 | 18, 20, 54 | 9, 11, 13 | 18, 20, 53 |
| Below the floor | 18, 19, 25 | 11, 14, 47 | 12, 11, 32 | 16, 18, 21 | 12, 10, 31 |
| Window sky | 25, 26, 34 | 22, 24, 55 | 19, 21, 54 | 9, 10, 12 | 19, 21, 53 |
| Window floor | 105, 127, 127 | 42, 52, 94 | 79, 98, 151 | 79, 86, 93 | 77, 96, 148 |
| Background / LCD black | 8, 10, 12 | 4, 6, 32 | 4, 6, 32 | 4, 5, 9 | 4, 6, 31 |

**What the comparison shows:**
- In R and G, the corrected panel is now at the 6WB's level: faces within a few codes and the window floor close. The old window floor was too dark by 2×, because of P9's 0.24 gain.
- What remains is **blue**. The G20 floor plus the phone's blue response (γ_B 0.64, floor 0.56 % of white) lifts every dark area to B 30–55, where the 6WB photos sit at 9–25. The panel cannot go below its own black. A further blue cut in the darks would only help where the panel's B is above 0, which is already mostly done.
- The "too light" look in photo 12 comes mostly from three things:
  1. the night-mode exposure (+2.8 EV);
  2. the blue G20 black;
  3. the bright blue bar strip.

  The baked face levels are not a major cause.

## 6. Theme constants outside the baked files (`bake/work/P10/theme-levels.patch`, against `design/gen_6wb.py`, NOT applied)

The patch applies cleanly. Regenerating `gen_6wb.py` rewrites `wb_comfort.json` and `wb_comfort_map.json`.

| Constant | Old | New | Reason |
|---|---|---|---|
| bg `gain` (window, horizon, line) | [0.24, 604] | [1.0, 604] | The window level is now in the texture. 0.24 would dim it twice and put the floor bars at half the 6WB's. |
| range-arc fill colour | [222, 220, 216] | [210, 209, 205] | C6 curve |
| ED-arc fill colour | [214, 128, 136] | [114, 66, 70] | C6 curve. Weak: its source was hazed 17; drop this hunk if it reads too dark. |

**No change needed:**
- `shared/shaders.js` WBBACK C10 background, (0, .5, 1.5)/255 plus halo (1, 1, 2)/255: the C10 curve gives (0, .5, 1.4) and (.9, .9, 1.8), a change under 0.2 code.
- The theme's `face` [0, 0, 0].
- Sport and Eco opacities (P9-composition: band and bridge 0.48 default, proposal 0.35 / 0.30; the Eco tint gains). These are ratios, not levels. The Sport and Eco layers' colours went through their own curves.

**Fallback only (`baked` off):**
- The WBDIAL procedural face lift (0.026, 0.030, 0.040) would map to about (0.029, 0.023, 0.015).
- The C1 curve for disc (0.038, 0.042, 0.052) is about the same, slightly less blue.

These are left as they are. That path is not the default, and shaders.js is being edited.

## 7. To finish (needs the forbidden paths)

1. Run `cd bake/src && ./P9/py.sh ../../tools/bake_scene.py` to repack `hud/scene/*.json` from the corrected layers. I checked that this pipeline reproduces the committed scene byte for byte from the pristine layers. I used it in a scratch copy for the "new" render.
2. Apply `theme-levels.patch`, then run `gen_6wb.py`.

**Regenerate P10 itself:**

```
./P10/regen_packages.sh && ./P10/py.sh -m P10.floors && ./P10/py.sh -m P10.window && ./P10/py.sh -m P10.apply
```

Analysis only:
- `P10.align12` with a render;
- `P10.g20model` (set `P10_FIT_FACES=1` to include the faces);
- `P10.predict OLD NEW`;
- `P10.sheet`.

## 8. Uncertainty

- **Night mode.** It merges frames, applies local tone mapping and uses an auto white balance under warm street light. All of these exaggerate brightness and blue, which is why the regional biases reach ±12.
- **One photo.** It cannot separate the panel's gamma from the camera's. That is why the gammas sit at 0.86 (R/G) and 0.64 (B).
- **The car's partial dial drawing (§1)** makes the faces' panel value uncertain.

**A second photo would settle it:**
- **Kind of photo.** Same scene, phone in a pro / manual app: fixed exposure, ISO 50–100, 1/30 s, no night mode, white balance locked at 5500 K, RAW if possible.
- **Exposure.** Numerals unclipped.
- **Content.** A calibration layout of flat patches at panel 0 / 4 / 8 / 16 / 32 / 64 / 128 / 255 per channel, plus our theme.

That gives the true G20 floor, gamma and blue leakage directly, and shows whether the blue is the LCD or the camera. A shot of the stock BMW theme at the same exposure would give a G20-to-G20 reference.

The 6WB floors themselves rest on photos with their own processing: 17 and 07 are hazed; 04, 03 and 05 are good.
