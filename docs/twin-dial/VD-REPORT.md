# VD — the dials (Twin Dial, round 1)

Numbers: `design/twin-dial/vd/dials.json` (also published to `bake/work/twin-dial/pub/VD/`). Tools: `tools/twin-dial/vd/`.
Units: lengths are fractions of **R = the centre line of the thin outer white bezel ring**. Angles are degrees clockwise from 12 o'clock (−125 = lower left). Positions are x right, y down from the dial centre.

## Method

1. `dialfit.py`: a first pass on the originals. It fits the bezel ring and the inner-disc rim as ellipses (robust `fitEllipse` on per-ray ring centres) and unrolls each dial to a polar image. The final numbers come from **VR's homography-rectified frames** (`pub/VR/<id>_rect.png`, R = 400 px, keys `02Lv`… in the tools), which are not re-fitted. My affine fits agree with VR's for 04 and 05: rim 0.531–0.533 against VR's 0.531–0.532. They also agree for 02: rim 0.543 against VR's 0.545.
2. `radial.py`: the median radial luma profile over 240–300° and 60–120°. Edges are half-level crossings; ring widths are FWHM.
3. `ticks.py` and `law.py`: bright ticks are angular peaks of whiteness in a radial window. Major lines are angular minima of band luma. The value-to-angle law comes from a lattice fit to them.
4. `numerals.py`: bright or red connected components in the rectified frame give each numeral's centre (ρ, θ) and its height and width.
5. `needle.py`: cross-profiles of the needle at rest give its width along ρ. `redzone.py` measures the red pixels' angular and radial extent and their sRGB. `extents.py` measures the bezel's and band's open ends and the band texture (FFT).

Reference quality: VR's 02 homography is good to 0.35 px rms at R = 400, with about 205 source px per R. 04 and 05 have about 107 source px per R, so a source pixel is about 0.009 R and widths below about 0.02 R are blur-limited.

## Two variants in the references

- **A: references 02 and 05.** The ticks sit in a lighter strip on the band's outer edge, with a dark gap before the bezel. The rim is thin.
- **B: reference 04.** The band ends at a white rule at 0.905. The ticks and round dots sit outside it, in the dark. The rim is thick (0.040), and the red zone is **the solid wedge**.

The owner's lead look takes elements from both: the scale band from A and the wedge from B. The spec below uses the 02 geometry and puts the 04 wedge on the 02 band. Where the references disagree, all values are in the JSON (`alt`).

## Specification (spec value · uncertainty · references that agree · status)

| Element | Spec value | ± | Agree | Status |
|---|---|---|---|---|
| Bezel radius / width | 1.000 / 0.021 | 0.002 | 02L 02R 05L 05R (04: 0.016) | verified |
| Bezel open ends | 144° … 216° (gap about 180°) | 1° | 02R (04: 140.75–219.25) | verified |
| Dark gap, band → bezel | 0.940 – 0.989 | 0.004 | 02R (05: 0.950–0.987) | verified |
| Band outer / inner edge | 0.940 / 0.580 | 0.004 | 02L 02R (05: 0.950/0.553; 04: 0.885/0.585) | verified |
| Tick strip (lighter annulus) | 0.893 – 0.940 | 0.004 | 02, 05 (04 has none) | verified |
| Band shading (sRGB/255 over the clipped white) | 0.21 at 0.585 → 0.40 at 0.715 → 0.61 at 0.86; strip 0.66 | ±0.03 | 02R (05: 0.16→0.41) | verified (VC linearises) |
| Band texture | not resolved; propose a subtle grid or noise ≤ 3 %, pitch 0.03–0.045 | — | 04 only shows a grid (about 0.044, maybe moiré) | **hypothesis** |
| Rim radius / width | 0.545 / 0.016 | 0.002 / 0.003 | 02L 02R (04, 05: 0.531; 04 width 0.040) | verified; **references disagree** |
| Gap, rim → band | 0.553 – 0.578, black | 0.004 | 02R | verified |
| Inner disc | black (02 at black level), no vignette | — | 02 | verified |
| Speedometer law | 0 at −125, 100 at 0, 300 at +125; 24.93° per major; 20 km/h per major below 100, 40 km/h above | 0.2° | 02R (04 mph: 25.0° per major, linear; 05: −130/+128) | verified |
| Speedometer minors | 4 per major (5 / 10 km/h) | — | 02R 05R 04R | verified |
| Speedometer large numerals | 0 20 40 60 80 100 140 180 220 260 300; h 0.071; centre ρ 0.76 | 0.004 / 0.01 | 02R 05R | verified (0 is under the needle: hypothesis) |
| Speedometer small numerals | 10 30 50 70 90 120 160 200 240 280; h 0.054; centre ρ 0.775 | 0.004 | 02R 05R | verified |
| Tachometer law | 0..8 linear, 0 at −120, 8 at +120, 30°/1000 rpm | 0.3° | 04L (05L: ±130, 32.47°) | verified; **references disagree** |
| Tachometer minors | 1 per 1000 (05: 3) | — | 04L | verified |
| Tachometer numerals | 1–8, h 0.135, centre ρ 0.745 (outer extent 0.80), upright, on the value angle; 7 and 8 red | 0.005 / 0.015 | 04L (05L: h 0.120) | verified |
| Minor tick | ρ 0.896–0.934, width 0.012, white | 0.002 | 02L 02R 05L 05R | verified |
| Major tick | same length, width 0.018 | 0.002 | 02R 05R (04: dots 0.039) | verified |
| Major line in the band | ρ 0.580–0.893, near black, width about 0.006 | — | 02, 05 | span verified, width **hypothesis** |
| Red wedge | 6500 rpm → scale end (74.9°–120.0°), ρ 0.550–0.940, radial edges; fill sRGB (105, 4, 14), outline (242, 12, 48) about 0.01; ticks and numerals on it red | 0.5° / 0.005 | 04L | extent and colour verified; outline width hypothesis |
| Needle | white, straight; root 0.465, widest 0.039 at 0.56, 0.032 at 0.68, 0.022 at 0.77, 0.020 at 0.86, 0.016 at 0.89, tip 0.99; no cap | 0.003 | 02L 02R (04: root 0.55, wider) | verified |
| Needle glow | none visible | — | 02, 04 | **hypothesis** (VC) |
| Hub: speed digits / unit | centre (0, +0.03) h 0.23 / (0, +0.24) h 0.06 | 0.02 | 02R | verified (affine) |
| Hub: gear / program | (−0.02, +0.39) h 0.15 / (+0.02, +0.56) h 0.055 | 0.02 | 02L | verified (affine) |
| Bars under the dials (fuel L, coolant R) | y +0.73, x −0.42…+0.42, thickness 0.025; end labels at (∓0.35, +0.68) h 0.05; icon (0, +0.63) h 0.11 | 0.01 | 04L 04R | verified (segment count: hypothesis) |
| Tachometer unit "1/min × 1000" | curved outside the bottom right, θ 149–164°, ρ 0.93 | — | 04L | verified |
| Rev strip (02) | label y +0.71 h 0.055; bar y +0.775, x −0.39…+0.42; numerals 0 2 4 6 8 at y +0.855, h 0.070, x = −0.347 + 0.0906·krpm; red from about 6.8 | 0.01 | 02L | numerals verified; bar **hypothesis** |
| READY / OFF | READY green at (−0.73, 0.00), OFF in the left foot at (−0.50, +0.60) | 0.02 | 02L (04: OFF (−0.60, +0.53)) | **hypothesis** |
| Feet | band continues past the scale ends to ±144°; grey trapezoids below, to about y +0.85 | — | 02, 04, 05 by eye | **hypothesis** |

## Open questions for the lead / owner

1. **Sweep.** Reference 02's speedometer runs ±125°, 04's tachometer ±120° and 05's dials ±130°. The two dials should share one sweep: ±125° (02, the sharpest frame) is proposed for both, giving 31.25° per 1000 rpm.
2. **Rim and band.** The rim is at 0.545 (02) or 0.531 (04, 05), and the band's inner edge at 0.580 or 0.553. These are different software variants, not measurement error (VR's rings agree to 0.002). The spec takes 02.
3. **Wedge on a variant-A band.** The spec puts 04's solid wedge over 02's band and tick strip (ρ 0.550–0.940). 04's own tick dots lie outside a white rule, which is not drawn in A.
4. **Band texture.** Not resolvable at the references' resolution. Decide on the bench, or get a sharper frontal facelift frame (VR's web search).
5. **Hub content in the tachometer.** Only 02 (hybrid: D1/AUTO, fuel and battery bars) and 04 ("−", the fuel bar under the dial) show it. The gear slot follows 02.
6. **04's needles rest at −119.4°**, past its speedometer's 0 tick. This is ignored; the spec rests the needles at scale 0.
