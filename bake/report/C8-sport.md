# C8 Sport (P6): band, hairlines, bridge, wings

Regenerate (files, QC, manifest): `cd bake/src && ./C8-sport/py.sh C8-sport/build.py` (about 20 s).
Manifest: `bake/manifest/C8-sport.json` (validator OK; the schema forces `cluster: "C8"`). Params with sources: `bake/src/C8-sport/params.py`.
Measurement and fit scripts: `measure_mid.py`, `measure_wings.py`, `measure_bridge.py`, `fit_band.py`, `fit_wing3.py`, `tune_wing.py`.
QC sheets and results: `bake/work/C8-sport/qc_*.png`, `bake/work/C8-sport/qc_results.json`.

## What Sport draws now (shared/shaders.js, design/gen_6wb.py)
- WBDIAL style 1 draws a glow band from `u_hub` = 0.62 R out to R - 4 px. Its level is 0.42 + 0.58 * band^1.3, it is lit up to the value, and it has hairlines at every minor step. A short white needle runs in the band, and the shader draws no ticks or bezel gloss.
- WBBACK style 1 draws:
  - a bridge: a Gaussian centred at cy + 0.06 R, sigma 46 px (0.16 R at R 290);
  - wings: white lines from 0.80 R that curve level (`cy - 0.66 R + 46 (1 - exp(-u/45))`) over 130 px.
- Sport still uses the OLD geometry (R 290).

## Fits

All references are measured in R units. The radii come from 03 (sport photo, alignment good: 0.63 / 0.54 px). 02 is a clean render with other proportions (disc 0.568 R, floor 0.134 R): its band covers 0.63–0.99 R and its upper wing sits higher. 02 is used only as a cross-check of shape, hue and level. 01 is 5.8x upsampled, so it is weak.

| element | ref | ROI | SSIM | dE2000 | edge px |
|---|---|---|---|---|---|
| speedo band alone (opacity 0.30) | 03 C1 | ring 0.45–0.88, 230:260 | 0.70 | 3.6 | n/a (no Canny edges in the soft ref) |
| speedo band + hairlines over stand-in face | 03 C1 | same | 0.85 | 3.5 | n/a |
| hairlines sector | 03 C1 | ring 0.55–0.80, 300:120 | 0.91 | 2.5 | n/a |
| tacho band alone | 03 C2 | ring 0.45–0.88, 280:190 (lit fill and red zone out) | 0.60 | 4.7 | n/a |
| tacho band stack | 03 C2 | same | 0.84 | 3.9 | n/a |
| bridge (opacity 0.28) | 03 PANEL | between the bezels, abs(v) < 0.38, car out | 0.70 | 3.3 | – |
| wings | 03 PANEL | 10 px around the strokes | 0.34 | 10.9 | 2.1 |
| band / bridge / wings | 01 | same | 0.54 / 0.63 / 0.06 | 14.5 / 8.7 / 23.6 | – / – / 6.8 |
| band / bridge / wings | 02 | same | 0.49 / 0.46 / 0.15 | 16.8 / 19.1 / 22.1 | – / – / 5.3 |

**Band.** The radial profile is fitted to 03 with a ramp, a rim and a crisp edge, through a PSF of sigma 0.012 R (rms 2.9 code values). Its sweep is 230 + 260 on the speedo and 230 (OFF) + 261.25 on the tacho; in 03 both ends are crisp.

**Wings.** The wing centreline fits 03 to 2.8 px rms. Most of that error is 03's own left/right asymmetry: its upper wings differ by 4.8 px.
- Wing SSIM is low because 03 blurs the stroke (FWHM 5 px at the tail) and our stroke is crisp; the edge error is 2.1 px.
- The `tune_wing.py` variants that are wider and dimmer change SSIM by at most 0.02.

**Banding flags.** The "stack" runs are flagged because the flat stand-in face is a constant colour, and the wing runs because their white core is constant. Neither is a ramp quantisation problem.

## Re-fitting to our panel
- 6WB dial spacing is 3.05–3.18 R (03: 3.088 R); ours is 3.27 R.
- **Wings** stay anchored to their own dial, in R units, mirrored. Each one leaves the bezel tangentially at r = 1 and ends at u = 1.13 R. The gap between opposite tips therefore grows from 0.83 R to 1.01 R, which is about 30 px more per side at R 335.
- **Bridge** is uniform in x in all three references. It spans whatever gap lies between the dial centres, clipped at r = 1 R of each dial. Its vertical profile (v_c 0.11 R, sigma 0.092 R) and the collar (0.17 of the peak at the bezel, decaying over 0.05 R, abs(v) < 0.45) stay in R units. QC renders the same code at each reference's own dial centres (from refs.json).

## Shared layers in Sport (params, no re-bake)
These are in `sport_shared_layers` in the manifest, taken from 03 sport against 03 comfort:
- **Hidden (opacity 0):** the ticks and the tick groove; the inner-disc lit edge (0.49 R); the inner ring (weak); the hub ring.
- **Unchanged:** the face, the floor, and the bezel, which stays neutral grey in 03.
- **Dynamic, in the shader:** the lit fill from OFF to the needle is ×2.9 brighter, and the red zone from the shift point is ×2.2 brighter.

## Open questions
These are listed in the manifest. In short:
- **Level:** the three references disagree by 3x, so the files are baked at peak alpha 1 and the layer opacity sets the level.
- **Hue:** the photos and 02 / the theme accent disagree on how pure the red is.
- **Ticks in Sport:** 02 shows red tick segments; 03 and 01 show none.
- **Hub glow:** a red glow at the hub (< 0.2 R) shows in 01 and 02 but not in 03.
- **Tacho hairline pitch** is weak (not visible in 03).
- **QC stack:** the real P1/P2 stack was not available at build time; the QC used a stand-in face.
