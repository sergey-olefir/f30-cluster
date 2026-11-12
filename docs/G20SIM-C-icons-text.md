# G20 bench simulation, package C: icons and text

Package C of `docs/AGENT-BRIEF-g20-sim.md` (§7) draws the icons and texts of BMW's stock G20 Comfort cluster for the bench. That covers the telltales, the belts and airbag, the bottom row, the digital speed, the labels, the speed-limit sign and the check-control panel. Everything is our own vector drawing plus a free font. There are no photo pixels, no BMW artwork and no BMW font. It is bench only.

## 1. Delivered

| Path | What |
|---|---|
| `bench/g20/c.js` | `window.G20C`: module, style table, all drawing (text renderer folded in; there is no `text/text.js`) |
| `bench/g20/fonts/Roboto-wdth-wght.subset.ttf` + `Roboto-OFL.txt` | The free font (SIL OFL 1.1), variable wdth 75–100 / wght 100–900, subset to Latin + Cyrillic (364 KB) |
| `bench/g20/icons/manifest.part.json` | 28 element entries + 1 font entry. C ships no images: entries are `procedural: true`, `file: "c.js"` |
| `bake/work/g20sim/FONT.json` | The font choice, for package B's dial numerals |
| `bake/src/G20/icons/` | `measure.py`, `measure_parts.py`, `calibrate_text.py` (font fit per text run), `ascii.py` / `gridcrop.py` (geometry reading), `qc_c.py` (QC), `make_manifest.py` |
| `bake/work/g20sim/C/` (scratch) | `harness.html`, `shot.sh`, `shot_08/09/14.png`, `qc/qc_*.png` review sheets, `qc/qc.json`, `qc/qc_table.md`, `text_fit.json`, `measure.json` |

Size: `bench/g20/` use by C is 412 KB (budget 2 MB).

## 2. Font: Roboto (variable, OFL)

All text was measured at the photo's digit height (33 px) on rect 08:

| Font | "467" width (photo 70) | "16:43" (105) | "+3.5" (83) |
|---|---|---|---|
| **Roboto wdth 87.5, wght 700** | **72** | **106** | **83** |
| Inter 600 / 700 | 82 / 84 | 117 / 122 | 95 / 99 |
| Arimo 700 | 78 | 121 | 92 |

- **Width:** Inter and Arimo are 11–17 % too wide. Barlow has no Cyrillic.
- **Cyrillic:** Roboto covers it. The street names and the check-control text are Ukrainian.
- **Shape:** its digits have the closed, round proportions of the photos' numerals.
- **One file for every style:** the variable axes give the semi-condensed bold numerals, the condensed COMFORT PLUS / COLD / AUTO H, the bold message and the regular street name.

`calibrate_text.py` fits size, scaleX, pen x and baseline per text run. It renders each candidate with PIL, stretches it to the photo's ink width, blurs it like the photo and scores the cross-correlation. A free fit always picks wght 900, because the camera's bloom fattens every stroke, so the weights were chosen by eye (§4).

## 3. API as implemented

```js
G20C.init(base) -> Promise          // loads base + 'fonts/Roboto-wdth-wght.subset.ttf' as 'G20Roboto' (FontFace); Arial fallback
G20C.drawUnder(ctx, s)              // z 60-89 (see below)
G20C.drawOver(ctx, s)               // (P) red/green, driver belt, bottom-row gear (connected)
G20C.lamps                          // [{id, name, group, colour, onPanel}], 16 entries
G20C.PRESETS = { startup: {lamp map, exactly 08's panel lamps}, driving: {} }
G20C.PRESET_EXTRAS                  // addition: startup = {ccMessage:'ready', limit:50, gearLetter:'P', values:{rpm:0,speed:0}}
G20C.STYLE = { COL, T, G, HALO }    // addition: the one style table (colours per look, text styles, geometry, halo)
```

**drawUnder**, in order:
1. lit telltales (brake, TPMS, ABS, DSC, AUTO H, steering), rear belts, airbag;
2. digital speed + "km/h";
3. "1/min x1000";
4. **OFF** if `rpm` is null or < 200, **otherwise the tacho scale's "0"** (addition, see §8);
5. **COLD** if `oil` < 40 and the engine runs;
6. stock only: the centre mode label and the centre gear letter;
7. the speed-limit sign (`s.limit` > 0);
8. the pump icon, range number + "km", clock `H:MM`;
9. `s.ccMessage` ? the check-control panel : the street name;
10. the temperature (`±x.x` + ° + C), the bottom-row mode label (connected only), and `assist.info_tacho` "i" (lamp).

- **Lamps:** `G20C.lamps` holds the 11 telltale/belt/airbag ids from `g20_comfort.json`, plus `tt.parking_brake.hold` and `assist.info_tacho`. The four housing LEDs are `housing.low_beam`, `housing.side_light`, `housing.check_engine` and `housing.dsc_off`. They have `onPanel: false` and are never drawn, because they sit outside the 1920×720 panel.
- **(P) colour:** the (P) is red when `tt.parking_brake` is set. It is green when only `tt.parking_brake.hold` is set.
- **Sprites:** icons are rendered once per colour into small offscreen canvases and then blitted. Their cut-outs use `destination-out`, which must never touch the bench canvas. A test over a green background found no holes.
- **Canvas state:** every call is wrapped in `save`/`restore`. The harness checks that `globalAlpha`, the composite operation and `shadowBlur` come back clean ("done clean").

## 4. Text styles (panel px; `T` in c.js)

| Run | Size | wght | Stretch | sx | Anchor | Baseline |
|---|---|---|---|---|---|---|
| range digits | 47 | 700 | semi-cond. | 0.975 | left 182.7 | 699.5 |
| range "km" | 33.3 | 600 | semi-cond. | 1.06 | after digits + 3.2 | 699.0 |
| clock | 47 | 700 | semi-cond. | 0.973 | centre 397 | 699.5 |
| temperature digits | 47 | 700 | semi-cond. | 0.975 | right 1624 | 700.0 |
| "°" / "C" | ring r 5, lw 2.8 at (1637.6, 679.6) / 35, 500 | | normal | 0.98 | left 1643 | 699.8 |
| street | 44 | 450 | semi-cond. | 0.953 | centre 961 | 699.8 |
| message lines 1 / 2 | 35.5 | 750 | semi-cond. | 0.985 | centre 969 | 644.8 / 690.8 |
| digital speed | 105.5 | 700 | semi-cond. | 1.027 | right 530.2 | 396.0 |
| "km/h" | 27.2 | 600 | semi-cond. | 1.13 | left 539.3 | 393.2 |
| mode label, centre | 31.5 | 700 | condensed | 1.055 | left 1222.4 | 366.8, +28 |
| mode label, bottom | 32.9 | 700 | condensed | 0.986 | left 1224.8 | 682.8, +28 |
| gear, centre | 106 | 700 | semi-cond. | P 0.874, D 1.028, R/N/S 0.95 | centre 1518.6 | 395 |
| gear, bottom | 49.3 | 750 | semi-cond. | P 1.03, D 1.21, R/N/S 1.12 | centre 1410.7 | 703 |
| "1/min", "x1000" | 34.5 | 600 | semi-cond. | 0.95 / 0.925 | left 1424 | 596.5 / 625.8 |
| OFF | 32.9 | 750 | semi-cond. | 0.99 | left 1514.4 | 603.8 |
| tacho "0" | 54.8 | 550 | normal | 1.087 | left 1518 | 613.5 |
| COLD | 31.5 | 750 | condensed | 0.892 | left 1841.9 | 657.8 |
| limit 2 / 3 digits | 35.6 / 33 | 420 | semi-cond. / cond. | 0.93 / 0.86 | centre 538.9 | 633.8 / 632.8 |
| AUTO H | 34.5 | 800 | condensed | 0.86 | left 1776.6 | 203.6 |

The text cannot match glyph for glyph, because it is a different font. What was compared per run is the ink box (position, cap height, width; this is the geometry column in §6) and the core colour.

## 5. Colours (measured; `COL` in c.js)

The "core" colour is the median of the brightest half of each element's ink. Night is measured on 08, day on 09.

| Element | Night (08) | Day (09) | Notes |
|---|---|---|---|
| White texts, digits, gear, OFF, message, "i" | 255,249,252 | 255,250,252 | Camera clips; the pink tint is the camera's white balance |
| Units "km", "°C" | 240,218,225 | 244,220,227 | Thin strokes read greyer |
| Mode label COMFORT PLUS | 220,200,206 | 228,202,206 | Genuinely greyer than the white texts (OFF at the same size reads 255) |
| "1/min x1000" | 240,215,220 | same | |
| "km/h" | 222,202,209 | same | |
| COLD | 235,224,228 | same | Measured on 14 |
| Pump icon | 240,216,223 | 249,215,224 | |
| Brake / steering / red (P) | 244,106,88 | same | Red-orange, hue ~10° |
| TPMS / ABS / DSC | 250,184,100 | same | 08 only |
| AUTO H | 126,216,80 | 128,226,82 | 14: 142,221,111 |
| Green (P) | (not lit in 08) | 126,243,62 | 14: 109,223,52 |
| Belts | 234,66,82 | same | 08; driver belt in 14: 212,50,67 |
| Airbag | 238,55,74 | same | 08 only |
| Limit sign: ring / disc / number | 233,37,62 / 254,241,246 / 52,42,47 | disc 254,244,248 | |
| Check-control frame / fill | 248,220,223 / gradient 88,72,82 at y 606 to 10,12,21 at y 720, faded to the background at x 700–800 and 1140–1222 | (not seen by day) | 08 only |

- **Day vs night:** no measurable difference in any icon or text between 08 and 09, which are 7 minutes apart. The camera's auto exposure normalises them. The day look therefore uses 09's values where the element is lit in 09, otherwise the night value (weak).
- **Is 14 night?** Its clock reads 10:15 and its backgrounds are brighter than 08's (bg 27–33 vs 9–15). The colours of our elements in 14 match 08/09 within noise, so the photos cannot settle it. The harness renders 14 with the night (default) look.
- **Halo:** at 2–3 px outside the ink, the lamps are only +6…+10 levels brighter than the white texts. In the texts that spread is pure camera blur. The halo is therefore faint: canvas shadow, blur 5, alpha 0.28, lamps only (weak).
- **Unlit look:** nothing is drawn. In 09 and 14 every unlit lamp spot measures equal to the background (core − bg < 3 levels).

## 6. QC

**Method.** `harness.html` draws `G20C` alone over black at 1920×720 in three states:
- 08: stock, night, startup preset, message, 50 sign, P, OFF;
- 09: stock, day, AUTO H + green (P), street, D, idle;
- 14: connected, AUTO H + green (P) + driver belt, 30, COLD, bottom-row COMFORT PLUS and P.

Headless Chrome (port 8092, own user-data-dir) takes the screenshots, and `qc_c.py` compares each element's ROI (bbox + 4 px) with the rect using `qc.metrics` (SSIM on luma, mean ΔE2000):
- **box:** the whole ROI;
- **ink:** both inks dilated by 3 px;
- **psf:** as ink, after blurring *our* crop with the camera blur fitted per photo (σ 1.2 px for 08/09, 1.8 for 14). This only separates shape errors from the photo's blur. The bench draws the crisp render.

**Geometry** is the ink box (half-max of the element's channel) ours − photo per edge. The review sheets are in `bake/work/g20sim/C/qc/` (reference | ours | diff, 4×).

Group means:

| Group | SSIM box | ΔE box | SSIM ink | ΔE ink | SSIM psf | ΔE psf | Mean of max geometry error (px) |
|---|---|---|---|---|---|---|---|
| Telltales (11) | 0.40 | 18.1 | 0.47 | 19.3 | 0.54 | 15.7 | 1.6 |
| Bottom row (17) | 0.33 | 13.8 | 0.44 | 16.8 | 0.57 | 13.2 | 3.4* |
| Assist / message (21) | 0.42 | 14.4 | 0.53 | 15.4 | 0.65 | 12.5 | 3.8* |

\* These means include the outliers explained below. They are other things inside the photo's ROI, not our errors.

**Every SSIM is below 0.85, for these reasons:**
1. **Camera blur and bloom.** The photos are soft: σ 1.2–1.8 px plus bloom around every bright stroke. Ours is a crisp LCD-like render. Matching the blur alone raises SSIM by 0.1–0.35 (psf column), and the bottom-row P reaches 0.90.
2. **Background.** The photo's ROI holds the dial faces, map roads, the red pointer glow (OFF, "1/min x1000": ΔE 20–30) and the dark-blue panel tint. Ours is black: G20C is drawn alone, and B's and D's layers are not in this comparison.
3. **Other font.** Roboto is not BMW Type Next. Per-glyph phase errors of 1–2 px in a 35 px glyph cost a lot of SSIM even with the right box ("1/min x1000" 0.48, temperature 0.32–0.52).
4. **Photo 14 is coarse** (±2–3 px per g20_comfort.json) and much softer (σ 1.8). Its AUTO H and (P) SSIM is ~0, which is a 3–4 px registration offset of a thin glyph: the same drawing scores 0.52–0.78 on 08 and 09.
5. **Airbag (0.15).** The pictogram is redrawn approximately: a reclined figure with an oval, an "X" of torso and leg bars, and two belt gaps. Its fine internal gaps are not resolved in 08. It is marked medium in the manifest.

**Geometry check.** On 08 and 09 every element is within 2 px except these:
- `bottom.airbag` x1 +3;
- `assist.rpm_label` 08 x1 −3 (but 09 +1: the two photos disagree by 4 px on the same text);
- `assist.speed_limit` x ±4: the stock bottom frame line (B's) runs through the sign's ROI and widens the photo's ink. The ring alone is centred (539.3, 621.8), r 41;
- `assist.cc_panel` x1 −36: the photo ink includes B's tacho line starting at x 1222. Our frame ends at 1215, as in 08;
- `assist.mode_label_centre` 08 y ±4: a map road crosses the label in 08. On 09 it is 0,0,1,0;
- `assist.digital_speed` 09 (3/−4): map roads in the ROI. On 08 and 14 it is ≤ 1.

On 14 the misses are 3–4 px (AUTO H, (P), driver belt, rpm label, range +3), within the rect's ±2–3 px. `bottom.street` 14 x1 −28 comes from our 0.7.2 text inside the ROI; the street text itself ends at 1102 vs 1104.

Full table: `bake/work/g20sim/C/qc/qc_table.md`. Selected rows (ink and psf):

| Element | Photo | Geometry d | SSIM ink / psf | ΔE ink / psf |
|---|---|---|---|---|
| tt.brake | 08 | 0,0,0,−1 | 0.58 / 0.65 | 14.0 / 12.2 |
| tt.tpms | 08 | 1,−1,−1,−1 | 0.53 / 0.66 | 15.1 / 12.9 |
| tt.parking_brake (green) | 09 | 0,−1,−1,−1 | 0.63 / 0.78 | 15.1 / 10.7 |
| bottom.clock | 08 | 0,−1,0,1 | 0.64 / 0.76 | 11.2 / 9.3 |
| bottom.street | 09 | 0,−1,−1,1 | 0.56 / 0.70 | 17.2 / 14.6 |
| bottom.cc_info | 08 | 0,0,0,0 | 0.79 / 0.87 | 9.0 / 7.4 |
| assist.cc_panel (box) | 08 | see above | box 0.69 | box 7.7 |
| assist.gear_centre | 09 | 0,0,0,0 | 0.72 / 0.81 | 7.4 / 5.7 |
| assist.gear | 14 | 0,−1,1,0 | 0.57 / 0.90 | 13.0 / 6.4 |
| assist.cold | 14 | 0,0,0,0 | 0.53 / 0.81 | 15.5 / 10.1 |

## 7. Evidence per element

| Element | Evidence | Basis |
|---|---|---|
| Telltales brake, TPMS, ABS, DSC, steering; rear belts | Strong | Lit look from 08 only; unlit = nothing (09, 14) |
| Airbag | Medium | 08 only; approximate redraw |
| AUTO H | Strong | 08, 09, 14 |
| (P) red / green | Strong | 08, 12, 13 / 09, 10, 14 |
| Driver belt | Strong | 08, 14 (+10–12) |
| Range, clock, temperature, street | Strong | Positions and styles from 08, 09, 14 |
| Range left-aligned, clock centred, temperature right-aligned | Weak | Only 3-digit ranges, 2-digit hours and "+x.x" were seen |
| Minus sign of the temperature; one-digit hours; long street names (squeezed to 520 px) | None | Not seen |
| Street size | Medium | 09 and 14 disagree by ~10 % in cap height (14 smaller); 09 (stock, sharper) is used |
| Digital speed "0" | Strong | 08, 09, 14 |
| Digital speed growing left of a fixed right edge | Weak | Inferred; only "0" seen |
| "1/min x1000" | Strong | 08, 09, 14 |
| OFF | Weak | 08 only; rule `rpm` null or < 200 is ours |
| Tacho "0" | Medium | 09, 14 |
| COLD | Medium for look (14, 10), weak for the rule | `oil` < 40 and engine on is ours; in 08 (engine off) it is not shown |
| Mode label COMFORT PLUS, centre and bottom | Strong | 08, 09 / 14 (+10) |
| SPORT / ECO PRO texts and layout | None | Drawn as one line, same style |
| Gear letters P, D centre; P bottom | Strong | 08, 09 / 14 |
| R, N, S widths; D in the bottom row | Weak | D's bottom width is extrapolated from the centre's P/D ratio |
| Speed-limit 50 and 30 | Strong | 08, 09, 14 |
| Speed-limit three-digit set (100–130) | None | Condensed, sx 0.86 |
| Check-control panel, "i", "ready" text | Strong for geometry | 08 only; other messages none |
| Panel's day look | None | |
| Panel hiding the stock bottom line's ends (x 695–1224) | Strong | 08 vs 09 |
| `assist.info_tacho` "i" | None for its trigger | A bench lamp, lit in the startup preset as in 08 |
| Lamp halo | Weak | |
| Day look | Weak | Equal to night within camera noise |

## 8. Open points and deviations

1. **The tacho scale's "0" is drawn by C, not B.** In 08 BMW's OFF replaces it; in 09 and 14 the "0" is there. B must not bake a "0" at (1513–1553, 572–615).
2. **The check-control panel paints an opaque base** (the measured background, 9,12,22 by night) over x 695–1224, y ≥ 603. In 08 the stock bottom line's curved ends are not drawn while the panel shows, and this hides B's line ends. It assumes B's background there is close to that colour. If B's vignette differs, the lead may want B to supply that colour, or a panel-free variant of the line.
3. **`text/text.js` is folded into `c.js`.** There is one style table, `G20C.STYLE`.
4. **`icons/` holds only the manifest part.** The icons are vector code in c.js. No SVG or PNG files are shipped.
5. **Additions to the contract:** `G20C.PRESET_EXTRAS` and `G20C.STYLE`. Lamps carry `onPanel`. Four `housing.*` lamp ids exist only for the panel UI.
6. **Not done:** a per-glyph match to BMW Type Next (impossible with a free font), and the airbag pictogram's fine detail.
7. **For the owner's photo protocol:**
   - any SPORT / ECO PRO frame;
   - a three-digit limit sign;
   - a negative temperature;
   - a one-digit hour;
   - another check-control message;
   - the engine running with cold oil in the stock layout.

   Each would replace a weak or none entry above.
