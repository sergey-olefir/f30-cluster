# Twin Dial — specification (rev 2, for round 2)

The new cluster app `twin_dial`: a facelift twin-round-dial cockpit drawn on the G20's 1920 × 720 panel, tachometer
left, speedometer right. Rev 1 joined the seven round-1 reports (`docs/twin-dial/V?-REPORT.md`); rev 2 adds the
owner's decisions of 2026-11-17, the corrections the mockup exposed, and everything round 2 needs to build, bake,
test and install the app without asking again.

**How to read it.** Every number is in panel px (x right, y down, 1920 × 720) unless it says R (dial units, §3.1).
The named JSON files hold the evidence; this file wins where they disagree (§20 lists every override). Status words:
**verified** = measured or computed; **owner** = the owner's decision (2026-11-17); **hypothesis** = needs the bench
or the car; **deferred** = decided not to do in round 2. The mockup (`tools/twin-dial/mockup/mockup.py`, output in
`bake/work/twin-dial/mockup/`, git-ignored) draws this spec and is the visual reference for round 2 — the owner
approved its look ("макети дуже круті").

---

## 0. Owner decisions (2026-11-17)

| # | Question | Decision |
|---|---|---|
| D1 | Sweep | **±125° for both dials** |
| D2 | Inner disc rim | **as reference 02**: 0.545 R, width 0.016 R |
| D3 | Red zone | **04's solid wedge on 02's band** |
| D4 | Band texture | **none** |
| D5 | Needle | **white** |
| D6 | Our check-control message | **ours, as mockup 3**: the bottom plate (M2) in the bottom row's place |
| D7 | Stricter message rule | **accepted, revisited later**: we never draw over BMW's panel until the car confirms "shown now" |
| D8 | Centre pages | **date/clock and trip computer, switchable, as mockups 1 and 2** |
| D9 | Rev strip under the tachometer | **dropped; the fuel bar takes its place, as in the mockups** |
| D10 | Gear letters | **draw everything ourselves, covering BMW's** — as a later experiment (§17.3); round 2 ships with BMW's letter visible in the gear gap |
| — | Black-box hypothesis | **deferred** ("пізніше"): no box experiment in round 2 |
| — | App name / icon | working name **Twin Dial**, glyph "TD", no maker name or mark anywhere |
| — | Speedometer numerals | **thinned a little** (§5.3) |
| — | More references | **none for now**: night, warning and reduced view stay our interpretation (§2) |

---

## 1. Scope

**In round 2:** a separate app `apps/twin_dial` (own id, own settings, installed beside f30_cluster, never both
drawing at once — §14.5); the two dials, the frame, two centre pages, the bottom row, our check-control message with
the fallback window, day and night looks, the bench simulation, tests, the state gallery, one car install.

**Not in round 2:** BMW's map in the centre, car picture with doors, media page, guidance page, the stalk button,
the stored-message marker, battery voltage, covering BMW's gear letter, any black-box experiment, any write to the car,
M view or sport looks, mph scales (the speedometer is km/h only; mph is a later variant — §18).

**Never:** a maker's name, logo, font or bitmap; BMW's symbol bitmaps (`requestDefaultSymbols`) baked, logged or
committed; `KombiIF.standardCCMessage` / `extendedCCMessage` or any setter; killing an app process; hiding a BMW
warning without our own text for that exact message on screen in the same frame.

---

## 2. References (VR)

- Five references, `reference/vc/01`–`05` (git-ignored, never committed). Facelift: **02** (real car, phone, the
  geometry master, 0.35 px rms), **04** (aftermarket bench unit: tachometer face, wedge, reds), **05** (seller render:
  colour levels). Classic 01 and 03 are cross-checks only.
- Rectified frames at R = 400 px: `bake/work/twin-dial/pub/VR/`; numbers: `design/twin-dial/vr/references.json`.
- **Gaps (owner: no more references for now):** only two tachometer frames, both about 107 source px per R; no night,
  warning or reduced-view frame of the facelift. Those states are designed by analogy and marked hypothesis.
- **Lesson from rev 1:** every "hypothesis — by eye" in the reports is a question to the references, not a fact. The
  grey "feet" (VD) were one and are withdrawn (§20). Round 2 checks any by-eye element against the rectified frames
  before drawing it.

---

## 3. Units, coordinates, layout (VG)

### 3.1 Dial units

- **R** = the centre line of the thin outer white bezel ring. **R = 300 px.**
- Angles: degrees **clockwise from 12 o'clock**; negative = anticlockwise. (x, y) offsets in R from the dial centre,
  y down.
- Frame units (VF): u, v in R from the midpoint M = (960, 400); x = 960 + 300 u, y = 400 + 300 v.

### 3.2 Placement (verified fit; `design/twin-dial/vg/layout.json`)

| Item | Value |
|---|---|
| Tachometer centre | **(380, 400)** |
| Speedometer centre | **(1540, 400)** |
| Centre distance | 1160 px = 3.867 R (02: 3.875) |
| Ring outer edge | 303.9 px |
| Ring ends | ±144°, foot at y 645.9 |

The dials are ~9 % smaller and 30 px lower than the references' proportion: at the references' size BMW's side
lamps fall inside the dials. Tightest clearances: auto-hold lamp 3.7 px (right ring), ABS lamp 4.3 px (left ring).

### 3.3 Keep-outs (every state, every frame)

| Item | Rect / rule | Treatment |
|---|---|---|
| BMW's belt + airbag group | [497, 660, 688, 720] | see-through hole in our background; nothing of ours inside |
| Gear-letter gap | [1380, 660, 1460, 720] | **no layer rectangle of ours intersects it** (background split in three, §13) |
| BMW's side lamps (7) | `layout.json` `keep_outs.telltales_holes.rects_plus_3px` (box + 3 px) | see-through holes; nothing of ours inside |
| Dial furniture rule | nothing of a dial below y 657 where x ∈ 494–691 or 1377–1463 | checked by `test-twin-layout.js` |
| Hood (`shared/visible.js`) | ≥ 4 px under the hood line | everything of ours |
| BMW's message panel | `zc.panel` dilated 3 px (VF `message_panel.json` `fallback_window.polygon_px`, bbox [696, 595.75, 1226, 704]) | covered by our bottom row / plate; fallback window (§8) |
| BMW's stored-message marker | [1240, 588, 1288, 630] | covered (D7) until a signal for it is confirmed |
| Telltale strip above the tab bar | [564, 58, 981, 115] | stays black: BMW's lamps on the G20 are at the sides |

---

## 4. The dial, common to both (VD; `design/twin-dial/vd/dials.json`)

| Element | Value (R) | Status |
|---|---|---|
| Bezel ring | r 1.000, width 0.021, white; open at the bottom between +144° and −144° (through 180°) | verified |
| Dark gap band → bezel | 0.940–0.989, black | verified |
| Tick strip (lighter annulus) | 0.893–0.940 | verified |
| Grey scale band | 0.580–0.940, from −144° to +144°: it runs past both scale ends to the bezel ends and **ends in a radial cut; nothing below** | verified (02, 04) |
| Gap rim → band | 0.553–0.578, black | verified |
| Inner disc rim (D2) | r 0.545, width 0.016, white, full circle except where hub content needs it (none in rev 2) | owner |
| Inner disc | black, no vignette | verified |
| Major line across the band | 0.580–0.893, near black (6, 6, 8), width 0.006 | span verified, width hypothesis |
| Minor tick | 0.896–0.934, width 0.012, white | verified |
| Major tick | 0.896–0.934, width 0.018, white | verified |
| Sweep (D1) | scale from −125° to +125° | owner |
| Needle (D5) | white, straight, no cap, no glow; profile (ρ, width): (0.465, 0.030) (0.56, 0.039) (0.68, 0.032) (0.77, 0.022) (0.86, 0.020) (0.89, 0.016) (0.99, 0.004) | verified (02) |
| Needle shadow | the band × 0.85 out to 0.05 R either side of the needle | hypothesis; bench decides, may be dropped |
| Texture (D4) | none | owner |

**Needle motion:** the same smoothing as f30_cluster's smooth needles (0.7.14, `shared/hud.js`), always on in
twin_dial. **Rest:** with no valid value the needle rests at the scale's 0 (speedometer) / the "OFF" position
(tachometer, §5.2). Values above the scale end clamp at +125°.

---

## 5. The two dials

### 5.1 Tachometer (left)

- **Law:** 0–8 × 1000 rpm, linear, 0 at −125°, 8 at +125° (31.25° per 1000).
- **Ticks:** majors at every 1000 (0–8), one minor at every 500.
- **Numerals:** 1–8 (no 0), Saira, bake 57 px (cap 0.135 R), centre ρ 0.745, upright, on the value angle;
  numerals on the wedge red.
- **Red wedge (D3):** from the **redline** (setting, default 6500 rpm) to 8000; ρ 0.550–0.940, radial edges; fill
  `#4E020B` area (VC: linear 0.077 of red; raise to ~0.15 of red if it reads purple on the panel's blue black floor —
  bench/car), outline red `#DA1030` ~3 px; ticks inside the wedge red. Ticks at or after the redline and numerals
  from 7 red (7 and 8 at the default; the rule: a numeral is red when its value ≥ the redline rounded up to 1000).
- **"OFF" label:** Saira 22 px (dial label), at (−0.56, +0.58) R — in the band's lower-left end, below scale 0. The
  needle rests at −135° (inside the band's end, on "OFF") while the engine is not running. hypothesis (02's
  powermeter has OFF there; 04's tachometer shows the same place).
- **Hub:**
  - **READY** (green `#3C9B22`, Saira 22) at (0, −0.20) R, shown while the car is ready to drive
    (VehicleCondition 10); otherwise absent.
  - **Unit label** "1/хв × 1000" (Noto Sans 20, grey 227) at (0, −0.04) R. Not the curved label of 04: it would
    cross the belt group.
  - **Gear** (Saira 64, cap 0.147 R) at (−0.02, +0.39) R: P R N D, D with the gear number in automatic manual mode
    ("D3"), M1…M8 / S1…S8 as the car reports; "–" when unknown.
  - **Drive program** (Saira 22) at (+0.02, +0.56) R: COMFORT / SPORT / SPORT+ / ECO PRO / ADAPTIVE (Latin, our own
    labels from the drive-mode enum); absent when unknown.
- **Fuel bar (D9)** under the dial, where 02 had the rev strip: y +0.73 R (= 619), x −0.42…+0.42 R, thickness 0.025 R,
  **5 segments** with 4 px gaps; empty segments (46, 47, 50); filled white, partial segment filled proportionally;
  the **first segment red** when the car reports reserve (`statusFluidLevelFuelTankSpare` = active) — otherwise white.
  End labels "0" and "1/1" (Noto 21) at (∓0.35, +0.68) R; pump icon `td_fuel_side` 32 px at (0, +0.645) R.
  Fill = litres / tank capacity; capacity a constant in `app.json` config (`tankLitres`, default 59 — the owner confirms
  the car's tank). No valid fuel → all segments empty, no red.

### 5.2 Speedometer (right)

- **Law (verified on 02):** 0 at −125°, 100 at 0°, 300 at +125°; 25° per major mark; 20 km/h per major up to 100,
  40 km/h above (piecewise linear).
- **Ticks:** majors at 0 20 40 60 80 100 140 180 220 260 300; 4 minors per major (every 5 km/h below 100, every 10
  above).
- **Hub:** digital speed (Saira 92, figure 0.217 R) at (0, +0.03) R; unit "км/год" (Noto 21) at (0, +0.24) R.
  Speed: the same field and conversion as f30_cluster's digital speed, integer; "–" with no value.
- **Coolant bar** under the dial: same geometry as the fuel bar; ends "C" and "H"; icon `cc_coolant` 32 px.
  Fill: 50 °C → empty, 130 °C → full, linear (hypothesis; the car's own verdict `engineTemperatureEvaluated` can
  replace it after probe P6); last segment red when ≥ 120 °C.

### 5.3 Speedometer numerals, thinned (owner)

| Set | Values | Face, size | Centre ρ |
|---|---|---|---|
| Large | 0 20 40 60 80 100 140 180 220 260 300 | Saira, bake 28 px (figure 0.067 R) | 0.76 |
| Small | 10 30 50 70 160 200 240 280 | Saira, bake **18 px** (VT's own "160", 0.046 R; was 23) | **0.78** (was 0.775) |

**90 and 120 are dropped**: they crowd 100 at the top. Rule checked at bake time and in `test-twin-layout.js`: every
numeral's ink box keeps ≥ 4 px of black to every other numeral, tick and the needle's rest position.

---

## 6. The frame (VF; `design/twin-dial/vf/frame_spec.json`)

### 6.1 Tab bar

- Rect [618, 127, 1302, 172]. Vertical grey ramp, linear light 0.002 (top) → 0.16 (bottom), neutral. White rule
  (0.85) under it, y 171.2–172.7. No outline round the bar.
- **Separators** at x 744, 812, 1168, 1237: a dark 1-px gap, then a light 1-px line (96) at the next cell's left.
- **Cells and content** (icon 38 × 38 centred at y 143; text baseline 156):

| Cell | x | Content | Source | Empty state |
|---|---|---|---|---|
| Range | 618–744 | `td_fuel` icon at x 636, value (Noto 31) + "км" (Noto 19) | `range` | "– км" |
| Warning | 744–812 | `cc_warn` icon at x 778 | a message shows | icon only, cell unlit |
| Media | 812–1168 | `td_radio` / `td_media` icon at x 905, text (Noto 33) from x 925, clipped with "…" at x 1160 | **unseen (P8)** | icon only, no text |
| Phone | 1168–1237 | `td_phone` at x 1202 | **unseen (P9)** | icon, dim (0.5) |
| Navigation | 1237–1302 | `td_nav` at x 1270 | `guidingState` (arrives) | icon, dim (0.5) when not guided |

- **Highlight:** while a message shows, the warning cell is filled flat with the severity colour (§8.2) from the cell
  top to the rule, and the rule under it takes the same colour. Icon stays white (black on amber).
- Round 2 draws the media text only once P8 shows the field; until then the cell is icon only. Media text is never
  logged (length only).

### 6.2 Centre window and pages (D8)

- Window [729, 172, 1191, 613], no border. Page grammar: **title** centred at y 270 (Noto 41, box y 251–289), **rule**
  y 296, x 741–1180, 1.5 px, 0.80; **body** y 296–565; content within x 729–1191 (u ±0.77).
- **Page "clock"** (mockup 1): title "Дата і час"; time (Saira 92) centred at (960, 372); weekday (Noto 39) at y 450,
  lower case Ukrainian ("вівторок"); date "DD.MM.YYYY" (Noto 39) at y 505. Time and date are the local time
  f30_cluster already derives (`timeDateUTC` + zone, fallback `statusShowTimeDate` — `config.clockLocal`); the weekday
  is computed from the local date. 24-hour clock. No time → "––:––", no date line.
- **Page "trip"** (mockup 2): title "Поїздка"; two rows, two columns, numbers right-aligned at x 905 and 1105, units
  hang 6 px after (Noto 39 / 21), baselines 362 and 430:
  - row 1: "ø 6.8 л/100 км" · "ø 41 км/год" (average consumption, average speed);
  - row 2: "12.4 км" · "0:43 год" (distance, driving time);
  - footer (Noto 31, grey 227) at y 520: "від початку поїздки, 14:00" (departure time). No reset hint: we never reset.
  - Source: `statusBordcomputerAverage` / `TravelData` / `TravelStart` (**unseen**, probe P4). Which of BC1/BC2 is
    "since start" and the factors come from P4. **Until P4 has proven the fields, the page shows "–" for each value
    and the switch still offers it** (owner sees what is missing); after P4 the factors go into config, not code.
- **Switching** (D8 "switch as in mockups 1 and 2"): a setting `centre` = `clock` | `trip` | `cycle`. `cycle` (default)
  holds each page 10 s while the car stands and keeps the last page while driving (no page change above 5 km/h — a
  moving page is a distraction). The stalk button is not a signal we have (probe P11); if P11 finds one, it replaces
  `cycle` in a later round. Page change = hard cut: the centre sheet (one page, 540 × 400) is repainted, as it is
  every minute for the clock anyway. Packing both pages in one sheet would cost +1.65 MiB and break the 6 MiB rule.

### 6.3 Bottom row (rest state)

- Rule y 613 (x 629–1292, 2.2 px, 0.80). Two lines, baselines 656 and 703; numbers Noto 40, right-aligned; units Noto
  21, 5 px after the number, on its baseline.
- Left column ends x 846: L1 **odometer** "48 215 км" (thin space as thousands separator); L2 **clock** "14:43".
- Right column ends x 1153: R1 **trip distance** "412.6 км" (02's slot) once P4 proves the field, until then the
  **range** (arrives); R2 **outside temperature** "+7.5 °C" (sign always shown, one decimal).
- Odometer from `statusRangeTankStatus.mileageKilometre` (struct arrives, member unread — P3); until P3 confirms the
  factor, the odometer slot shows the value with the factor 1 km and the log line proves it on the first drive.
  Invalid → "–".
- The whole row lies inside BMW's panel footprint: it **is** a "cc:" layer that steps aside for the fallback window
  (§8.4).

---

## 7. Colour, day and night (VC; `design/twin-dial/vc/palette.json`)

### 7.1 Day

| Material | sRGB (target) | Note |
|---|---|---|
| White: numerals, bezel, rim, ticks, needle, text | 255 | |
| Tick strip | 135 137 142 (L ≈ 0.25) | hypothesis ×1.6 |
| Band | `Y = 0.010·exp(7.5(ρ−0.60))·exp(−0.85(cosθ−1))`, tint (0.96, 1.0, 1.08) | shape verified, level ×1.7: `bandGain` set on the car (§17.2) |
| Major line in the band | 6 6 8 | |
| Red | `#DA1030` (218 16 48) | wedge outline, red numerals/ticks, red segments |
| Wedge fill | 78 2 11 (0.11 of red) | raise toward 0.15 of red if it reads purple |
| Tab ramp | 0.002 → 0.16 linear | |
| Tab / bottom rules | 237 / 231 | |
| Warning highlight red | 176 10 37 | |
| Grey message cell (white/default) | 111 | the tab ramp's bottom |
| Amber (yellow/orange messages) | 240 170 10 | hypothesis: no reference; the mockup's value |
| Green (READY, green messages) | 60 155 34 | |
| Secondary text | 227 | |
| Background, hubs | 0 | |

Every value is sent with the G20 black-floor correction `srgb((L − F)/(1 − F))`, F = (0.12 %, 0.09 %, 0.56 %) —
`palette.json` holds the corrected codes.

### 7.2 Night (hypothesis — no reference exists)

No tint; a per-material multiplier in linear light on top of the car's own backlight dimming: white 0.80, bezel/rim
0.70, ticks 0.75, rules 0.70, tick strip 0.55, band 0.6 inner/mid → 0.55 outer → 0.5 lit ends, tab ramp 0.55, red 0.85,
wedge fill 0.8, green 0.75. Applied as one colour transform per layer (uniforms), **no layer rebuilt** — f30_cluster's
night-look mechanism. Source: `statusDayNightChangeOver` (arrives; 1 day, 2 night, 0 hold, 3 invalid → the sun, as
f30_cluster). Setting `nightLook` = auto | on | off.

---

## 8. Our check-control message (D6, D7; VF `message_panel.json` M2)

### 8.1 Geometry (mockups 3 and 4)

| Part | Value |
|---|---|
| Plate (opaque black, ours) | [694.5, 592, 1230, 720] — covers BMW's panel outline with ≥ 1.5 px everywhere |
| Rule | y 611–615 (4 px) in the severity colour, x 629–1291 (replaces the 2.2 px white rule) |
| Symbol cell | [702, 623.5, 768, 707.5], filled per severity |
| Symbol | 54 × 54, centred (735, 665.5); white, black on amber |
| Headline | Noto Sans 42 (cap 30 px), from x 783, max width 441 px; one line → baseline 680; two lines → 656 / 703; more → line 2 ends in "…" |
| Counter "n/m" | Noto 29, grey 227, right-aligned at x 1224 on line 2 (line 2 then ends at x 1182); only when the car gives a frame count (P1) |

### 8.2 Severity (from ccList `cCColor`)

| cCColor | Cell fill | Symbol | Rule + warning tab |
|---|---|---|---|
| RED 1 | red 176 10 37 | white | red |
| YELLOW 2, ORANGE 4 | amber | black | amber |
| GREEN 3 | green | white | green |
| WHITE 5, DEFAULT 0 | grey gradient cell (as a tab) | white | light grey 231 |

### 8.3 Text and symbol

- Text = ccList `cCShortName` (UTF-16, the car's language) for the shown id, drawn in Noto Sans (has the full car
  character set incl. U+02BC). Never logged (length only).
- Symbol by id from `design/twin-dial/vt/message_symbols.json` (community numbering, unverified on this car); any
  other id → generic by colour (red/yellow/orange → `cc_warn`, white/green/default → `cc_info`). A missing symbol
  never opens the window; a missing glyph does.
- BMW's bitmaps are never used, baked, logged or committed.

### 8.4 When ours shows, when BMW's shows (safety rule)

- **Which message:** only the one the cluster says it shows now (`statusActiveCCMessage` number, second witness
  `Vehicle2.statusDisplayedCCMessage`), matched to a ccList entry by id. ccList's stored entries are never drawn. We
  follow BMW's cycling (`statusMenuCCMessage` frame n of m drives the counter); we never cycle on our own.
- **D7 (owner: accepted, revisited later):** until the car has once delivered a "shown now" number that matched a
  ccList entry, **our plate is never drawn over BMW's panel**: whenever the ccList heuristic says a message may show,
  the fallback window opens and BMW's own panel is visible. (`config.ccActive.strict = true`.)
- **Fallback window:** `zc.panel` dilated 3 px, baked once as an R8 mask (~536 × 112), sampled by the background
  layer bgL — a see-through hole through every layer of ours inside it. The bottom-row sheet and the plate sheet are
  "cc:" layers and step aside **before** the window opens, so no frame shows half of BMW's panel under our text.
- **Open** from the signal handler (`_ccPush`), not the tick: ccList / active-number change → evaluate → texts step
  aside → window opens.
- **Close** only after our plate for that exact message (symbol + headline + line 2 in ONE paint) has been on screen
  ≥ `CC_SETTLE_MS` = 150 ms (`_ccPainted` / `_ccOnScreen`, keyed on the headline) — f30_cluster's `_ccOpen` path.
- **Keeps it open:** (1) message signals not readable yet; (2) D7: "shown now" never seen; (3) active number has no
  ccList entry; (4) empty name; (5) a glyph missing from the font (latched); (6) a throw while drawing (latched);
  (7) the message changed (new id or new words) and the new text is not yet on screen; (8) our sheet could not be
  made (pixel memory, asset refused).
- **Message ends** (number 0): the plate goes, the window shuts, then the bottom row returns — never a frame with
  neither ours nor BMW's in that area while a message is shown.
- **Enter/leave:** hard cut, no fade. The centre page is untouched.

---

## 9. Type (VT; `design/twin-dial/vt/typography.json`, `sizes.json`)

- **Saira** (SIL OFL 1.1), width 125, weight 550 (±50, settle on the bench): scale numerals, speed, gear, dial labels
  (READY, OFF, programs). **No Cyrillic** — it draws digits and our Latin labels only; a Cyrillic string never goes to
  Saira (test).
- **Saira stretch:** bake with a horizontal stretch of 1.06 (the references' zero is ~7 % wider); a `stretch` option
  in `tools/bake_fonts.py` `bake()`; the gallery compares 1.00 / 1.06.
- **Noto Sans** (SIL OFL 1.1), width 100, weight 500: everything else — titles, units, bottom row, tab text, page
  text, the message. Subset to `tools/bake_fonts.py` CAR_TEXT + Latin (Ukrainian, Russian, Belarusian, Latin accents,
  № « » „ " " – — … U+02BC), as was done for Roboto.

| Slot | Face | Bake px |
|---|---|---|
| Speedometer large / small numerals | Saira | 28 / **18** |
| Tachometer numerals | Saira | 57 |
| Digital speed | Saira | 92 |
| Clock on the clock page | Saira | 92 |
| Gear | Saira | 64 |
| Dial labels (READY, OFF, program) | Saira | 22 |
| Centre title | Noto | 41 |
| Centre values / weekday / date | Noto | 39 |
| Centre body, footer | Noto | 31 |
| Bottom row numbers | Noto | 40 |
| Tab text (range value / media) | Noto | 31 / 33 |
| Units, small labels, bar ends | Noto | 19–21 |
| Message headline / counter | Noto | 42 / 29 |

- Files: `Saira[wdth,wght].ttf`, `NotoSans[wdth,wght].ttf` (+ OFL.txt each) into `tools/fonts-src/`, licences in the
  app's NOTICE. Atlas budget ~0.8 MiB per full-text Noto size (1024 × 399 alpha, counted twice); digit-only Saira
  ≤ 1024 × 70.

---

## 10. Pictograms (VT; `design/twin-dial/vt/pictograms.js`)

25 of our own (MIT, `PROVENANCE.md`), `shared/icons.js` distance-function format, baked white + alpha:

- tab bar 38 × 38: `td_fuel`, `cc_warn`, `td_radio`, `td_media`, `td_phone`, `td_nav`;
- gauges 32 × 32: `td_fuel_side`, `cc_coolant`;
- message symbols 54 × 54: `cc_door`, `cc_belt`, `cc_brake`, `cc_tyre`, `cc_engine`, `cc_washer`, `cc_bonnet`,
  `cc_boot`, `cc_oil`, `cc_pedal`, `cc_service`, `cc_battery`, `cc_coolant`, generic `cc_warn`, `cc_info`;
- spare: `td_avg`, `td_settings`, `cc_warn_solid`, `cc_dot`.

Round-2 clean-up: export `stepDist` from `design/strip/pictograms/pictograms.js` and drop the copy in VT's file.

---

## 11. Signals (VS; `design/twin-dial/vs/signals.json`)

All read-only; `check_signals.py` must pass (every `r` with a non-zero getter id). Privacy: media text, call state and
road names are never logged except as lengths / enums. No `newCCMessage`, no `requestDefaultSymbols`, no setters.

| What | Interface . field → member | On this car | No value → |
|---|---|---|---|
| Speed (display) | as f30_cluster | arrives | needle at 0, "–" |
| rpm | as f30_cluster | arrives | needle at OFF |
| Gear, drive program | as f30_cluster | arrives | "–" / no program |
| Ready / engine | VehicleCondition | arrives (10 = ready) | READY off |
| Fuel, reserve, range | KombiIF.statusRangeTankStatus (255 / 4095 = none) | arrives | empty bar, "– км" |
| Odometer | same → `mileageKilometre` | struct arrives, member unread (P3) | "–" |
| Coolant | CDS.statusEngineTemperature (raw − 48 °C, 255 none) | arrives | empty bar |
| Outside temperature | as f30_cluster (ambient) | arrives | "–" |
| Clock, date | `timeDateUTC` + zone; fallback `statusShowTimeDate` | arrives | "––:––" |
| Day / night | Vehicle.statusDayNightChangeOver | arrives | the sun |
| Messages | KombiInterface_2.ccList; KombiIF.statusActiveCCMessage; Vehicle2.statusDisplayedCCMessage; KombiIF.statusMenuCCMessage | ccList arrives; the rest unseen (P1) | window open (D7) |
| Trip computer | KombiIF.statusBordcomputerAverage / TravelData / TravelStart | unseen (P4) | "–" |
| Units | EnvironmentalInformation.UnitBN2020 | unseen (P5) | km, km/h |
| Media (tab) | HmiMediaState.playerMetadata (instance HMI_CID 1), MediaSource | unseen (P8) | icon only |
| Phone (tab) | ConnectivityAggregator.aggregatedCallState | unseen (P9) | dim icon |
| Guidance (tab) | guidingState | arrives | dim icon |

The declared set is VS's 19 interfaces minus what round 2 does not draw (doors, battery, cluster view, next turn,
CheckControlMaster) — they stay in the probe build only (§17.1). Every unseen field is declared but nothing breaks
when it never arrives.

---

## 12. States and behaviour

| State | Dials | Centre | Bottom row | Tab bar |
|---|---|---|---|---|
| App start, no data | needles at rest, hub "–" | clock page, "––:––" | "–" | icons only |
| Ignition on, engine off | tach needle on OFF, speed 0 | as setting | live | live |
| Ready to drive | READY green | as setting | live | live |
| Driving | live | page held (no cycle > 5 km/h) | live | live |
| Message shown, ours drawable (after D7 confirmation) | live | unchanged | plate | warning cell lit |
| Message shown, not drawable / D7 not yet confirmed | live | unchanged | **BMW's panel through the window** | warning cell lit |
| Night | per §7.2 | same | same | same |
| Demo (setting) | the kit's demo drive; a 4 s needle sweep at start while standing | both pages | made-up steady values | made-up media text |

- **Units:** km/h and km only in round 2. If P5 says miles, the app logs it and keeps km (mph dial is a later variant).
- **Invalid values:** every signal's "none" value maps to "no value" (above); never a stale number older than 5 s on a
  moving value (speed, rpm), 60 s on slow ones (fuel, coolant, temperature).

---

## 13. Rendering, assets, budget (VG; `design/twin-dial/vg/budget.json`)

### 13.1 What is drawn how

| Part | How |
|---|---|
| Dial faces (band shading, tick strip, ticks, numerals, rim, bezel, OFF, bar end labels, bar frames, icons under the dials, unit labels) | **baked R8** face per dial (luma), coloured by region in the dial shader |
| Red wedge (from the redline), red numerals/ticks, bar fills, needle, shadow | **shader** `tdial` (uniforms: angle, redline, fuel, reserve, coolant, night) |
| Background, tab-bar ramp + separators + highlight, rules, lamp/belt holes, fallback window | **shader** `tdback` on three layers + one R8 panel mask |
| Digital speed, gear | GPU glyph text (ATEXT, shared/shaders.js) |
| Tab contents, centre pages (both packed), hub labels, bottom row, our plate | **image sheets** (hud.js packing, Noto/Saira atlases for car text) |

The R8 faces carry luma only; the region tint (white / band tint / red) comes from a second channel-free rule in the
shader (ρ, θ ranges from VD), so no RGBA face is needed. If VC's band tint cannot be made this way, the faces go RGBA8
(+5.3 MiB) — only with a measured reason.

### 13.2 Layers per connection

| Conn | Layers | Pixel memory |
|---|---|---|
| 0 | bgL [0, 0, 1380, 720], bgRT [1380, 0, 1920, 660], bgRB [1460, 660, 1920, 720], tacho [70, 90, 690, 660], speedo [1230, 90, 1850, 660], speed text | 1.48 MiB |
| 1 | gear text, tabs sheet 552 × 52, centre sheet 540 × 400 (the shown page), hub labels 300 × 60 | 2.04 MiB |
| 2 | bottom-row sheet 524 × 88, plate sheet 536 × 128 | 0.87 MiB |
| **All** | **12 of 24**; ≤ 5 assets per client | **4.4 MiB steady**, ≈ 7.8 MiB at a layout switch |

Rules: steady ≤ 6 MiB, peak ≤ 8 MiB (half the service's 16 MiB stays free); drop unused scene textures before making
new ones; every sampler2D bound (`_bindBlanks`); shader sources after `compact()`: `tdial` ≤ 8 KB, `tdback` ≤ 6 KB
(the KOMBI resets on big effect shaders; one look per source — day/night by uniforms, never two looks in one source);
`highp` for any panel-px length > 256 (fp16 `mediump` overflows); ≤ 32 uniforms per effect layer. The speedometer
layer's rectangle ends at y 660 so nothing of ours touches the gear gap.

### 13.3 Bake pipeline

1. `design/gen_twin.py` → `apps/twin_dial/hud/layouts/twin.json` from `vg/layout.json` + `vd/dials.json` +
   `vf/frame_spec.json` + this spec's overrides (gen_6wb pattern, `base_at` baselines).
2. `tools/twin-dial/bake_face.py` → `face_tacho.r8`, `face_speedo.r8` (616 × 560 each, drawn at 3× and reduced,
   like the mockup; our own drawing from the numbers; numerals from the OFL fonts; the thinned set of §5.3 with its
   clearance check).
3. `tools/strip/bake_mask.py` "msg" lane code → `panel_mask.r8` (the fallback window).
4. `tools/bake_fonts.py` `twin_dial` list → atlases (Saira 1.06 stretch; Noto CAR_TEXT subset).
5. Pictograms: VT's baked PNGs (already in the repo).
Every baked file is reproducible from the repo (no reference image is an input to a bake).

---

## 14. The app `apps/twin_dial`

### 14.1 Files

- `app.json`, `main.js` (MGU App Kit layout), `hud/layouts/twin.json` (generated), baked assets, NOTICE (Saira, Noto
  Sans OFL).
- `shared/`: reused unchanged — `hud.js`, `hud_text.js`, `hud_data.js`, `layouts.js`, `shaders.js`, `icons.js`,
  `cluster_render_client.js`, `visible.js`, `sun.js`, `sensors.js`, `screen.js`, `menu.js`, `gallery.js`,
  `previews.js`. New in `shared/`: shaders `tdial`, `tdback` (in `shaders.js`, beside the 6WB ones) and hud.js widget
  types `tdial`, `tdback`, plus a `panel` concept (a centre page = a named group of widgets with
  `toggle: "centre=<name>"`). Changes to `shared/` must leave f30_cluster's tests green.

### 14.2 app.json

```json
{ "id": "twin_dial", "title": "Twin Dial", "version": "0.1.0", "vendor": "custom", "loggingId": "OATD",
  "iconGlyph": "TD",
  "config": { "target": "panel", "tankLitres": 59, "ccList": "<as f30_cluster>",
              "ccActive": "<as f30_cluster 0.7.20, plus \"strict\": true>",
              "ccDisplayed": "Vehicle2.statusDisplayedCCMessage", "clock": "<as f30_cluster>",
              "clockLocal": "<as f30_cluster>", "trip": { "factors": null } } }
```

### 14.3 Settings (centre screen)

| Setting | Values | Default |
|---|---|---|
| `centre` | clock / trip / cycle | cycle |
| `redline` | 5000–7500 rpm, step 250 | 6500 |
| `nightLook` | auto / on / off | auto |
| `bandGain` | 0.6–1.7 (band and strip level, §7.1) | 1.0 |
| `demo` | on / off | off |

### 14.4 Log (`/var/opt/public/oap/oap_<uid>/data/twin_dial.log`; the uid is assigned at install — read it from the car, as 12211 is f30_cluster's)

Numbers and enums only; text as lengths. Lines round 2 must emit: start + version; every message evaluation
(`cc: id N colour C name len L shown-now S → ours|window (reason)`); the D7 latch (`cc: shown-now confirmed`);
P3/P4 raw values on first arrival; day/night; layer/asset/pixel-memory totals after each build.

### 14.5 Coexistence with f30_cluster

Both apps target the panel. Only one may draw: twin_dial's menu says so; installing twin_dial does not touch
f30_cluster. How the owner switches (the Store's disable, or an on/off in each app's
settings) is settled in T4: round 2 checks what f30_cluster offers today and adds an "off" setting to twin_dial if
needed. Hypothesis to prove on the bench: an app that is off holds no layers or assets, so the two never add up past
24 layers / 16 MiB.

---

## 15. Safety (VG §5)

| Item | Treatment | Proof |
|---|---|---|
| Belt + airbag group | hole in every state | `test-twin-layout.js`, pixel audit |
| Gear letter | BMW's, drawn over us in the gap; no rect of ours intersects it | budget rects, test |
| Side lamps (7) | holes = box + 3 px | test |
| BMW's message panel | our plate or the fallback window, never neither | `test-twin-cc.js` |
| BMW's black box | not provoked (gap kept) | car photo after a layout switch and a drive-mode switch |
| Before driving | start the car with the belt unbuckled and a door open: BMW's belt lamp and the door message (ours or BMW's) must show | car check §17.2 |

---

## 16. Bench, tests, gallery

- `node bench/server.js twin_dial` (G20 simulation draws BMW's lamps, belt, gear letter and panel beneath/over us).
- New tests:
  - `test-twin-layout.js`: every widget clears `visible.check`, keep-outs, furniture rule, numeral clearance (§5.3),
    no layer rect in the gear gap, no Cyrillic string set in Saira.
  - `test-twin-budget.js`: ≤ 8 layers per connection, ≤ 6 MiB steady, ≤ 8 MiB peak on the bench's 16 MiB
    enforcement, shader sizes ≤ targets, every sampler bound.
  - `test-twin-cc.js`: VG §5.4 cases 1–9 (blind start; ccList without active number → window, never ours (D7);
    active N named → window opens in N's frame, closes ≥ 150 ms after our paint; no entry / empty name / missing glyph
    / throw → open and latched; N → M; end; sheet refused; layout switch and day/night with a message; pixel audit).
  - `test-twin-pages.js`: clock/trip/cycle switching, no cycle while moving, "–" fallbacks.
  - Existing `test-fonts.js`, `test-daynight.js` on the new layout; all f30_cluster suites stay green.
- Gallery (`tools/shots/`): {day, night} × {no message, message ours, message window, blind} × {clock, trip} ×
  {engine off, ready, driving} + demo; compared side by side with the mockup.

---

## 17. Car

### 17.1 Probe build (log-only; owner approval needed when the car is online)

One build of twin_dial with `probe` on: subscribes VS's P1–P12 fields read-only and logs raw values (numbers,
lengths). Actions: open/close a door, two messages (P1, P2); compare odometer (P3); compare with the iDrive trip
page (P4); read units (P5); cold start (P6); doors, boot, bonnet (P7); FM/USB/CarPlay (P8); a call (P9); engine
off/on (P10); stalk button through all pages (P11); a guided route (P12). Results go into config (factors, ids), not
code. **The black-box experiment is not part of it (deferred).**

### 17.2 First install checks

Install via the Store (separate app); f30_cluster off. Check: belt lamp and side lamps visible; door message → BMW's
panel through the window (D7 not yet confirmed) and the log line; after the first confirmed "shown now", the next door
message shows our plate; day/night switch; layout and drive-mode switches → no black box (photo); set `bandGain` from
one fixed-exposure photo against the bench render (compare mid-tones only — the phone clips whites); the wedge fill
does not read purple.

### 17.3 Deferred experiments

- **D10, covering BMW's gear letter:** a setting `gearCover` (off): our gear letter at BMW's place, the gap closed.
  Run only together with the black-box experiment the owner deferred; revert = setting off.
- **Black box:** BR/BS/BC reports in `docs/boxes/`; not in round 2.

---

## 18. Round 2 work packages

| Pkg | Work | Output | Done when |
|---|---|---|---|
| T1 | Fonts: add Saira + Noto (subset), `stretch` in `bake()`, `twin_dial` list | `tools/fonts-src/`, atlases | test-fonts green; gallery of 1.00/1.06 |
| T2 | Faces: `bake_face.py` (both dials, thinned numerals, clearance check) | `face_*.r8` | pixel diff vs mockup crops within 2 px on geometry |
| T3 | Shaders `tdial`, `tdback`, widget types, panel mask | `shared/shaders.js`, `shared/hud.js` | budget test, f30 suites green |
| T4 | Layout generator + app skeleton, settings, pages, bottom row, tab bar | `design/gen_twin.py`, `apps/twin_dial/` | layout + pages tests green |
| T5 | Messages: plate, severity, window, D7 strict, logging | `apps/twin_dial`, `shared/hud.js` | `test-twin-cc.js` green incl. pixel audit |
| T6 | Bench G20 + gallery matrix | `bench/`, `tools/shots/` | gallery renders all states |
| T7 | Probe mode (log-only) | `apps/twin_dial` | probe lines on the bench with injected values |

Order: T1 → T2 → T3 → T4 → T5 → T6 → T7 (T1, T2 and T6 can run in parallel). Each package on its own branch from
`twin-dial/spec`, merged into `twin-dial/r2`; nothing pushed without the owner's word.

---

## 19. Open after round 2 (not blocking)

Probe results P1–P12; D7 revisited after P1; D10 + the black box; centre pages a/d/e/f (map, car, media, guidance);
the stalk button; mph variant; band level and night palette from a car photo; the stored-message marker; a facelift
night/warning/reduced-view reference if one turns up.

---

## 20. Changes from rev 1 (and overrides of the round-1 JSON)

- **Feet withdrawn** (`vd/dials.json` `feet` updated; VC's `band_feet` colour unused): the band ends in a radial cut
  at ±144°, nothing below — rectified 02 and 04.
- **Speedometer numerals thinned:** 90 and 120 dropped; small size 23 → 18 px, ρ 0.775 → 0.78 (VT `sizes.json`
  `scale_minor` overridden).
- **Rev strip dropped** (D9): VD's `rev_strip_02` unused; the fuel bar is under the tachometer; the furniture rule's
  rev-strip clause no longer applies.
- **Unit label straight in the hub** (VD's curved 149–164° label crossed the belt group).
- **READY moved** into the hub top (0, −0.20) R (VD's (−0.73, 0) sat on the band).
- **Trip page has no reset hint** (we never write); footer = departure time.
- **Message plate counter** right edge set to x 1224 (inside the plate).
- **Settings** add `bandGain`; `centre` options cut to clock / trip / cycle.
