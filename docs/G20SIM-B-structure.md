# G20 bench simulation, package B: static bake of the stock Comfort dials

The static parts of BMW's stock G20 Comfort dials and the panel around them, for the bench simulation (`docs/AGENT-BRIEF-g20-sim.md` §7 B, contract `bake/work/g20sim/CONTRACT.md`). Everything here is our own procedural drawing, fitted to the rectified photos. No photo pixels are shipped.

## 1. Delivered

- **Shipped:** `bench/g20/structure/`, 42 PNGs (21 per look) and `manifest.part.json`, 2.05 MB in total (budget 8 MB).
- **Code:** `bake/src/G20/structure/`:
  - `build.py`: the entry point.
  - `measure_geom.py`, `measure_crisp.py`, `numerals.py`, `minis.py`, `fit_soft.py`: measure and fit.
  - `model.py`, `render_soft.py`, `render.py`: rendering. These read only `params/`, never a photo.
  - `qc_struct.py`: QC.
  - `lib.py`: helpers.
  - It reuses `bake/src/qc.py` (`metrics`, `review_sheet`) and `bake/src/common/imageio.py` by importing them; neither is edited.
- **Measured parameters:** `bake/src/G20/structure/params/`, 2.2 MB of numbers: curves, profile tables, colours.
- **Scratch:** `bake/work/g20sim/B/` holds the review sheets `qc_<photo>_<look>_<roi>.png`, the full A/B images `qc_full_*.png`, `qc_table.json` and `geometry_check.json`.

**Regenerate.** Run from the worktree root:

```sh
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project \
  --with opencv-python-headless --with numpy --with pillow --with scipy \
  python bake/src/G20/structure/build.py --measure     # ~77 s: measure + render + QC
#                                         (no flag: render from params/ + QC, ~45 s; --no-qc: render only, ~25 s)
```

## 2. Layers (manifest)

Each entry exists twice, once with `look: night` (fitted to rect 08) and once with `look: day` (fitted to 09). `x`, `y` and `scale` follow the contract. Each entry also carries `w`, `h` and `bytes`.

| z | id (without `.night` / `.day`) | kind, composite | state / cond | evidence |
|---|---|---|---|---|
| 0 | `structure.bg` (full panel, `scale 2`) | albedo, opaque | any | strong |
| 20 | `structure.map_veil` (map.region, `scale 2`) | albedo with alpha | any | **weak** |
| 22 | `structure.speedo.glow`, `structure.tacho.glow` | glow, `lighter` | any | strong (weak under the pointer glow) |
| 24 | `structure.speedo.wing`, `structure.tacho.wing` | albedo, opaque | any | strong (weak for y > 415) |
| 26 | `structure.fuel_mini.fill`, `structure.oil_mini.fill` | albedo; **`clip`** | any | fuel medium, oil weak |
| 30 | `structure.speedo.frame`, `structure.tacho.frame` (frame, bottom line, end hooks, ticks) | albedo | any | strong |
| 31 | `structure.speedo.bottom_end`, `structure.tacho.bottom_end` | albedo | **`cond: no_cc_message`** | medium |
| 32 | `structure.rev_band` | albedo | any | strong |
| 33 | `structure.speedo_info_line` | albedo | any | strong |
| 33 | `structure.tacho_info_line` | albedo | **`state: stock`** | medium |
| 34 | `structure.fuel_mini`, `structure.oil_mini` (frame with zones, numerals 1 ½ 0, pump icon, car icon) | albedo | any | strong (icons medium) |
| 40 | `structure.speedo_numerals` (20 … 260), `structure.speedo_scale_label` ("0 km/h") | font | any | strong |
| 40 | `structure.tacho_numerals` (1 … 7) | font | any | strong |
| 40 | `structure.tacho_zero` ("0") | font | **`cond: engine_on`** | strong (09/14) |

**B's own flags.** The lead must implement these:

- `cond: "engine_on"`: draw only while rpm > 0.
- `cond: "no_cc_message"`: draw only while `ccMessage` is null. In 08 the check-control panel sits on the curved ends and they are not visible.
- `clip` on the minis' fills: `{by: "<mini>_needle", keep: "empty_end_side", photo_needle}`. The fill is a level bar that runs from the scale's empty end (the bottom) up to the needle. It is baked as the full sweep, so it must be clipped live to the half-plane of D's mini needle line that contains the bottom end of the scale. `qc_struct.clip_fill` is the reference implementation.

## 3. Method

The 6WB-bake method: fit procedural drawings to the rectified photos, then run QC by SSIM and ΔE2000 on ROIs.

- **Mirror symmetry.**
  - The two dials are mirror images about x = 959.45 px (frame vs mirrored frame: median 0.31 px).
  - The band line and the inner edge E of the wing are measured as one curve in speedo space, snapped to both photos at once: speedo pixels at P, tacho pixels at mirror(P).
  - Each dial therefore supplies what the other hides: the tacho apex under the gear letter, and the speedo's wing-strip end under "260".
  - The two minis are also mirror images of each other.
- **Geometry.**
  - Frames: ridge tracker on the white line.
  - Bottom lines: straight-line fit on 09, x 340–690. The tacho line starts at the speedo end, mirrored.
  - Band: hand anchors snapped to the ridge of the high-passed red line.
  - Wing inner edge E: edge tracker, then a symmetric snap.
  - Ticks: intensity-moment capsules, one per tick, on 08 ∪ 09. There are 2 classes (major / minor), drawn at the class sizes. The speedo's 0 tick is hidden under its needle in every photo and is the mirror of the tacho's 0 tick (09).
  - Info lines: per-row half-max ends, giving parallelograms with slanted cuts.
  - Curved ends: ridge-traced on 09.
  - Rev band: per-column half-max edges, with a lighter rim (measured G 65–80) round a deeper red core.
- **Soft layers** (`fit_soft.py`):
  - **Background:** bilinear node grid (40 px) with membrane regularisation, robust fit to the background pixels (outside every element). Residual rms 2.7 code values (08) and 4.5 (09).
  - **Glow:** profile table RGB(s along the band, signed distance), fitted to photo − background between the band and the frame. It keeps the band's bright red line, because only *whitish* crisp content is masked.
  - **Wing:** opaque. A table along the band (depth) plus a bevel table along E, blended at distE 11–15 px.
  - Tables are 8 px bins along s, smoothed. Masked bins are filled along s. Tacho wing bins never seen are taken from the speedo, gain-matched.
- **Frame line:** an alpha table across the line (0.25 px bins) per 30 px of arclength. The photo's line is sharp at the top and bottom, with a soft outer halo on the left and right flanks. A single profile made the top and bottom lines too fat (bottom-lines SSIM was 0.59; it is now 0.82).
- **Minis:**
  - Outer frame: ridge-tracked in 2 pieces (above and below the notch at ½). Colour zones are classified along the path: fuel white + red reserve; oil red top, white, blue bottom.
  - Fill: an (s, d) table relative to the frame smoothed over the notch. The fill's inner white border line, 13 px inside the frame, is drawn into the fill. The dark scale lines are measured as black-hat lines.
  - Icons: our own vector drawings scaled to the measured ink boxes.
- **Pointer glow.**
  - The zones are the pixels within 100 px of a needle with y > 415, for the photographed needle positions. The tacho's idle needle in 09 and 14 is detected automatically.
  - These zones are excluded from every fit, and the tables continue across them from their neighbours.
  - The 08-vs-09 tacho difference (09 ≈ 0.71·08 + 22 after a gain fit) shows the glow spans the whole lower wing, ±~100 px around the needle.

## 4. Looks

**Night** is fitted to 08.

**Day: separate soft files fitted to 09.** These are bg, veil, glow, wing and fills. They are cheap: about 1 MB together.

The crisp layers are also emitted per look, with colours measured on 09; they are small. A global affine map would not do: 09 ≈ 0.71·08 + 22 holds for the dark surfaces, but the whites saturate in both photos.

**14 is a day photo, not a night one.** Its clock reads 10:15, and every surface is at or above the 09 levels.

| ROI vs 14 | luma bias, day look | luma bias, night look |
|---|---|---|
| Speedo face | +1.5 | −27 |
| Tacho face | −8 | −20 |
| Background | −12.5 | −23 |

14 also has strong glare:

- a grey haze over the map and the speedo's inner area (masked: x 560–960, y 120–600);
- a teal reflection on the left edge (not masked; it inflates the 14 background row);
- a 1.5–3 px registration offset of its bottom lines against 08 and 09. Measured bottom-line y at x 320: 08 646.5, 09 647.0, 14 648.8.

Use the day look for 14-like conditions.

**Map veil.** Road contrast drops towards the dial faces: 0.62–0.67 of the plateau at x ≈ 600 (08 and 09), and 1.0 by x ≈ 690. The map's background drops much more than its roads do (to about 0.3). So the veil's alpha is fitted to the road contrast only, as symmetric logistic ramps:

| Look | Amplitude | Centre x | Width |
|---|---|---|---|
| 08 | 0.59 | 606.6 | 3.2 (a step) |
| 09 | 1.0 | 598 | 53 |

**D's map must darken its own background towards its left and right ends.** The two fits disagree, so the veil is weak: **calibrate or drop it together with D's map.**

## 5. QC

**Setup.**

- Composite: our layers in the photo's state, over black. map.region gets a flat neutral stand-in (the photo's median map colour) and is **excluded from every ROI**. The minis' fills are clipped at the photographed needles.
- Masked:
  - every non-structure element's bbox (C's and D's);
  - the needle corridors (7 px) and the mini needles (14 px);
  - glare (09: x 760–1180, y 95–215; 14: see §4);
  - in 14: our 0.7.2 texts (the CONTRACT boxes, plus "bright in 14, dark in ours") and the black box.
- Each cell reads: SSIM (luma) / mean ΔE2000, with the pointer zone masked; in brackets, the same without that mask.

| ROI | 08 night | 09 day | 14 vs day look | 14 vs night look (info) |
|---|---|---|---|---|
| speedo frame+band | 0.917 / 4.09 (0.897 / 4.54) | 0.887 / 5.00 (0.868 / 5.57) | 0.766 / 10.69 (0.753 / 10.78) | 0.724 / 12.49 (0.719 / 12.17) |
| speedo face | 0.939 / 2.17 (0.898 / 5.12) | 0.940 / 2.21 (0.903 / 5.37) | 0.903 / 8.55 (0.899 / 9.74) | 0.870 / 11.96 (0.867 / 12.79) |
| tacho frame+band | 0.889 / 5.02 (0.879 / 5.25) | 0.871 / 5.42 (0.834 / 6.21) | 0.707 / 10.38 (0.698 / 9.98) | 0.702 / 10.72 (0.683 / 10.73) |
| tacho face | 0.955 / 1.48 (0.906 / 4.36) | 0.952 / 1.54 (0.916 / 4.62) | 0.901 / 5.76 (0.881 / 8.36) | 0.802 / 8.53 (0.774 / 11.75) |
| rev band | 0.798 / 6.62 | 0.672 / 8.74 | 0.586 / 12.85 | 0.789 / 9.99 |
| info lines | 0.903 / 5.04 (0.876 / 5.90) | 0.893 / 5.00 (0.861 / 6.39) | 0.516 / 7.38 | 0.425 / 7.34 |
| fuel mini | 0.778 / 5.93 | 0.714 / 7.48 | 0.751 / 8.22 | 0.784 / 7.88 |
| oil mini | 0.715 / 5.78 | 0.655 / 7.67 (0.656 / 7.55) | 0.550 / 9.10 (0.582 / 8.24) | 0.454 / 8.31 |
| bottom lines | 0.817 / 7.65 (0.810 / 8.02) | 0.809 / 8.93 (0.800 / 9.70) | 0.376 / 15.65 | 0.301 / 17.14 |
| background | 0.969 / 0.77 | 0.966 / 1.12 | 0.823 / 7.21 | 0.582 / 8.04 |

**Why some SSIM values are below 0.85:**

- **Rev band (0.80 in 08; 0.67 in 09; 0.59 in 14):**
  - the segments carry a fine dotted pixel texture that is not modelled (flat rim + core instead);
  - 1 px registration differences between the rects;
  - in 14, glare on the red.
  - ΔE is 6.6 in 08.
- **Minis (0.65–0.78):**
  - small, busy areas: the frame with its zones, the fill gradient, the inner line, the dark scale lines, the numerals and the icons;
  - our icons are simplified drawings;
  - the fill's top edge is a hard half-plane clip at the photographed needle;
  - the 14 oil mini shows COLD (oil needle at the bottom, so almost no fill) and has glare above the needle.
- **Bottom lines in 14:** a 2–3 px registration offset of rect 14 (see §4) on a 6 px line. In 08 and 09 they are 0.81–0.82: a 1 px offset between 08 and 09, and the speedo line half-hidden by the 50 sign and the cc panel.
- **Info lines in 14:** only 384 px are left after masking our 0.7.2 texts, and the same registration offset applies.
- **Frame+band in 14:** glare (the haze lifts the dark gap); with the pointer zone unmasked, the idle glow in the tacho.
- **Background in 14:** haze and a teal reflection. The 14 photo is brighter overall than 09.

**Pointer-zone effect.** The faces drop from about 0.95 to about 0.90 when the zone is unmasked. That residual is D's moving glow, which our static model leaves out.

## 6. Geometry check

The table compares, for each element, our rendered bbox (alpha ≥ 0.5) with the bbox in g20_comfort.json. Boxes are [x0, y0, x1, y1] in panel px. Within 2 px everywhere, except the re-measured edges below.

| element | ours | g20_comfort | diff | note |
|---|---|---|---|---|
| speedo | [82,35,727,653] | [82,36,704,652] | x1 +23 | g20's hull stops at 704. "260" is visible to x 727 (ink box [658,73,727,105] measured on 08). |
| tacho | [1204,35,1836,652] | [1204,36,1836,652] | ≤ 1 | |
| rev band | [1222,46,1397,73] | [1221,47,1397,68] | y1 +5 | Per-column half-max: the bottom edge reaches y 70.9 at x 1380 and 72.4 at x 1396. g20's poly cuts it. |
| speedo info line | [370,412,695,416] | [370,412,613,417] | x1 +82 | Re-measured: 2 segments, x 371–612 and 616–694 (08, 09, 14 agree). |
| tacho info line | [1223,412,1548,415] | [1306,412,1550,417] | x0 −83 | Re-measured: 2 segments, x 1224–1302 and 1306–1548. Both are gone in 14. |
| fuel mini | [8,429,202,652] | [7,432,215,651] | x1 −13, y0 −3 | g20's hull includes neighbours. Our red reserve zone ends 3 px short of the photo's (x ≈ 205). The full-sweep fill reaches the frame top. |
| oil mini | [1721,434,1911,652] | [1706,428,1911,651] | x0 +15, y0 +6 | g20's hull includes the needle and neighbours. Our frame follows the photo's ridge within 1 px (checked at y 520–620). |

Curve accuracy:

- Frames vs mirrored frames: 0.1–0.5 px.
- Band and E: snapped to both dials, with ≤ 1 px residual where visible.
- Registration between photos varies by 1–3 px (§4), which limits the meaning of anything below that.

## 7. Font

The numerals use Roboto, package C's choice from `FONT.json` (`bench/g20/fonts/Roboto-wdth-wght.subset.ttf`), at wght 550, wdth 100.

- **Fit:** weight and width come from a grid of the mean IoU of the ink masks against the photo (best 0.737).
- **Size and position:** each numeral's size is set by its digit height and its position by the ink-box centre; each is stretched to its measured ink width.
- **"km/h":** the IoU grid preferred wght 800, because the photo's blur thickens thin strokes. By eye the unit has the digits' weight, so it uses 550.
- **IoU per numeral:** 0.57 ("100") to 0.88 (the speedo's "0").

## 8. Evidence and open points

- **Weak:**
  - the map veil (§4);
  - the lower wing and band under the pointer glow (continued from above);
  - the oil fill above its needle (the fuel fill's mirror image, symmetric fit);
  - the tacho wing apex under the gear letter (from the speedo, gain-matched);
  - the speedo's 0 tick (mirror of the tacho's);
  - the speedo wing-strip end under "260" (mirror of the tacho's);
  - the day look's soft layers in strong glare (14).
- **Medium:** the minis' icons (our simplified vector drawings), and the curved ends' visibility with a cc message (they are hidden in 08).
- **For D and the lead:**
  1. The minis' grey fill is a level bar and needs the live clip (§2).
  2. In 09 the tacho shows a red bar along the scale from 0 to the idle needle (y ≈ 615–625, x 1540–1640). It is dynamic, so it is not baked; it belongs with D's pointer glow.
  3. The pointer glow covers the whole lower wing (±~100 px around the needle).
  4. Calibrate the veil together with D's map.
- **Rev band separators:** taken from the red-profile minima on 08 (x 1303.5/1310.5, 1339/1341, 1366.5/1368.5) and written into `render.py` as constants.
- **Day look:** fitted to 09 as photographed, including its ambient lift (09 ≈ 0.71·08 + 22 on the dark surfaces). No exposure normalisation.
