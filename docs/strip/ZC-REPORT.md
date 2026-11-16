# Package ZC report: zone C (x 690-1250) of the bottom strip

The zone holds BMW's check-control panel (`assist.cc_panel`), its symbol slot (`bottom.cc_info`), the message
lines (`cc.text`), the road label (`bottom.street`), the standby odometer (`bottom.odometer`) and the two centre
hooks between the dials' bottom lines (`rail.centre`).

Coordinates are continuous panel px, boxes `[x0, y0, x1, y1]`. Every number below was measured on package R's
rectified 4x strips (`bake/work/strip/rect/`, strip rms 0.46-0.82 px). Edges sit at 50 % between the local black
and the element's own plateau. Light is given in units where BMW's white text in the same photo is 1.0. No text
content appears here or in any file of this package.

Independence (package H): 62 = 08, 61 = 09, 60 = 10 and 68 = 39 are the same frames. The two independent message
captures are 62 (two lines) and 66 (one line). 64 and 67 show the same road string.

Numbers: `design/strip/ZC/atlas.json`, `diff_summary.json`, `mask_proposal.json`. Scripts: `tools/strip/ZC/`
(`run_all.sh` reruns everything, then `publish.py`). Pixels stay in `bake/work/strip/zone-c/`.

## 1. Verdicts

1. **The panel is not a box. It is an arc rail with a gradient fill under it.** Verified on 62 and 66, and
   cross-checked on 17 (theme connected).
   - The arc has a flat top. Its centreline sits at y 605.1 (604.7 on 62, 605.6 on 66), its 50 % edges at
     602.9 / 607.5, and it is 4.6 px thick (FWHM). The flat part runs from x 747 to x 1175, and its sag over
     that run is at most 0.26 px, so the top is straight.
   - The shoulders are circular arcs of radius 78.5 (left) and 79.9 (right), centred at (753.2, 684.4) and
     (1168.0, 684.9).
   - The ends taper. Brightness falls to 50 % of the plateau at x 714-715.5 and 1206-1208, and to 10 % at
     x 707-709 and 1214. A faint tail reaches (701, 621) and (1220, 621); the spec's "tips" 702 / 1221 are this
     tail.
   - The panel is symmetric about x 960.9. Its brightness is 0.80-0.93 of white, with a pinkish tint like the
     rails.
   - **One line and two lines give the same outline**, within 0.9 px.
2. **There is a fill under the message (spec 5.1 is refuted).** It is a gradient, about 0.05 of white just under
   the arc's flat part and separated from the arc by a 2 px dark line.
   - At x 791 it reads 0.053 at y 612, 0.045 at y 630, 0.027 at y 642, 0.014 at y 660, 0.007 at y 672 and
     0.003 at y 690.
   - It fades towards both tips. The 0.5 %-of-white contour runs y 620: x 701-1220, y 640: 726-1205,
     y 660: 734-1177, y 680: 736-1130. These contours are the "slanted ends" the owner saw.
   - It is not camera bloom. At the same distance from the text, the area above the arc reads black.
   - The fill is a warm purple-grey (linear R > B > G).
   - Package H read the same fill; both measurements agree.
3. **The message text is centre-anchored at x 968.6 ± 0.4.** This was measured on three lines of different width
   (299, 277 and 261 px) on two independent captures. The text axis is 7.7 px right of the panel's own axis.
   - Two lines: baselines 646.75 and 691.0, leading 44.25.
   - One line: baseline 671.5.
   - x-height 20.5-20.75. The tallest glyph tops sit 26.0-26.5 above the baseline.
4. **The symbol slot is vertically centred at y 660.4.** The info symbol measures [736.5, 638.25, 752.75, 682.75];
   the door symbol measures [720.5, 635.0, 756.0, 685.5]. The right edges differ by 3.25 px (752.75 / 756.0), so
   no single edge is the anchor. Slot proposed: [711, 632, 757, 688].
5. **The road label is centre-anchored at x 960.6** (spread 1.5 px over three different strings 330, 282 and
   98 px wide). Baseline 700.1, x-height 23.6-24.0, deepest descender 708.25. This refutes H's "anchors cannot be
   settled" for the road label. The widest string seen is 509 px (photo 34, from `measured.json`; not
   re-measured).
6. **The standby odometer (65) is centred on its digit group.** The six digits span [890.0, 1028.75], centre
   959.4. The label hangs left of them (starting at x 807) and the unit right (ending at x 1079), baseline 698.
   This rests on one string only, so it is a hypothesis.
7. **The ghost in 63 is BMW's standby odometer at about 2.4 % of white.** Its digits sit within 2.5 px of 65's.
   The position is verified. That it is one frame of the standby-to-normal cross-fade is a hypothesis.
8. **The centre hooks (`rail.centre`) exist only while no message shows.** They are in every no-message photo
   (61, 63, 64, 65, 67, 68, and 60 with the theme connected).
   - The notches, where the dial lines break before each hook, are centred at x 695.1 and 1224.1. Each is a gap
     about 5.6 px wide at 50 %, slanted 0.73 px per px of y.
   - The hook tips are at about (755.5, 616) and (1164, 616).
   - **While a message shows, the hooks are gone.** The speedo rail then ends at x 683-687 with a rounded end and
     the tacho rail starts at 1232.2-1232.6, so both rails stop about 7 px further from the centre than the
     notches do.
9. **Relation to a theme: `assist.cc_panel` and `bottom.cc_info` are drawn UNDER it.** Session photo 58 (our
   opaque paint) shows BMW's message and symbol only inside the uncovered 13 px band (y 652-666), with no arc
   above it. The photo is not registered, but the band matches the audit's computed gap. Rails and hooks are
   also under. The odometer's relation is not needed (standby is always BMW's row); package D's photo would
   settle it.
10. **A connected theme does not change the panel (hypothesis).** On 17 against 66 the arc agrees within 1.1 px.
    Symbol and text read 2-3.5 px further left on 17. That is inside 17's registration at 0.64 photo px per
    panel px, so it is not taken as a change.

## 2. Defect table (current build `3c8ef46`, package O maps; counts in panel px)

Both layouts give identical numbers in zone C. "Light" is the sum of (alpha or 1 - alpha) × BMW's light, in
panel px of white.

| # | Mode / states | Element | Class | px | Light | Box | Status |
|---|---|---|---|---|---|---|---|
| 1 | all6WB msg, msg-long | `cc.text` + `cc_info` + fill | LEAK | 2759 + 718 + 6494 | 1209 + 473 + 70 | y 652-666 band, x 709-1196 | verified |
| 2 | all6WB msg, msg-long | `bottom.cc_info` (the `u_cc` column) | LEAK | 718 | 473 | [720, 634, 757, 666] | verified; a defect under decision 1.7 (no window for BMW's symbol) |
| 3 | all6WB road-latched-msg | panel arc / fill / text | CLIP | 8123 / 21256 / 12294 | 2080 / 820 / 4808 | [700, 601, 1222, 689] | verified; plus DOUBLE: our `nav` 1754 and `cc_desc` 3260 px within 3 px of visible BMW ink. Breaks decision 1.5 |
| 4 | allG20 unread **and** all6WB unread (maps identical to allG20 msg) | hooks L / R, tacho rail start | LEAK | 433 / 544 / 212 | 234 / 301 / 109 | [706, 613, 755, 651], [1163, 614, 1228, 652], [1218, 642, 1246, 652] | verified: `CC_BOX` opens with no message ever read |
| 5 | all6WB unread | `bottom.street` | LEAK + DOUBLE | 4932 | 2942 | [794, 668, 1127, 709] | verified; ours `nav` 965 px over BMW's road label (the 69.png box) |
| 6 | allG20 msg, msg-long, latched | tacho rail start | LEAK | 143 | 56 | [1226, 643, 1246, 651] | verified: `CC_BOX` x1 = 1243 |
| 7 | allG20 msg / all6WB msg-latched | arc tail + fill left of x 709 | CLIP | 20 + 346 | 1.1 + 4.2 | [700, 598, 760, 661] | verified; 66's glare inflates the px; 62 alone: arc 16 px, fill 37 px |
| 8 | all6WB msg-latched | text / symbol / fill bottom row | CLIP | 108 / 11 / 371 | 20 / 1.8 / 4.5 | y 666.0-666.5 | verified: the top edge of the `nav_bg` hole |
| 9 | allG20 no-message states | odometer ghost (63) | visible | 836 | 12.7 | [840, 667, 1051, 699] | **not a defect**: BMW's own transition in BMW's row |

SAFETY: no belt, airbag or over-element footprint (dilated 3 px) lies in x 690-1250, so the count is 0 by
construction. The marker (ZR) is cut by our edge at x 1243 (seam 7 below).

Standby proper (65, `VehicleCondition`) has no package O state. O's `p-engine-off` is the normal P row (as 62 and
63) and is clean in zone C, so the standby odometer could not be diffed against our build.

## 3. Seams, ranked

The step is the composite's luminance on either side of our coverage edge, 2 px each way (white = 1). Our cover in
the strip is RGB black and BMW's background is black, so a step appears only where an edge cuts BMW's light.

| Rank | Edge | Step (max cell p95) | dE00 | Where |
|---|---|---|---|---|
| 1 | `CC_TOP` soft bottom, y 652-666 (all6WB msg) | 0.97 | 73 | x 770-1150, through BMW's text |
| 2 | `nav_bg` hole top, y 666 (all6WB msg-latched) | 0.97 | 74 | x 834-1102 |
| 3 | `u_cc` column bottom, y 666 (all6WB msg) | 0.96 | 98 | x 738-758, through BMW's symbol |
| 4 | our road text over BMW's road label (all6WB unread) | 0.93 | 50 | [901, 685, 1020, 704] |
| 5 | `CC_BOX` left edge x 709 through the left hook (unread) | 0.82 | 89 | y 632-652 |
| 6 | `CC_BOX` right edge x 1243 through the tacho rail (unread, allG20 msg) | 0.80 | 88 | y 640-652 |
| 7 | the same x 1243 edge through the marker (ZR) | 0.42 | 52 | y 616-628 |
| 8 | x 709 edge through the arc tail and the fill (allG20 msg) | 0.17-0.28 | 34-37 | y 612-652 |

## 4. Mask proposal (zone C), in words

The shapes are in `mask_proposal.json`; previews are in `bake/work/strip/pub/ZC/mask_<channel>_4x.png`.

- **`zc.cover`**, all channels: opaque over [690, 596, 1250, 720]. Above y 596 the existing map-window foot
  stays as it is.
- **`zc.panel`**, hole in `bmw_msg` only. This is the shape the owner asked for.
  - **Top:** follows the arc's measured top edge (mean of 62 and 66), 2 px outside it. Feather out 1 px; BMW is
    black there.
  - **Tips:** at x 699 and 1223, around the faint tails. Feather out 1.5 px.
  - **Left side:** straight down at x 708, 3 px left of the widest symbol and 22 px right of the message-state
    speedo rail end. Feather out 2 px.
  - **Right side:** slanted, along the fill's 0.5 % contour, through (1210, 640), (1186, 660) and (1184, 701).
    It stays 6 px right of the widest text box (1177.5). Feather 3 px in and 3 px out, to blend into the fill's
    own fade.
  - **Bottom:** y 701, 3 px under line 2's deepest descender. Feather 2 px in and 2 px out.
- **`zc.street`**, hole in `bmw` only: [703, 665.25, 1219, 711.5]. This is the widest string seen (509 px)
  centred on 961, with 3.5 px a side. Feather out 1.5 px. The edge is invisible on the car: black on black.
- **`zc.odometer`**, hole in `standby` only: [793, 661.5, 1095, 701]. It allows one more digit each way.
- **`ours`:** no hole in zone C. Nothing here is a safety telltale or drawn over a theme.

**Checked against the photos.** Every hide element (hooks, rails, ghost, BMW's road label in `ours`) has 0 px
leak, and every show element (arc, symbol, text, road label, odometer) has 0 px clip.

- The only residual is fill at the hole's feathered edges: 57 px on 62, carrying 0.10 px of white, peak
  0.8 % of white.
- 66 shows more (316 px, 2.9 px of white). That is glare and dust on the glass left of x 712, not the panel.

**What it costs.**

- The road label hole's right edge sits 4 px from the theme-connected mode label (1223, photo 17; ZR's). That
  shared corridor is x 1219-1223.
- The panel's right tip sits 9 px from the message-state tacho rail start and 18 px from the marker. ZR's marker
  hole lives in that corridor.
- `bmw` and `bmw_msg` must be separate channels. The hooks lie inside the panel's footprint, and they show
  whenever no message does.
- So in `allG20` a message is visible only from the frame in which the mask switches. Package X's safety tests
  must cover that latency.
- An alternative is to pre-open the text band (about [757, 653, 1178, 700]) in `bmw` as well. It would expose
  nothing of BMW's except the road label, which is open there anyway. The owner or package X should decide.

## 5. Reconciliation with `measured.json` and the catalogue

| Number | Theirs | Ours | Verdict |
|---|---|---|---|
| `check_control.rail_y` | 604.8 ± 0.9 | 605.1 (604.7 / 605.6) | confirmed |
| `rail_thickness_px` | 4.9 | 4.6 (4.5 / 4.7) | corrected, -0.3 |
| `rail_flat_x` | [749, 1176] | [747.25, 1174.5] | confirmed (-1.5) |
| `rail_tip_left/right` | (702, 621) / (1221, 621) | faint tail (701, 621) / (1220, 621); 50 % at 714.75 / 1207; 10 % at 708 / 1214 | confirmed as the extreme extent. H's 710.5 / 1211.2 is a third threshold |
| `symbol_slot.right_x` | 752.9 | 752.75 (info) / 756.0 (door) | corrected: symbol-dependent |
| `symbol_slot.centre_y` | 658.7 | 660.4 | corrected, +1.7 |
| `text_centre_x` | 967.5 ± 1.5 | 968.6 ± 0.4 | confirmed |
| `one_line_baseline_y` | 671.2 | 671.5 | confirmed |
| `two_line_baselines_y` | 645.8 / 690.2 | 646.75 / 691.0 | +0.9 / +0.8 (the same frame as 08: a registration difference) |
| `two_line_leading_px` | 44.4 | 44.25 | confirmed |
| `cap_height_px` / `x_height_px` | 27.0 / 20.9 | 26.0-26.5 / 20.5-20.75 | corrected, -0.5..-1 / -0.3 |
| `street.centre_x` / `baseline_y` | 960.5 / 700.5 | 960.6 / 700.1 | confirmed |
| `street.x_height_px` | 22.8 | 23.6-24.0 | corrected, +1 |
| `street.descender` | 8.0 | 7.9-8.2 | confirmed |
| `dial_bottom_line.left/right_notch_x` | 695 / 1224 | 695.1 / 1224.1 | confirmed |
| `left_hook_tip` / `right_hook_tip` | (753.5, 614.5) / (1166.5, 614.5) | about (755.5, 616) / (1164, 616) | corrected, about 2 px |
| catalogue `assist.cc_panel` bbox | [712, 601, 1240, 691] | arc x 699-1223, top 602.9, fill to about y 700 | corrected: the 1240 included the marker; the left edge missed the arc tail |
| catalogue `bottom.cc_info` | [736, 637, 753, 682] | [736.5, 638.25, 752.75, 682.75] (info) | confirmed (the same frame as 08) |
| catalogue `bottom.street` | [795, 669, 1126, 709] | [794.75, 668.25, 1125.25, 708.25] | confirmed (the same frame as 09) |
| catalogue relation `cc_panel`, `cc_info` | unknown | under (photo 58) | settled |

## 6. Unattributed light

With every catalogued element masked, almost nothing in zone C is left.

- **Map foot.** Faint light at y 601-610 under the map in 61 and 68 (peak 0.024).
- **Dust on the cover glass.** Point specks at the same eight places in 64, 65 and 67 (peak up to 0.41), for
  example (792, 622), (748, 687) and (869, 603). They are absent in 61, 63 and 68, so they are on the glass, not
  in the display (hypothesis).
- **Unexplained.** [1221, 660, 1226, 666] in 66 and 67 only, peak 0.02. Both are reflection-angle shots, so it is
  probably a reflection.

## 7. Limits

- **No night shot.** The fill's contrast at night, and whether night dimming changes the fill, are unknown.
- **One odometer string.** Its anchor is a hypothesis.
- **The widest road string is not re-measured.** 509 px comes from photo 34.
- **The fill measurement is weak on 64-67.** Glare raises the black by 0.03-0.04 there, so the fill's lower tail
  can be measured on 62 only.
- **Photo 58 is not registered.** The "under" verdict rests on the visible band matching the computed gap.
