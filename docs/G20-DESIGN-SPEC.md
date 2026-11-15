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

---

## 0. Headline numbers

| What | Value (panel px) | How |
|---|---|---|
| Bottom-row value baseline (range, clock, temperature) | **y 698.1** ±0.6 | measured, 6 photos |
| Bottom-row value figure height | **33.0** ±1.0 (31.9 on the two sharpest) | measured |
| Bottom-row digit advance (tabular) | **24.2** ±0.2 | measured, 39/09/08/17/34/41 |
| Unit text ("km", "°C") cap height | **25.7** ±0.8 = 0.78 × the value height | measured |
| Street label | centred on **x 960.5** ±0.6, baseline **y 700.5**, cap **30.9**, x-height **22.8** | measured, 39/34/09 |
| Street label weight | stem **3.4** px = 0.11 × cap — a **Light** | measured, 39/34 |
| Dial bottom line | 7 px thick, centre **y 647**, hook tips (753.5, 614.5) and (1166.5, 614.5) | measured, 39 |
| Speed-limit sign | centre **(537.4, 621.3)**, outer r **41.1**, ring width **9.3**, white disc r **31.8** | measured, 7 photos |
| Sign digits | figure height **26.4**, advance **18.9**, centred in the disc | measured, 09/08/17/34 |
| Sign empty state | three dashes 8.8 × 4.4, pitch 13.0, centred | measured, 39 |
| Check-control rail | 5 px, flat at **y 604.8**, x 749…1176, tapered tips (702, 621) and (1221, 621) | measured, 08/17/42/43 |
| Message text | centred on **x 967.5** ±1.5; one line baseline **671.2**; two lines **645.8 / 690.2**, leading **44.2** | measured |
| Message cap height / x-height / stem | **26.6 / 20.6 / 5.1** — a **Bold** (stem 0.20 × cap) | measured, 42 |
| Symbol slot (the "i" or the pictogram) | right edge **x 752.9**, centre **y 658.7**, up to 41 × 53 | measured, 08/17/42/43 |
| Severity marker, right of the rail | box ≈ **[1252, 591, 1280, 627]** | measured, 08 ("i") / 43 (triangle) |
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
| Street label "Миколи Пимоненка вулиця" | 30.75 | 22.9 | **0.745** | 3.62 | **0.118** | 34 |
| Street label "Львів" | 30.87 | 22.7 | **0.735** | 3.25 | **0.105** | 39 |
| Check-control "Підігрів керма / деактивовано." | 25.88 | 19.9 | **0.769** | 5.12 | **0.198** | 42 |
| Bottom-row values "432", "10:52" | — | — | — | 5.3–5.9 | **0.166** of the figure height | 39 |

So the stock cluster uses **at least three weights of one family**: a Light for the street label, a
Regular/Medium for the bottom-row values, a Bold for the check-control message and the mode label.
All are normal width, not condensed — the message only *looks* condensed because it is bold and
tightly set.

The x/cap difference between the street (0.74) and the message (0.77) is at the edge of the error
bars (±1 % on the cap, ±1.5 % on the x-height), and part of it is letter choice: the street's
x-height was read on flat-topped `ьві`, the message's on round `оев`, which overshoot. Treat the face
as one design with **x/cap ≈ 0.75**, not as two.

Other measured glyph facts (all **measured**, photo 39 unless noted):

- **Digits are tabular.** Advance **24.2 px** at a figure height of 32.0 (advance/figure **0.760**).
  The minutes' first digit starts at x 405.3–406.4 whether it is 1, 3, 4 or 5 (photos 39/09/08/17).
- **The "1" sits left in its advance.** In "10:52" the next digit's ink starts 22.9 px after the "1"'s
  ink, not 24.2, so the "1"'s ink begins about 1.3 px earlier than another digit's would. Draw the "1"
  about 1.3 px left of centre inside the 24.2 px cell, not centred.
- **"1"** has a flag down-left from the top of the stem and **no foot serif** (ink 13.6–14.1 wide).
- **"4"** is closed (ink 21.8 wide, flat top and bottom, h 31.6 against 32.2 for the round "3").
- **"0"** is a plain oval, no slash, no dot (ink 21.4 wide).
- **"7"** has no crossbar (photo 09 "473": ink 23.3 wide at this threshold).
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

**Street label** ("Миколи Пимоненка вулиця", cap 30.75, photo ink width 508.9 px):

| Face | Setting | Rendered ink width | Deviation |
|---|---|---|---|
| **Roboto variable** | wdth 87.5, wght 350 | 494 | **−2.9 %** |
| PT Sans | Regular | 495 | −2.7 % |
| Roboto variable | wdth 100, wght 350 | 531 | +4.3 % |
| Noto Sans Display | wght 350 | 531 | +4.3 % |
| Open Sans | wght 350 | 542 | +6.5 % |
| IBM Plex Sans | wght 350 | 552 | +8.5 % |

**Check-control message** ("Підігрів керма", cap 25.88, photo ink 220.1 px; the second line
"деактивовано." fitted on its x-height gives the second figure):

| Face | Setting | Deviation, line 1 (cap-fit) | Deviation, line 2 (x-fit) |
|---|---|---|---|
| **Noto Sans Display** | wght 600 | **+1.3 %** | **−0.2 %** |
| PT Sans | Regular (stroke 41 % light) | −1.9 % | +5.4 % |
| IBM Plex Sans | wght 550 | +4.5 % | +3.3 % |
| Open Sans | wght 700 | −6.4 % | −2.8 % |
| Roboto | wdth 100, wght 500 | +7.2 % | +0.7 % |

The spread between the two fits is itself the signal: the stock face's x-height is 0.769 of its cap,
Roboto's is 0.761, Noto Sans Display's is 0.769. That is why Noto Sans Display is consistent on both.

**Bottom-row digits** ("432" figure 32.0, ink 69.0; "10:52" ink 105.3):

| Face | Setting | "432" | "10:52" | Digit advance |
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

Comparison images: `design/g20-spec/fonts/*.png` (renders with the photo's measured ink box drawn
around them — committed, no photo pixels) and `bake/work/g20spec/font-*.png` (photo above the
candidates — git-ignored, because reference pixels are).

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

If the owner would rather not depend on a font at all for the **sign digits** — ten glyphs, one size —
§4.3 gives a measured specification from which they can be drawn directly.

---

## 2. The bottom row

All **measured**. Photo 39 (stock, day, 1.84 photo px per panel px) is the master; 09, 08, 17 and the
hi-res 34/41 cross-check it. Elements left to right.

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
| Mode label (2 lines) | [1223, 657.6, 1356, 708.6] | 680.4 / 708.5 | cap 22.6, leading 28.1 | left-aligned at x 1223; only with a theme connected or the centre occupied |
| Gear letter | P [1395.1, 666.9, 1419.9, 700.1], D [1395.6, 666.1, 1421.3, 698.3] | 699.2 ±1.0 | cap 32.7 | BMW draws this **over** any theme (`design/overlay/`) |

Alignment within the row is **not settled**: every photo shows a 3-digit range, a 2-digit hour
starting with 1 and a "+d.d" temperature, so whether the groups are left-, centre- or right-aligned
cannot be read off. The widths above are what to reproduce for exactly those shapes.

The belt and airbag lamps sit between the clock and the sign ([503, 679, 576, 715] rear belts,
[593, 666, 624, 715] driver belt, [635, 665, 679, 715] airbag) and are BMW's, drawn over any theme —
see `design/overlay/g20_comfort.json`. Nothing we draw may cover the driver belt.

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

---

## 3. The street / road label

**Measured** on 09 ("Луганська вулиця"), 39 ("Львів"), 34 ("Миколи Пимоненка вулиця"), 17 and 14.

- It is **the street name only**. No road shield, no road number, no distance appears in any of the
  five photos that show it. The text is plain, in the navigation's language (Ukrainian here), with no
  prefix or suffix of its own — "Миколи Пимоненка вулиця" is simply the name as the map holds it.
- **Centred on x 960.5** ±0.6: three different lengths (98, 331, 509 px) all have their ink centre
  within 1 px of 960.5.
- **Baseline y 700.5**, i.e. **2.4 px below** the range/clock/temperature baseline. Measured twice
  inside a single photo (39: 700.46 against 698.06; 34: 700.79 against 698.44), so it is real, not a
  rectification difference.
- **Cap 30.9, x-height 22.8, descenders 8.0 px below the baseline**, Light weight (§1.2). It is
  noticeably lighter than the values beside it — that contrast is the most visible thing to get right.
- **When it shows:** whenever the check-control line is free. Photos 09, 39, 34, 41 (no message) show
  the street; 08, 17, 42, 43 (message) show the message instead and no street. So the message and the
  street name are **the same line, mutually exclusive** — the message wins.
- **Width available:** from the measured extremes, x ≈ 700…1220, about **520 px**. The widest name
  seen is 509 px, which nearly fills it. On the left the symbol slot ends at 753 and on the right the
  mode label starts at 1223, so a name longer than 520 px has nowhere to go.
- **Truncation: not measured.** No photo shows a name that does not fit. BMW could ellipsize, squeeze
  or scroll. `docs/G20SIM-C-icons-text.md` assumed a squeeze to 520 px; that assumption is still
  untested.
- **Nothing else shares the line.** Left of it are the belt and airbag lamps and the check-control
  symbol slot; right of it the mode label and the gear letter. Neither moves when the street name
  grows.

---

## 4. The speed-limit sign

### 4.1 Geometry

**Measured** by a least-squares circle fit on the red ring, in seven photos (39, 09, 08, 17, 34, 41,
42). The four independent rectifications (39, 09, 08, 17) agree within 1.3 px in x and 0.4 px in y.

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
  **no stock equivalent**: BMW keeps the disc and empties the number.

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
against 39/09 (no message).

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

### 5.2 The symbol

- **Right-aligned at x 752.9** (±0.2 across 08, 17, 42, 43) and **centred on y 658.7** (±0.1).
- Width varies with the pictogram: the "i" is 16.9 wide, the door symbol 24.2–35.1, the heated-wheel
  symbol **41.3** — the widest seen. Height 45.1 ("i") to **53.0** (heated wheel).
- So the slot to reserve is about **[712, 632, 753, 686]**, right- and middle-aligned.
- The "i" itself is a round dot 12.4 × 12.3 over a stem with a foot, total [735.9, 636.3, 752.8, 681.4].
- The pictograms are BMW artwork. We must draw our own equivalents; the three seen are an "i", a
  car-from-above with one door open, and a steering wheel with three heat waves.

### 5.3 The text

**Measured**, with photo 42 (1.90 photo px per panel px) as the master:

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
occupies the line at a time; the set is a numbered sequence of frames; the severity marker right of
the rail (§5.6) is what tells you there is something to cycle through.

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

`design/overlay/g20_comfort.json` calls it `assist.info_tacho`, "meaning not known". The photos settle
it: it is a **severity marker that appears with the message**, in a fixed slot just outside the rail's
right end.

| Photo | Marker | Box |
|---|---|---|
| 08 (ready-to-drive, info) | an "i", dot + stem | [1255.5, 590.9, 1270.0, 626.6] |
| 17 (door open) | a warning triangle with "!" | ≈ [1250, 593, 1282, 627] |
| 43 (door open) | a warning triangle with "!" | ≈ [1252, 591, 1280, 627] |
| 42 (heated wheel off) | **absent** | — |
| 39, 09 (no message) | absent | — |

So the slot is about **[1252, 591, 1282, 627]**, roughly 30 × 36, and the glyph in it follows the
message's class: "i" for an information message, a triangle for a warning, absent for at least one
message (42). An "i" also appears at the symbol slot on the left in 08, so the left slot holds the
message's own pictogram and the right slot a class marker; they are independent.

---

## 6. What a redraw must get right first

In order of how visible an error would be:

1. **The two text weights in one row.** The street label is Light and the values beside it are
   Medium; drawing them at one weight is the biggest single giveaway.
2. **The baselines, 698.1 and 700.5.** A 2.4 px step between the centre label and the values either
   side; drawing them on one baseline reads as wrong even though it looks tidier.
3. **The rail, not a box.** The check-control frame is one 5 px line above the text, growing out of
   the dial bottom lines, with tapered ends — not a rounded rectangle.
4. **The sign's ring ratio.** Ring 9.3 on an outer radius of 41.1 is 23 % of the radius; a thicker
   ring reads as a different brand's sign.
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
