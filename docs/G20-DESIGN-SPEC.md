# The stock G20 cluster, measured: a specification for drawing it ourselves

Package `design/g20-spec`. What BMW's own G20 Comfort cluster draws in the bottom strip — the bottom
row, the street label, the speed-limit sign and the check-control message — in enough detail to
redraw it in GLSL or as text widgets and land on the stock pixels. It exists so the theme can stop
leaving transparent windows for BMW to draw through, with a per-element setting of "BMW draws it" or
"we draw it".

**Sources.** Reference photos only, plus the car's own SOME/IP catalogue from the 2026-11-15 snapshot
and BMW's published owner's manuals. The car is offline: nothing here was read from it in this
package. Every number is marked **measured** (with the photo and the method) or **estimated**.

**Coordinates** are panel px, 1920×720, x right, y down — the same frame as `design/overlay/` and
`shared/visible.js`. Boxes are `[x0, y0, x1, y1]`.

**The numbers live in `design/g20-spec/measured.json`**, which the tools and this document share.

**Corrected on 2026-11-16** after the strip packages measured the bottom strip again on new, higher-resolution
photos (`docs/strip/*-REPORT.md`, numbers in `design/strip/*/`). Package H checked every claim here against them
(`docs/strip/H-REPORT.md`, `design/strip/H/claims.json`). What changed, in short:

- **Four of the "new" photos are old frames.** 60 = 10, 61 = 09, 62 = 08 and 68 = 39 are the same exposures at a
  higher resolution (identity transform, NCC ≥ 0.998, the same capture second; H). The new exposures are 63–67.
  A cross-check between such a pair is one observation twice.
- **What each photo shows was partly wrong.** 39 and 40 are stock (H, by content). 17 is **not** plain stock: it
  is BMW's drawing **under a connected theme** (BMW's black box, and the mode label and gear moved into the row;
  H claim C7). 08 was taken at dusk, not at night (H C18).
- **BMW rearranges the row when a theme is connected** (§2): the mode label and gear move into the row. Of the
  stock-visible photos only 10 = 60, 14 and 17 show that arrangement, which is the one the see-through layouts
  live with.
- **Every text size below was 1–2 px too big.** BMW's white text is overexposed in the photos, so half-max edges sit
  0.8–1.6 px outside the true ones per edge (package T). Positions and advances survive; heights, stems and widths
  do not. T's corrected values are given beside the old ones.
- **Coordinates.** The old numbers carry `tools/g20spec/zoom.py`'s pixel-centre convention; the strip packages
  use continuous panel px (pixel i covers [i, i+1)), which is +0.44–0.5 px on a position (T, ZL). Where an old
  and a new position are compared below, that offset is part of the difference.
- **Claims that were wrong**, each corrected in its section: there **is** a fill under the message rail (§5.1); the
  marker right of the rail **outlives** the message (§5.6); the sign is centred at (538.45, 621.2) with r_outer
  40.95 (§4.1); the street line is not always the street when no message shows (§3).

---

## 0. Headline numbers

Corrected 2026-11-16: where a strip package re-measured a number, its value comes first and the old one is
given as "was". Sizes are T's overexposure-corrected values.

| What | Value (panel px) | How |
|---|---|---|
| Bottom-row value baseline (range, clock, temperature) | **y 698.1** ±0.6; T 698.0–698.8, ZR 698.25–699.0 | measured, 6 photos; confirmed (T, ZR) |
| Bottom-row value figure height | **31.0** ±0.3 (was 33.0: overexposure) | T, clock fit over 9 photos |
| Bottom-row value stem | **4.4** ±0.4 (was 5.5) | T |
| Bottom-row digit advance (tabular) | **24.2** ±0.2 (ZL reads 24.4) | measured, 39/09/08/17/34/41; T confirms |
| Clock colon advance | **13.9** ±0.4 (was 12.9, read on a "1" pair) | T, photo 64 only |
| Unit text ("km", "°C") cap height | **24.3**, stem 2.4, grey, not white (was 25.7) | T, photo 68 only |
| Street label | centred on **x 960.6** (ZC; T 960.7), baseline **y ~700** (ZC 700.1, T 699.7; was 700.5), cap **29.8**, x-height **21.9** (T; was 30.9 / 22.8) | 39/34/09; ZC, T on 61/64/67/68 |
| Street label weight | stem **3.0** px = 0.10 × cap — a **Light** (was 3.4) | T |
| Dial bottom line | **6.5** px thick on the left (ZL; ZR 6.8–7.1 on the right; was 7.0), centre **y 647.45**; hook tips about (755.5, 616) and (1164, 616) (ZC; was (753.5, 614.5) / (1166.5, 614.5)); the hooks show only while no message does | ZL, ZR, ZC |
| Speed-limit sign | centre **(538.45, 621.2)** ±0.3, outer r **40.95**, ring width **9.41**, white disc r **31.54** (was (537.4, 621.3), 41.1, 9.3, 31.8). **Open:** H and O read the centre ~0.7–0.8 px lower (§4.1) | ZL, photos 60–64, 66–68 |
| Sign digits | figure height **26.9** (ZL; T 26.8; was 26.4), advance **18.9**, centred in the disc | 09/08/17/34; ZL, T |
| Sign empty state | three dashes **9.4 × 4.9** (was 8.8 × 4.4), pitch 13.07, centred | ZL on 68 = 39 |
| Check-control rail | **4.6** px (ZC; was 4.9), flat at **y 605.1**, x 747…1175; tapered ends: 50 % of the plateau at x 714.75 / 1207, faint tail to (701, 621) / (1220, 621) — the old "tips" (702, 621) / (1221, 621) are that tail; H's half-max 710.5 / 1211.2 is a third threshold | ZC on 62, 66; H |
| Fill under the rail | **yes**: a faint warm purple-grey gradient, ~0.05 of white under the rail, fading down and towards both tips (was "no fill") | ZC, H on 08 = 62, 66, 17 |
| Message text | centred on **x 968.6** ±0.4 (ZC; T 968–969; was 967.5); one line baseline **671.5** (ZC) / **670.2** (T); two lines **646.75 / 691.0** (ZC) / **645.3 / 689.4** (T), leading **44.25**. The ZC–T baseline difference (~1 px) is open | ZC, T on 62, 66 |
| Message cap height / x-height / stem | **24.3–24.9 / 18.2–19.2 / 3.4–3.9** (T; was 26.6 / 20.6 / 5.1) — stem 0.14–0.16 × cap, heavier than the street label but not the "Bold" read before | T, one photo per line kind |
| Symbol slot (the "i" or the pictogram) | centre **y 660.4** (was 658.7); right edge depends on the symbol: **752.75** for the "i", **756.0** for the door (was 752.9 for all); slot about **[711, 632, 757, 688]** | ZC on 62, 66 |
| Stored-messages marker, right of the rail | "i" **[1255.75, 591.25, 1269.75, 626.5]**, warning triangle **[1243.25, 591.75, 1284.75, 627.5]** (41.25 × 35.75). It **outlives the message** (was "severity marker that appears with the message", box ≈ [1252, 591, 1280, 627] from our own window on 43) | ZR on 62/63, 66/67; P; H |
| Anything on the speedometer scale for the limit | **nothing drawn** (the "Excess speed display" setting is off on this car) | measured, 08/09/17/39 |
| Several check-control messages | **cycled** as numbered frames, up to 3, never stacked or scrolled | car's own `statusMenuCCMessage` |
| Typeface | BMW's own; nearest free match **Roboto variable, wdth 87.5** | measured + web |

---

## 1. Typeface

### 1.1 What BMW uses

BMW's in-car face is a BMW-commissioned grotesque, not a retail font, and BMW does not publish it.
Web search did not produce a reliable primary source naming the exact cut used in the G20 cluster:

- BMW's corporate face since the 2020 rebrand is **BMW Type Next** (Thin / Light / Regular / Bold).
  The naming is confirmed by design press and BMW's corporate-identity guidelines
  ([Design Week, March 2020](https://www.designweek.co.uk/issues/9-15-march-2020/bmw-new-logo-2)),
  but no source ties it to the instrument cluster of a 2019–2022 G20 on iDrive 7.
- Before that BMW used **BMW Type**, described everywhere as a custom Helvetica-influenced grotesque.
- Owners report BMW changing the cluster/HUD face in a 2023 software update
  ([BimmerPost G87 thread](https://g87.bimmerpost.com/forums/showthread.php?p=30509352)), i.e. the
  face is tied to the cluster software version, which makes any single name unsafe for our car.
- Nothing font-related appears in the head-unit snapshot (`reference/car/2026-11-15/`), and would not
  be expected to: the cluster is a separate ECU (KOMBI) and renders its own text.

**Conclusion (estimated):** the G20 ID7 cluster uses a BMW-commissioned grotesque of the BMW Type /
BMW Type Next family. The exact name cannot be established from public sources, and it does not
matter for us, because the file may never be shipped.

**Hard rule honoured.** No BMW font file was looked for, downloaded, committed or shipped by this
package. Everything below is either a free face or a measured glyph specification.

### 1.2 What the photos measure

Measured with `tools/g20spec/measure.py` on photos rectified to panel px. Ratios are size-independent,
so they identify the face; see §7 for the method and its error bars.

| Run | cap | x-height | x/cap | stem | stem/cap | Photo |
|---|---|---|---|---|---|---|
| Street label (a 3-word street name, 509 px) | 30.75 | 22.9 | **0.745** | 3.62 | **0.118** | 34 |
| Street label (a one-word place name, 98 px) | 30.87 | 22.7 | **0.735** | 3.25 | **0.105** | 39 |
| Check-control (a two-line heated-wheel message) | 25.88 | 19.9 | **0.769** | 5.12 | **0.198** | 42 |
| Bottom-row values (a 3-digit range, a 4-digit clock) | — | — | — | 5.3–5.9 | **0.166** of the figure height | 39 |

So the stock cluster uses **at least three weights of one family**: a Light for the street label, a
Regular/Medium for the bottom-row values, a Bold for the check-control message and the mode label.
All are normal width, not condensed — the message only *looks* condensed because it is bold and
tightly set.

The x/cap difference between the street (0.74) and the message (0.77) is at the edge of the error
bars (±1 % on the cap, ±1.5 % on the x-height), and part of it is letter choice: the street's
x-height was read on flat-topped `ьві`, the message's on round `оев`, which overshoot. Treat the face
as one design with **x/cap ≈ 0.75**, not as two.

**Corrected 2026-11-16 (package T):** the heights and stems in this table are 1–2 px too big, because BMW's white
text is overexposed in every photo and its half-max edges sit 0.8–1.6 px outside the true ones. The ratios that do
not involve a stem survive (street x/cap 0.735, T). The stems do not: corrected, the street label is stem/cap
**0.10** and the message **0.14–0.16**, not 0.198, so the message is a medium-heavy weight rather than a clear Bold
(T recommends Roboto wght 450 for it). The per-field values are in `design/strip/T/typography.json`.

Other measured glyph facts (all **measured**, photo 39 unless noted):

- **Digits are tabular.** Advance **24.2 px** at a figure height of 32.0 (advance/figure **0.760**).
  The minutes' first digit starts at x 405.3–406.4 whether it is 1, 3, 4 or 5 (photos 39/09/08/17).
- **The "1" sits left in its advance.** In the photo's clock (a 2-digit hour starting with "1") the next digit's ink starts 22.9 px after the "1"'s
  ink, not 24.2, so the "1"'s ink begins about 1.3 px earlier than another digit's would. Draw the "1"
  about 1.3 px left of centre inside the 24.2 px cell, not centred.
- **"1"** has a flag down-left from the top of the stem and **no foot serif** (ink 13.6–14.1 wide).
- **"4"** is closed (ink 21.8 wide, flat top and bottom, h 31.6 against 32.2 for the round "3").
- **"0"** is a plain oval, no slash, no dot (ink 21.4 wide).
- **"7"** has no crossbar (photo 09's 3-digit range: ink 23.3 wide at this threshold).
- **"2"** has a flat horizontal base and a curved top.
- **Round glyphs overshoot** the flat ones by 0.3–0.6 px at a 32 px figure height (≈1%).
- **The degree sign** is a ring, outer box 10.0 × 10.9 at (1631.0, 673.1)–(1641.0, 684.0), i.e. its top
  aligns with the cap top of the unit text, not with the digits.
- **The colon** of the clock is two 6.5 × 6.9 squares with rounded corners, upper at y 673.1–680.0,
  lower at y 691.4–697.9; colon advance ≈ **12.9 px** (0.53 of a digit).
- **Units are 0.78 of the value size** and sit on the same baseline (within 0.6 px).

### 1.3 Free candidates, ranked

Method (`tools/g20spec/fontfit.py`): for each candidate, set the size so the rendered cap (or figure)
height equals the photo's; where a stem was measured, pick the weight whose stroke matches, so the
width stays an independent check; then compare the ink width of the whole run. 18 free families were
tried (`tools/g20spec/fingerprint.py` prints the shape ratios for all of them). Three — **Archivo,
Jost and Public Sans** — turned out to have no Cyrillic at all and are disqualified whatever they
score; a street name or a check-control message here is Ukrainian.

**Street label** (photo 34's 3-word street name, 23 characters, cap 30.75, photo ink width 508.9 px):

| Face | Setting | Rendered ink width | Deviation |
|---|---|---|---|
| **Roboto variable** | wdth 87.5, wght 350 | 494 | **−2.9 %** |
| PT Sans | Regular | 495 | −2.7 % |
| Roboto variable | wdth 100, wght 350 | 531 | +4.3 % |
| Noto Sans Display | wght 350 | 531 | +4.3 % |
| Open Sans | wght 350 | 542 | +6.5 % |
| IBM Plex Sans | wght 350 | 552 | +8.5 % |

**Check-control message** (photo 42's first line, 14 characters, cap 25.88, photo ink 220.1 px; the
13-character second line fitted on its x-height gives the second figure):

| Face | Setting | Deviation, line 1 (cap-fit) | Deviation, line 2 (x-fit) |
|---|---|---|---|
| **Noto Sans Display** | wght 600 | **+1.3 %** | **−0.2 %** |
| PT Sans | Regular (stroke 41 % light) | −1.9 % | +5.4 % |
| IBM Plex Sans | wght 550 | +4.5 % | +3.3 % |
| Open Sans | wght 700 | −6.4 % | −2.8 % |
| Roboto | wdth 100, wght 500 | +7.2 % | +0.7 % |

The spread between the two fits is itself the signal: the stock face's x-height is 0.769 of its cap,
Roboto's is 0.761, Noto Sans Display's is 0.769. That is why Noto Sans Display is consistent on both.

**Bottom-row digits** (3-digit range: figure 32.0, ink 69.0; 4-digit clock: ink 105.3):

| Face | Setting | Range | Clock | Digit advance |
|---|---|---|---|---|
| **Noto Sans** | wght 450 | **+0.0 %** | +0.7 % | **+0.8 %** |
| Noto Sans Display | wght 450 | −2.1 % | −2.1 % | −2.4 % |
| Fira Sans | Regular | −2.9 % | — | −1.3 % |
| PT Sans | Regular | −2.9 % | — | +2.8 % |
| **Roboto** | wght 450–500 | +4.3 % | **−0.2 %** | +4.9 % |
| Arimo | wght 450 | +4.3 % | — | +4.9 % |
| Inter | wght 450 | +7.2 % | — | +11.1 % |

Inter is out: its figures are strongly proportional (its "1" is 31 % narrower than its "0"), the stock
face's are tabular. Roboto at width 87.5 brings the digit advance to 0.743 of the figure height
against the measured 0.760, i.e. 2 % narrow — between its two widths, 87.5 is the better clock fit.

Comparison images: `design/g20-spec/fonts/*.png` (renders of an invented stand-in string with the
photo string's character count, with the photo's measured ink box drawn around them, so their
deviations differ a little from the tables above, which were fitted on the photo's own string;
committed, no photo pixels) and `bake/work/g20spec/font-*.png` (photo above the candidates;
git-ignored, because reference pixels are).

### 1.4 Recommendation

**Use Roboto variable (SIL OFL), width axis 87.5, and set the weight per run — not a glyph
specification of our own.** Reasons:

1. It is already in the repo (`tools/fonts-src/Roboto-wdth-wght.subset.ttf`, Latin + Cyrillic,
   364 KB) and already chosen by the bench G20 simulation (`docs/G20SIM-C-icons-text.md`), so the two
   stay consistent.
2. One variable file covers the three weights the stock cluster uses, and the width axis closes most
   of the remaining width error (street −2.9 % against +4.3 % at normal width).
3. Its skeleton is the closest of the open faces to the photos: tabular figures, closed "4", unslashed
   "0", flagless-footed "1", x/cap 0.761 against the measured 0.735–0.769.
4. Drawing our own glyphs would cost a full Cyrillic + Latin set for street names and check-control
   text in whatever language the car is set to. That is not worth 3 % of width.

Per-run settings to start from. Roboto's design metrics are cap **0.711 em**, x-height **0.528 em**,
figure height **0.721 em**, so for a renderer whose "size" is the em (PIL's is):

> em size = cap height / 0.711 = figure height / 0.721

| Run | Roboto axes (**estimated**) | Target height (**measured**) | em size | Anchor |
|---|---|---|---|---|
| Range / clock / temperature digits | wdth 87.5, wght 500 | figure 33.0 | 45.8 | baseline 698.1 |
| "km", "°C" | wdth 100, wght 500 | cap 25.7 | 36.1 | baseline 698.1 |
| Street label | wdth 87.5, wght 350 | cap 30.9 | 43.5 | centre x 960.5, baseline 700.5 |
| Check-control message | wdth 100, wght 500–600 | cap 26.6 | 37.4 | centre x 967.5 |
| Mode label | wdth 87.5, wght 700 | cap 22.6 | 31.8 | left x 1223 |
| Gear letter | wdth 100, wght 600 | cap 32.7 | 46.0 | centre x 1407.5, baseline 699.2 |
| Sign digits | wdth 100, wght 400 | figure 26.4 | 36.6 | centre of the disc |

(Use the figure height, not the em size, as the thing you tune: 31.9 on the two sharpest photos and
34 on the softest, so ±1 px of judgement is left to the eye on the car.)

**Superseded 2026-11-16:** the target heights in this table are the overexposed ones. Package T's corrected
targets and bakes replace them: row figure 31.0 (wght 450, wdth 100, advance 24), units cap 24 (wght 300),
street cap 30 / x 22 (wght 325, wdth 90.6), message cap 25 / x 18 (wght 450, wdth 87.5), mode label cap
20.1–20.7, sign figure 27 (`docs/strip/T-REPORT.md`, "Recommended bakes").

If the owner would rather not depend on a font at all for the **sign digits** — ten glyphs, one size —
§4.3 gives a measured specification from which they can be drawn directly.

---

## 2. The bottom row

All **measured**. Photo 39 (stock, day, 1.84 photo px per panel px) is the master; 09, 08, 17 and the
hi-res 34/41 cross-check it. Elements left to right.

**Corrected 2026-11-16 (package H, claim C17).** The cross-checks are fewer than they look. 34 and 41 are our
theme over BMW's row, and 41 is registered via 39 and 34 via 41, so the hi-res chain is one registration. 17 is
BMW's drawing with a theme connected, not plain stock. 68, 61 and 62 are the same frames as 39, 09 and 08. The
independent stock exposures behind this section are 39, 09, 08 and 17 (17 with a theme), plus, since then,
63–67 (packages ZL, ZR, T).

**There are two stock arrangements of the row** (H verdict 3; ZR; package OVERLAY/CAR3-J before them):

- **No theme connected** (39 = 68, 09 = 61, 08 = 62, 63, 64, 66, 67): the mode label and the gear letter are in
  the tacho's centre, not in the row.
- **A theme connected** (10 = 60, 14, 17): BMW moves its mode label (from x ~1223) and its gear letter
  (x 1395–1424) into the row, and usually blacks out the old gear spot in the tacho hub (not always: 34). The gear
  is drawn **over** the theme, the mode label **under** it (ZR on 60). This is the arrangement the see-through
  layouts live with, and only 10 = 60, 14 and 17 show it.
- BMW's **standby** row (65) is a third look: the odometer in the centre, the mode label in the row, no sign and no
  belts (§3, ZC, P).

Nothing in the left half of the row moves between the first two: sign, range, clock, rail ends and driver belt
agree within 0.5 px between 60 and 61–64 (ZL).

```
 x:   136        303   345      450          537        712  753            960.5           1223   1395  1540    1662
      [range+icon]     [clock]              (sign)     [sym] [--- message / street label ---] [mode] [gear] [temp]
```

| Element | Ink box | Baseline | Size | Notes |
|---|---|---|---|---|
| Range icon (pump + arrow) | [135.6, 667.0, 175.4, 696.9] | — | 39.8 × 29.9 | the arrow's tip is the leftmost ink at x 135.6 |
| Range digits | first ink x **183.6**, 3 digits end x 254.0 | 698.1 | figure 33.0, advance 24.2 | gap icon→digits ≈ 8 px |
| Range "km" | [261.8, 674.5, 303.1, 697.0] | 698.1 | cap 25.7 | gap digits→"km" ≈ 8 px |
| Clock "HH:MM" | [344.6, 665.0, 450.1, 698.4] | 698.1 | figure 33.0 | hour2 ink x 367.9, colon ink x 392.9–400.0, min1 x 405.8, min2 x 429.4 |
| Temperature sign "+" | [1539.6, 671.0, 1562.4, 692.6] | — | 22.8 × 22.3 | a plain cross, centred on the digits' mid-height |
| Temperature digits "d.d" | [1565.4, 665.4, 1621.3, 698.0] | 698.1 | figure 33.0 | the decimal point is 5.6 × 6.9 |
| Degree ring | [1631.0, 673.1, 1641.0, 684.0] | — | outer ø ≈ 10.4, stroke ≈ 2.8 (estimated) | top aligned with the "C" cap |
| "C" | [1644.6, 673.1, 1661.9, 698.0] | 698.1 | cap 25.7 | |
| Street label | centred x 960.5, widest seen [706, 669, 1215, 709] | 700.5 | cap 30.9, x 22.8, descender 8.0 below the baseline | §3 |
| Mode label (2 lines) | [1223, 657.6, 1356, 708.6]; ZR: [1225.25, 657.25, 1355.0, 708.25] on 60 / 14, left 1222.75 on 65 | 680.4 / 708.5 (ZR 679.5–680.0 / 707.25–708.25) | cap 22.6 raw (ZR 22.25–22.5); **20.1–20.7** corrected (T); leading 28.0–28.5 | left-aligned at x **~1223** (1222.75–1225.25: the spread is between registrations, ZR). In the row **with a theme connected (10 = 60, 14, 17) or in BMW's standby (65)**, not "with the centre occupied": 63 and 67 have the car picture in the centre and keep the label in the tacho (H C5) |
| Gear letter | P [1395.1, 666.9, 1419.9, 700.1], D [1395.6, 666.1, 1421.3, 698.3]; ZR P [1396.0, 666.25, 1419.75, 699.75] (60, 14) | 699.2 ±1.0 | cap 32.7 | in the row only with a theme connected; BMW draws it **over** the theme (ZR on 60: our grid line stops at the P; 58 shows two gear letters) |

The range icon's leftmost ink, the arrow tip, is at x **133.75** on the new photos (ZL; was 135.6). The temperature
is **right-aligned in front of a fixed unit** (ZR verdict 6): the degree sign stays put within ±0.25 px and the
last digit's right ink within ±0.5, while a "+d.0" value sits 2.0–2.9 px further left than the "+d.5" values. That
rests on one capture of the odd string (61 = 09), so it is a strong hypothesis. The digits are then not quite
tabular there (about 2 px between a final "0" and a final "5", ZR), against T's tabular advance 24.2 on the range and clock.

Alignment of the range and the clock is **not settled**: every photo shows a 3-digit range and a 2-digit hour
starting with 1, so whether those groups are left-, centre- or right-aligned cannot be read off. ZL and T lean to
a left anchor after the pump for the range (a right-anchored 4th digit would run into the pump), as a
**hypothesis**. The widths above are what to reproduce for exactly those shapes.

The belt and airbag lamps sit between the clock and the sign. ZL's boxes on the new photos (continuous px) are
**[500.5, 677.75, 580.25, 715.25]** rear belts, **[590.0, 664.5, 628.75, 715.25]** driver belt and
**[632.75, 664.25, 684.25, 715.5]** airbag (was [503, 679, 576, 715], [593, 666, 624, 715], [635, 665, 679, 715]:
each 2–5 px too tight). Only the **driver belt** is known to be drawn **over** a theme (catalogue, strong; ZL on
59/60). Whether the rear belts and the airbag are drawn over or under is **unknown**: no photo has them lit under
our paint (H C16, ZL). Package D's matte photo during the start-up lamp check settles it. Until then nothing we
draw may cover any of the three.

### 2.1 The dial bottom lines

**Measured on 39**; they frame the whole strip and the message rail grows out of them.

- A straight line, **7.0 px thick** (half-max of the across-line profile, 08/17/39 agree within
  0.6 px), centre **y 647.0**, running from under the fuel mini gauge to x ≈ 695 on the left and from
  x ≈ 1224 to under the oil mini gauge on the right.
- At x ≈ 695 (left) and x ≈ 1224 (right) there is a small **notch** — the line is interrupted by about
  2 px — and then it curves upward, thinning to about 5 px, and ends in a point at
  **(753.5, 614.5)** and **(1166.5, 614.5)**. The two tips are symmetric about x 960.
- The speed-limit sign is drawn **on top** of this line (the line is visible as stubs either side of
  the sign, photo 34).

**Corrected 2026-11-16.** On the new photos the line is **6.5 px** thick at half-max on the left, centre
**y 647.45** ±0.3, flat (ZL); on the right ZR reads centre 647.5–647.9 and 6.8–7.1 px. The notches are centred at
x **695.1** and **1224.1**, each a gap about **5.6 px** wide at 50 % and slanted (ZC; "about 2 px" above was the
low-resolution reading). The hook tips are at about **(755.5, 616)** and **(1164, 616)** (ZC; about 2 px from the
numbers above). The hooks exist **only while no message shows**: with a message the speedo line ends at x 683–687
with a rounded end, the tacho line starts at x 1232.2–1232.6, and the message's rail takes the hooks' place (ZC,
R finding 4). BMW's line is also cut round the sign: it stops at r 42.44 from the sign's centre on both sides, a
black moat from the ring's edge (r 40.95) to r 42.45 (ZL).

---

## 3. The street / road label

**Measured** on 09 (a 2-word street name), 39 (a one-word place name), 34 (a 3-word street name), 17 and 14.
(Of these, 34 is our theme over BMW's row and 14 / 17 are BMW's drawing with a theme connected; 09 and 39 are the
same frames as 61 and 68: H.)

**Corrected 2026-11-16** (packages ZC and T on 61, 64, 67, 68; three strings of different width): centred on
**x 960.6** (ZC, spread 1.5 px; T 960.7 ±1.3), so the centre anchor is confirmed. Baseline **700.1** (ZC) / **699.7**
(T), not 700.5. Overexposure-corrected cap **29.8**, x-height **21.9**, stem **3.0** (T). ZC's half-max x-height is
23.6–24.0, the same overexposure seen from the other side, not a disagreement about the glyphs. Descender 7.9–8.2
(ZC). The widest string, 509 px on 34, is not re-measured and carries 1–2 px of the same dilation (T).

- It is **the street name only**. No road shield, no road number, no distance appears in any of the
  five photos that show it. The text is plain, in the navigation's language (Ukrainian here), with no
  prefix or suffix of its own — photo 34's 3-word name is simply the name as the map holds it.
- **Centred on x 960.5** ±0.6: three different lengths (98, 331, 509 px) all have their ink centre
  within 1 px of 960.5.
- **Baseline y 700.5**, i.e. **2.4 px below** the range/clock/temperature baseline. Measured twice
  inside a single photo (39: 700.46 against 698.06; 34: 700.79 against 698.44), so it is real, not a
  rectification difference. *Corrected 2026-11-16:* the step is real but smaller on the new measurements,
  about **1–2 px** (T: road 699.7 against the row's 698.0–698.8; ZC 700.1 against ZR's 698.25–699.0).
- **Cap 30.9, x-height 22.8, descenders 8.0 px below the baseline**, Light weight (§1.2). It is
  noticeably lighter than the values beside it — that contrast is the most visible thing to get right.
- **When it shows:** *corrected 2026-11-16 (H claim C4):* **not** whenever the check-control line is free.
  Photos 09, 39, 34, 41 (no message) show the street, and so do 61, 64, 67, 68; 08, 17, 42, 43 (message) show the
  message instead and no street. But **63** has no message **and no street** (the centre shows the car picture,
  and a faint ghost of the standby odometer, ~2.4 % of white, sits in the line: ZC), and in BMW's standby (**65**)
  the line holds the **odometer** (ZC). So the message and the street name are **the same line, mutually
  exclusive** — the message wins — but a free line can also be empty or hold the odometer. (34 and 41 are our
  theme over BMW's row; 42 and 43 too.)
- **Width available:** from the measured extremes, x ≈ 700…1220, about **520 px**. The widest name
  seen is 509 px, which nearly fills it. On the left the symbol slot ends at 753 and on the right the
  mode label starts at 1223, so a name longer than 520 px has nowhere to go.
- **Truncation: not measured.** No photo shows a name that does not fit. BMW could ellipsize, squeeze
  or scroll. `docs/G20SIM-C-icons-text.md` assumed a squeeze to 520 px; that assumption is still
  untested.
- **Nothing else shares the line.** Left of it are the belt and airbag lamps and the check-control
  symbol slot; right of it the mode label and the gear letter. Neither moves when the street name
  grows. (*2026-11-16:* the mode label and gear are there only with a theme connected or in standby, §2; in
  standby the line itself is the odometer's — its digit group centred at x 959.4 with a label left and a unit right,
  baseline 698, one string seen: ZC, hypothesis for the anchor.)

---

## 4. The speed-limit sign

### 4.1 Geometry

**Corrected 2026-11-16 (package ZL; H, O).** The geometry to use, in continuous panel px:

| | Value | Spread | Source |
|---|---|---|---|
| Centre | **(538.45, 621.2)** | ±0.3 | ZL, photos 60–64, 66–68 (60 direct on our grid: y 621.29) |
| Outer radius (red edge) | **40.95** | 40.91–41.22 | ZL |
| Inner radius (white face) | **31.54** | 31.45–31.69 | ZL |
| Ring width | **9.41** | | ZL |
| BMW's black moat round the ring | r 40.95 … **42.45** | the rail is cut at r 42.44 (41.84–42.82) on both sides | ZL |

The sign is round to the measurement (ellipticity 0.03–0.38 px with no common axis). The white face sits 0.37 px
right of the ring's centre on every photo, too little to see (ZL).

**Open: the centre's y (and x) differ by ~0.7–0.8 px between packages, and this is not resolved.** ZL reads
(538.45, 621.2) on its own local photo models. Package H's ring fits on package R's strip rects give x 537.2–538.0,
y 621.9–622.9 (r_outer 41.6–42.0 at its threshold); package O's per-photo fits on R's first rects average
(537.68, 622.02); T's sign digits centre at (538.6, 621.9). ZL puts the spread down to registration (R's models
put the sign at x 537.1–538.5, y 621.2–622.5 on the same photos, noisier). The code uses ZL's centre today; a photo
on the car settles it.

**Why the old numbers were off.** The table below is in `tools/g20spec/zoom.py`'s pixel-centre convention (+0.5 px
to compare with the strip packages), on low-resolution rects with about ±1 px of registration error. Converted, the
old centre is (537.9, 621.8): +0.55 / −0.6 px from ZL's. The old r_outer 41.1 and ring 9.3 are within 0.15 px of
ZL's. Our window (`SIGN_WIN`) took that old centre unconverted, which put it 1.15 px left of BMW's sign: the cause of
the owner's lopsided ring (ZL verdict 2, O §1).

The original measurement, kept for the record:

**Measured** by a least-squares circle fit on the red ring, in seven photos (39, 09, 08, 17, 34, 41,
42). The four independent rectifications (39, 09, 08, 17) agree within 1.3 px in x and 0.4 px in y.
(*2026-11-16:* 34, 41 and 42 are our theme over BMW's row and are registered through 39 — one chain, not three
more observations — and 17 has a theme connected; H claim C17.)

| | Value | Spread |
|---|---|---|
| Centre | **(537.4, 621.3)** | ±1.3, ±0.4 |
| Outer radius | **41.1** (ø 82.2) | ±0.4 |
| Inner radius (white disc) | **31.8** (ø 63.6) | ±0.3 |
| Ring width | **9.3** | ±0.15 |

Cross-check: `design/overlay/g20_comfort.json` gives the bbox [498, 581, 580, 663] from an independent
half-max measurement on rect 08 — centre (539, 622), ø 82. Agreement within 1.6 px.

The sign sits **on** the speedo's bottom line (its lower edge reaches y 662.4, 15.4 px below the
line's centre at y 647, so the line passes behind it) and is drawn over it. There is a thin
dark rim, 1–2 px, immediately outside the red ring in every photo; it is probably the display's own
anti-aliasing against the dark background rather than a drawn outline (**estimated**).
*Corrected 2026-11-16:* the dark rim is **BMW's own black moat**, about 1.5 px wide (r 40.95 to 42.45): the bottom
line is cut there, symmetrically about the sign, on every photo (ZL). The ring's ink box is
[497.5, 580.2, 579.4, 662.2] (ZL).

Colour: the photos are not colour-managed. The ring reads (194, 23, 36) in 39 and (235, 34, 60) in 09;
`g20_comfort.json` records (233, 37, 62) from rect 08, the disc (254, 241, 246) and the number
(52, 42, 47). Use the standard sign red (about **#E2232E**) with an off-white disc and a near-black
number; the measured values do not justify anything more precise.

### 4.2 States

The car's own interface definition settles the state set. `TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction`
(from `reference/car/2026-11-15/someip/`, **verified from the catalogue**, not from the car's
behaviour) carries:

| Member | Values |
|---|---|
| `displaySpeedLimit` | UInt8, the number |
| `invalidFlag` | UInt8 — no limit known |
| `displaySymbolStyle` | `ECE`, `ECE_UNSURE`, `US`, `US_UNSURE`, `CHINA(_UNSURE)`, `KOREA(_UNSURE)`, `JAPAN(_UNSURE)` |
| `displaySpeedLimitUnit` | `KM_H`, `MPH`, `NICHT_VERFUEGBAR` |
| `displayNoPassingRestriction` | `KEIN_UEBERHOLVERBOT_ERKANNT`, `UEBERHOLVERBOT_PKW`, `…_LKW`, `…_PKW_MIT_ANHAENGER_ERKANNT`, `AUFHEBUNG_UEBERHOLVERBOT_PKW_ERKANNT`, `AUFHEBUNG_…_LKW`, `…_LINKSVERKEHR`, `ANDERE_UEBERHOLVERBOTE` |
| `displayRemainingDistanceNoPassingRestriction` | UInt16 |
| `displaySpeedLimitSupplemental` | `KEIN_ZUSATZZEICHEN`, `UHRZEIT`, `REGEN`, `SCHNEE`, `SCHNEE_REGEN`, `AUSFAHRT_LINKS/RECHTS`, `DISTANZ_1/2`, `NEBEL`, `RESTRIKTION`, `ANHAENGER`, `ZONE`, `SCHOOL`, `WORK_ZONE` |
| `displaySpeedLimitWarning` | `SLI_WARNUNG_NICHT_ANGEFORDERT`, `SLI_WARNUNG_ANGEFORDERT`, **`SLI_WARNUNG_STUFE_2`** |

So, as states to draw:

1. **A limit.** Round ECE sign with the number (§4.3).
2. **"Unsure" (greyed).** The `*_UNSURE` symbol styles pair with the **G20's own manual**: "without
   navigation, the signs are greyed out after curves or long stretches of road"
   ([BMW 3 Series 2020–2023, Displaying Speed Limit Info](https://www.autouserguide.com/bmw/3-series-bmw/bmw-3-series-2020-2023-displaying-speed-limit-info-user-manual/);
   the same wording is in the [i7 manual](https://www.manualslib.com/manual/3351094/Bmw-I7.html?page=218)).
   So there is a **dimmed/greyed variant** of the same sign on this car. **Not photographed; how far
   it is dimmed is unmeasured.**
3. **No limit known.** The sign stays, with **three dashes** instead of the number (§4.3). Photo 39,
   and 41/42/43 from the same session, all show it.
4. **End of the limit.** Not photographed. BMW's symbol for it is the white disc with diagonal
   strokes; our own shader already draws that variant (`shared/shaders.js` WBSIGN `u_show.x == 2`,
   five diagonal stripes). Geometry **unmeasured** — see §4.5.
5. **Supplementary plate.** A second, smaller plate under the sign for rain/snow/fog/time/zone/school.
   **Never photographed**; position and size unmeasured. It is the one state most likely to surprise a
   redraw, because it needs vertical room below the sign that nothing else uses.
6. **No overtaking** — §4.4.

`mph` is out of scope by the owner's decision: the sign stays round with a number, and no US
rectangular variant is specified here.

### 4.3 The number and the empty state

**Measured** on 09, 08, 17 ("50") and 34 ("50"), plus 14 ("30"):

| | Value |
|---|---|
| Figure height | **26.4** ±0.7 (0.41 of the disc's diameter) |
| Digit advance | **18.9** ±0.6 |
| Ink width, two digits | **34.8** ±0.4 |
| Ink box of "50" (photo 34) | [520.0, 608.9, 554.8, 635.7] |
| Centred on | (537.9, 620.9) — the disc's centre within 0.6 px |

So the number is centred in the disc both ways; a three-digit limit would be 53.7 px wide against the
63.6 px disc, which fits but leaves only 5 px either side — `docs/G20SIM-C-icons-text.md` assumed BMW
condenses three-digit limits. **Three digits were never photographed.**

**Empty state** (photo 39, confirmed in 41/42/43): **three dashes**, each **8.8 × 4.4 px**, pitch
**13.0**, ink span x 520.0…554.9, centre y 621.4 — i.e. the same ink width as a two-digit number, and
centred the same way. The dashes are the same near-black as the digits.

*Corrected 2026-11-16 (ZL, continuous px):* digits "50" ink 34.9 × **26.9** (T: 26.8), centred 0.1–0.3 px right and
0.25 px low of the face centre; dashes **9.4 × 4.9**, pitch 13.07, ink x 520.7–556.2, centre y 621.3 (on 68 = 39,
the same frame as the photo above). 41/42/43 are our theme over BMW's row.

### 4.4 The no-passing sign

**Not photographed.** No reference photo has one. What is known:

- It exists on this car: `displayNoPassingRestriction` above, with start and end variants and separate
  values for cars, trucks and car-with-trailer, plus a left-hand-traffic variant and a remaining
  distance.
- BMW's manuals describe it as shown **together with** the speed-limit display
  ([BMW 5 Series manual](https://www.manualslib.com/manual/1190940/Bmw-5-Series.html?page=87)), with
  separate symbols for the start and the end of a no-passing zone
  ([BMW 4 Series manual](https://www.manualslib.com/manual/964932/Bmw-4-Series.html?page=82)).
- Our own 6WB theme already draws one to the **right** of the limit sign (`shared/shaders.js` WBSIGN,
  `design/gen_6wb.py`), which is where the F30 6WB look puts it.

**Estimated** placement for a stock-style redraw: a second disc of the same outer radius 41.1,
centred at the same y 621.3, to the right of the limit sign with the same gap BMW leaves between the
two in its other clusters — about one ring width, so centre ≈ (537.4 + 2·41.1 + 9, 621.3) =
**(628, 621)**. This is a guess; §8 lists the photo that would settle it.

### 4.5 Exceeding the limit, and the end of a limit

**What is established.**

- BMW's own words: *"The display flashes if the detected speed limit is exceeded **or the speed limit
  changes**. Depending on national-market version, an acoustic signal also sounds."*
  ([BMW i7 owner's manual](https://www.manualslib.com/manual/3351094/Bmw-I7.html?page=218)); the same
  behaviour, worded as *"If the detected speed limit has been exceeded, the indicator light will
  flash"*, is in the
  [M4 manual](https://www.manualslib.com/manual/2442666/Bmw-M4-Coupe.html?page=163). The flashing is
  switchable: the setting is **"Warn when speeding"** under
  `CAR > Settings > Driver Assistance > Speed Limit Assistance`.
- So **the same animation covers both cases the owner described**: when the limit changes — including
  a derestriction — the newly shown sign flashes; when you exceed the limit, the sign flashes. There
  is no separate "derestriction wipe" in BMW's description: the sign changes to the new symbol and
  that symbol flashes.
- The car's own field has **two warning stages**: `displaySpeedLimitWarning` ∈
  {`SLI_WARNUNG_NICHT_ANGEFORDERT`, `SLI_WARNUNG_ANGEFORDERT`, `SLI_WARNUNG_STUFE_2`}. So the look has
  at least two intensities — most plausibly stage 1 = flash for a while, stage 2 = keep flashing or
  flash faster. **Which is which is not established.**
- The G20's own manual repeats it: *"When the detected limit is exceeded, the indicator light
  flashes"*, switched by **"Warn when speeding"**
  ([BMW 3 Series 2020–2023](https://www.autouserguide.com/bmw/3-series-bmw/bmw-3-series-2020-2023-displaying-speed-limit-info-user-manual/)).
  It does not give a duration.
- The owner's statement that a sign is essentially always present matches the photos: in four separate
  sessions the sign is on screen, showing either a number or the three dashes, never absent. So the
  "no sign at all" state our own `_signWired()` logic can produce (`docs/POLISH-E-REPORT.md` §3) has
  **no stock equivalent**: BMW keeps the disc and empties the number. (*2026-11-16:* with one exception: BMW's
  **standby** row (65) draws no sign, and the bottom line runs straight through its seat. Standby is BMW's vehicle
  condition WOHNEN, `VehicleCondition` 5 — not P with the engine off: 62 and 63 are P with the engine off (the tacho
  reads OFF), 64 is P at rpm 0, and all three show the sign. Package P; that 65 is condition 5 is P's hypothesis until a car log line confirms it.)

**On the owner's "it animates the derestriction, then shows the new limit".** The only animation BMW
documents is the flash, and the only state change the car's field can express is
`displaySpeedLimit` / `invalidFlag` / `displayNoPassingRestriction` changing value. So the most likely
reading of what the owner sees is: the symbol swaps to the end-of-limit disc (or to the new number),
and the new symbol then flashes for a few seconds — one mechanism, two appearances, no wipe or slide.
This is **not proven**: a cross-fade or a short scale-in between the old and the new symbol would look
the same from the driver's seat and cannot be ruled out from stills. The video in §8 settles it, and
`feat/bottom-row` should keep the transition behind `limitChangeAnimation` so it can be switched from
"swap" to "cross-fade" without touching the rest.

**What is not measured: every timing.** There is no video in the reference set
(`reference/` holds 22 JPEGs, 20 PNGs and no moving image), and public video cannot be frame-timed
from here. So the flash period, the number of flashes and how long the new sign flashes after a change
are **estimated**, not measured.

The only quantitative hint found is an owner's report that the over-speed warning gives *"about four
beeps and then stops until you drop below the speed limit and then exceed above it again"*
([BimmerPost U11 thread](https://u11.bimmerpost.com/forums/showthread.php?t=2101886)) — a different
model and an unverified post, but it says the warning is a **short burst that latches**, not a
continuous blink, and it bounds the burst at roughly 2–4 s if the beeps are at 1–2 Hz.

Parameters for `feat/bottom-row` to expose, with suggested defaults (**all estimated**):

| Parameter | Suggested default | Basis |
|---|---|---|
| `limitChangeFlashMs` | 3000 | a 4-beep burst at 1–2 Hz is 2–4 s (forum report above); BMW gives no figure |
| `limitFlashPeriodMs` | 500 (on 250 / off 250) | a typical automotive attention blink, 2 Hz |
| `overspeedFlashStage1` | flash for `limitChangeFlashMs`, then hold steady; re-arm only after the speed drops below the limit | `SLI_WARNUNG_ANGEFORDERT` + the latch in the forum report |
| `overspeedFlashStage2` | flash continuously while over the limit | `SLI_WARNUNG_STUFE_2` |
| `limitChangeAnimation` | none beyond the flash: swap the symbol, then flash | the manuals describe a flash, not a transition |
| `flashDims` | the whole sign (ring, disc and number) blinks between full and off | **estimated**; it could be only the ring |
| `derestrictionHoldMs` | show the end-of-limit symbol until the next limit arrives, no timer | **estimated**; nothing in the manuals or the interfaces sets a timer, and `displaySpeedLimit` simply changes |

**How to settle it in one drive** (§8): with the car's log already wired for `speed limit raw`
(`docs/POLISH-E-REPORT.md`), a phone video of the cluster through two limit changes and one
over-speed, at 30 or 60 fps, gives every number above to ±33 ms.

### 4.6 Anything on the speedometer scale

**Measured: nothing.** In photos 08, 09, 17 and 39 the speed limit is 50 (or dashes) and the speedo
scale between 40 and 60 carries no tick, arc, band or marker of any kind — only the dial's standard
white ticks, the orange face gradient and the needle's glow. `bake/work/g20spec/speedo-no-marking.png`
shows the 09 crop.

A marker nonetheless exists as a **setting on this very car**. The G20's own manual has an **"Excess
speed display"** entry: *"the speed limit that is detected by the Speed Limit Info is displayed with a
marking in the speedometer"*
([BMW 3 Series 2020–2023](https://www.autouserguide.com/bmw/3-series-bmw/bmw-3-series-2020-2023-displaying-speed-limit-info-user-manual/);
the same sentence is in the [M4 manual](https://www.manualslib.com/manual/2442666/Bmw-M4-Coupe.html?page=163)).
So the right statement is: **the setting is off on this car**, not that the feature is absent.
**Estimated:** turned on, it is a small marker at the limit's angle on the speedo scale; its shape,
colour and size are unmeasured, and a photo with the setting on would settle them (§8).

(Our own 6WB theme already draws an over-limit band on the speedo — `docs/POLISH-E-REPORT.md` §4 — and
that is our design, not BMW's.)

---

## 5. The check-control (info) message

### 5.1 The frame is not a box

**Measured** on 08 (night, two lines), 17 (day, one line), 42 (day, two lines), 43 (day, one line),
against 39/09 (no message). (*2026-11-16, H:* 08 is dusk, not night; 17 is BMW's drawing with a theme connected;
42 and 43 are **our** theme over BMW's row.)

**Corrected 2026-11-16 (packages ZC and H): there IS a fill under the rail.** ZC measured the panel on 62 (= 08,
two lines) and 66 (one line), cross-checked on 17:

- **The rail:** centreline **y 605.1** (604.7 / 605.6), 50 % edges 602.9 / 607.5, **4.6 px** thick (FWHM), flat
  from x **747** to **1175** with at most 0.26 px of sag. The shoulders are circular arcs of radius 78.5 (left) and
  79.9 (right), centred at (753.2, 684.4) and (1168.0, 684.9). The panel is symmetric about x 960.9, 0.80–0.93 of
  white with a pinkish tint like the dial lines.
- **The tips** taper: brightness falls to 50 % of the plateau at x 714–715.5 and 1206–1208, to 10 % at x 707–709 and
  1214, and a faint tail reaches **(701, 621)** and **(1220, 621)**. The old tips (702, 621) / (1221, 621) are that
  tail. H's half-max ends, 710.5 / 1211.2 (R 62), are a third threshold. **Which "end" a redraw means must be
  stated**: the three numbers are the same tip read at three levels, not a disagreement.
- **The fill:** a gradient, about **0.05 of white** just under the rail's flat part, separated from the rail by a
  2 px dark line, fading downwards (at x 791: 0.053 at y 612, 0.027 at y 642, 0.007 at y 672, 0.003 at y 690) and
  towards both tips. Its 0.5 %-of-white contour runs x 701–1220 at y 620, 726–1205 at y 640, 734–1177 at y 660,
  736–1130 at y 680: those are the "slanted ends" the owner saw. A warm purple-grey. **Not camera bloom**: at the
  same distance from the text the area above the rail is black. H read the same band independently (max(RGB) median
  91 / 102 / 74 on 08 / 66 / 17 against 25–30 just above the rail and 18–35 in the same box with no message).
- **One line and two lines give the same outline**, within 0.9 px (ZC).
- **A connected theme does not change the panel** (17 against 66, within 1.1 px: ZC, H; hypothesis, at 17's low
  resolution).
- The panel and its symbol are drawn **under** a theme (ZC on our photo 58; not registered, so medium evidence).

The original reading, kept for the record (its "no fill" is refuted above):

With no message, the two dial bottom lines end in the upward hooks of §2.1. **With a message, the
hooks are replaced by a single rail that joins the two dials over the message area.** There is no
closed box, no fill and no border below or at the sides — only the rail above.

| | Value | Spread |
|---|---|---|
| Rail thickness | **4.9** | ±0.2 |
| Rail flat segment | **y 604.8**, from x **749** to x **1176** | ±0.9 in y |
| Left tip (tapers to a point) | **(702, 621)** | |
| Right tip | **(1221, 621)** | |
| Shape between tip and flat | a smooth S, passing (715, 613) and (735, 606) on the left | measured on 08 |

The rail is thinner than the dial bottom line (4.9 against 7.0) — measured in the same photos, so the
difference is real.

`design/overlay/g20_comfort.json` records a `assist.cc_panel` polygon that reaches y 691 and x 1240;
that polygon is the hull of the frame *plus* the text and the "i", measured once on 08. The rail
numbers above supersede it for drawing.

`docs/G20SIM-C-icons-text.md` §8.2 notes that the stock bottom line's curved ends are **not drawn**
while the panel shows, and paints an opaque base over x 695–1224, y ≥ 603. The traces here confirm the
first half: the hooks are gone whenever the rail is up. They find **no evidence of an opaque base**.
The 25th-percentile background inside the message area against the same strip just left of the rail's
tip reads 20 vs 14 in photo 42 but 26 vs 31 in photo 43 — opposite signs, both within the panel's own
vignetting, which moves 5–8 levels across that span in photo 39 with no message at all. So: draw no
fill under the message (**measured**, weak — it rests on two day photos).
*Refuted 2026-11-16:* 42 and 43 are photos of **our** theme, which covered BMW's panel there; on BMW's own drawing
(08 = 62, 66, 17) the fill is plainly there (ZC, H claim C1). There is still no **opaque** base: the fill is about
5 % of white at its brightest.

### 5.2 The symbol

- **Right-aligned at x 752.9** (±0.2 across 08, 17, 42, 43) and **centred on y 658.7** (±0.1).
- Width varies with the pictogram: the "i" is 16.9 wide, the door symbol 24.2–35.1, the heated-wheel
  symbol **41.3** — the widest seen. Height 45.1 ("i") to **53.0** (heated wheel).
- So the slot to reserve is about **[712, 632, 753, 686]**, right- and middle-aligned.
- The "i" itself is a round dot 12.4 × 12.3 over a stem with a foot, total [735.9, 636.3, 752.8, 681.4].
- The pictograms are BMW artwork. We must draw our own equivalents; the three seen are an "i", a
  car-from-above with one door open, and a steering wheel with three heat waves.
- *Corrected 2026-11-16 (ZC on 62, 66):* the slot is centred at **y 660.4**; the "i" is
  [736.5, 638.25, 752.75, 682.75] and the door [720.5, 635.0, 756.0, 685.5], so the right edges differ by 3.25 px
  and no single edge is the anchor. Slot proposed: **[711, 632, 757, 688]**.

### 5.3 The text

**Measured**, with photo 42 (1.90 photo px per panel px) as the master. *Corrected 2026-11-16:* 42 is our theme
over BMW's row, and the heights below are 1–2 px too big (overexposure). On the new photos: centre **x 968.6** ±0.4
on three lines of two independent captures (ZC; T 968–969); one line baseline **671.5** (ZC) / **670.2** (T); two
lines **646.75 / 691.0** (ZC) / **645.3 / 689.4** (T), leading 44.25; cap **24.3–24.9**, x-height **18.2–19.2**,
stem **3.4–3.9** (T, overexposure-corrected; ZC's half-max reads cap 26.0–26.5, x 20.5–20.75). The ~1 px baseline
difference between ZC (half-max edges) and T (corrected edges) is open; T's correction moves a bottom edge up by
the same amount, which would explain it (hypothesis).

| | Value |
|---|---|
| Centre x | **967.5** ±1.5 (08: 968.5, 43: 968.4, 17: 965.4) — *not* the street label's 960.5 |
| One line, baseline | **y 671.2** ±0.4 |
| Two lines, baselines | **y 645.8 and 690.2** (08); 647.4 and 691.5 (42) |
| Leading | **44.2** ±0.3 |
| Cap height | **26.6** ±0.5 (08 27.1, 17 27.0, 43 26.5, 42 25.9) |
| x-height | **20.6** ±0.5 (08 20.9, 17 21.0, 43 20.7, 42 19.9) |
| Stem | **5.1** (photo 42) → a Bold, 0.20 × cap |
| Descender | 4.5–5.2 px below the baseline |

Both lines are **centred**, not left-aligned: in 08 the two lines differ in length by 22.5 px and their
left edges differ by 11.25 px, exactly half.

The one-line baseline (671.2) is **not** the midpoint of the two-line baselines (668.0). The 3.2 px
difference is larger than the rectification spread between those photos, so treat the one-line and
two-line layouts as two fixed layouts rather than one centred block (**measured**, weak: it rests on
two photos per case).

More than two lines was never photographed.

### 5.4 Severity and colour

The cluster's own list interface (`KombiInterface_2.ccList` / `newCCMessage`, from the snapshot
catalogue) carries a per-message colour:

`CCColorEnum = { DEFAULT: 0, RED: 1, YELLOW: 2, GREEN: 3, ORANGE: 4, WHITE: 5 }`

and a risk class `CCRiskClassEnum = { DEFAULT, RK10 … RK180, RK800, RK900, UNKNOWN }`, plus a
presentation type `CCTypeEnum = { TYP_A … TYP_E }`, a text type
(`CC_NAME` / `ADDITIONAL_CC_DESCRIPTION` / both), a symbol id, a highlight position and an indentation
level. So **six colours and five presentation types exist**; which message gets which is BMW's
mapping and is not in the catalogue.

**Measured from the photos:** all four messages seen (ready-to-drive, door open ×2, heated wheel off)
are **white** — the same white as the bottom-row values, and brighter than the Light street label.
No red, yellow or orange message was photographed, so their exact tints are **unmeasured**. The
telltale colours measured on the same photos are a reasonable stand-in: red (236, 64, 81), amber
(250, 184, 100), green (126, 216, 80) — `design/overlay/g20_comfort.json`.

### 5.5 More than one message at once

**What is established, from the car's own interfaces:**

- `KombiIF.statusMenuCCMessage` carries `numberFrameCheckControlMessageScroll`,
  `quantityFrameCheckControlMessageScroll` and `numberCheckControlMessage1/2/3`. So the cluster
  presents the active set as **"frame n of m"** and tracks **up to three message numbers**.
- `KombiIF.statusActiveCCMessage` carries the same pair for the message currently displayed:
  `numberFrameDisplayControlCheckControlMessage` and `frameDisplayControlCheckControlMessage`.
- `CheckControlMaster.basicList` holds, per message, `ccmId`, a `reason` (including **`CCM_SHOWN_BY_IC`**),
  a `timeStamp_s`/`timeStamp_ms` and an `activeState` (`AKTIV` / `INAKTIV`), plus a `filterInformation`.
  The timestamp is the ordering key the master has.

**So: the stock cluster cycles, it does not stack and it does not scroll sideways.** One message
occupies the line at a time; the set is a numbered sequence of frames. ~~The severity marker right of
the rail (§5.6) is what tells you there is something to cycle through.~~ *Corrected 2026-11-16 (H claim C2,
P):* the marker right of the rail is not a cycle indicator. It stays after the message has gone (63, 67), and
BMW's manuals describe an indicator for "at least one Check Control message displayed **or stored**" (P §1.1).

**What BMW's manuals give:**

| Behaviour | Value | Source |
|---|---|---|
| Several faults at once | *"the messages are displayed in succession"* / *"one after another"* | [M4 manual](https://www.manualslib.com/manual/2442666/Bmw-M4-Coupe.html?page=153) |
| Temporary messages auto-hide | **approx. 20 s**, then stored | [X1 manual](https://www.manualslib.com/manual/3340313/Bmw-X1.html?page=123) |
| Hiding a permanent message with the stalk button | hidden **approx. 8 s**, then shown again | same |
| Permanent messages | shown until the fault is fixed; cannot be hidden | M4 manual |
| Urgent messages | the long text is pushed to the centre screen automatically | M4 manual |
| Some messages | shown again after the ignition goes off | M4 manual |

**What is not measured: the per-frame dwell time.** No manual states it and no photo or video here can
give it. Parameters for `feat/bottom-row`, with suggested defaults (**estimated**):

| Parameter | Suggested default | Basis |
|---|---|---|
| `ccFrameDwellMs` | 4000 | the common automotive cycle; nothing in BMW's sources contradicts it |
| `ccFrameTransition` | hard cut (no fade, no slide) | nothing in the photos or the interfaces suggests motion; the rail does not move |
| `ccAutoHideMs` | 20000 | **measured from BMW's manual**, for messages that auto-hide |
| `ccHideReshowMs` | 8000 | **measured from BMW's manual** |
| `ccMaxSimultaneous` | 3 | `numberCheckControlMessage1/2/3` |
| `ccOrder` | by arrival (`timeStamp_s`), severity first where the risk class differs | `basicList` carries both; which one BMW sorts on is not established |

### 5.6 The marker right of the rail

**Corrected 2026-11-16 (packages H, P, ZR).** The marker is **independent of the message and outlives it**:

- **It stays after the message.** 62 has a message and an "i"; 63, about a minute later, has no message and the
  same "i". 66 has a door message and a triangle; 67, from the same minute, has no message and the triangle. 64,
  61 and 68 have neither (P, H claim C2; verified on the photos).
- **What it means:** most likely BMW's indicator that "at least one Check Control message is **displayed or
  stored**" (G80 and X1 owner's manuals; P §1.1). That reading is a strong **hypothesis**: the manual's sentence
  and the photos agree, but no public text ties the sentence to this slot.
- **Its glyph** is probably the class of what is stored: "i" for information, a triangle once a warning is stored
  (one example each: 62/63, 66/67; **hypothesis**). Which wins with both kinds stored, and whether a red message
  tints it, is not photographed.
- **Its size.** The "i" is **[1255.75, 591.25, 1269.75, 626.5]** (ZR on 62; the same slot on 63 within 0.75 px).
  The warning triangle is **[1243.25, 591.75, 1284.75, 627.5], 41.25 × 35.75** (ZR on 66/67; H's provisional
  [1241.5, 590.3, 1283.5, 626.4]), centred like the "i" at x ~1263 — about three times the "i". The slot is the
  triangle. The box "≈ [1252, 591, 1280, 627]" below, and `triangle_43` in `measured.json`, are the outline of
  **our own 0.7.7 window** clipping the triangle on 43, not the triangle (H, ZR). On 17 the triangle is cut at the
  top by the media list.
- **Relation:** drawn **under** a theme: on 43 only the apex and the middle of the base survive our paint (ZR).
- Its apex touches the map window's lower corner (ZR).

The original reading, kept for the record (its "appears with the message" and its box are refuted above):

`design/overlay/g20_comfort.json` calls it `assist.info_tacho`, "meaning not known". The photos settle
it: it is a **severity marker that appears with the message**, in a fixed slot just outside the rail's
right end.

| Photo | Marker | Box |
|---|---|---|
| 08 (ready-to-drive, info) | an "i", dot + stem | [1255.5, 590.9, 1270.0, 626.6] |
| 17 (door open) | a warning triangle with "!" | ≈ [1250, 593, 1282, 627] |
| 43 (door open) | a warning triangle with "!" | ≈ [1252, 591, 1280, 627] |
| 42 (heated wheel off) | **absent** | — (*2026-11-16:* 42 is our theme over BMW's row, and the marker is drawn under a theme, so its absence there is not conclusive) |
| 39, 09 (no message) | absent | — |
| *2026-11-16:* 63 (no message) | an "i" | [1256.5, 592.0, 1270.25, 626.75] (ZR) |
| *2026-11-16:* 66 (door open) / 67 (no message) | a warning triangle with "!" | [1243.25, 591.75, 1284.75, 627.5] (ZR) |

So the slot is about **[1252, 591, 1282, 627]**, roughly 30 × 36, and the glyph in it follows the
message's class: "i" for an information message, a triangle for a warning, absent for at least one
message (42). An "i" also appears at the symbol slot on the left in 08, so the left slot holds the
message's own pictogram and the right slot a class marker; they are independent.
(*2026-11-16:* the slot is about **[1243, 591, 1285, 628]**, the triangle's, and the marker follows what is
**stored**, not the message on screen — see the top of this section.)

---

## 6. What a redraw must get right first

In order of how visible an error would be:

1. **The two text weights in one row.** The street label is Light and the values beside it are
   Medium; drawing them at one weight is the biggest single giveaway.
2. **The baselines, 698.1 and 700.5.** A 2.4 px step between the centre label and the values either
   side; drawing them on one baseline reads as wrong even though it looks tidier. (*2026-11-16:* about 698 and
   700, a 1–2 px step: T, ZC; §3.)
3. **The rail, not a box.** The check-control frame is one 5 px line above the text, growing out of
   the dial bottom lines, with tapered ends — not a rounded rectangle. (*Corrected 2026-11-16:* a 4.6 px rail
   **and the faint gradient fill under it**, about 5 % of white, fading down and towards the tips — draw the fill
   too, or the panel reads as a bare line: ZC, H; §5.1.)
4. **The sign's ring ratio.** Ring 9.3 on an outer radius of 41.1 is 23 % of the radius; a thicker
   ring reads as a different brand's sign. (*2026-11-16:* ring 9.41 on r_outer 40.95, still 23 %: ZL. And the sign
   must be centred on BMW's centre to a fraction of a pixel, or the ring reads lopsided: §4.1.)
5. **Tabular digits with the "1" set left.** Otherwise the clock jiggles every ten minutes.
6. **The empty "- - -" state**, which is what the sign shows most of the time on roads without signs.

---

## 7. Method and error bars

- Photos are warped to panel px by the package-B model (`tools/overlay/rectify.py`, homography plus
  one radial term), which has an rms of about 1 panel px over the whole panel. Photos 34, 41, 42 and
  43, which were never rectified before, were tied in by `tools/g20spec/fit_strip.py`: photo 39's
  model composed with a partial affine fitted by SIFT+RANSAC on the common content. Their fits are
  rms 0.90 / 1.51 / 0.87 / 1.96 panel px.
- `tools/g20spec/zoom.py` and `crops.py` warp a panel box out of the **original** photo at n× panel
  resolution (Lanczos), so no resampling is lost to an intermediate rect.
- `tools/g20spec/measure.py` separates ink from background on `max(RGB)` (light text),
  `255 − min(RGB)` (dark glyphs on the sign) or `R − max(G, B)` (the red ring), thresholds at the
  midpoint between the 5th and 99.5th percentile, and takes connected components.
- **Error bars.** A single edge against the panel frame is ±1 px, dominated by the rectification. A
  difference measured inside one crop — a cap height, an advance, a line thickness, a baseline step —
  is good to about ±0.3 px. Where photos disagree, the spread is given.
- Photo 39 (1.84 photo px per panel px) and 34 (1.99) read heights about 1.3 px smaller than 09
  (0.89), 08 (0.86, night, bloomed) and 17 (0.64). Where a single number is given it is the median
  across photos, with the sharp-photo value noted.

**Corrected 2026-11-16 (packages H, T, R, ZL).**

- **Hi-res originals of old frames.** 39, 09 and 08 have higher-resolution originals: **68, 61 and 62** are the same
  exposures (and 60 is 10). They add resolution, not observations (H verdict 1; R transfers their models rather
  than refitting them).
- **One registration chain.** 41 is fitted via 39, and 34, 42 and 43 via 41, so the hi-res set 34/41/42/43 rests on
  one registration, and all four are our theme over BMW's row (H claim C17). The independent stock exposures
  behind this document are 39, 09, 08 and 17, and 17 has a theme connected.
- **08 is dusk, not night** (capture metadata; H claim C18): the panel is in its day/dusk look. It matters for
  colour, not geometry.
- **The size bias is overexposure, not sharpness.** BMW's white text is at or above the camera's highlight shoulder,
  so a half-max edge sits 0.8–1.6 px outside the true one, and more so on the softer photos — which is the 1.3 px
  above. T corrects it per photo (calibrated on our own grid labels in 60); its values replace every height and stem
  here. R finding 6: a 50 % threshold is biased outwards even on unsaturated strokes (~0.45 px on a 2 px line).
- **Coordinate convention.** `zoom.py` works in pixel centres; the strip packages in continuous px. Add about
  0.44–0.5 px to an old position before comparing it (T, ZL).
- **The rects.** R's strip models leave a coherent 0.5–0.7 px rms residual before its residual field; and between
  x ~700 and ~1220 there are no fixed landmarks in any stock photo, so zone C positions are interpolated (R finding
  3, about 0.5–1 px, hypothesis).

**Reproducing the figures** (from the main checkout, which has `reference/` and `bake/work/`):

```sh
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
    python -I tools/g20spec/fit_strip.py --root . --out-dir bake/work/g20spec/rect --photo 41
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with opencv-python-headless \
    --with numpy python -I tools/g20spec/sheets.py --root . --fonts <font dir> \
    --hjson-extra bake/work/g20spec/rect/H.json
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with opencv-python-headless \
    --with numpy python -I tools/g20spec/figures.py --fonts <font dir> --out design/g20-spec/fonts
```

Committed figures (no photo pixels): `design/g20-spec/fonts/*.png`,
`design/g20-spec/schematic/bottom-strip.svg`.
Review sheets with photo pixels (git-ignored, on this machine): `bake/work/g20spec/`
— `bottom-row.png`, `sign-50.png`, `sign-empty.png`, `cc-08-two-line.png`, `cc-17-one-line.png`,
`cc-42-two-line.png`, `cc-43-one-line.png`, `cc-39-no-message.png`, `speedo-no-marking.png`,
`font-*.png`.

---

## 8. What could not be measured, and what would settle it

| Open | Why | What settles it |
|---|---|---|
| The flash period and duration when the limit changes or is exceeded | no video in the reference set | one 30 fps phone video of the cluster through two limit changes and one over-speed |
| Which of `SLI_WARNUNG_ANGEFORDERT` / `STUFE_2` looks like what | same | the same video, with `speed limit raw` logging on (`docs/POLISH-E-REPORT.md` §3) |
| Whether a limit change swaps the symbol or cross-fades it | stills cannot tell | the same video |
| The end-of-limit symbol's geometry | never photographed | a photo on a road where a limit ends (German autobahn derestriction, or any "end of all restrictions" sign) |
| The "Excess speed display" marker on the speedo scale | the setting is off on this car | turn it on in `CAR > Settings > Driver Assistance > Speed Limit Assistance` and take one photo with a limit up |
| The no-passing sign: position, size, the gap to the limit sign | never photographed | a photo on a road with a no-overtaking sign, with the limit sign also up |
| The "unsure" (greyed) sign variant | never photographed | a photo after a long stretch with no signs, where the system dims the last limit |
| A three-digit limit | never photographed | a photo on a 100 or 130 road |
| A supplementary plate (rain, snow, time, zone, school) | never photographed | a photo in rain on a road with a wet-weather limit |
| The per-frame dwell time with several check-control messages | not in any manual | one video with two messages up (open two doors and switch the heated wheel off) |
| Which key the cluster sorts several messages on | `basicList` carries both arrival and risk class | the same video: note the order against the order the faults appeared in |
| Red / yellow / orange message tints | only white messages photographed | a photo of any warning-class message |
| How a too-long street name truncates | never photographed | drive a street whose name is longer than ~520 px |
| Whether the row is left-, centre- or right-aligned per group | only 3-digit ranges, 2-digit hours, "+d.d" temperatures seen | one photo with a 4-digit range or a 1-digit hour, and one with a negative temperature |
| The exact face name | BMW does not publish it | nothing public will; it does not matter, because the file may never ship |

The photo protocol in `docs/OVERLAY-PHOTO-PROTOCOL.md` covers how to take these so they rectify
cleanly.

*2026-11-16 (H claim C32):* the 2026-11-16 photo set settles none of the rows above. It did settle three things this
document had wrong or open: the marker without a message (§5.6), standby (§3, §4.5) and the fill (§5.1). New open
items it raised: the sign centre's ~0.8 px disagreement (§4.1), whether the rear belts and the airbag are drawn
over a theme (§2; package D's photo), and the mode label's widest name (only one mode name seen; ZR).
