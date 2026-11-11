# Bake P0: alignment, inventory and the shared contract

Status: P0 done (alignment, rect crops, inventory, schema, QC tool, helpers). Machine-readable versions:
`bake/manifest/refs.json` (alignment), `bake/manifest/inventory.json` (clusters, stacking, P0 measurements),
`bake/manifest/schema.json` (manifest contract). How to run things: `bake/README.md`.

## 1. Alignment (dial to dial)

Every 6WB reference dial was fitted from its own bezel: rays from a hand seed, the bright bezel ridge per ray
(sub-pixel), RANSAC circle, then an ellipse (perspective) with ellipse-distance inliers. The photo dial's bezel
**outer half-max edge** maps to our R (the ridge lands at ~0.99 R). Camera roll comes from the line through both
dial centres; single dials use the inner-disc floor edge (05, 12); the 13 close-up uses the minor-tick pitch for its
radius and the 6000 rpm tick for its roll. Residual = rms of the ridge points about the ellipse, in panel px.

| Image | Mode | C1 | C2 | C3 | C4 | Notes |
|---|---|---|---|---|---|---|
| 17 physical full | comfort | good 0.64 | good 0.59 | good 0.14 | good 0.21 | best geometry; **veiling glare**: face L 50-72 after normalisation |
| 04 whole mph | comfort | ok 0.46 | ok 0.52 | ok 0.34 | good 0.39 | mph scale (0-160) on C1; upsampled 2.4x |
| 05 tach close-up | comfort | | ok 0.69 | | | best rev dial levels; bottom cut; KIES logo masked |
| 06 wide + wheel | comfort | good 0.84 | good 1.13 | skipped | skipped | 4.5x upsampled: composition only |
| 07 lamps lit | comfort | ok 0.90 | poor* 0.58 | ok 0.37 | ok 0.45 | *ray count only, fit is right by eye; warm cast, glare |
| 12 speedo signs | comfort | good 0.41 | | | | variant (orange range arc); face pure black |
| 02 clean render | comfort / sport / eco | ok 0.85 / 1.08 / 1.11 | ok 1.02 / 1.15 / 1.02 | ok-good | ok-good | proportions differ from photos (disc 0.568 R, floor 0.134 R) |
| 03 bimmerstop | eco / comfort / sport | good / ok / good | good | ok / ok / ok, eco C3 poor | eco ok, sport poor | watermark, '<' button masked; comfort C4 is an empty ring |
| 01 small | eco / sport / comfort | 1.2-2.3 px | 1.3-2.3 px | | | 5.8x upsampled: colour / layout only |
| 13 ticks close-up | comfort | | partial 0.32 | | | 33 deg arc; radius from tick pitch (iter 2.975 -> 3.2 deg); `@4x` crop |
| 14 inner rings | comfort | partial 0.26 | | | | scale assumes the disc edge = 0.51 R; roll unknown |
| 15 hub + needle | comfort | partial 0.15 | | | | scale assumes hub ring = 0.135 R; `@4x` crop |

G20 / ours: 10 rectified by the grid homography (re-derived exactly: 108 crossings, 3.54 px mean); 08 / 09 by SIFT
to 10 (66 / 63 inliers, 1.1 px) chained with it. **Photo 11 is not in photo 10's camera pose and shows our theme in
the OLD geometry** (R 290, hubs (496,360)/(1424,360)), not the current G20 one: it was rectified by a 4-point fix
(our hubs + minis -> OLD positions) and checks against BMW's black-box corner at 3.6 px. The bench baseline
`reference/ours/ref_comfort_bench_1920x720.png` is also OLD geometry; both are mapped per dial to the G20 dial frame
(`ours_bench.comfort.C*`, `11_our-theme_on-car.g20.C*`).

## 2. Exposure

Per mode panel: black = 5th percentile of luminance just outside the bezels (1.0-1.08 R), white = mean of the top
0.5 % inside 0.95 R (numerals, tick cores, needle masked), white -> 235, per-channel gains to make that white
neutral (clamped 0.8-1.25), gamma not fitted. Close-ups: crop percentiles, no white balance. Face luminance after
normalisation (0.55-0.75 R, top half): 02 3-6, 03 5-12, 04 7-9, 05 10, 06 15, 07 19-21, **17 52-72**. Take face
and disc levels from 05 / 03 / 04 / 02; use 17 for geometry and layering, not levels.

## 3. Disagreements with the default stacking (brief 6.2), with evidence

1. **Floor darkening is wider than the disc.** Below the horizon line the whole face is darker out to ~0.7 R
   (05: L 7 above / 3 below at |u| 0.5-0.7; 17 C1: 70 / 47), while the crisp edge exists only inside ~0.45 R.
   Proposed: a soft `floor-shade` shadow at z 2.5 (below groove / ticks, it stops inside 0.80 R) plus the crisp
   floor edge at z 8.
2. **Inner disc and inner ring are arcs open at the bottom**: both end at the floor line (17, 05, 04). This agrees
   with floor at z 8 above them, but differs from the current shader, which draws a full ring at 0.51 R.
3. **Radii**: disc edge ~0.49 R (0.473-0.51; theme 0.51), inner ring ~0.33 R (05 only, weak; theme 0.36), floor
   0.236-0.257 R (theme 0.26), hub ring 0.128-0.138 R (theme 0.135 ok), groove inner rim 0.80 R ok, bezel ridge
   0.99 R.
4. **Bottom arcs (C6) are not in 6.2**: they sit in the dials' bottom gap in the tick band, so they belong with the
   ticks (z 5.5). Their look is variant-specific (17/07 tick scale, 02 white+red bar, 12 orange bar).
5. **Light direction is not confirmed.** Bezel ridge brightness vs angle: the clean render 02 is brightest at the
   top / upper left (130 deg), the photos 17 / 04 / 03 at the bottom toward the window (~268 deg), and the two dials
   of a photo mirror each other (17: C1 302, C2 219 deg). That points to reflections in the photos rather than the
   drawn gloss. Packages should measure the highlight position across the bezel tube (13, 05) before adopting
   "upper left".
6. **02 vs the photos**: 02's proportions differ (disc 0.568 R, floor 0.134 R). Geometry from the photos, colour and
   gradients from 02 where the photos are hazy; both numbers go in the reports.

Rev-scale check: 05's major ticks at 280.6 / 312.9 / 344.8 / 17.8 / 50.8 / 82.4 / 114.0 deg (1-7k) give a 32.2 deg
pitch, matching RPM_PER 32.1, about 1.3 deg earlier than RPM_START 250.5. The roll is known to within ~1 deg, so
this is not conclusive. The minor pitch is 3.2 deg in both 05 and 17.

## 4. Known weak spots

- Mini gauges in 03 (eco C3, sport C4) and 01 comfort C1: poor fits; 06 minis skipped.
- 14 and 15 scales rest on theme radii (0.51, 0.135); 14's roll is unknown.
- The text mask (bit 16) is approximate (bright top-hat blobs, 0.18-0.80 R). Packages should add their own
  element masks via `--roi`.
- Needle corridors for Sport / Eco come from `bake/src/p0/overrides.json` (set by eye).
- C5 / PANEL crops of the 6WB images put the dials at x ~435 / ~1485 (6WB dial spacing 3.05-3.18 R against our
  3.27 R), so the 6WB window and gap are narrower than ours. Use C5 for shapes and profiles, not for absolute x.
