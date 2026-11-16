# Package ZR: the right zone of the strip (x 1240–1920, y 540–720)

Branch `strip/ZR` (base `integrate/bottom-row` 3c8ef46). Analysis only: no app, layout, shader or font file
touched. Coordinates are continuous panel px (pixel (i, j) covers [i, i+1) × [j, j+1)), boxes `[x0, y0, x1, y1]`.
Every number says where it was measured. **verified** = measured on a photo or read from the engine's output (O's
maps). **hypothesis** = everything else.

Sources: package R's v3 rasters (`bake/work/strip/rect/<id>_strip_4x.png`, linear 16-bit, all of 60–68 plus
08/09/10/14/17/39/40), package O's maps (`bake/work/strip/pub/O`, both layouts, 26 states each), and my own
independent provisional registration of 60–68 (`tools/strip/ZR/quickreg.py` + `localreg.py`), kept only as a
cross-check. Package H's provenance applies: 60 = 10, 61 = 09, 62 = 08, 68 = 39 are the same frames, so they are
**not** independent observations. The new captures are 63–67.

Tools: `tools/strip/ZR/` (`atlas.py`, `unattributed.py`, `overunder60.py`, `rail.py`, `diff.py`, `propose.py`,
plus `quickreg.py`, `localreg.py`, `gridcheck.py` for the cross-check). Numbers: `design/strip/ZR/atlas.json`,
`unattributed.json`, `diff.json`, `mask_proposal.json`. The traced outlines and the 4× masks are git-ignored
(`bake/work/strip/zone-R/`, `bake/work/strip/pub/ZR/`). A traced outline of BMW's glyphs is a vector copy of BMW's
artwork, so it stays out of the repo.

## 1. Verdicts

1. **In `allG20` we clip two stock row items in every state.** (verified, O's maps against R's rects)
   - The **mode label**, which BMW moves into the row whenever a theme is connected, is fully covered:
     4325 px² of footprint at α = 1, including 1989 px² of ink. The only exception is the message states, where
     CC_BOX's right end (x < 1243) uncovers 86 px² at the label's left end.
   - The **messages-present marker** (an "i" or a warning triangle) is fully covered in every state of both
     modes: 1152 px² of footprint, 882 px² of ink.
   - The temperature shows correctly (CLIP 0).
2. **CC_BOX uncovers BMW's tacho rail stub.** This is the one serious LEAK in zone R. The leak is x 1224 → 1245.75,
   y 642.75–652, up to 0.94 of stock white, 28 white·px² inside zone R (more on ZC's side of x 1240). It happens in
   every `allG20` message state (msg, msg-long, unread, both latched states) and in `all6WB` unread and
   msg-latched. It is also the most visible seam in the zone: mean step 0.052 of white, p95 0.69, ΔE2000 19.
   (verified)
3. **The marker is drawn UNDER a theme.** On 43 (our 0.7.7 over the row) only the apex and the middle of the base
   of the triangle survive; its lower corners are cut by our paint. On 56 and 58 it is absent under our cover while
   a warning message is up. The catalogue says `unknown`; it should be **under**. (Verified on 43. The absence on
   56 and 58 alone would only be a hypothesis, because there we cannot know the marker was lit.)
4. **The gear letter is drawn OVER a theme.** On 60 (= 10) our grid line x 1400 is interrupted by the P: the
   green inside / outside ratio is −0.05. 58 shows two gear letters. (verified) It needs no hole. Our tray letter
   plus BMW's row letter is a functional duplicate in every non-standby state of both modes. That is a `gearTray`
   decision, not a mask defect.
5. **Mode label, temperature, rpm label, the tacho "0", COLD and the rail are drawn UNDER a theme.** On 60 our
   major grid lines run over each of them. Green inside / outside ratio: mode label at x 1300 1.05, temperature at
   x 1600 0.91, COLD at x 1900 1.24, rpm label and "0" at y 600 0.99 / 0.74, rail at x 1300 / 1400 0.86 / 0.90.
   (verified)
6. **The temperature is a right-aligned number in front of a fixed unit.** This refutes "cannot be settled"
   (H, claim C15). The degree sign stays put in every photo, within ±0.25 px in my frame. The sign, the first digit
   and the point move with the last digit: "+4.0" (61 = 09) sits about 2.0–2.9 px further left than "+3.5",
   "+4.5" and "+6.5" (62–68). The last digit's right ink stays put (±0.5). This is measured relative to the degree
   sign, and R's frame and mine agree to 0.3 px. It needs proportional digits, about 2 px between "0" and "5".
   **Hypothesis strength:** only one capture holds the odd string ("+4.0").
7. **The widest temperature** has two integer digits and a sign ("-12.5", "+38.0"): its left ink reaches
   x ≈ 1511.5 ± 2. Our `all6WB` patch `[1498, 662, 1667, 705]` already covers it. The hole I propose for `allG20`
   and standby is `[1508.25, 662, 1666.75, 702.5]` (50 % line). (hypothesis: it rests on the right-alignment of
   verdict 6 and on a digit advance of 24.2 + 2 px.)
8. **The standby mode label sits where the theme-connected one does,** to 1.0 px in my frame and 2.5 px in R's.
   R's 65 is distorted, see 4.3. (verified within that tolerance)
9. **The MSA icon** (`assist.msa`, new id, 68 = 39) replaces the rpm label in its own slot: `[1405.25, 571.75,
   1505.75, 612.5]`, right edge equal to the rpm label's 1505 ± 0.5. That suggests the slot is right-aligned at
   x ≈ 1505.5 (hypothesis). Like the rpm label, it lies under our tacho dial in every mode, with no leak.
10. **Nothing lit in zone R is left unexplained.** On R's rects, all eight stock photos come to 0 unexplained
    blobs (`unattributed.json`). Four fixed bluish specks scale with the ambient light: bright in 64–67, faint in
    61–63 and 68. They are **on the cover glass, not the display** (hypothesis): (1294.2, 694.0),
    (1486.0, 677.6), (1838.3, 682.4), (1834.0, 681.0).

## 2. The stock atlas (R's frame unless noted; uncertainty ±1 px absolute, ±0.3 px within one element)

Edges: the 50 % contour of ink, where ink = linear luminance minus a grey opening wider than any stroke. On text
that sits on BMW's red face glow, this removes the glow. The threshold is per glyph (two passes) so the thin degree
ring is not lost to the digits' bloom. Blur (10–90 % edge spread): 1.0–2.25 px on 61–67 and 2.0–3.0 px on 68 / 39.
Colours are camera-relative: the photos are not colour-managed, and per R stock white clips at about 0.92 linear,
so "rel W" is luminance relative to the temperature's core in the same photo.

| id | state / photos | ink box | colour core sRGB (lin) | rel W | relation |
|---|---|---|---|---|---|
| `bottom.temperature` | every non-standby photo; 65 | `[1537.75–1539.75, 665.25–666.0, 1660.75–1662.5, 698.25–699.0]` (61–64, 66, 67) | 245,239,239 (0.915, 0.864, 0.865) | 1.00 | under (60) |
| `assist.info_tacho` "i" | 62, 63 (with and without a message) | `[1255.75, 591.25, 1269.75, 626.5]` / `[1256.5, 592.0, 1270.25, 626.75]`; dot 9.75 × 9.25, stem with foot 14 × 23 | 245,235–238,237–239 | 0.98–1.01 | **under** (43) |
| `assist.info_tacho` triangle | 66, 67 (with and without a message) | `[1243.25–1243.5, 591.75, 1284.5–1284.75, 627.5]`, 41.25 × 35.75; bar `[1261.0, 603.25, 1266.25, 615.25]`, dot `[1260.5, 616.5, 1266.75, 621.75]` | 244,242,242 | 1.01 | **under** (43) |
| `assist.mode_label`, theme position | 60 (= 10), 14 | C `[1225.25, 657.25–657.5, 1240.5, 679.5]`; COMFORT to x 1355.0; PLUS `[1226.0, 686.0, 1290.0, 708.25]` | — (60 has the grid) | — | under (60) |
| `assist.mode_label`, standby | 65 | COMFORT `[1222.75, 658.25, 1354.75, 681.25]`, PLUS `[1223.25, 686.25, 1287.75, 709.0]` | 235,203,205 (0.834, 0.597, 0.611) | 0.74 | under |
| `assist.gear` | 60 (= 10), 14 | P `[1396.0–1396.25, 666.25–666.5, 1419.5–1419.75, 699.75]` (60's foot is under our grid line y 700) | 248,247,248 (14) | 1.00 | **over** (60, 58) |
| `assist.rpm_label` | 61–64, 66, 67 | `[1424.25–1425.0, 573.25–573.75, 1504.75–1505.25, 625.5–625.75]` | 234–246, 206–227, 208–228 | 0.76–0.91 | under (60) |
| `assist.msa` (new) | 68 (= 39) | `[1405.25, 571.75, 1505.75, 612.5]` | 233,208,211 | 1.03 | unknown (needs D) |
| `assist.off` | 62, 63 (P, engine off), 65 | `[~1515.5, 579.9, 1566.25–1567.0, 604.0–604.75]` (left 1511.0 includes needle pixels) | 246,240,236 | 0.93 | unknown (needs D) |
| `structure.tacho.num0` (new) | 61, 64, 66, 67, 68: alternates with OFF | `[1519.0–1519.25, 573.25–573.75, 1544.5–1545.25, 611.25–612.25]` | 243–247, 204–210, 202–208 on the red glow | 0.74–0.79 | under (60) |
| `assist.cold` | 60, 65, 66 | letters `[1843.5, 636.5, 1903.25, 657.5]` (66) | 245,220,221 | 0.86 | under (60) |
| `rail.right` (new) | every photo | centre y 647.5–647.9, half-max thickness 6.8–7.1, lower 50 % edge 650.9–651.3 (x 1230–1590); notch (a full gap) at x 1223.1–1224.4 | | | under (60) |

**Text metrics, temperature** (R, 61–64, 66, 67):
- Baseline 698.25–699.0. Figure height 32.75–33.25. Degree ring `[1630.5–1630.75, 672.5–673.0, 1641.75–1642.25,
  684.25–685.25]`. C 17.25–18 wide, its right ink 1661.25–1662.5.
- '+' ink 23.5–25.0 wide, at 671.0–694.
- Ink widths: '4' 22.25, '3' 21.5–21.75, '5' 20.25–20.75, '0' 22.5.
- **Anchor: the right edge of the number** (verdict 6). Widest box: verdict 7.
- Stems and tracking are package T's.

**Mode label:** cap height 22.25–22.5, line pitch 28.0–28.5, left-aligned (the C starts at 1225.25 on 60 and 14
alike). Only COMFORT / PLUS has been seen, so the widest name is unknown.

**Halo** (mean ink at distance d outside the 50 % contour, relative to the element's peak; temperature, 61–64):
- 0–1 px 0.22, 1–2 px 0.045–0.054, 2–3 px 0.011–0.020, 3–4 px 0.003–0.009, then the black floor.
- In the glare photos 65–67 the 3–4 px value is 0.011–0.014.
- The display's black under the row is 0.15–0.3 % of white on 61–63 and 68, and 0.4–2.2 % on 64–67 (ambient).

**Neighbours and corridors** (clear gap between 50 % edges):

| from | to | gap, px |
|---|---|---|
| rail.right lower edge (651.2) | mode label cap top (656.6–658.25) | **5.4–7.0** (the tightest corridor) |
| rail.right lower edge | temperature top (665.25) | 14.0 |
| rail.right top edge (644.2) | marker base (627.5) | 16.7 |
| mode label right (1355–1356.4) | gear left (1396) | 39.6 |
| gear right (1419.75) | temperature, widest left (1511.5) | 91.8 |
| marker left (1243.25) | CC panel rail tip (1221, 621; spec) | ~22 |
| marker apex (591.75) | map window's corner (roads to y 593 at x 1247–1283 on 62, 64) | **0, they touch** |
| rpm label right (1505) | OFF / "0" left (1515.5 / 1519) | 10.5 / 14 |

## 3. Reconciliation with `measured.json` and the catalogue

| number | was | now | verdict |
|---|---|---|---|
| measured `temperature.plus_ink_x` (39 = 68) | [1539.6, 1562.4] | [1540.0–1541.1, 1559.5–1562.9] on 68; [1539.25, 1563.75] on 62 | confirmed ±1.5 |
| measured `temperature.digits_ink_x` | [1565.4, 1621.3] | [1566.6, 1621.1] (ZR 68) | confirmed |
| measured `degree_ring_box` | [1631.0, 673.1, 1641.0, 684.0] | [1630.5–1630.75, 672.5–673.0, 1641.75–1642.25, 684.25–685.25] | confirmed; about 1 px larger (blur) |
| measured `C_ink_x` | [1644.6, 1661.9] | [1644.0–1644.5, 1661.25–1662.5] | confirmed |
| measured `value_text_baseline_y` | 698.1 ± 0.6 | 698.25–699.0 | confirmed (+0.15 to +0.9) |
| measured `value_figure_height_px` | 33.0 | 32.75–33.25 | confirmed |
| measured `mode_label` (17) | left 1223.0, cap 22.6, baselines 680.4 / 708.5, leading 28.1 | 60 / 14: left 1225.25, cap 22.25, baselines 679.5–680.0 / 707.25–708.25; 65: 1222.75 | confirmed ±2.3 (registration spread between photos) |
| measured `gear_letter` P (17) | [1395.1, 666.9, 1419.9, 700.1] | [1396.0–1396.25, 666.25–666.5, 1419.5–1419.75, 699.75] (60, 14) | confirmed ±1 |
| measured `right_marker_box.i_08` | [1255.5, 590.9, 1270.0, 626.6] | [1255.75, 591.25, 1269.75, 626.5] (62 = 08) | confirmed (Δ ≤ 0.35) |
| measured `right_marker_box.triangle_43` | [1251.9, 591.0, 1277.9, 614.0] | stock triangle [1243.25, 591.75, 1284.75, 627.5] | **refuted as the triangle's size**: 43 shows a triangle clipped by our 0.7.7 paint (agrees with H) |
| catalogue `bottom.temperature` | [1540, 666, 1663, 701] | [1537.75–1540, 665.25–666, 1660.75–1662.5, 698.25–699]; widest left 1511.5 | box confirmed, bottom −2; field −28.5 on the left |
| catalogue `assist.info_tacho` | [1256, 591, 1270, 627], `unknown` | "i" confirmed; the slot is the triangle, [1243.25, 591.75, 1284.75, 627.5] | x0 −12.75, x1 +14.75; relation → **under** |
| catalogue `assist.mode_label` | [1226, 659, 1359, 711] | [1225.25, 657.25, 1355.0, 708.25] (60, 14) | −0.75 / −1.75 / −4.0 / −2.75 |
| catalogue `assist.gear` | [1398, 668, 1424, 703] | [1396.0, 666.25, 1419.75, 699.75] | −2 / −1.75 / −4.25 / −3.25 (the catalogue box is 14's coarse rect); over confirmed |
| catalogue `assist.rpm_label` | [1425, 573, 1506, 626] | [1424.25–1425, 573.25–573.75, 1504.75–1505.25, 625.5–625.75] | confirmed |
| catalogue `assist.off` | [1516, 580, 1568, 604], `unknown` | [~1515.5, 579.9, 1566.25–1567, 604–604.75] | box confirmed; relation still unknown (needs D, engine off) |
| catalogue `assist.cold` | [1843, 635, 1903, 658], under medium | [1843.5, 636.5, 1903.25, 657.5] | confirmed; under → strong (60) |

## 4. Unattributed light, pixel diff, seams

### 4.1 Unattributed light (`unattributed.json`)

What is lit in zone R once the catalogued elements are removed (dilated 3 px):
- `rail.right`; `structure.tacho.ticks` (including the 13 × 19 major tick at 0 rpm,
  `[1539, 624.5, 1552.5, 643.5]`); `structure.tacho.rev_band`; `structure.tacho_needle`;
- `structure.oil_mini.*` (rail, ticks, cold and hot bands, needle);
- `map.region` (the map window's lower-right roads reach x 1360, y 593 on 62 and 64);
- the four glass specks, and the halos of catalogued elements.

**0 unexplained blobs** on all eight photos above max(6 × noise, 3 % of white), at least 2 px².

### 4.2 Pixel diff (`diff.json`; the same in both layouts within 0.1 px²)

| defect | where | states | count | status |
|---|---|---|---|---|
| CLIP mode label | `[1222.75, 656.6, 1356.4, 709]` | every `allG20` state (msg states: 86 px² at its left end are uncovered by CC_BOX, x < 1243) | 4325 px² at α 1 (ink 1989 px²) | verified |
| CLIP marker | `[1243.25, 591.25, 1284.75, 627.5]` | every state, both modes | 1152 px², Σα 1152 (ink 882 px²) | verified; in `all6WB` it is a defect unless X draws our marker |
| LEAK rail stub | `[1224–1240, 642.75, 1245.75, 652]` | `allG20` msg, msg-long, unread, msg-latched, road-latched-msg; `all6WB` unread, msg-latched | 51 px² in zone R, 28.2 white·px², max 0.94 | verified |
| LEAK rail tail | `[1491.75–1571.25, 650.75, …, 651.5]` | all non-standby states | 25 px², 0.5 white·px², max 2.2 % | verified, barely visible |
| SAFETY (an over-element under our α) | gear footprint + 3 px | all non-standby states | 1537 px² | listed as the brief asks; harmless (BMW draws over us; not a telltale) |
| DOUBLE (pixel) | — | — | 0 px² | verified |
| DOUBLE (functional) | our tray gear [1448–1568, 565–601] and BMW's row gear | all non-standby states, both modes | — | verified (58); a decision |
| CLIP standby row | temperature + mode label | O's maps no longer have a standby state (H: standby ≠ P engine off); with today's code `all6WB` keeps our temperature patch and cover there | — | hypothesis until X implements §1.6 |

There are no belt or airbag telltales in zone R, so no SAFETY in the strict sense.

### 4.3 Seams, ranked (current build)

1. **CC_BOX right edge** x 1240.1–1244.4, y 598–694, msg states: mean step 0.052 of white, p95 0.69, ΔE2000 19.3,
   edge width 2.6 px. This is the rail stub.
2. **The `allG20` see-through edge** round the temperature (x 1481–1871, y 643–720): mean 0.0041 (Comfort) /
   0.0015 (Sport), p95 0.014, ΔE 2.1, edge 6.9 px. Black on black: invisible in practice.
3. **The `all6WB` temperature patch edge** `[1497–1668 × 661–706]`: 0.0006, ΔE 2.1. Invisible.

### 4.4 Cross-check of package R (falsification)

- **R's 65 has a tilt in the row.** Its rail centre climbs from 647.8 (x 1230) to 649.7 (x 1550), against
  647.3–648.0 in every other photo. Its temperature sits 2–3 px low (baseline 701.75).
- **R's 68 bottom row is about 1.5 px high** (baseline 697.0 against 698.25–699.0).
- R's own cross-check has no landmark below the rail, so neither shows there. My footprints therefore avoid R's 65
  and 68 for the temperature, and union R's 65 with mine for the mode label.
- **My own provisional chain** (61 tied to 60 by an affine) disagrees with R by up to 4.6 px at x ≈ 1900 on 61–68.
  The error is mine (a scale term in the affine 61 → 60 link), so R's frame is used throughout. Relative
  measurements (glyph against glyph) agree between the two frames to ≤ 0.3 px.

## 5. The mask proposal (`mask_proposal.json`; previews at `bake/work/strip/pub/ZR/preview_<channel>_zoneR_4x.png`)

Convention: the polygon is our 50 % line. α reaches 0 at `feather_in` inside a hole and 1 at `feather_out`
outside it. Everything in zone R that no hole names is opaque. BMW's background behind every hole is black (0.15–0.3 %
of white), so the feathers are 0.75–1.25 px: enough for the "shadow" softness without exposing a neighbour.

| shape | channels | polygon (50 % line) | feather in / out | why |
|---|---|---|---|---|
| `bottom.temperature` hole | bmw, bmw_msg, standby | `[1508.25, 662.0, 1666.75, 702.5]` | 1.25 / 1.25 | widest value; 3.25 px from the widest ink, where the halo is < 1.5 % |
| `assist.mode_label` hole | bmw, bmw_msg, standby | L-shape: (1220, 655.25) → (1359.5, 655.25) → (1359.5, 684.25) → (1292.75, 684.25) → (1292.75, 712) → (1220, 712) | 0.75 / 0.75 | top edge in the 5.4–7 px corridor: α 1 down to 654.5 (3.3 px below the rail's edge), 0 from 656.0 (0.6 px above the earliest cap top) |
| `assist.mode_label` (alternative) | same | `[1220, 655.25, 1388, 712]` | 0.75 / 0.75 | if a longer mode name exists (unseen). Costs nothing: BMW draws black there |
| `assist.info_tacho` hole | bmw, bmw_msg; standby and ours conditional | the convex hull of the "i" and the triangle, grown 3 px (18-point polygon in the JSON, x 1240.4–1287.6, y 588.4–630.4) | 1.0 / 1.0 | the marker outlives the message; it stays open in `ours` unless X draws ours |
| `rail.right.stub` cover | all | `[1222, 640, 1252, 656]` | 0 / 0 | ZC's panel hole must stop at x ≤ 1222 below y 640 |
| gear | — | no hole | — | BMW draws it over us |

**Check against the stock light** (the same metric as 4.2):

| channel | ink clipped | LEAK |
|---|---|---|
| bmw / bmw_msg | mode label 0, temperature 0, marker 1.4 px² (α < 0.5, the triangle's base corners) | 0.3 px², 0.007 white·px² |
| ours | — | 0 |
| standby | — | 6.6 px², max 2.75 % (R's 65 tilt puts the rail lower there: an artefact) |

**What the proposal costs:**
- **Comfort:** our tacho's chrome ring and ticks cross the marker slot. 165 px² of our ink above 5 % of white
  would be cut, if the hole is applied to the dial layer as well. Sport has none of our ink there.
- **`allG20` mode label:** opening it puts BMW's row label on screen together with our own mode text in the tacho
  (x 1388–1628, y 514–539). That is a duplicate unless our `mode` widget is hidden in `allG20`.
- **The marker's apex touches the map window's corner.** Harmless if the map window is a hole too, but the two
  holes then merge.

## 6. Conflicts I could not resolve

- **The mode label's widest name** is unknown: only COMFORT / PLUS has been seen, so the right edge is 1359.5
  hugged or 1388 conservative. The owner or package P can list the mode names.
- **`assist.off` and `assist.msa`:** under or over a theme? Only package D's matte photo with the engine off and
  auto start/stop on can settle it. Both lie under our dial in every channel, so the mask does not depend on it.
- **The marker in `all6WB`:** package X (e) decides. Until then the safety-side default is a hole.
- **Standby:** O's maps carry no true standby state any more. The `standby` channel is checked against photo 65
  only.
- **The theme-connected mode label's x:** 1225.25 on R's 60 / 14, 1223.2 on H's 17, 1222.75 on R's 65. That
  2–2.5 px spread is between registrations. The hole covers all of them with ≥ 2.75 px.
