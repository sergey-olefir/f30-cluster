# Twin Dial — specification, round 3 (live tabs, the 06 look, messages in the centre)

This file specifies what Twin Dial becomes after round 3. It builds on `docs/twin-dial/SPEC.md` (rev 2, the 0.1.0 app) and **replaces** its §4–§8 where they differ; everything SPEC rev 2 says about units, placement, keep-outs, fonts, signals already in the app, budget rules and safety stays in force unless this file changes it. The evidence is in the ten round-3 reports (`docs/twin-dial/r3/<PKG>-REPORT.md`) and their numbers (`design/twin-dial/r3/<pkg>/*.json`), which today live on the branches `twin-r3/{sd,sf,sb,sm,sp,sn,sv,sc,k1,k2}` (not merged). Where a report and this file disagree, this file wins; every such override is listed in §16.

Status words: **owner** = decided by the owner (2026-11-18); **verified** = measured or computed; **hypothesis** = needs the bench or the car; **after probe** = specified, but switched on only when the car session of `docs/AGENT-BRIEF-car-signals.md` has shown the signal.

Panel px, x right, y down, 1920 × 720; R = 300 px; tachometer centre (380, 400), speedometer centre (1540, 400); angles in degrees clockwise from 12 o'clock.

---

## 0. The owner's decisions of round 3

| # | Subject | Decision |
|---|---|---|
| R1 | Dial look | **`80_look_06`** of K1's contact sheet: band B, the red zone as an arc on the bezel, the numerals' shadow, the tick strip's bright line, the gear in the hub's centre, the needle's shadow; plus the fixes (the three rings end together, the inner ring thin). The needle stays white (SPEC D5). |
| R2 | Small speedometer numerals | **unchanged** (10 30 50 70 160 200 240 280; 90 and 120 dropped). |
| R3 | Tabs | **live**: the selected tab is filled; the centre shows that tab's content. **Each tab its own colour.** |
| R4 | Tab 1 | on-board computer: date and time, trip, **technical data** as a page that **a setting can hide**. As the mockups. |
| R5 | Tab 2 | the messages, **in the centre**; the bottom plate goes. As the mockups. |
| R6 | Tab 3 | radio / media, as the mockups. Media from **CarPlay**. |
| R7 | Tab 4 | phone, as the mockups. |
| R8 | Tab 5 | navigation: **BMW's map in the centre**. |
| R9 | Switching tabs | a setting in the app now; the button's signal is searched on the car (`config.tabKey`). |
| R10 | Speed limit | **(a)** a sign at the bottom row's right end **+ (b)** a marker on the speedometer's scale **+ the tick strip red from the limit**. |
| R11 | Cruise control and speed limiter | drawn **in the lower opening of the speedometer** (reference 12). |
| R12 | Driver-assistance page | **none**: the limit is on every tab (R10) and the set speed is in the speedometer (R11). |
| R13 | BMW's telltales drawn by us at the top, the whole bottom ours | **not touched** in this round. |

Two readings of the owner's words are the lead's and are drawn as variants in the mockup round before the build (`docs/twin-dial/MOCKUP-SPEC-R3B.md`): R10's "strip red from the limit" (taken as: the speedometer's tick strip is red from the limit's angle to the scale's end), and R11's exact place (taken as: the hub's lower part, above the coolant bar).

---

## 1. References

`reference/vc/01`–`12` (git-ignored; never an input to a bake; no maker's name, logo, font or bitmap in a tracked file). New in round 3: **06** (a clean frontal render, the lead reference for the dial look and the tab fill), 07, 08, 09, 10 (the reduced view: list page, sign placement), 11 (the same file as 01), **12** (classic, night: cruise set speed and its symbol in the speedometer's lower opening, a marker on the bezel at the set speed, the sign at the bottom row's right end). Rectified frames: `bake/work/twin-dial/pub/VR/` (01–05), `bake/work/twin-dial/r3/pub/SD/` (06, 07, 08, 10, 11).

---

## 2. The dials (R1; SD `dials_v2.json`, K1 `looks.json` look `look_06`)

### 2.1 The three rings (both dials)

| Ring | Radius (R) | Width (R) | Ends at | Finish |
|---|---|---|---|---|
| Bezel (outer thin ring) | 1.000 | 0.0204 (as today) | **143.6°** | cut square, no fade |
| Band (the thick ring) | 0.5795–0.9375 | — | **143.0°** | one radial cut, nothing below |
| Inner ring (rim) | 0.544 | **0.008** (today 0.0156) | **143.55°** (today 150.0°) | cut square, no fade |

Verified on rectified 06 and 02 to 0.15°: on every reference the three rings end on one radial line. Ours ran the inner ring 6.4° past it and drew it twice as thick. The dark gap band → bezel is 0.9395–0.992 R, black; the gap rim → band 0.548–0.5795 R, black.

### 2.2 The band (look B, from 06)

- Luma: `Y = 0.0188 · exp(4.60 · (ρ − 0.60)) · exp(0.59 · (1 − cos θ))` in linear light (K1's fit on rectified 06 after its black level; rms 0.10 in log). Outer/inner ratio 3.2 (today 8.1): flatter and lighter inside.
- Tint (linear, R : G : B) = **0.76 : 1.00 : 1.064** (cool; today 0.96 : 1 : 1.08).
- Symmetric left/right (06's one-sided highlight from the upper right is **not** copied: the owner chose picture 80, which is symmetric).
- `bandGain` (setting, SPEC rev 2) keeps scaling the band and the strip.
- Major lines across the band: ρ 0.58–0.89, width 0.010 R (today 0.0075), black.
- No texture.

### 2.3 The tick strip

- Body ρ 0.893–0.9375, sRGB **(98, 109, 111)** (today 137 neutral).
- **Bright line** at its outer edge, ρ 0.924–0.934, sRGB **(115, 124, 126)** (06: +45 % over the strip in linear light).
- Ticks as today: ρ 0.896–0.934, minor width 0.012 R, major 0.018 R, white. Tachometer minors stay 1 per 1000 and the speedometer's as today (06's 3 per 1000 is not adopted).

### 2.4 Numerals

- Sets, sizes and radii as today (tachometer 1–8 at 57 px; speedometer large 28 px, small 18 px, R2).
- **Shadow (new, baked into the face):** SD's model fitted to 06's profiles — a dark outline hugging the ink, width 0.008 R, darkening the band to 0.75; and a soft drop shadow, offset (+0.010, +0.012) R (right, down), blur σ 0.008 R, darkening the band by 0.35. K1's picture 80 used (0.008, 0.020) R, σ 0.009, 0.70 by eye; **SD's measured model is the authority**, and the mockup round shows both against the 06 crop so the difference is seen before the bake.
- The same dark edge on the white ticks (06: 0.9° clockwise of each tick): hypothesis, in the mockup only.

### 2.5 The red zone (tachometer): an arc on the bezel

- From the **redline** (setting, default 6500 rpm) to the **bezel's end, 143.6°**: the bezel itself is red there, ρ 0.990–1.010, sRGB **(210, 20, 21)** (06). No wedge: the band stays grey (tinted as §2.2) under it.
- Ticks from the redline on and the numerals whose value ≥ the redline rounded up to 1000 are red (7 and 8 by default), as today.
- "8" (ink 119.0–131.5°) lies wholly beside red: the owner's wish that the red reaches the end is met by the arc running to 143.6° (05's rule; 06 itself stops at 125.2°).
- Engine: `u_red.w` (the zone's end angle) set to 143.6; the arc replaces the wedge in `tdial` (+78 bytes; K1 `shader_cost.js`).

### 2.6 The needle

White, profile as SPEC rev 2 §4, with the engine's shadow (the band × 0.85 out to 0.05 R either side) — this is what 0.1.0 already draws on the car. Rest positions as today (speedometer at 0; tachometer −135° on "OFF" with the engine off). 06's slimmer red needle is not adopted.

### 2.7 The tachometer's hub (gear in the centre)

| Item | Centre (R) | Size | Face | Note |
|---|---|---|---|---|
| Gear | **(0, 0)** | cap height 0.222 R ≈ 66 px: the same size as the digital speed | Saira, `td_big` extended with `D M N P R S` and the gear digits, or `td_gear` re-baked at 92 px (+20 KB) | GPU text as today; "D3" style values as the car reports |
| Drive program | **(0, +0.209)** | cap 0.058 R ≈ 17 px (Saira 24) | `td_label` | where the unit sits on the speedometer |
| READY | **(0, −0.29)** | Saira 22, green | `td_label` | moved up (today −0.195) |
| Unit "1/хв × 1000" | **(0, +0.40)** | Noto 20, grey 227 | baked in the face | moved down (today −0.04); 06 curves it outside the lower right, where our belt group is |
| OFF | (−0.56, +0.58) | as today | baked | unchanged |

Under the tachometer: the fuel bar, its end labels and the pump icon as today (SPEC rev 2 §5.1).

### 2.8 The speedometer's hub

Digital speed (0, +0.03) R Saira 92 and the unit (0, +0.24) R as today. New below them: the cruise / limiter readout (§9). Under the dial: the coolant bar as today.

### 2.9 Scale additions on the speedometer

The limit marker and the red strip from the limit: §8. The cruise marker: §9. 06's fixed red marks at 30, 50 and 130 km/h are **not** drawn (they would read as a live limit beside ours).

### 2.10 What the build changes

`tools/twin-dial/bake_face.py` constants and one re-bake of both faces (same 616 × 560 R8: no pixel-memory change); `tdial` shader: band tint constants, the bezel arc, the strip's red-from-limit and the two markers (budget: `tdial` ≤ 8 KB after `compact()`, today 4.46 KB; the 06 look adds +81 bytes, §8/§9 about +0.5 KB); `design/gen_twin.py` (hub positions); the gear font.

---

## 3. The tab bar (R3; SF `tabs.json`)

### 3.1 Geometry

- Bar [618, 127, 1302, 172]; ramp 0.002 → 0.16 (linear, top to bottom), tinted (0.96, 1.0, 1.08) with the band look B; **rule under the bar 3 px** (y 170–173, code 230; today 1.5 px).
- **Separators at x 780, 848, 1168, 1237** (today 744, 812, 1168, 1237): tab 1 = 618–780 (162 px: icon + three digits + unit at the references' sizes), tab 2 = 780–848, tab 3 = 848–1168 (320 px), tab 4 = 1168–1237, tab 5 = 1237–1302. Each separator: a dark column, then a light line 3 px to its right.
- **Icons 36 px** (0.12 R; today 29), centred at y 143; **text cap 24 px** (Noto 33–34), baseline 156. Tab 1's icon starts 18 px from the bar's left end (x 636).
- **No icon is ever dimmed.** State is shown by the icon's variant (§3.3).
- Text that does not fit ends in "…"; icon + text are centred as one group in the media cell.

### 3.2 Selection

- One tab is always selected. Its whole cell (from the cell top to the rule, between its separators) is filled with the bar's own ramp shape **in the tab's colour**: `fill(y) = colour_linear × t(y)`, `t = ramp(y) / 0.16`, near black at the top, the full colour at the rule. The rule under that one cell takes the tab colour lightened (the fill's bottom colour + 0.15 × the white rule, linear light); elsewhere the rule stays white. Icon and text on the fill: white.
- Colours (sRGB before the panel's black-floor correction; SF):

| Tab | Function | Fill colour | Evidence |
|---|---|---|---|
| 1 | on-board computer | red (176, 10, 37) | verified: 02, 06 (06's ramp measured: (45, 25, 27) top → (150, 38, 43) bottom, rule (187, 83, 87)) |
| 2 | messages | red (176, 10, 37) | verified: 04, 08 |
| 3 | media | amber (240, 150, 10) | hypothesis (the unselected icon's colour on 05, 09) |
| 4 | phone | green (60, 155, 34) | hypothesis |
| 5 | navigation | blue (30, 150, 200) | verified: 10 |

- **The fill never carries a message's severity** (SC, SF): severity is on the card, the warning icon and the bottom rule (§5.3).

### 3.3 What each tab carries

| Tab | Icon | Text | Variants |
|---|---|---|---|
| 1 | `td_fuel` | range + "км" (Noto 33 / 19) | "–" with no range |
| 2 | `cc_warn` | — | white when nothing shows; **the severity colour** (red (218, 16, 48), amber (240, 170, 10)) while a message shows and tab 2 is not selected; white on the fill when selected. Tab 2 is **always present** (the references' maker hides it with no message; ours keeps fixed separators) |
| 3 | source icon: `td_radio` (tuner), `td_media` (player), projection icon for CarPlay | station or title, clipped with "…" | icon only until the media probe (P8) has shown the text field; a mute mark **after probe** |
| 4 | `td_phone_bars` (a handset with signal bars) when a phone is connected; `td_phone_off` (crossed out) when none | — | icon only; the bars' count **after probe** (P9); until then the plain `td_phone` |
| 5 | `td_nav` (arrow) | — | within 300 m of a manoeuvre the icon may become the turn arrow (30 px): **after probe** (P12) |

### 3.4 The tab state and its rules (SB's prototype, `shared/twin_tabs.js` on `twin-r3/sb`)

- State `tab` ∈ {1, 2, 3, 4, 5}; `tdback`'s existing highlight draws the fill (no shader change beyond the colour table); the centre follows the tab **in place** (no layout rebuild; changing `centre` no longer rebuilds either).
- Settings: **"Таба" = авто / 1 / 2 / 3 / 4 / 5** and **"Не перемикати таби вище" = вимк. / 5 / 10 / 20 / 30 / 50 км/год** (default 5).
- **Auto rules** (setting "авто"), in priority order:
  1. a message shows → tab 2, at any speed, until the message ends; then back to the tab before it;
  2. a call rings or runs → tab 4 (**after probe** P9); a message outranks a call;
  3. guidance becomes active → tab 5;
  4. otherwise the driver's last choice (start-up: tab 1).
  Rules 2–4 wait while the car is above the lock speed; rule 1 never waits. The driver's own key (when one exists) is never locked.
- **Leaving tab 2 while a message shows is allowed** (by the key or the setting): BMW's panel opens in the same turn (§5.4). The tab is not locked: a "shown now" number that never clears would otherwise lock the driver out of every tab.
- `config.tabKey`: null until the car session names a signal (the on-board-computer button on the stalk is the first candidate: `de.bmw.body.Light.IndicatorSteeringColumn.operationColumnStalks`, a bit of one byte, notifier only). Forms: `{iface, field, path, mask}` (a bit), `{…, press: [index, name]}`, `{…, counter: true}`, `{…, any: true}`. One press = the next tab that exists, cyclic (1 → 2 if a message is listed → 3 → 4 → 5 → 1).
- Pages inside tab 1: the `centre` setting (§4.1). A scroll key inside a tab (the thumbwheel) is specified only after the car session.

### 3.5 The bottom row follows the tab (SF)

- **Tab 1 selected:** two lines as today (L1 odometer, R1 trip distance or range, L2 clock, R2 outside temperature).
- **Any other tab:** **one line** — the clock (left column, right edge x 846) and the outside temperature (right column, right edge x 1153) on the **upper** baseline (656), as the approved mockups draw it; the lower line is empty (the sheet stays opaque over the whole of BMW's panel footprint). The speed-limit sign sits at the row's right end on every tab (§8).
- The bottom-row sheet moves to **connection 0** (§5.5).

---

## 4. The centre pages

Window [729, 172, 1191, 613]. Grammar (SF, verified against 06 and 02 to 1–2 px): title centred, Noto 41, baseline 281; title rule y 295–297.5 (**2.5 px**, code 205), x 739–1181; body y 300–565; a small right-aligned meta line under the rule at baseline 326 (cap 22 px); a footer line at baseline 565 (cap 23 px, grey 227); a scroll line at x 1189 when a page has more than fits.

### 4.1 Tab 1 — the on-board computer

Setting **`centre` = годинник / поїздка / технічні дані / по колу** (default: по колу — 10 s per page while the car stands, the page held above the lock speed); setting **"Технічні дані" = показувати / сховати** (default: показувати) removes the technical page from the choice and from the cycle (R4).

1. **Date and time** (as today; the owner keeps the large Saira clock of the approved mockup): title "Дата і час"; time Saira 92 at (960, 372); weekday Noto 39 at y 450; date "DD.MM.YYYY" Noto 39 at y 505.
2. **Trip** (02's table grammar): title "Поточна поїздка"; meta line right-aligned: the driving time ("0:43 год"); rows at baselines 384 and 455: row 1 — pump icon 36 px at x 729, "ø", average consumption (number right-aligned at x 896, the unit as a stacked fraction "л / 100 км"), average speed (number right-aligned at x 1109, "км/год"); row 2 — distance ("12.4 км"); footer: "від початку поїздки, 14:00". Sources and factors: research3/MK (`config.trip.factors`, the fallback chain KombiIF → ResetLogic3, a dash only for a silent or invalid field).
3. **Technical data** (SV page V1; R4): title "Технічні дані"; four rows at baselines 352, 418, 484, 550: label Noto 31 from x 745, value Noto 40 right-aligned at x 1150, unit 6 px after; under each row a bar x 745–1175, 12 px below the baseline, 6 px thick, track 0.16 grey, fill white and red from the warning value.

| Row | Label | Bar range | Red from | Source | On this car |
|---|---|---|---|---|---|
| 1 | Олива | 50–150 °C | 130 | `CDS.statusEngineTemperature.temperatureEngineOilDrive` (raw − 48) | arrives; scale a strong hypothesis |
| 2 | Охолодження | 50–130 °C | 120 | same field, `temperatureEngineDrive` (raw − 48) | arrives; scale verified |
| 3 | Наддув | 0–1.6 бар | — | `FES.statusSwitchDriveDynamicSport2.displayBoostPressure` (0.01 bar, 255 none) | arrives in another app's log; scale a hypothesis until a drive under load |
| 4 | Зовні | — | — | `ExteriorTemperature` (raw × 0.5 − 40) | arrives |

   "Охолоджувальна рідина" does not fit beside its value at these sizes: the label is "Охолодження". A second technical page **"Шини"** (SV V1b: our own top-view outline at (960, 430), the four pressures Noto 40 with "бар", temperatures under them; TPMS getters polled every 10 s while the page shows; amber when a pressure is ≥ 0.2 bar under its target) follows in the cycle **after probe** (the values have been seen only in another app's log).

### 4.2 Tab 2 — messages: §5.

### 4.3 Tab 3 — media (R6; SM `model.json`)

- **M3 "certain only"** (until the car session has shown the fields): title "Медіа"; the source pictogram 66 px centred at (960, 392); nothing else.
- **M2 radio** (**after probe**): title "Радіо", meta line: the band ("FM", "DAB"); pictogram `td_radio` 54 px at y 344; station name Noto 41 centred at baseline 424; radio text Noto 29 grey at 471 (one line, "…"); footer: preset · frequency · traffic flag.
- **M1 now playing** (**after probe**): title "Медіа", meta line: the source ("USB", "Bluetooth", "CarPlay"); title of the track Noto 41 at baseline 400, artist Noto 31 grey at 444; a progress line x 800–1120 at y 500 (2 px track, white fill), elapsed left and total right (Noto 21), "4 / 12" centred under it; a mute mark when muted.
- Sources: `HmiMediaState` on instance `HMI_CID` (`playerMetadata`: each line with its type TITLE / ARTIST / ALBUM; `trackProgress`; `menu.iconKind` for the source), `TunerFmAmDab.currentStationFmDabAm` (radio detail), `MediaPlayer` on instance **`CarPlayMedia`** (the owner uses CarPlay; an app may declare one instance). No cover art (one picture can be 850 kB) and no track list in this round.
- Privacy: titles, station names and artists are drawn, never logged (lengths and enums only).

### 4.4 Tab 4 — phone (R7; SP `model.json`)

- **Idle page:** title "Телефон"; the phone pictogram 54 px at (960, 344); line 1 Noto 39 at baseline 424: "Підключено · CarPlay" / "Підключено · Bluetooth" / "Телефон не підключено"; line 2 Noto 29 grey at 471: battery ("80 %") and signal ("3/4") when the car gives them. **No missed-call count** in this round (it needs the call list, which would bring names and numbers into the app's memory).
- **Call card** (shown automatically, tab 4 selected by auto rule 2): title "Вхідний дзвінок" / "Розмова" / "Виклик…"; a green handset 66 px at (960, 372) (incoming) or the call timer Saira 72 at baseline 410 (active; our own timer from the state change); under it "Контакт" or "Номер" (from the contact id being known or not), Noto 39 at baseline 478; a muted-microphone mark when the car says so; the meta line names the path ("CarPlay").
- **The caller's name:** a setting **"Показувати ім'я абонента"**, default **off**; never logged, never kept after the call.
- Everything here is **after probe** (P9: no telephony field has been seen on this car). Until then tab 4 shows the idle page with "Немає даних" and the plain icon.
- Sources: `VoiceCall` (instance `Call1`), `VoiceCallManager`, `ConnectivityAggregator.aggregatedCallState`, `DevicePresentation.deviceList`.
- The car session must also photograph whether Twin Dial hides BMW's own incoming-call pop-up (hypothesis: BMW draws it under our layers).

### 4.5 Tab 5 — navigation (R8; SN `map.json`, `guidance.json`)

| Situation | Centre | Status |
|---|---|---|
| BMW's (or Waze's) map is in the cluster's map slot | **the map window W1**: no title; a see-through box in the left background layer, zero box [750, 180, 1170, 564], fades 120 px (top), 80 px (sides and bottom), corner radius 24 — our black is full where BMW's map has fallen to 75 %, so BMW's own edge never shows; the road name (Noto 33, white) on a dark bar at the window's foot, baseline 590, when the car gives a road | the hole: bench only; **experiment `mapWindow`** on the car (the map has been photographed through our panel only on the old cluster-render 0.5.8) |
| guidance active, no map | **the guidance page**: title "Навігація"; our arrow 120 × 120 at [770, 318, 890, 438]; distance Saira 72 left-aligned at x 915, baseline 410, unit Noto 29; next road Noto 33 at baseline 480 (clipped at x 1180); lane row (≤ 8 lanes, 34 px pitch, 30 px arrows) y 498–532; footer Noto 29 grey at baseline 560: arrival time and remaining distance | **after probe** (P12: `Guidance.conclusiveDart`, `currentLaneGuiding`, `nextDestinationInfo` are unseen) |
| route being calculated | title; "Розрахунок маршруту…" Noto 33 at y 400 | `guidingState` arrives |
| no route, a road name known | title; the road Noto 41 at y 400; "Маршрут не прокладено" Noto 29 grey at y 452 | arrives |
| nothing | title; "Маршрут не прокладено" | — |

- **When the window opens:** only while tab 5 is selected **and** the map is believed present: (S1) cluster-render's status rows say slot 0x100 is mapped with a map content — once experiment `mapSlots` has proven the app can read them; until then (S2) the cluster's map-view setting (`KombiIF.statusConfigurationKombi5.statusNavigationDisplayType`) = map **and** (guidance active **or** "map without a route" enabled). On any doubt the window closes at once and the fallback page shows. For 6–8 s after a fresh panel mapping the map slots are off: the window stays shut then.
- BMW's map box with a theme up (photo 41, cluster-render 0.5.8): 10 % edge x 700–1217, y 138–594; full brightness x 794–1150, y 209–557 — wholly between our dials, ending 19 px above our bottom rule.
- The centre sheet draws nothing inside the box on the map page.
- The turn arrow in the speedometer's hub (reference 07) is **not** used: it would sit in the KOMBI's black-box area.
- Our own pictograms for manoeuvres (turns ×9, forks and exits, roundabouts by exit, destination flags): `guidance.json` `pictograms_needed`. BMW's arrow artwork is never fetched.

---

## 5. Messages in the centre (R5; SC `card.json`, `states.json`)

### 5.1 The page

Tab 2's body is **one image sheet** [729, 298, 1191, 568] (462 × 270), opaque black, painted in one go, above every other centre layer. The title "Повідомлення" is an ordinary text widget.

- **The card** (the message the car says it shows now): symbol cell [922, 306, 998, 382], filled by severity; symbol 54 px centred (960, 344), white (black on amber); headline Noto 42 (cap 30), centred, max width 436 px, **up to 3 lines** at baselines 424 / 471 / 518 (about 17 letters a line), wrapped by words, the last line ending in "…" when cut; the counter "n/m" Noto 29 grey at the top right of the body (right edge x 1180, baseline 326), only when the car gives a frame count.
- **Rows** (every other listed entry; the car's list carries active and stored entries alike): pitch 44 px; symbol 32 px in the severity colour at x 741; name Noto 33 from x 781, max width 399 px; 6 rows on a list-only page, 2 under a one-line card, 1 under a two-line card, none under three lines; order: severity (red, amber, others), then the car's order; a scroll line at x 1189 when there are more.
- **Pointer page** (a message shows but ours cannot be drawn): the cell and a generic symbol by the known colour; our fixed words "Повідомлення / на панелі внизу" (Noto 39, baselines 424 / 471). It never counts as our text for any message.
- **Empty page:** `cc_info` 66 px at (960, 392), half white; "Немає повідомлень" Noto 39 at baseline 478.

### 5.2 Text and symbol

As SPEC rev 2 §8.3: the name from `ccList.cCShortName` in the car's language, in Noto Sans; our own symbol by id (`message_symbols.json`), a generic one by colour otherwise; never logged; BMW's bitmaps never used. A row counts as our text for its message only when its whole name fits.

### 5.3 Severity

From `cCColor` (RED → red; YELLOW, ORANGE → amber; GREEN → green; WHITE, DEFAULT → grey). It shows in three places, never in the tab's fill:
1. the card's symbol cell: red (176, 7, 30), amber (240, 170, 10) with a black symbol, green (59, 155, 26), grey = the tab ramp;
2. the warning tab's icon while tab 2 is **not** selected: red (218, 16, 48), amber (240, 170, 10), white otherwise;
3. the bottom rule (y 611–615) while our card covers BMW's panel: red, amber, green, or light grey 231.

### 5.4 The safety machine (the hard rule: a BMW warning is never hidden unless our own text for that exact message is on the screen in the same frame)

BMW's panel is at the bottom ([696, 595.75, 1226, 704], the fallback window = `zc.panel` dilated 3 px, the R8 mask of SPEC rev 2). Our bottom row covers it at rest; our text is now in the centre.

1. **A message appears** (signal handler, not the tick): the bottom row steps aside and the fallback window **opens**; tab 2 is selected (auto rule 1); the card for that message is painted.
2. **Only after our card for that exact message has been on screen ≥ `CC_SETTLE_MS` (150 ms)** may the window close and the bottom row return (in one line, §3.5) with the rule in the severity colour.
3. **The message changes** (another id, or other words): if the new message's whole name is already on screen as a row, the panel may stay covered; otherwise as step 1.
4. **The driver or a rule leaves tab 2 while the message shows:** the window opens **in the same turn**; and — new in round 3 — **the centre may not remove our text until the panel has been open ≥ 150 ms** (the window is on connection 0 and the tab-2 sheet on another connection: there is no ordering between them; without the wait SC's model finds frames with the warning hidden).
5. **The message ends:** the card goes; the window shuts; then the bottom row returns; the tab goes back to the one before (auto).
6. **Every keep-open condition of SPEC rev 2 §8.4 holds for the centre:** signals not readable yet; D7 (until the car has once delivered a "shown now" number that matched a listed entry, our card never lets the panel be covered: the pointer page shows and the window stays open); no entry for the number; an empty name; a glyph the font lacks (latched); a throw while drawing (latched); the message changed; the sheet could not be made.
7. **Release** (research3/MC, narrowed by SC): a "shown now" value that is no verdict — 65535, or a number whose entry has left the list — lets the list decide instead, but **only a number that was already set before its entry left the list** is released (MC's wider `leftList` covered BMW's panel in one case: a door message returning with its number before its list entry). Twin Dial takes this narrowed release; f30_cluster's own `release` stays off until it carries the same narrowing.

### 5.5 Connections (a hazard found in 0.1.0)

The bottom-row sheet moves to **connection 0**, the connection of the layer that opens the window: on 0.1.0 the row (connection 2) and the window (connection 0) are unordered, so the row's text can sit over BMW's opening panel for some frames if the service does not apply the connections together (SC's model: 31 of 35 cases). Tab 2's sheet takes the old plate's slot on connection 2 (SC option a: about 5.13 MiB steady; the rebuild peak must be measured by `bench/test-twin-budget.js`); the sign sheet (§8) is also on connection 2.

### 5.6 Tests

`tools/twin-dial/r3/sc/` holds the model (35 cases run three ways: the service applying a turn at once, op by op, and with the connections in any order; eight broken machines that must each fail). The build round ports it to `bench/test-twin-cc.js` on the real engine with the per-frame pixel audit: BMW's panel is covered only while our card (or a full row) for the shown number is completely on screen; the bottom row never sits over an open panel.

Unproven until the car: that 150 ms covers the sheet upload and the panel's opening; whether the service applies one turn's writes on several connections together; what "shown now" carries (probe P1).

---

## 6. Colour and night

Day values above. Night: SPEC rev 2 §7.2's multipliers on the new values (band × 0.6 / 0.55 / 0.5, strip × 0.55, strip line × 0.55, white × 0.8, red × 0.85, the tab fills × 0.75, amber × 0.8 — hypotheses: there is still no night reference of the facelift; 12 is the classic generation). All sent with the G20 black-floor correction.

---

## 7. Type and pictograms

- Fonts as SPEC rev 2 §9 (Saira digits and Latin labels only; Noto Sans for every text). New sizes: tab text Noto 34; gear in `td_big` (or `td_gear` at 92); program Saira 24; technical rows Noto 31 / 40; card headline Noto 42; rows Noto 33; guidance distance Saira 72; call timer Saira 72; cruise set speed Saira 40 (§9).
- New pictograms (our own; today drawn in K2's `tools/twin-dial/mockup/pictos_r3.py` on `twin-r3/k2`, 25 of them: car outline, handset, phone with bars, phone crossed out, mute, projection, engine block, tyre, turn arrows, …) move into `design/twin-dial/vt/pictograms.js` and `shared/twin_icons.js`; to add: the cruise and limiter symbols (§9), the manoeuvre set of §4.5, the derestriction sign's stripes (§8).

---

## 8. The speed limit (R10; SV `placement.json`)

Finding: Twin Dial 0.1.0 draws no limit and **covers BMW's own sign** (BMW's sign is at (538.45, 621.2), r 41, inside our tachometer's lower right, under our opaque background; a hole there would cut the "8", the red arc's end and the bezel). So the limit is drawn by us.

- **Signal:** `de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction` (notifier 32769, declared `s`): `displaySpeedLimit`, `displaySpeedLimitUnit`, `displaySpeedLimitWarning`, `displaySpeedLimitSupplemental`, `invalidFlag`. The engine's `signOf` and f30_cluster's `config.sign` are copied as they are. That this field arrives on the car is **not yet shown by a log line in the repository**: the build logs it (numbers only) and the car session confirms it.
- **(a) The sign:** a disc centred **(1300, 672)**, outer r **33**, red ring 7.6 px, white disc, the number in Saira bold (three digits shrink to fit); box [1267, 639, 1333, 705]. Clearances (measured on the render): 10.7 px to BMW's stored-message marker, 26 px to our ink, 41 px to the fallback window, 47 px to the gear gap, 15 px to the panel's bottom. One small image sheet (96 × 88) on connection 2; **not** a "cc:" layer — it stays when the fallback window opens.
- **(b) The marker:** on the speedometer's tick strip, ρ 0.893–0.94, 2° wide, red (181, 26, 17), at the limit's angle (−125° + 1.25°/km/h up to 100, + 0.625°/km/h above: 30 → −87.5°, 50 → −62.5°, 70 → −37.5°, 90 → −12.5°, 110 → +6.25°, 130 → +18.75°). Shader only (`tdial` uniform `u_lim`): no layer, no memory.
- **The strip red from the limit (the lead's reading of the owner's words; variants in the mockup round):** from the marker's angle to the scale's end (+125°) the tick strip's body is red — dim (0.45 of the marker's red) while the needle is below the limit, full when the car says "over" (`displaySpeedLimitWarning` ≥ 1) or the needle is past the marker. Ticks in it stay white.
- **States:** limit known → all three; unknown (254 / 255 or the unit "not available") → the empty sign with three dashes, no marker, no red strip; end of restrictions (0) → the derestriction sign, no marker; nothing received or `invalidFlag` → nothing at all; a conditional limit (`displaySpeedLimitSupplemental` ≠ 0) → the sign with a dot under it, the marker hollow; mph → the number as the car gives it, the marker converted to km/h. We never flash the sign.
- The no-passing sign is not drawn in this round.

---

## 9. Cruise control and the speed limiter (R11; reference 12)

- **Place (the lead's reading; variants in the mockup round):** the speedometer hub's lower part, under the unit and above the coolant icon — the free disc centred (1540, 528), r 45 (14 px to our ink, 52 px under the KOMBI's black-box area [1420, 320, 1611, 440]). Layout: the set speed in **green** (60, 155, 34), Saira 40, right-aligned at x 1536, baseline 540, "км/год" Noto 19 under it at baseline 560; the function's symbol 36 px centred (1572, 528): our own "cruise" (a speedometer with an arrow), "adaptive cruise" (the same with a car ahead), "limiter" (LIM in a frame).
- **A second marker on the scale:** green, at the set speed, same geometry as §8 (b), drawn outside the strip's red (ρ 0.94–0.985, in the dark gap, pointing in) so the two markers never hide each other.
- **States:** active → green number, symbol and marker; standby → grey (227) number and symbol, no marker; off → nothing.
- **Signal (unseen):** `TrafficSignDisplayControl.displayDriverAssistanceLongitudinal` (notifier 32772, `s`): `activeFuncLongitudinal` (none / cruise / hill descent / limiter), `valueRequestedSpeed`, `dispRequestedSpeed.dispRequestedSpeedStatus` (none / standby / active), the unit flag; two other candidate sources (the HUD feed among them) are in the car brief. **After probe**: the build carries the drawing switched off (`config.cruise: null`).

---

## 10. Settings (the app's menu)

| Setting | Values | Default | New |
|---|---|---|---|
| Таба | авто / 1 / 2 / 3 / 4 / 5 | авто | yes |
| Не перемикати таби вище | вимк. / 5 / 10 / 20 / 30 / 50 км/год | 5 | yes |
| Сторінка бортового комп'ютера (`centre`) | годинник / поїздка / технічні дані / по колу | по колу | changed |
| Технічні дані | показувати / сховати | показувати | yes |
| Показувати ім'я абонента | так / ні | ні | yes (after probe) |
| Redline, Night look, Band level, Demo, on/off | as SPEC rev 2 | | |
| Діагностика (a sub-menu): release of a stuck message, map window W1 / off, forced map window, slot log | off | | yes (experiments; each one config key today) |

Every setting applies in place (no layout rebuild).

---

## 11. Signals added to the normal build

Read-only, every `r` with a non-zero getter id, `tools/signals/check_signals.py` must pass. Declared now: the sign (`TrafficSignDisplayControl`, `s`); the technical rows (`CDS.statusEngineTemperature` is already declared; `FES.statusSwitchDriveDynamicSport2`); the trip fallbacks of research3/MK (already on `main`). Declared but drawn only **after probe**: media, phone, guidance manoeuvre, the cluster's map-view setting, cruise, tyres, the tab key. Everything unseen is declared so that nothing breaks when it never arrives (a dash, an empty state, a summary line in the log after 2 and 10 minutes naming the silent fields).

Never: a setter, a method call with side effects, `newCCMessage`, `requestDefaultSymbols`, the RIC services' methods (the head unit's pushes to the cluster cannot be observed, only called).

---

## 12. Rendering and budget

- Layers today: 14 (6 / 6 / 2 per connection). After round 3: connection 0 gains the bottom row (7 of 8); connection 2 holds the tab-2 sheet and the sign sheet; the cruise readout shares the speedometer's hub-label sheet. Rules unchanged: ≤ 8 layers per connection, ≤ 6 MiB steady, ≤ 8 MiB peak, `tdial` ≤ 8 KB, `tdback` ≤ 6 KB (the map window adds about 300 bytes to part L), every sampler bound, `highp` for lengths over 256 px, no layer rectangle in the gear gap [1380, 660, 1460, 720].
- The KOMBI's black-box area on the G20 is **[1420, 320, 1611, 440]** (`shared/visible.js`; the rectangle in the round-3 brief was the X3's). The digital speed (y 374–444) lies in it: if the box ever appears on Twin Dial, the fallback is to move the digits below y 440.

---

## 13. Safety

SPEC rev 2 §15 holds. New or changed: the message machine of §5.4; the bottom row on connection 0 (§5.5); the speed limit restored (§8) — until then the driver has no limit on the cluster with Twin Dial up; the map window shows whatever BMW draws there, so it closes on any doubt (§4.5); the call card must not hide BMW's own call pop-up without showing the call itself (§4.4, the photo in the car session).

---

## 14. Phases

| Phase | What | Needs |
|---|---|---|
| **A — mockups** (`docs/twin-dial/MOCKUP-SPEC-R3B.md`) | the pictures this spec has no approved picture for: cruise in the opening, the strip red from the limit, the technical page in tab 1, the 06 look on every page, the three-line card | nothing |
| **B — build 0.1.1** (brief to be written after A) | §2 (re-baked faces, hub), §3 (tabs, settings, auto rules 1, 3, 4), §4.1, §5 (card, machine, connection move, narrowed release), §8 (sign, marker, red strip), tab 3 M3, tab 4 idle, tab 5 fallback pages + `mapWindow` as an experiment, the Діагностика menu | A approved |
| **C — the car session** (`docs/AGENT-BRIEF-car-signals.md`) | every deferred and unseen signal read; the experiments photographed | a build with the probe; the car online |
| **D — build 0.2.0** | media M1 / M2, the call card and tab-4 detail, the guidance page, cruise / limiter, tyres, the tab key, the scroll key | C's results |

---

## 15. Open after this spec

The telltales at the top and a bottom that is wholly ours (R13, deferred); the black box itself (research3/MB's experiments); a night reference; the reduced view (reference 10); the no-passing sign; a missed-call count; cover art; the references' sixth tab.

---

## 16. Overrides of the round-3 reports and of SPEC rev 2

- **SPEC rev 2 D3** (a solid wedge) → the red arc on the bezel (R1).
- **SPEC rev 2 D6 / §8.1** (the bottom plate M2) → the centre card (R5); the plate is removed.
- **SPEC rev 2 §5.1** (gear low in the hub, READY at −0.20, the unit at −0.04) → §2.7.
- **SPEC rev 2 §6.1** (separators 744 / 812; the highlight = severity; dim icons) → §3.
- **SPEC rev 2 §6.2** (`centre` = clock / trip / cycle) → §4.1 with the technical page.
- **VF (round 1):** "fill = severity" is refuted (SF).
- **SD / K1 (the owner's finding on the inner ring):** refuted as an angle — the references' inner ring ends with the band and the bezel; ours was 6.4° longer and twice as thick. If the car shows otherwise, a close photo of a dial's lower ends decides.
- **K1's numeral shadow** (by eye) → SD's measured model (§2.4).
- **SC** recommended a dim warning icon with no message → white (SF: nothing is dimmed).
- **SF** proposed 06's 44 px clock → the owner keeps the large Saira clock.
- **SV** recommended (a) + (b) → the owner adds the red strip from the limit; SV's assistance page (d) and the hub place (c) are not used for the sign (the hub's lower part goes to cruise, §9).
- **SN:** no title on the map page (kept); the hub variant of 07 rejected.
- **The round-3 brief:** the black box rectangle corrected (§12); "the sign signal arrives" downgraded to "not yet shown by a log line".

## 17. As built in 0.1.1: the owner's final decisions and the car's real sources (2026-11-18)

This section is newer than everything above and **wins where they differ**. Evidence: `docs/twin-dial/FIN-REPORT.md`,
`docs/twin-dial/R3B-INTEGRATION.md`, `docs/car-fix/CF1-REPORT.md` … `CF3-REPORT.md`, `docs/car/CP-REPORT.md`,
`design/car/answers.json`. Status words as at the top; **car** = seen in the car's log on 2026-11-18.

### 17.1 The owner's decisions after the mockup round

| Subject | Decision (owner) | Replaces |
|---|---|---|
| Numeral shadow | **None.** `SHADOW_MODEL = None` in `tools/twin-dial/bake_face.py`; faces re-baked. | §2.4 (SD's shadow model) |
| Page dots | **None** (never drawn; asserted absent). | K2's dots |
| Tab 2 | **Hidden while there is no message**: in the bar only while ccList holds an entry other than the resting id 0 (or while tab 2 is selected / held). Separators 780 / 848 / 1168 / 1237 with a message, 780 / 1168 / 1237 without; the media cell then is 780–1168. The TRIP cycle skips a hidden tab. | §3.1, §3.4 |
| Red strip from the limit | **L2**: red only between the limit's marker and the needle, only while over (`config.limit.strip = "L2"`). | §8 (the lead's L1 reading) |
| Cruise / limiter | Place **C1** (the speedometer hub's lower part); number, unit and symbol **green** while active, grey otherwise. | §9 |
| Technical data | The setting "Технічні дані: сховати" hides **both** technical pages (engine data and tyres). | §4.1, §10 |
| Navigation view | Setting **"Навігація" = авто / карта / стрілки** (settings only, no key). No lens: the map window, when on, is the wide **W2** box [700, 173, 1220, 600]. | §4.5 |
| Map window | Still an experiment: off by default, switched in Діагностика ("Вікно карти": вимк. / W2 / W1). | §4.5 |
| Assistance scales (front vehicle) | Not read, not drawn. | §9 |
| Settings in the menu | `centre`, "Таба" (авто / 1–5), "Не перемикати таби вище" (default 5 км/год), "Технічні дані", "Навігація", caller name (off). | §10 |

### 17.2 What the car really sends (replaces "after probe" above)

| Feature | Source that works on the car | What does **not** work |
|---|---|---|
| Message "shown now" | `Vehicle2.statusDisplayedCCMessage.statusNumberCheckControlMessageDisplay` (car: door open → 15 with the ccList entry in the same ms; closed → 0 about 0.7 s after the list rests). 65535 = unknown → the window stays open. A number with no ccList entry opens the window and selects no tab. | `KombiIF.statusActiveCCMessage` reads 65535 all the time (`ccActive.dead: true`); `newCCMessage` never arrives; `ccListRiskClass`, `CheckControlMaster.basicList` time out. |
| Tab key | Bit **0x40** of `de.bmw.body.Light` `IndicatorSteeringColumn.operationColumnStalks` (notifier only, declared `s`), rising edge = next tab (car: 17 presses, 17 clean pairs). The cluster still reacts to the key by itself. | — |
| Speed limit | The **event** `de.bmw.dass.TrafficSignRecognition.TrafficSignRecognition`: `presentClassLimitSpeed` × 5 = km/h (car: class 8 with a 40 sign, 6 with 30, 10 in town); 0 / 253 / 254 / 255 = none; `controlSLIWarning` = over the limit (hypothesis). Second witness, logged only: `SignRecognitionFrontCamera`. Decoder: `shared/limit_src.js`. | `TrafficSignDisplayControl`: its provider never comes up (kept as a fallback for other cars). FASuS getters time out. |
| Cruise / limiter | `DisplayDataServer.functionalLibraryData`: `cruiseCtrlSpeedHUD` = set speed in km/h (65535 = none), `ldmSym` `LDM_SYM_DCC` / `LDM_SYM_SLD` / `LDM_SYM_NONE`, `ldmSymColor` `LDM_ACTIVE` / `LDM_OFF` (car: filled with the head-up display off). | The FASuS-side set speed is encoded, not km/h. |
| Trip computer | `statusBordcomputerAverage` speed × 0.1, consumption × 0.1; `statusBordcomputerTravelData` way × 1 km (car, checked against the car's own trip page). Odometer `mileageKilometre` × 1. | — |
| Media (tab 3) | `HmiMediaState` (lines, menu's selected icon = the source), `TunerFmAmDab` station, `MediaPlayer` on `CarPlayMedia` (title, artist, time). On (`pages.media`). | — |
| Phone (tab 4) | `ConnectivityAggregator.aggregatedCallState` → the call card with our own timer; a call selects tab 4 (`tabs.callSelects`). Device lines and call detail stay dark (unseen). | — |
| Navigation (tab 5) | With CarPlay leading: `guidingProvider` = `CAR_PLAY`, `nextDestinationInfo` (`rawDistance` in metres, travel time, arrival), `currentRoad` → the "route" page without an arrow (`pages.route`). | `conclusiveDart`, `nextIntersection`, lanes stay empty with CarPlay; the arrow page (`pages.guidance`) stays dark until the car's own navigation is tried. |
| Tyres | Dark (`pages.tyres: false`): not seen yet. | — |

### 17.3 Budget as built

14 layers in three connections (7 / 4 / 3), 4.83 MiB of pixel memory steady and at the peak; the start-up hold
(`config.startupHold`) is on. Still for the car: the cluster's acceptance of the shaders, the map window W2, two messages
at once on "shown now", the limit's warning flag and derestriction, the cruise colours while suspended, the arrow page with
the car's own navigation.

### 17.4 Fixed in 0.1.2: the machine's tab follows the tab rules

Found in the 0.1.1 state gallery (`tools/shots/twin`, set E): with the setting "Таба = 2" saved (or with the key back on tab 2
before a message ended) the bar showed tab 2 while the message machine still stood on its old tab, so tab 2's page stayed empty
over stored messages. Cause: the machine learns of a tab only when it moves (`_twinTabMoved`), and a choice of tab 2 made during
a period (a message on show, or BMW's panel kept open at the start before the messages are read) only takes the card back. Fix
(`shared/hud.js` `_twinSync`): outside a message period the machine's base is set to the tab the rules selected. The safety
machine itself (`shared/twin_cc.js`) is unchanged. Tests: `bench/test-twin-tabs.js` "0.1.2" (five checks that fail without it).

### 17.5 Fixed in 0.1.3: BMW's own speed-limit sign no longer shows through the belt hole

Seen on the car (photo of 2026-11-19, parked, Comfort): a short red sliver above the rear-belt lamp. It is the bottom of
BMW's own speed-limit sign's ring (ink box [497.5, 580.2, 579.4, 662.2], its black moat to y 663.7; `docs/G20-DESIGN-SPEC.md`),
seen through our background's belt hole, which started at y 660 across the whole group [497, 660, 688, 720]. Fix
(`design/gen_twin.py` `BELT_HOLES`): the hole is two rects, [497, 666, 586, 720] over the rear belts (top 677.75) and
[586, 660, 688, 720] over the driver belt (from x 590.0, y 664.5) and the airbag lamp (y 664.25), so all three lamps stay
see-through and the sign stays under our black. `bg_l` now has six holes (the shader takes eight); the keep-out for our own
content is still the whole group. Tests: `bench/test-twin-layout.js` (each lamp has a hole, no hole meets BMW's sign, the holes
stay inside the group). Still for the car: no red left above the rear belts; all three lamps still light at the start-up check.
