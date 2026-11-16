# Strip package T — typography

Branch `strip/T`. Numbers: `design/strip/T/typography.json` (also published to `bake/work/strip/pub/T/typography.json`
for package F). Tools: `tools/strip/T/`. Everything is in panel px, continuous coordinates (pixel *i* covers
[*i*, *i*+1)); a baseline is the bottom edge of flat-bottomed ink.

## Verdicts

1. **Every earlier size measurement of BMW's strip text is too big by 1–2 px**, and the new photos would have made
   it worse. BMW's white text is at or above the camera's highlight shoulder in every 2026-11-16 photo (flat-topped
   stroke profiles, plateau 0.92 linear), so its half-max edges sit **0.8–1.6 px outside the true ones per edge**.
   Calibrated on our own text of known geometry in photo 60 (the grid's yellow labels, saturated like BMW's white:
   +0.58 ± 0.23 px per edge), then carried to every photo through the clock's leading "1". With that correction the
   per-field fits close to 0.03–0.2 px rms across photos whose raw heights differ by 2 px. **verified** (method),
   the absolute anchor rests on one calibration (±0.3 px on a height).
2. **Our row values (`wb_row`) already have BMW's height** (31.0 against 31.0 ± 0.3), but are **too bold** (stem 5.0
   against 4.4) and **too narrow** (tabular advance 23 against 24.2; colon 11 against 13.9).
3. **Our units (`wb_val`) are too big and twice too bold** for BMW's grey units (C 26 / stem 4.8 against 24.3 / 2.4).
4. **Our road label and message (`wb_cap`) are half BMW's size** (cap 15 against 29.8 for the road label and 24.6 for
   the message). `wb_cap` also draws the dial captions, so it cannot grow: the strip needs its own bakes (`wb_road`,
   `wb_msg`), which is where package F's Cyrillic goes.
5. **Our temperature group sits 8–10 px left of BMW's, our range group 4.5–6.5 px left, every row text 1 px high.**
   The clock is in place (colon 0.7 px right, within the registration).
6. **Photo 68 is not a new photo:** it is the same shot as photo 39 (39's file carries the date 2026-11-13; the
   strings and values match, and every row glyph box agrees to 0.15 px under two different registrations). Package H should record it; it is also the least saturated photo, which is
   why it is useful here.

## Per-field table

BMW = dilation-corrected median over the photos named; Ours now = the baked atlas and `wb_dials.json`
(`wb_sport_dials` places these widgets identically), laid out as `shared/hud_text.js` does (computed, not read back
from the engine). V = verified on photos, H = hypothesis.

| Field | Metric | BMW | Ours now | Δ (ours − BMW) | Recommended | Evidence |
|---|---|---|---|---|---|---|
| row values (range, clock, temp) | figure height | 31.0 (round 31.04, flat 30.88) | 31.0 | 0.0 | 31.0 | V: clock fit over 9 photos, k 0.92–1.11, rms 0.08–0.17 |
| | stem | 4.4 ± 0.4 | 5.0 | +0.6 | 4.5 | V (weaker): clock + range fits, rms 0.16–0.28 |
| | digit advance (tabular) | 24.2 ± 0.15 | 23 | −1.2 | 24 | V: identical-digit pitch, photo 63; legacy 24.2 over 6 photos |
| | colon advance | 13.9 ± 0.4 | 11 | −2.9 | 14 (override) | V: same digit either side of the colon, photo 64 only |
| | digit ink widths 0 1 2 3 4 5 6 7 8 9 | 20.1 12.6 19.2 20.0 20.7 19.4 20.1 19.6 20.5 19.2 | 18.5 11.8 19.5 18.7 20.4 18.4 18.7 19.5 18.5 18.4 | −0.3 to −1.9 (0 2 3 5 6 8 narrower) | 19.7 12.1 20.8 19.8 22.1 19.5 19.8 20.9 19.7 19.6 (rms 0.9, shape) | V |
| | baseline | 698.0 (photo 60/68 frame) / 698.8 (61–67 frame) | 697 | −1 | **698** | V; the two registration frames differ by 0.8 px (flagged to R) |
| range | ink, 3 digits | x 183.7–251.7 | right edge 4.5 px left | −4.5 | box x 143 (right edge 253) | V ± 1.5 (registration) |
| | anchor | unsettled: always 3 digits, tabular | right | | keep right; H: BMW left-anchors after the pump (a 4-digit range right-anchored would run 16 px into the pump) | H |
| clock | colon centre | 396.1 ± 0.7 | 396.8 | +0.7 | box x 335 (unchanged; within the registration) | V |
| | ink span "1x:xx" | 345.0–449.3 | | | with colon 14 the minutes land too | V |
| temp | ink "+d.d" | x 1540.2–1621.1 | right edge 8.0 px left | −8.0 | box x 1513 (right edge 1623) | V ± 1.5; 65 and 68 are off at this x |
| units (grey, ~0.35 of the values' white) | "C" cap / "m" x / "k" asc | 24.3 / 17.0 / 22.5 | 26.0 / 19.0 / 27.0 (`wb_val`) | +1.7 / +2.0 / +4.5 | 24 / 18 / 26 | V: photo 68 only (the one where the grey units are not saturated) |
| | stem | 2.4 ± 0.3 | 4.8 | +2.4 | 2.4 | V: photo 68 |
| | "km" ink | x 261.5–300.9 (width 39.4) | left edge 6.5 px left | −6.5 | box x 259 | V |
| | "°C" ink | x 1631.0–1660.3 (width 29.3) | left edge 9.8 px left | −9.8 | box x 1629 | V |
| road label | cap / x | 29.8 / 21.9 (x/cap 0.735) | 15 / 11 (`wb_cap`) | −14.8 / −10.9 | 30 / 22 | V: 4 photos, fit rms 0.04 / 0.24 |
| | stem | 3.0 ± 0.5 | 2.9 | −0.1 | 2.8 | V (weak) |
| | baseline / centre | 699.7 ± 0.4 / x 960.7 ± 1.3, centred | 700 / 960 | +0.3 / −0.7 | 700 / box x 691 w 540 | V |
| message | cap / x | 24.3–24.9 / 18.2–19.2 | 15 / 11 (`wb_cap`) | ≈ −9.6 / −7.7 | 25 / 18 | V, one photo per line kind (62, 66): a range |
| | stem | 3.4–3.9 | 2.9 | ≈ −0.7 | 3.7 | V (one photo) |
| | baselines | one line 670.2; two lines 645.3 / 689.4; centre x 968–969 | 645 / 689 (`cc_name` / `cc_desc`), centre 968 | ≈ 0 | package X's design | V |
| sign digits | figure / stem | 26.8 / 3.9 | 26.0 / 4.8 (`wb_val`) | −0.8 / +0.9 | 27 / 3.9 | V: 6 photos; dark ink, not dilation-corrected (raw height does not follow the dilation) |
| | centre | x 538.6, y 621.9 | (our sign art is elsewhere) | | | V |
| mode label (standby) | cap | 20.1–20.7, two lines, baselines ~679.7 / 708.4, left ~1224 | (ours is in the tray) | | not ours | V (65 only) |
| speed foot "0" | figure | 41 ± 0.5 | (BMW's) | | | V |

## Recommended bakes (for package F)

`tools/bake_fonts.py` entries, Roboto variable (`tools/fonts-src/Roboto-wdth-wght.subset.ttf`, OFL, already holds 255
Cyrillic code points). Sizes are integers: the Pillow here rounds a float size, so the existing `g20_mode` at 31.5 is
baked at 32.

| Name | Bake [wght, wdth] | Gives | Draws |
|---|---|---|---|
| `wb_row` (change) | 43 px, [450, 100] (was [500, 87.5]) | figure 31.0, stem 4.5, advance 24 | own_range, own_clock, own_temp |
| `wb_row` ":" | advance override 14 (optional) | BMW's colon | the clock |
| `wb_rowu` (new) | 34 px, [300, 87.5] | C 24, m x 18, stem 2.4; "km" 39.0 wide (BMW 39.4), "°C" 29.2 (29.3) | own_range_u, own_temp_u |
| `wb_road` (new) | 42 px, [325, 90.625]; alt. [375, 87.5] | cap 30, x 22, stem 2.8; glyph-edge rms 0.96 px on the photo strings | nav |
| `wb_msg` (new) | 35 px, [450, 87.5] | cap 25, x 18, stem 3.7; glyph-edge rms 0.82 px | our message |
| `wb_lim` (new, optional) | 38 px, [450, 87.5] | figure 27, stem 3.9; glyph-edge rms 0.24 px | the limit digits |

Widget y must come from the baked font (`gen_6wb.base_at(font, baseline)`): Cyrillic capitals with marks change a
font's cellHeight and baseline. Baselines to use: row and units **698** (`ROW_BASE` is 697), road label **700**
(`NAV_BASE` 700.5 gives 700 today), message as package X places it (BMW's one line sits at 670.2).

## Fingerprints (size-free)

| Text | BMW | Roboto as recommended |
|---|---|---|
| row values | adv/fig 0.779, stem/fig 0.141, "1" ink / "0" ink 0.63, tabular | 0.774, 0.144, 0.61, tabular |
| road label | x/cap 0.735, stem/cap 0.10 | 0.733, 0.094 |
| message | x/cap 0.73–0.79, stem/cap 0.14–0.16 | 0.72, 0.148 |
| units | x/C 0.70, k/C 0.93 (a short ascender) | 0.75, 1.08 — Roboto's "k" stands ~3.5 px over BMW's |
| sign digits | stem/fig 0.147 | 0.144 |

BMW's own face was not downloaded or used. No web search was needed: Roboto, the repo's face, fits every text kind
within the measurement error except the units' "k".

## Widest strings (from the glyph metrics)

- **range**: 4 digits = 96.8 px of advance; right-anchored on today's 251.7 the ink would start at ~160, inside the
  pump icon (ends ~175). So either BMW left-anchors after the pump or never shows 4 digits (H; no photo).
- **clock**: tabular, so "00:00" to "23:59" keep the layout; the ink span moves only by the end glyphs' bearings
  (≤ ±1 px): about 344–450.5.
- **temperature**: one more digit ("+22.5", "−22.5") adds 24.2 px on the left if right-anchored: ink from ~1516
  (H: anchor not photographed).
- **road label**: 329 px is the widest in this set; the legacy 509 px (photo 34) is dilated by ~1–2 px.
- **message**: 257–298 px per line in this set.

## Reconciliation with `design/g20-spec/measured.json`

| Number | Legacy | Now | Δ | Why |
|---|---|---|---|---|
| value figure height | 33.0 | 31.0 | −2.0 | dilation |
| value stem | 5.5 | 4.4 | −1.1 | dilation |
| value digit advance | 24.2 | 24.2 | 0 | confirmed (dilation-invariant) |
| value baseline | 698.1 | 698.0–698.8 | ≈ 0 | confirmed |
| colon advance | 12.9 | 13.9 | +1.0 | legacy took a "1" pair; this is a same-digit pair |
| unit cap | 25.7 | 24.3 | −1.4 | dilation |
| street cap / x / stem | 30.9 / 22.8 / 3.4 | 29.8 / 21.9 / 3.0 | −1.1 / −0.9 / −0.4 | dilation |
| street baseline / centre | 700.5 / 960.5 | 699.7 / 960.7 | −0.8 / +0.2 | confirmed within the registration |
| message cap / x / stem | 27.0 / 20.9 / 5.6 | 24.3–24.9 / 18.2–19.2 / 3.4–3.9 | ≈ −2.4 / −2.2 / −2 | dilation |
| message one-line baseline | 671.2 | 670.2 | −1.0 | legacy from 17 / 43 (low resolution, our theme up) |
| message two-line baselines | 645.8 / 690.2 | 645.3 / 689.4 | −0.5 / −0.8 | |
| message centre | 967.5 | 968–969 | +1 | |
| sign digit height | 26.4 | 26.8 | +0.4 | dark ink: no dilation either way |
| mode label cap | 22.6 | 20.1–20.7 | −2 | dilation; legacy from 17 |

Legacy coordinates also carry `tools/g20spec/zoom.py`'s half-pixel convention (+0.44 px at 8×, see package R's
`H.json` `_about`); the differences above are larger than that.

## Method, briefly

- `register_quick.py`: a provisional photo → panel model (SIFT from the old stock rects), used only until package R's
  `bake/work/strip/rect/H.json` had the photo; all final numbers use R's `<id>_strip` models.
- `glyphs.py`: warp a field at 8×, linearise sRGB, threshold at half the stroke plateau, glyph boxes and stems.
- `calib60.py`: the dilation of photo 60 on our own grid labels (atlas `head`) — saturated 0.58 ± 0.23 px per edge,
  unsaturated 0.19–0.25.
- `analyse.py`: per-photo dilation (x and y separately: the y dilation is up to 0.6 px larger in some shots, likely
  hand shake), then per field raw = true + 2·k·b fitted over the photos (k = 1 for the row's digits by construction;
  the road label fits k 0.83–0.88, the grey units 0.52).
- `fitfont.py`, `compare.py`: Roboto rendered as `bake_fonts.py` bakes it and laid out as `hud_text.js` lays it out, on
  the photo strings (kept in a git-ignored scratch file only), against BMW's corrected glyph boxes.

## What limits these numbers

- The absolute size scale rests on one calibration (photo 60): the transfer from our saturated yellow labels to
  BMW's saturated white is assumed. Photo 68, the least saturated, lands where the chain predicts (0.21 px per edge
  against 0.19–0.25 measured for unsaturated ink), which is the one independent check.
- Positions carry R's strip registration: ±0.7 px rms, and frames 60/68 against 61–67 differ by ~0.8 px in y and 1–2
  px in x. The temperature at x ~1600 is off by 2–3 px in 65 and 68.
- Message sizes come from one photo per line kind; a range is given.
- Not photographed: a 4-digit or 2-digit range, a 1-digit or 2x hour, a negative or two-digit temperature, a night
  shot (dimmer text would dilate less — the method handles it), a no-overtaking sign.
