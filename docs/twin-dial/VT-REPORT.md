# Twin Dial package VT — typography and pictograms

Branch `twin-dial/vt`. Numbers: `design/twin-dial/vt/typography.json` (choice, rankings, bake sizes),
`design/twin-dial/vt/sizes.json`, `design/twin-dial/vt/samples.json`, `design/twin-dial/vt/message_symbols.json`.
Pictograms: `design/twin-dial/vt/pictograms.js` (+ `pictograms/svg`, `pictograms/baked`, `PROVENANCE.md`).
Tools: `tools/twin-dial/vt/`. Published to `bake/work/twin-dial/pub/VT/`.

All measurements are on package VR's rectified references (`pub/VR/<id>_rect.png`, R = 400 px, the left dial's
bezel radius); lengths below are in dial units R unless they say "panel px" (VG layout rev 3: R = 300 panel px).

## Verdicts

1. **The dial print is one squared, extended display face; the centre text is a plain humanist sans.** The
   references use two families: the scale numerals, the hub readouts, the gear and the small dial labels (AUTO, MAX)
   share superelliptic "squared" rounds (the zero fills 0.904 ± 0.013 of its box on 8 scale zeros, 0.940 on 3
   readout zeros; an ellipse fills 0.785) and a wide set (zero w/h 0.97); the centre window's text, the bottom row
   and the tab text use oval rounds (fill 0.836 ± 0.018, zero w/h 0.73). **verified** (02, 05).
2. **Dial print: Saira (SIL OFL 1.1), width 125, weight 550.** First of 38 families / 75 font files on the scale
   numerals (box 4.23 %, next 7.13 %), the readouts (3.22 %, next 4.46 %) and the small scale numerals; its zero's
   squareness is within 0.004 (scale) and 0.015 (readout) of the references'. **verified**.
   Limit: width 125 is Saira's axis maximum and its zero is still about 7 % narrower than the references'
   (0.90 against 0.97 w/h) — **hypothesis** for round 2: bake with a horizontal stretch of 1.05–1.07, check on the
   bench gallery. Saira has **no Cyrillic** — fine, it draws only digits and our own Latin labels.
3. **Text: Noto Sans (SIL OFL 1.1), width 100, weight 500.** First of the faces that carry every car character
   (box 3.14 % on 13 samples from 02 and 05; Open Sans 3.30, Roboto 3.56). It has all of `tools/bake_fonts.py`
   CAR_TEXT — Ukrainian, Russian, Belarusian, the Latin accents, № « » „ “ ” – — … and **U+02BC natively** (no
   substitution). The three leaders differ by 0.4 % of the cap height (≈0.1 px at our sizes): Roboto (already in
   `tools/fonts-src/`) is a zero-cost fallback if the owner prefers no new face. **verified**.
4. **Weights are the softest numbers.** The box fit hardly moves with weight, so the weight is bracketed between
   the fitted LCD bloom (≥ 0, per photo) and no bloom at all (stroke / height): scale 500–600, readouts 450–600,
   dial labels 450–650, text 400–550. The values chosen are the middles. **hypothesis ± 50**; settle on the bench
   against the references.
5. **Message font = the text face** (Noto Sans 500) at VF's cap 0.10 R = 30 panel px. A missing glyph opens BMW's
   window (decision 6); with Noto Sans that happens only for characters outside CAR_TEXT.
6. **Pictograms: 25, our own** (15 new + 10 of package P's, reused unchanged). Every message gets a symbol: a
   drawing by meaning when its id is in the table, otherwise a generic marker by colour (red / yellow / orange →
   warning triangle, white / green / default → "i").

## Faces per role

| Role | Face, setting | Licence | Box dev. | Squareness d_fill | Next best | Evidence |
|---|---|---|---|---|---|---|
| Scale numerals (speedometer 20…300, tachometer 1…8, power % numerals) | Saira wdth 125, wght 550 (500–600) | SIL OFL 1.1 | 4.23 % | +0.004 | Orbitron 7.13 % (d_fill +0.068, too square), Jura 7.20 % | V: 14 samples, 02 + 05 |
| Small scale numerals (10, 30 … 280) | Saira wdth 125, wght 550 | OFL | 2.93 % | +0.038 | Jura 4.58 % | H: 1 sample (02 "160"); 6 others lost to the light band edge |
| Big readouts (speed, gear "D1") | Saira wdth 125, wght 550 (450–600) | OFL | 3.22 % | −0.015 | Orbitron 4.46 % | V: 02 hub "0", "D1"; 05 hub "0" |
| Dial labels (AUTO, MAX, READY, OFF) | Saira wdth 125, wght 550 (alt. Play Bold, OFL) | OFL | 2.38 % | +0.048 | Play Bold 3.34 % / score 4.11 | H: 2 samples |
| Labels and text (centre window, bottom row, tab text, units, message) | Noto Sans wdth 100, wght 500 (400–550) | OFL | 3.14 % | −0.007 | Open Sans 3.30 %, Roboto 3.56 % | V: 13 samples, 02 + 05 |

Box deviation = rms of every glyph-box edge (x0 x1 y0 y1 of each glyph, positions included, so widths, heights and
spacing all count) after a fitted size, position and bloom, in % of the sample's tallest glyph. Rankings with and
without the bloom term: `typography.json` `rankings_with_bloom` / `rankings_no_bloom`.

## Bake sizes for the G20 panel (R = 300 px, VG layout rev 3)

Size = the integer px size to give `tools/bake_fonts.py` so the face's figure ("0") or cap ("H") height meets the
target. VT's own heights are half-max ink boxes less twice the fitted bloom. From `tools/twin-dial/vt/sizes.py`.

| Slot | Face | Kind | Height (R) | Target px | **Bake px** | Got px | Source of the height |
|---|---|---|---|---|---|---|---|
| scale_major | Saira 550/125 | figure | 0.0667 | 20.0 | **28** | 19.8 | V: 02, six numerals (VD: 0.071 raw) |
| scale_minor | Saira 550/125 | figure | 0.054 | 16.2 | **23** | 16.2 | VD (10 numerals); VT's one "160": 0.046 — VD's taken (more samples) |
| tacho_numerals | Saira 550/125 | figure | 0.135 | 40.5 | **57** | 40.3 | VD 04L; 05L gives 0.120 and VT's 05 "2–6" 0.118: 04 taken (a real tachometer, VD's choice) |
| rev_strip_numerals | Saira 450/125 | figure | 0.070 | 21.0 | **30** | 21.2 | VD 02L |
| speed_readout | Saira 550/125 | figure | 0.217 | 65.1 | **92** | 65.0 | V: 02 hub (05: 0.17, a smaller hub layout) |
| gear | Saira 550/125 | cap | 0.147 | 44.1 | **64** | 44.0 | V: 02 "D" |
| dial_label | Saira 550/125 | cap | 0.051 | 15.3 | **22** | 15.1 | V: 02 "AUTO" (MAX 0.044) |
| centre_title | Noto Sans 500 | cap | 0.097 | 29.1 | **41** | 29.2 | V: 02 "Short-term memory" |
| centre_value | Noto Sans 500 | figure | 0.096 | 28.7 | **39** | 28.8 | V: 02 "0.0", "27.3", "4.5" |
| centre_body | Noto Sans 500 | cap | 0.073 | 21.9 | **31** | 22.1 | V: 02 "Reset values with OK" (05 "Language" 0.073) |
| centre_small_value | Noto Sans 500 | figure | 0.073 | 21.7 | **29** | 21.4 | V: 02 "0:43 h" |
| bottom_row | Noto Sans 500 | figure | 0.099 | 29.6 | **40** | 29.5 | V: 02 "694", "14:43", "+25.5" |
| tab_text | Noto Sans 500 | cap | 0.079 | 23.6 | **33** | 23.5 | V: 02 "DANCE FM" |
| units_small | Noto Sans 500 | figure | 0.051 | 15.2 | **21** | 15.5 | V: 02 "1 / min x 1000" |
| message_text | Noto Sans 500 | cap | 0.100 | 30.0 | **42** | 29.9 | VF message_panel.json (cap_R 0.1) |
| message_counter | Noto Sans 500 | cap | 0.068 | 20.4 | **29** | 20.7 | VF message_panel.json |

Uncertainty: ±0.3 rectified px on an edge at R 400 (VR's ring rms 0.35 px), i.e. about ±0.002 R or ±0.5 panel px
on a height; the bloom correction adds ±0.4 panel px on the display slots. A size step of 1 px moves a figure height
by 0.7 px, so every size is good to ±1.

Atlas cost (test bake with `tools/bake_fonts.py`'s own `bake()`, git-ignored output): the message and title fonts with
the full car set (246 glyphs) are 1024 × 399 each (399 KiB alpha, counted twice by the platform); every digit-only
Saira font is ≤ 1024 × 70. VG should budget ~0.8 MiB per full-text font.

## How the faces were chosen

1. `glyphs.py`: 32 text samples (`design/twin-dial/vt/samples.json`) on the rectified 02 and 05 — crop, max(R, G, B)
   so the red and green text counts, linearise, upsample 4×, threshold half way between a **local** background (a
   grey opening wider than any stroke: the scale band is a gradient and the numerals cast a shadow) and the stroke
   plateau; components grouped per character; glyph boxes, median stroke, squareness of 0 / O / D. Seven samples
   were dropped with the reason recorded (bloom joining two glyphs, a zero running into the light band edge).
2. `fetch_fonts.py`: 32 families from the Google Fonts `ofl/` tree (OFL only), plus the repo's own 6 — into
   `bake/work/twin-dial/refs/vt-fonts/` with `SOURCES.json` (URL and licence per file).
3. `fit.py`: every face at every weight 300–850 (step 50) and width 75–150 (where it has the axis) renders each
   sample's string, segmented the same way; the photo's boxes are fitted jointly per photo with one bloom ≥ 0,
   per-sample size and position. The references' raised "%" is segmented but not fitted. Squareness is compared on
   the candidate rendered at the photo's scale and blurred like the rectified photo. Coverage of CAR_TEXT by fontTools.
4. `sizes.py`: bake sizes; `summarise.py`: `typography.json`; `compare.py`: a review image (git-ignored).

## Pictograms

Our own drawings, `design/twin-dial/vt/pictograms.js`, the `shared/icons.js` contract (distance function in a 0…1 box)
in package P's step DSL; SVGs in `currentColor`; baked white+alpha PNGs drawn by `paintIcon()` itself. Nothing traced
or measured from any maker's artwork, the references or the car's bitmaps; only the references' pictogram **sizes**
were read (numbers). Provenance and licence (MIT): `design/twin-dial/vt/PROVENANCE.md`.

| Name | Meaning | Use | New? |
|---|---|---|---|
| `td_fuel` | fuel pump | range tab, fuel bar | new |
| `td_fuel_side` | pump with the filler-side triangle | fuel bar (reference 02's hub) | new |
| `cc_coolant` | thermometer in waves (ISO 2575) | coolant bar, coolant messages | new |
| `cc_battery` | battery, terminals, − + | battery voltage, charge / voltage messages | new |
| `td_avg` | ø (average) | trip computer values | new |
| `td_media`, `td_radio`, `td_phone`, `td_nav`, `td_settings` | note, mast, handset, arrowhead, cog | tab bar | new |
| `cc_warn` | triangle with "!" | warning tab; generic red/yellow/orange marker | P |
| `cc_warn_solid`, `cc_info`, `cc_dot` | filled triangle, "i", dot | markers; generic white/green/default | P |
| `cc_door`, `cc_belt`, `cc_brake`, `cc_tyre`, `cc_engine`, `cc_washer` | door, belt, brake, tyre pressure, engine, washer | message symbols | P |
| `cc_bonnet`, `cc_boot` | car side view, front / rear lid raised | message symbols | new |
| `cc_oil` | oil can with a drop | oil level / pressure | new |
| `cc_pedal` | foot on the brake pedal | ready to drive / press the brake | new |
| `cc_service` | spanner | service due | new |

The units (km/h, mph, 1/min × 1000, °C, l/100 km, kWh/100 km) are text in the label face, not pictograms. Belt and
airbag telltales stay BMW's (§2); `cc_belt` is only the message symbol.

**Pictogram sizes** (VG R = 300): tab icons 0.125 R → **38 × 38** (02 rectified: warning, pump, phone, arrow 49–51 px
at R 400, read by eye on a 2× zoom, ±2 px: **hypothesis**); gauge icons ~0.11 R → **32 × 32** (H); message symbol
**54 × 54** (VF M2, 0.18 R) and **66 × 66** (VF M1, 0.22 R); markers 30 × 36 and 28 × 28 (package P). The references'
tab icons are thin outlines (stroke ~0.01 R); ours keep package P's 0.07-of-box stroke (2.7 px at 38) so the set reads
as one — the owner may prefer thinner (`W` in `pictograms.js`).

**Message symbol rule** (`message_symbols.json`): by the ccList entry's id (package P's public-source catalogue,
community numbering, unverified on this car) → our drawing; any other id, and every id while the table is unconfirmed,
→ the generic marker by colour. The car's symbol ids (0–6 seen) are not mapped: no public enumeration, and the
bitmaps are maker's artwork (never drawn from, logged or committed). When the app's log pairs (ccList id, symbol id),
`by_symbol_id` can be filled from ids alone. A missing pictogram never opens the fallback window; a missing glyph does.

## What round 2 needs

- Copy `Saira[wdth,wght].ttf` and `NotoSans[wdth,wght].ttf` with their `OFL.txt` into `tools/fonts-src/` (or a
  subset of Noto Sans to CAR_TEXT + Latin, as was done for Roboto), add the `td_*` entries of `sizes.json` to a
  `twin_dial` list in `tools/bake_fonts.py`, and add Saira and Noto Sans to the app's NOTICE.
- Try Saira with a 1.05–1.07 horizontal stretch for the dial print (needs a small `bake()` option).
- Settle the weights (± 50) on the bench gallery against references 02 and 04.
- Export `stepDist` from `design/strip/pictograms/pictograms.js` and drop the copy in `design/twin-dial/vt/pictograms.js`.

## Limits

- Text samples come from two references (02 photo, 05 render); 03 and 01 are the classic generation, 04's text is too
  small after rectification. The dial labels and the small scale numerals rest on 1–2 samples (hypothesis).
- The weights are bracketed, not fitted (verdict 4).
- Tab-icon sizes were read by eye (±2 px at R 400).
- No maker's font was looked for, downloaded or used; no web search named the maker. Only OFL files were downloaded.
