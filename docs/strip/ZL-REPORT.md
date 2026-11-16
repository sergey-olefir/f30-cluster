# Package ZL: zone L of the bottom strip (x 0-700) and BMW's speed-limit sign

2026-11-16, branch `strip/ZL` on `integrate/bottom-row` (3c8ef46). Analysis only: no app, shader or layout file was
touched. Coordinates are continuous panel px (pixel i covers [i, i+1)); legacy numbers in OpenCV's pixel-centre
convention are converted (+0.5) where they are compared. Every number carries its photos; **verified** = measured on
a photo or read from the engine's output (package O's maps), **hypothesis** = inferred. Photo pixels and anything
derived pixel-wise from them live only under `bake/work/strip/`.

Per package H: 60 = 10, 61 = 09, 62 = 08 and 68 = 39 are the same frames at a higher resolution. The independent
captures in this zone are therefore {60/10, 61/09, 62/08, 68/39, 63, 64, 66, 67} for the sign and the row,
65 for BMW's real standby. Nothing in zone L moves between the theme-connected arrangement (60) and the plain stock
one (61-68): the sign, range, clock, readout, rail ends and driver belt agree within 0.5 px (verified, 60 vs 61-64).

## 1. Verdicts

1. **BMW's sign is round and centred at (538.45, 621.2) +-0.3.** Outer red edge r 40.95 (median; 40.91-41.22 on
   61-64, 66, 67), white face r 31.54 (31.45-31.69), ring 9.41 px. Edge residual rms 0.13-0.32 px, ellipticity
   0.03-0.38 px with no common axis over 7 photos: round to the measurement. The face sits 0.37 +-0.05 px right of
   the ring's centre on every photo (lateral chromatic aberration measured at -0.05 px, so it is not the lens); at
   0.37 px nobody can see it. **Verified.**
2. **The asymmetry the owner sees is our window, not BMW's sign.** The engine's own coverage (O's maps, allG20,
   every sign state) has the window's 0.5 contour on a circle at (537.30, 621.30), r 40.52: 1.15 px left of BMW's
   sign. Measured from BMW's centre, our coverage starts (alpha > 0.02) at r 38.5 on the right (E) and is full at
   r 40.2, *inside* BMW's red edge (40.95); on the left (W) it starts at r 40.85 and is full only at r 42.55. So
   BMW's ring is dimmed over its outer ~2.5 px on the right and shown whole plus 1.6 px of BMW's black on the left:
   CLIP 389 px of the sign, summed alpha x ink 180 px (61; 327/157 on 63, 367/209 on 62). **Verified** (engine +
   photos). Cause, to the pixel: the centre (537.3, 621.3) came from `measured.json`'s OpenCV-convention numbers
   fed into a shader that works in continuous coordinates (`lp = v_uv * u_size`), +0.5 px, plus ~0.6 px of the old
   low-resolution rects (the bench backdrops themselves put the sign at x 537.48-538.83, y 621.10-622.91, so on the
   bench the backdrop adds its own +-1 px). 3bfce09 (r 42 -> 40) turned a 1.15 px offset that only widened the left
   side into one that eats the right side. **Reverting 3bfce09 does not fix it:** at r 42 (1 px soft, black
   full 1.5 px out) the right side's half-alpha still sits at r 40.85 from BMW's centre (the red's last ~0.5 px),
   while the left reaches full black only at r 44.65, so the rail stubs (cut at r 42.45) show half-bright again on
   the left: the "whiskers" (computed from the window geometry, hypothesis until O runs the parent commit). The fix is the
   centre: (538.45, 621.2), edge at r 41.8 inside BMW's own black moat (40.95 .. 42.45), hard (0.6 px).
   Package H reads the centre 1 px *lower* (y 621.9-622.9 on R's rects); ZL's y is 621.2 (grid photo 60 direct:
   621.29; local affine on the four nearest grid lines 621.4-621.9). **Conflict on y, unresolved: +-0.7 px.**
3. **SAFETY defect in every state of both modes (verified):** WBBACK's `CC_TOP` patch [590, 594, 1250, 665] with its
   13 px soft foot reaches the driver belt (top y 664.5) and the airbag (top y 664.25): alpha up to 0.021 on the
   lamps' ink itself (5.5 px), 0.071 within 1 px, 0.24 within 3 px (164.7 px in the 3 px safety zone).
4. **P with the engine off clips the whole sign in allG20** (O's `standby`): CLIP 5257 px. BMW draws its full row
   there (62, 63; package H), so closing the window at P + rpm < 150 hides a sign BMW is showing. **Verified.**
5. **all6WB leaves BMW's clock fully visible** (no time zone, `own.clock = false`): LEAK 1928 px, visible light
   1426 px of white text. With the zone fed (`drive-clock`) the leak is 22.8 px / 0.48. **Verified** (decision 1.4).
6. **Nothing in zone L is left unaccounted for** (section 3) except one bright blob in 62 only, [672.5, 536, 683.5,
   591], passed to ZC.

## 2. Defect table (wb_dials; wb_sport_dials: O has not published it yet)

Counts in panel px; light in units of stock white text (the range digits' ink = 1.0) over BMW's black.

| mode / state (photo) | CLIP px (sum a x ink) | LEAK px (visible light) | SAFETY px (max a) | DOUBLE | what |
|---|---|---|---|---|---|
| allG20 drive, unread, drive-clock, limit-end, nopass (61) | 389 (180) | 24 (0.56) | 165 (0.24) | none | sign window 1.15 px off; rail's lower edge x 319-414, y 650-652.5 |
| allG20 park (63) | 327 (157) | 31 (1.8) | 165 | none | as drive; leak = range glyph rims |
| allG20 msg, msg-long, msg-latched, road-latched-msg (62) | 367 (209) | 6 (0.3) | 165 | none | as drive |
| allG20 limit-unknown (68, "---") | 170 (45) | n/a | 165 | none | ZL's 68 range alpha lost its unit glyphs (68 is darker): the 1012 px "leak" is that, not ours |
| allG20 limit-none | 0 | n/a | 165 | none | no photo of BMW with no sign in D; our window stays open |
| allG20 standby = P engine off (63) | **5257** (4978) | 31 | 165 | none | window closed over BMW's live sign |
| all6WB drive, unread, park, msg, limit-*, nopass | 0 | **1853-1937** (1282-1426) | 165 | none | BMW's clock (decision 1.4) |
| all6WB drive-clock (61) | 0 | 23 (0.48) | 165 | none | rail's lower edge only |
| all6WB msg-latched, road-latched-msg (62) | 7103 (6406) | 0 | 165 | none | measured against decision 1.5 (whole row BMW's): today only the failed item goes back, so BMW's sign (5260) and range (1842) stay covered |
| all6WB standby = P engine off (63) | 6982 (6289) | 0 | 165 | none | against decision 1.6 (BMW's row): sign and range covered |

## 3. Ranked seams (zone L)

1. **The sign window's edge across BMW's red ring**, E / NE / SE side, allG20 sign states: displayed luminance
   0.21-0.26 just outside vs 0.001-0.005 inside, CIEDE2000 45-52, 47 tiles. This is item 2 above.
2. **The bottom edge of our fuel mini layer** (WBDIAL mini fuel, rect [10, 538, 150, 678]) at x 64-128,
   y 660-684, every state of both modes: our side 0.025-0.074 (its grey art is cut by the layer rectangle), BMW's
   black outside 0.004-0.012; CIEDE2000 9-19; 8-10 tiles. A hard rectangular cut of our own art.
3. The rail's lower edge under the dial's cut, x 319-414, y 650-652.5: 0.02-0.05, 18 px. Faint.
Every other edge of our coverage in zone L runs over BMW black on both sides (step < 0.007).

## 4. The stock atlas (numbers: `design/strip/ZL/atlas.json`)

Method: ZL's local photo models (homography + k1 + a cubic panel-space correction; 60 fitted on 4300 points along
its grid lines, rms 0.25; 61-68 tied to 60 by masked ZNCC of fixed stock content, rms 0.13-0.29); 4x warps in
linear light; ink at half level after local black subtraction (the sign: R - max(G, B) for the red, green for the
face, so a white-bloom bias moves both edges the same way); 8-connected components; polygons from the 4x mask.

| element | widest box | notes (photos) |
|---|---|---|
| `assist.speed_limit` | disc c (538.45, 621.2), r 40.95 (ink [497.5, 580.2, 579.4, 662.2]) | face r 31.54; digits "50": ink 34.9 x 26.9, centred 0.1-0.3 px right and 0.25 px low of the face centre, stem 3.1-4.1 (exposure); "30" 35.0-35.6 wide; empty "---" (68 = 39): three dashes 9.4 x 4.9, pitch 13.07, ink x 520.7-556.2, centre y 621.3; ring colour sRGB ~(236, 9-17, 58-61) on 61-67, face ~(247, 236, 242) |
| BMW's moat round the sign | r 40.95 .. 42.45 | the rail is cut at r 42.44 (41.84-42.82) on both sides, symmetric about the sign (rail-end midpoint - centre +0.06 +-0.25); the gap reads 15-46 % of the rail's level (blur) |
| `rail.left` | y 647.45 +-0.3, thickness 6.5 (half max) | sign centre - rail = -26.46 +-0.07 on 8 photos; flat (slope < 0.25 px / 100 px) |
| `assist.speed_foot` (new) | [370.0, 569.25, 477.0, 612.5] | "0 km/h" at rest in every photo; its right edge is 62.96 +-0.35 px left of the sign centre; clear gap to the ring 22.5-23.3 px |
| `bottom.range` | measured [133.75, 665.25, 304.5, 699.5]; widest (4 digits, hypothesis) to x 329 | pump pictogram: arrow [133.75-135.25, 679-680, 149-149.5, 690-691] + pump [147-148.75, 666.75-667.25, 174.75-175.25, 697.5-698]; digits from x 181.75-185.5 (glyph-dependent), tabular, advance 24.4 +-0.2, figure height 33.0-33.5, bottoms 697.5-699.5; unit at x 262.5-263.75 .. 303.5-304.5 for every 3-digit string seen (60-68), so the field cannot be right-anchored (a 4th digit would hit the pump): left anchor, **hypothesis** until a 2- or 4-digit range is photographed |
| `bottom.clock` | measured [345.25, 665.25, 453.5, 699.5]; widest [343.9, 665.25, 453.5, 699.5] | tabular cells 24.4; colon x 392.75-402.75 for every time seen (hours 1x only); a 1-digit hour is not photographed: anchor of that case **hypothesis** |
| `bottom.belt_rear` | [500.5, 677.75, 580.25, 715.25] | 62, 63, 67 (66 reads 2-3 px right: its model); red sRGB ~(250, 58-70, 89-96) |
| `bottom.belt_driver` | [590.0, 664.5, 628.75, 715.25] | lit alone in 64; 60 shows it over our grid |
| `bottom.airbag` | [632.75, 664.25, 684.25, 715.5] | |
| belt group | [500.5, 664.25, 684.25, 715.5] | gaps: rear-driver 13.7-14.5, driver-airbag 10.6-11.5, sign-rear 15.8-16.5, sign-driver 36.3-37.1 |

The range pictogram: BMW's is an arrow + pump (above); ours (`own_range_icon`, O's breakdown) has its ink at
[137, 673, 159, 696]: it starts 2-3 px right of BMW's arrow tip, ends 16 px left of BMW's pump's right
edge (175), and its top is 6 px lower than BMW's pump (667).

Under / over: the driver belt is drawn OVER a theme (catalogue, and session photos 59/60: lit over our opaque
background, **verified**). `bottom.belt_rear` and `bottom.airbag` stay `unknown`: no photo has them lit under our
paint. Package D's matte theme photographed during the start-up lamp check settles both (or the grid theme
shot at start-up).

Halo: white row text has a measurable rim out to ~1.5 px (0.15-0.30 of the ink at 0.5-1 px, < 0.04 past 2 px);
the sign has none past 1 px beyond the blur. Every edge in zone L can be hard (0.5-0.6 px): BMW's background
behind every row item here is black (p50 0.004-0.014 of white text in the D/P photos; 65-67 carry reflections).

## 5. Unattributed light (zone L, lum or redness > 4 % of white text, every catalogued item masked + 2 px)

All attributed: `structure.fuel_mini` (scale, numerals, its pump icon, the red band), `structure.speedo` (rail
arc, ticks, "20", the red glow, the needle at rest), `rail.left`, halo rims of the range and clock glyphs, the
map's edge (61: [606.8, 536, 615, 578]; 68: [657, 545, 704, 550.5]), cover-glass reflections (65: [45.8, 703.5,
188.2, 719] and [531.5, 665.5, 639.2, 720]; 66/67: [89-134, 711-717]). **Unexplained:** 62 only, a bright
vertical stroke [672.5, 536, 683.5, 591] (peak 0.57) - not in 61/63/64; likely the left end of something in the
centre (ZC / H to name it).

## 6. Reconciliation (zone L)

`design/g20-spec/measured.json` (OpenCV -> continuous +0.5): sign centre (537.9, 621.8) -> (538.45, 621.2),
**corrected** +0.55 / -0.6; r_outer 41.1 -> 40.95 (-0.15); r_inner 31.8 -> 31.54 (-0.26); ring 9.3 -> 9.41
(confirmed); digit height 26.4 -> 26.9 (+0.5); 2-digit width 34.8 confirmed (34.9); "---" dash 8.8 x 4.4 ->
9.4 x 4.9, pitch 13.0 confirmed (13.07), ink x [520.5, 555.4] -> [520.7, 556.2]; value baseline 698.6 confirmed
(digit bottoms 697.5-699.5); figure height 33.0 confirmed; advance 24.2 -> 24.4; range icon x0 136.1 -> 133.75
(the arrow tip), km x [262.3, 303.6] -> [262.5-263.75, 303.5-304.5]; clock box confirmed within 1 px, colon
[393.4, 400.5] -> [392.75-395.25, 400.5-402.75]; dial bottom line 647.5 / 7.0 -> 647.45 / 6.5 confirmed.
Catalogue bboxes: sign [498, 581, 580, 663] -> [497.5, 580.0, 579.4, 662.2]; belt_rear x0 503 -> 500.5,
y0 679 -> 677.75; belt_driver [593, 666, 624, 715] -> [590.0, 664.5, 628.75, 715.25]; airbag x0 635 -> 632.75;
range, clock within 1-2 px. `shared/visible.js` BELT [587, 665, 626, 720] is the driver lamp only and 0.5-2.75 px
tight on two sides.

## 7. The mask proposal (`design/strip/ZL/mask_proposal.json`, previews `bake/work/strip/pub/ZL/mask_*_4x.png`)

* `bmw` / `bmw_msg` (allG20; all6WB fallen back; P with the engine off): opaque everywhere in zone L except
  - the sign: circle (538.45, 621.2), edge r 41.8, feather 0.3 + 0.3 (in BMW's moat; clears the readout by 22.6);
  - the range: rect [131.75, 663.25, 331.0, 701.5], corner 3, feather 0.5 (widest 4-digit case, left anchor);
  - the clock: rect [341.5, 663.25, 455.5, 701.5], corner 3, feather 0.5;
  - the belt group + 3 px: polygon (497.5, 674.75) (587, 674.75) (587, 661.25) (683.25, 661.25) (683.25, 720)
    (497.5, 720), hard.
* `ours` (all6WB healthy): opaque everywhere except the belt group.
* `standby` (BMW's real standby, 65): range, clock and the belt group; the sign hole shut (the rail runs straight
  through the sign's seat there).
Cost: none at a neighbour - every edge runs over BMW black with >= 10 px of corridor, except the sign's, which
has 0.75 px either side and needs the centre to +-0.3 (item 2's y conflict must be settled first). `CC_TOP`, or
whatever replaces it in zone C, must stop above y 661.25 over x 587-683.

## 8. What limits this

Positions rest on ZL's own provisional registration (R's strip models, rms 0.46-0.82, put the sign at x 537.1-538.5,
y 621.2-622.5 on the same photos: noisier, and on the grid photo itself 537.64, 621.6). No night shot (the moat's
contrast at night is unmeasured); no photo of BMW in D with no sign (limit-none); no 2- or 4-digit range and no
1-digit hour (the anchors); 65-67 carry reflections; 66's model is 2-3 px off at x > 500 (excluded from positions).

Tools: `tools/strip/ZL/` (register, local60, tie, lmodel, crop, sign, sign60, sign_ctx, sign_rects, ca, atlas,
diff, mask, summary).
