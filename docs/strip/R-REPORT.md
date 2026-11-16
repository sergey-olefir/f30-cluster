# Package R: registration and photometry of the strip photos

Tools: `tools/strip/R/` (`grid60.py`, `register.py`, `old.py`, `photometry.py`, `crosscheck.py`, `summary.py`,
`common.py`, `publish.py`). Numbers: `design/strip/R/` (`registration.json`, `photometry.json`, `crosscheck.json`,
`models.json` = the models without their residual fields). Rasters and the full models are git-ignored, in
`bake/work/strip/rect/` (see `tools/strip/R/PUB-README.md`). No photo pixels and no photo text are in this branch.

Every number here is in panel px unless stated otherwise. **Verified** = measured on the photos by these tools;
**hypothesis** = an explanation not yet tested on the car.

## Method

- **60 (absolute).** Every visible major crossing of our grid (`grid.json`, majors at continuous [100k, 100k+2))
  located by NCC of green minus red at 4x in the photo warped by the current fit, grown from a 2-point start;
  homography plus one radial term (`tools/overlay/rectify.py`'s model). 92 crossings, 86 inliers at 2 px.
- **61** tied to 60's rect through BMW content that never moves (dial scales, rails, hooks, minis), with our grid,
  labels, swatches and probes masked; **62 to 68, 14, 17, 40** tied to 61's rect the same way. Start: SIFT photo to
  photo. Refine: masked NCC of 24 to 36 px windows with 2-D texture (a lone rail only constrains y, so it is
  rejected), searches 12, 6, 3 px. Then a smoothed thin-plate **residual field** through the inliers' residuals,
  smoothing chosen by leave-one-out; the rasters use base model plus field.
- **10, 09, 08, 39** are the same frames as 60, 61, 62, 68 (package H). Their models are transferred, not refitted,
  plus a constant shift of (+0.43, -0.23) px for the three Nov-11 JPGs (they are not exact rescales). After the
  shift, the old rect matches the new one to NCC 0.998 and 0.07 px. This is **not** independent validation.

## Findings

1. **The homography plus k1 model leaves a coherent residual of 0.5 to 0.7 px rms** on every photo, in regional
   patches of ±0.5 to 1 px. That is far above the NCC noise (median NCC 0.96 to 0.99). The residual field brings
   the leave-one-out error in the strip to 0.25 to 0.35 px on the frontal photos (verified). The plain zoom.py form
   cannot hold the field, so `<id>_strip` gives the plain model refitted on the lower half.
2. **Our grid's vertical lines in 60 are displaced column by column by up to ±1.5 to 2.5 px in x**, consistent
   along each line's whole height (for example x 1600 is +1.5 px, while x 1500 and x 1700 are about 0). The
   horizontal lines are smooth (verified). BMW content in the same photo does not show the pattern: registering 61
   to 60 leaves residuals of at most 0.33 px in those columns, and fitting the grid's field into 60 made 61's match
   worse (0.63 to 0.68 px rms). So 60 uses the base model only, and the wiggle belongs to the grid as drawn. It is
   not the camera. A fp16 (mediump) simulation of `GRID` predicts the right-half pattern only in part: the fit
   rises from 86 to 103 inliers at the same 0.8 px rms. **Hypothesis:** our effect layers do not land on
   whole-pixel x positions uniformly on the car. If that is true, it matters for every mask edge, and only a car
   photo of a layer with known pixel columns can settle it (package D's matte with its pixel ruler would do).
3. **There are no fixed landmarks in the strip between x of about 700 and 1220 in any stock photo** (zone C: road
   label, message, odometer). There the field is interpolated between the speedometer side (up to x 480 to 696)
   and the tachometer side (from x 1416). Uncertainty there is a **hypothesis**, about 0.5 to 1 px. Two things
   would fix it: the y position of the straight rail stretches as 1-D constraints, or a grid photo taken in the
   same session.
4. **In the message photos (62, 66) the rail hooks at x 728 to 772 and 1190 to 1250 do not match 61's** (NCC 0.05
   to 0.34, against 0.98 elsewhere). The message panel replaces the rail ends (verified, a signal for package ZC).
   In 65 (standby) the tachometer-side hook is shifted 2.1 px, or drawn differently.
5. **Stock white text is clipped** at about 0.92 linear (8-bit 245 to 248) in every PNG except 68, so it cannot
   serve as the exposure reference. The sign's red ring is not clipped. Exposure relative to 62 by the ring is 0.91
   to 1.02 for 60 to 67, and 0.80 for 68 (verified).
6. **A 50 % threshold is biased outwards.** Our 2 px grid lines measure 2.91 px FWHM in linear green on 60, so a
   bright 2 px stroke's edges sit about 0.45 px outside the true edge at 50 % (verified on 60 only; for clipped
   white text the bias is larger, **hypothesis**). A threshold that subtracts the local black and uses the
   unclipped peak, or an edge-spread fit, is safer.

## Per-photo table

Scale = photo px per panel px. Residuals are in panel px: base = homography plus k1 over the inliers; field LOO =
leave-one-out with the field, which is the error to quote for a point in the rasters. Black = display black,
linear Y (8-bit sRGB code). Glare = largest glare excess over the strip as a fraction of white. Valid = fraction of
the strip where colour can be trusted (glare under 2 % of white, no clipped channel). Edge = 10 to 90 % width of a
rail edge.

| id | view | scale | panel base rms / max | strip base rms | strip field LOO rms / max | black | glare | valid | edge | geometry | colour |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 60 | grid, frontal | 2.71 | 0.80 / 2.00 | 0.85 | 0.49 / 1.27 (grid) | 0.0026 (8.5) | 0.009 | 1.00 | 3.5* | yes (absolute frame) | yes, grid-covered |
| 61 | frontal | 2.47 | 0.63 / 1.85 | 0.65 | 0.51 / 1.76 | 0.0039 (12.8) | 0.042 | 0.82 | 1.7 | yes | yes, with valid mask |
| 62 | frontal | 2.38 | 0.46 / 1.84 | 0.42 | 0.31 / 1.83 | 0.0022 (7.3) | 0.011 | 1.00 | 1.1 | yes | yes |
| 63 | frontal | 2.38 | 0.52 / 1.91 | 0.50 | 0.29 / 1.51 | 0.0026 (8.5) | 0.002 | 1.00 | 1.2 | yes | yes (cleanest) |
| 64 | frontal | 2.31 | 0.64 / 1.98 | 0.66 | 0.29 / 2.55 | 0.0123 (29.0) | 0.071 | 0.74 | 1.1 | yes | black raised by glare |
| 68 | frontal, 12 MP | 1.84 | 0.74 / 1.94 | 0.80 | 0.35 / 1.30 | 0.0042 (13.5) | 0.033 | 0.90 | 2.7 | yes | yes (white not clipped) |
| 66 | upper right | 2.08 | 0.74 / 1.86 | 0.66 | 0.26 / 1.58 | 0.0064 (18.8) | 0.028 | 0.86 | 0.95 | yes | with valid mask |
| 67 | upper right | 2.06 | 0.73 / 1.98 | 0.63 | 0.25 / 1.15 | 0.0049 (15.3) | 0.037 | 0.80 | 1.2 | yes | with valid mask |
| 65 | upper right, standby | 1.89 | 0.92 / 1.97 | 0.86 | 0.69 / 2.67 | 0.0092 (24.1) | 0.089 | 0.63 | 0.9 | 1 px tolerance | weak: reflections |
| 10 | = 60, old JPG | 0.97 | transferred | — | — | 0.0029 | 0.013 | 0.87 | 3.3 | coarse | no |
| 09 | = 61, old | 0.89 | transferred | — | — | 0.0042 | 0.042 | 0.77 | 1.6 | coarse | no |
| 08 | = 62, old, night | 0.85 | transferred | — | — | 0.0023 | 0.011 | 0.95 | 1.6 | coarse | no |
| 39 | = 68, old | 1.85 | transferred | — | — | 0.0042 | 0.035 | 0.89 | 2.7 | as 68 | as 68 |
| 14 | old | 0.37 | 0.59 / 1.71 | 0.51 | 0.35 / 1.84 | 0.0084 | 0.069 | 0.70 | 3.6 | coarse | no |
| 17 | old | 0.63 | 0.51 / 1.99 | 0.52 | 0.41 / 2.24 (L only) | 0.0008 | 0.013 | 0.96 | 2.1 | coarse, left zone only | no |
| 40 | old, zoom | 5.19 | 0.41 / 1.21 | 0.38 | 0.24 / 0.89 (L only) | 0.0273 | 0.64 | 0.30 | 1.2 | left zone only | no: glare |

\* 60's rail edges are measured under the grid; the grid line itself (2 px drawn, 2.91 px FWHM) is the better
sharpness figure there.

No photo's strip rms exceeds 1 px. The strip maxima above 2 px (64, 65, 17) are single points at the tachometer
end of the right mini gauge.

Cross-check (`crosscheck.json`): fixed strip landmarks, located in each published 4x strip against 61's, land
within 0.07 to 0.16 px rms on 62, 63, 64 and 66. Landmarks that change with the state fail as they should: the
hooks in the message photos and the temperature mini's needle. 67's tachometer-side hook is off by 0.96 px and 68's
temperature end by 1.65 px; both are state-dependent content, not model error, but this is a **hypothesis**.

## What a photo cannot be used for

- 65: geometry better than 1 px (few fixed landmarks in standby); colour in the reflections (37 % of the strip is
  invalid).
- 64: black level (glare lifts it to 29/255 in places): use the valid mask.
- 40: colour (64 % glare); anything outside the left zone.
- 10, 09, 08, 14, 17: they are a panel px or coarser per photo px. 10, 09, 08 duplicate 60, 61, 62: use the new
  ones.
- Any photo: white-text brightness (it is clipped); x positions in zone C better than about 1 px (no landmarks).
- No night photo and no no-overtaking sign are in the set.
