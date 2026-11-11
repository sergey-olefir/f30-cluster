# C8 Eco Pro (P7): fit report

Eco Pro parts only, as layers and parameters on top of the Comfort dial stack (C1 / C2, P1 / P2).
Manifest: `bake/manifest/C8-eco.json` (cluster `C8`, mode `eco`). Assets: `apps/f30_cluster/hud/baked/C8-eco/`.

Regenerate (from `bake/src`):

```sh
$PY C8-eco/fit.py     # about 2 min: measure the crops, rectify, fit -> C8-eco/params.json, bake/work/C8-eco/fit_log.json
$PY C8-eco/build.py   # about 8 s: draw, write PNGs, QC, write the manifest
$PY validate_manifest.py ../manifest/C8-eco.json
```

## What Eco Pro draws now (shared/shaders.js, design/gen_6wb.py)

- Eco uses the OLD geometry (R 290).
- The rev dial is `style 4`: a flat white arc at R-17..R-1 from -46 to 100 deg, split at 0.
  The inner glowing arc is at `u_hub` = 0.62 R and runs from -60 to 80 deg.
  CHARGE and POWER labels sit at ±23 deg, 0.78 R, and EfficientDynamics at 0.47 R.
- The speed dial is `style 2`: a white ring with ticks and a glowing inner arc at 0.62 R.
- None of these radii or spans match the references (see below).

## Geometry from the references (R units, cw12 deg)

| Feature | 03 (primary) | 01 (cross-check) | 02 | Used |
|---|---|---|---|---|
| Band inner edge / peak | 0.823 / 0.833 (ellipse-rectified, rms 0.38 px) | 0.797 / 0.807 | not concentric (circle rms 6 px, centre off 0.2 R) | 03 |
| Band ends (white marks) | -39.75, 129.5 | -42.25, 131.0 | -48, ~148 | 03 |
| Blue fill zone bounds (marks) | -29.75, 89.5 | -32.0, 89.5 | white -48 .. ~100 | dynamic clip, default 03 |
| Mark radial extent | 0.823 .. 0.907, half width ~0.006 | | | 03 |
| OFF park mark | -130.5 (229.5), r 0.815 .. 0.905 | -130.75 | | 03 |
| Graduation lines | 5.0 deg pitch, dark, r < 0.875 | | ~1 deg (render) | 03 |
| EfficientDynamics arc edge / peak | 0.4985 / 0.5085 (rms 0.27 px) | 0.48 / 0.49 | ~0.505 (rms 3.8 px) | 03; this is the inner-disc edge lit blue |
| Speed-dial Eco arc edge / peak | 0.489 / 0.50 (rms 0.24 px) | 0.51 / 0.52 | ~0.43 (02 proportions) | 03 |
| Speed arc end | ~5 deg (fades 355..10) | 10 deg | 0 deg | 130 km/h at 1 deg/kmh (dynamic) |
| Bezel blue (window side) | C2 267.5 ±11.4, C1 91.2 ±9.5, on the 0.99 ridge | C2 249, C1 102, stronger | whole bezel + halo | 03 |

The face of the photo sits behind the glass, so its features are not concentric with the bezel that P0 aligned. They are off by 0.01–0.05 R and slightly elliptical (axes 1.02–1.07). `fit.py` fits an ellipse to each feature and warps the crop locally so the feature becomes a circle on our centre. The warped crops are `bake/work/C8-eco/rect/*.rc-*`, and all QC runs on them. Each element uses its own warp, so the band and the EfficientDynamics arc disagree by 2–3.5 px when one warp is applied to both.

## Fit numbers (QC on 03, primary; 01 is a 5.8x upsampled thumbnail, cross-check only)

Single elements are composited over a flat stand-in face: the fitted baseline colour, because the face belongs to P1/P2. The bezel tint is composited over the **Comfort photo of the same car (03 comfort)**, which stands in for P2's bezel in QC only, and compared with the Eco photo.

| Element | SSIM | dE2000 | Edge px | 01 SSIM / dE | Sheet |
|---|---|---|---|---|---|
| tacho.eco-track (grey zone) | 0.93 | 3.0 | 1.59 | 0.55 / 17.5 | `qc_tacho.eco-track__03…rc-tacho-band-03.png` |
| tacho.eco-fill (blue, clipped) | 0.78 | 7.7 | 2.05 | 0.39 / 22.9 | `qc_tacho.eco-fill__…` |
| band edges + marks | 0.81 | 7.7 | 1.51 | | `qc_tacho.eco-band-edges__…` |
| tacho.ed-arc @0.5x (1x: 0.80 / 5.8 / 1.75) | 0.80 | 5.7 | 1.77 | 0.65 / 12.9 | `qc_tacho.ed-arc__…` |
| speedo.eco-arc | 0.94 | 3.4 | 0.38 | 0.33 / 17.3 | `qc_speedo.eco-arc__…` |
| speedo arc beyond the Eco speed (dark) | 0.66 | 1.8 | | | `qc_speedo.eco-arc-beyond__…` |
| tacho.eco-glow tint (without the tint: 0.87 / 8.7) | 0.83 | 7.8 | | | `qc_tacho.eco-glow__…` |
| speedo.eco-glow tint (without the tint: 0.24 / 16.2) | 0.55 | 12.4 | | | `qc_speedo.eco-glow__…` |
| marks (end_lo / zone_lo / zone_hi / end_hi / off) | 0.68 / 0.72 / 0.83 / 0.68 / 0.68 | 5.3 / 8.1 / 5.7 / 6.0 / 4.4 | 1.35 / 1.31 / 1.45 / 1.73 / 0.89 | | `qc_tacho.eco-mark-*` |
| tacho.eco-ring (procedural) | 0.73 | 5.3 | | | `qc_tacho.eco-ring__…` |
| Tacho stack over black (element sectors) | 0.76 | 6.1 | 2.92 | 0.44 / 20.0 | `qc_stack-tacho-merged__…` |
| Speedo stack over black | 0.72 | 3.8 | 3.58 | | `qc_stack-speedo__…` |

All sheets are in `bake/work/C8-eco/`. The raw numbers are in `bake/work/C8-eco/qc_all.json`.

Against the targets: the track and the speed arc meet them. The fill, the EfficientDynamics arc and the marks fall short:
- The photo blurs the band edges (edge error 1.3–2.0 px against the 1.0 target).
- The ticks under the EfficientDynamics arc are not drawn.
- The blue zone has a brightness ripple along the arc that we do not model.

The C1 bezel tint is the weakest. At that angle the Comfort photo has a dark reflection on the ridge, so the tint cannot be solved there and C1 reuses C2's tint.

## Open questions and weak evidence

1. What drives the bounds of the CHARGE/POWER fill? 03 and 01 agree (-29.75..89.5); 02 differs. The fill is treated as a dynamic clip.
2. The Eco speed (130 km/h assumed) sets where the speed-dial arc ends. Verify it on the car.
3. The text is curved along the arcs: CHARGE, POWER and EfficientDynamics are set on an arc. Can the text widget draw on an arc?
4. Weak: the thin ring that closes the band round the bottom (03 shows it lit bluish near the bottom; we model it dim and neutral). Also weak: the ticks under the EfficientDynamics arc (pitch not measurable), the 0 deg split (hidden by the needle in 03), and the bezel-tint strength (03 alpha 0.30; 01 and 02 are much stronger).
5. Radii disagree between photos by about 0.015–0.026 R (03 against 01, from perspective). The drawing follows 03.
