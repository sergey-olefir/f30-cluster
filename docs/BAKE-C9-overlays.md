# BAKE C9: housing and glass, BMW's overlays on the G20, and the background (C10)

Package P8. **C9 is documentation only: nothing is shipped from it.** C10 is one baked layer.
Machine-readable versions: `bake/manifest/C9.json` (12 entries, all with `file: null`) and `bake/manifest/C10.json`.
Raw numbers: `bake/work/C9/overlays.json`, `bake/work/C9/housing.json` and `bake/work/C10/c10_fit.json`.
To regenerate, run this from `bake/src`:

```sh
export UV_CACHE_DIR=/Users/solefir/projects/f30-cluster/bake/work/.uvcache
PY="uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python"
$PY -m C9.build && $PY -m C10.build
```

All coordinates are panel px (1920×720, y down). Dial-frame values are in R units of our G20 geometry: R 335, C1 (412,380), C2 (1508,380). Angles are cw12.

## 1. Housing and glass (documentation only)

These were measured on P0's rectified dial crops of 17, 07, 04, 03, 06 and 02. The polar unwraps are in `bake/work/C9/housing_polar.png`.

**Bezel crescent.** The bezel ridge sits at r = 0.985–0.99 R in every good fit. Its FWHM spans about 0.985–1.0 R, which is 4–6 px at R 335. Along part of the ridge the ridge is brighter, forming an arc. Normalised luma rises from a base of 42–125 to a peak of 199–236.

| Photo | C1 peak cw12 / span | C2 peak cw12 / span |
|---|---|---|
| 17 (good) | 90 / 58 deg | 272 / 38 deg |
| 07 | 74 / 86 deg | 272 / 50 deg (fit poor) |
| 04 | 220 / 20 deg | 142 / 58 deg |
| 03 comfort | 214 / 22 deg | 202 / 26 deg |
| 06 | 28 / 34 deg | 132 / 62 deg |
| 02 render | 338 / 150 deg | 272 / 68 deg |

The arc lands somewhere different in every photo. In 17 and 07 it faces the window and the two dials mirror each other. This is a specular reflection of the room in the glass, not a drawn feature, which agrees with P0 finding 5. **Do not bake it.** If you want a static gloss, it belongs in the C1/C2 bezel layer (z 11). There, 02's upper-left key is the only drawn evidence.

**Glass reflections and veiling glare.** These were measured outside each photo's own dial circles (normalised luma):

| Photo | What we see |
|---|---|
| 17 | Lifts the whole surround to a warm grey, L 45–47 (p95 83–87, rgb ~32,30,27) |
| 03 | Sides and bottom at L 27–36 (daylight on the housing) |
| 04 | Top-band p95 of 19 (the hood) |
| 06 | L 8–11 |
| 07, 02 | 0–2 |

No shape repeats across photos. Evidence is weak. Not baked.

**Black surround.** The drawn background outside the dials is black: far-field median 0,0,0 in 02, 0,1–2,3 in 04, and 3–5 in 03 (flare). The glossy black housing beyond the TFT (L 45–90 in the lit-room photos 17 and 07) lies outside our 1920×720 panel. On the G20 the hood (`shared/visible.js` HOOD) takes its place. The surround therefore is the C10 base colour (section 3).

## 2. What BMW draws over our panel on the G20

**Sources:**
- **Photo 10** (grid, homography Hm): the main source. Each measurement is corrected by the offset of our own grid lines next to it. The local Hm error there is 1–3.3 px.
- **Photo 11** (our theme, P0's 4-point fix): used to prove what is drawn *over* an opaque custom theme. Its geometry is off by up to ~15 px at the bottom, so it is not used for coordinates.
- **Photos 08 and 09** (stock theme): give the stock telltale and bottom-row positions.

**P0's rectification of 08 is degenerate:** its PANEL crop is a smear. C9 re-derived 08 from the 09 rect (SIFT, 482 inliers, rms 1.8 panel px). See `bake/src/C9/align08.py` and `bake/work/C9/08_rect_panel.png`.

Maps:
- `bake/work/C9/overlays_annotated.png`: 2× scale, drawn over a dimmed photo 10. Scratch file, not shipped.
- `bake/work/C9/overlays_schematic.png`: the same map without photo pixels.

In both, dashed yellow is `visible.js`, solid boxes are measured, and grey shows our dials and window.

| Overlay | Measured x0, y0, x1, y1 | visible.js | Δ px (meas − js) | R units | Over a custom theme? |
|---|---|---|---|---|---|
| Black area | **1419.5, 320.8, 1610.8, 437.9** | 1420, 320, 1597, 440 | −0.5, +0.8, **+13.8**, −2.1 | C2: u −0.264…0.307, v −0.177…0.173 (covers the hub) | yes, observed (10, 11) |
| Gear letter "P" | 1398.4, 667.2, 1421.4, 700.2 | 1392, 664, 1428, 706 | +6.4, +3.2, −6.6, −5.8 | C2: r 0.95 R at 198° | yes, observed (10, 11) |
| Driver belt lamp | 589.7, 664.9, 623.7, 713.9 | 587, 665, 626, 720 | +2.7, −0.1, −2.3, −6.1 | C1: r 1.09 R at 148° | yes, observed (10, 11) |

How to read these numbers:
- **Black area.** Its edges come from the half-max points where it cuts our grid lines: 2 to 4 samples per edge, spread under 1 px. **`visible.js` puts the right edge 13.8 px too far left.** Proposed value: `[1420, 320, 1611, 440]`. I did not edit it (forbidden path); that is for the owner of `shared/`.
  - The box sits exactly where the stock theme draws its big gear letter (08/09: x 1491–1546, y 324–400).
  - Photo 11 agrees on the left and top edges (1421 / 320). Its right and bottom edges have no contrast there.
- **Gear letter.** `visible.js` covers the "P" with a margin of about 6 px. Keep it, because R, N, D, S and M are wider. In 11 the "P" lands at 1389, 659, 1414, 691, an error of about 9 px that comes from 11's 4-point fix.
- **Belt lamp.** The `visible.js` box runs to the panel's bottom edge (720), which is conservative and fine.

**Telltales of the stock theme** (08, night with warnings; 09 day). Their positions are good (rms 1.8 px). Whether BMW draws them over a custom theme has **not been observed**; only the driver belt has been. Evidence is weak.

| Group | Lamps (x0, y0, x1, y1) | Relation to our dials |
|---|---|---|
| Left column | brake (red) 20,214,83,256 · tyre pressure 18,269,75,315 · ABS 8,328,70,370 · DSC 13,382,60,430 (amber) | 7–17 px outside the C1 bezel (r 1.12–1.16 R) |
| Right column | AUTO H text 1780,184,1851,209 + 1857,186,1876,209 (green) · parking brake 1843,222,1906,265 (green in 09, amber in 08) · steering 1852,270,1912,321 (amber) | **AUTO H overlaps the C2 bezel by ~14 px**; the others are 14–19 px outside |
| Bottom row | rear belts 503,676,579,714 · driver belt 593,662,628,713 · passenger belt + airbag 637,662,682,713 (red) | under the C1 bezel's lower right |

The green light lamps further left are physical LEDs outside the panel.

**Stock-only content (not drawn over a custom theme):**
- **Bottom-row text.** In 11 only our own text appears there. In 10 our grid lines run *over* the temperature, so the temperature sits under us. Groups:
  - range 133–303 × 665–699
  - clock 346–452 × 664–698
  - street / message 797–1124 × 661–706
  - temperature 1536–1664 × 667–702
- **Check-control panel** (08): 715, 601, 1240, 690. Whether it pops up over a custom theme is unknown (weak).
- **Navigation map** (08/09): bbox 592, 161, 1303, 612. The hull is in `overlays.json`. It is a lower bound: it covers only where roads were drawn, inside the search box x 520–1420, y 140–612. In 10 the map shows under our transparent grid; in 11 it is gone.

**The HOOD polyline was not re-measured here.** It is drawn on the maps for context only.

## 3. C10 background (baked)

**Model.** colour = base + halo · h(r).
- r is the distance to the nearer big dial centre, in R units.
- h = 1 for r ≤ 1.04, and exp(−(r − 1.04)/0.0856) beyond.
- base sRGB = **(0, 0.5, 1.5)/255**. This is the mean of 02's (0,0,0) and 04's (0,1,3) far fields.
- halo = **(1, 1, 2)/255**. It is seen in 02 only (C1 side), so it is weak; 04 is flat.
- The layer is opaque, the bottom of the scene, and TPDF-dithered.
- No vertical gradient and no corner vignette are measurable on the drawn background. The lifts in 17, 03 and 04 are glass and housing (section 1).

**File:** `apps/f30_cluster/hud/baked/C10/panel.background.albedo@0.5x.png`, 960×360, 2,764,800 bytes by w·h·8.

**QC.** ROI: outside 1.04 R of the dials and 1.10 R of the minis, outside the window, y 40–560, with bright objects removed. "Shipped" is the file as delivered (G20 geometry). "Ref geometry" uses the same parameters drawn at the reference's own dial positions.

| Ref | Shipped SSIM / ΔE / luma bias | Ref geometry SSIM / ΔE |
|---|---|---|
| 02 (primary) | 0.869 / 0.86 / −0.3 | 0.886 / 0.79 |
| 04 | 0.869 / 0.77 / −1.2 | 0.850 / 0.74 |
| 17 (veiling glare, not fitted) | 0.04 / 12.2 / −44.6 | 0.04 / 12.2 |
| 03 (daylight on housing, not fitted) | 0.57 / 1.49 / −5.4 | 0.54 / 1.48 |

There is no banding: the plateau fraction is 0.03. The sheets are in `bake/work/C10/qc_panel.background*.png`.

**Recommendation for P9.** 2.64 MiB for a near-black field is poor value. Fold the four numbers into the existing WBBACK effect, which costs 0 bytes and no extra layer. If it must be an image, use @0.25x (480×180, 0.66 MiB).
