# B4 — the centre pages (Twin Dial 0.1.1 build, round 3)

Branch `twin-b/b4` (worktree `.claude/worktrees/b3-b4`), from `main` at c1f53f2. Brief: `docs/AGENT-BRIEF-twin-build-r3.md` §4 B4; design authority `docs/twin-dial/SPEC-R3.md` §4, §10, §11. Nothing here has been seen on a car.

## 1. What was built

**One layer for every page.** The centre is now one image layer, widget type `tdpage` (`c_page`, rect [729, 248, 462 × 347], an own layer, connection 1, z 6). `shared/twin_pages.js` (new) paints it in one go: the title, the texts, the pictograms, the bars, the progress line, the lanes and the tyre outline. The page items are in the layout: `design/gen_twin.py` writes their geometry, and the values are `{{td:pg…}}` tokens. A page change, a value change or a night change is one repaint, and only the changed rectangle is sent (`_blitDiff`). Nothing is rebuilt.

Before, the clock page and the trip page were two text sheets (440 × 285 and 446 × 218). Now 15 pages share one layer:

| | before (main) | after (B4) |
|---|---|---|
| layers on connection 1 (planner) | 5 (+1 for the GPU gear) | **4** (+1) |
| text sheets + the page layer, pixel memory (×2) | 3.07 MiB (sheets) | 1.37 MiB sheets + 1.22 MiB page = **2.59 MiB** (−0.48 MiB) |
| layers per connection | {0: 6, 1: 5, 2: 2} | {0: 6, 1: 4, 2: 2} |

These numbers come from `bench/test-twin-layout.js` (the engine's own `_plan`). They do not include B3's connection move or B5's sign sheet. `bench/test-twin-budget.js` still uses its stand-in `sheet_centre` (540 × 400), which is bigger than the new layer, so its budget is conservative.

**Grammar (SPEC-R3 §4 header):** the title is Noto 41, centred, baseline 281. The title rule is 2.5 px at y 295–297.5, x 739–1181, code 205: a tdback rule with the new role `title`, added as `TW_RULE.title`. The meta line is at baseline 326 with its right edge at 1190. The footer is at baseline 565. The body runs from y 300 to 565.

**Pages (page id, then what it shows; "dark" means built and switched off by config):**

| Tab | Page | Content | Switch |
|---|---|---|---|
| 1 | `clock` | "Дата і час"; time Saira 92 at baseline 404 (ink centred on 372), weekday and date Noto 39 at 460 / 519 (as approved) | live |
| 1 | `trip` | "Поточна поїздка"; meta "0:43 год"; pump and road pictograms (46 box, 36 ink) at x 729; "ø 6.8" right at 896 with the stacked "л / 100 км"; "ø 41" right at 1109 with "км/год"; "12.4 км"; footer "від початку поїздки, 14:00" (research3/MK sources and factors, `tripValues`) | live |
| 1 | `tech` | "Технічні дані"; Олива / Охолодження / Наддув / Зовні at 352 / 418 / 484 / 550; values Noto 40 right at 1150; units; bars x 745–1175, 12 px under the baseline, 6 px thick, grey track, white fill that turns red past 130 / 120 °C; the value turns red at or above its warning; a missing value shows a dash, no unit and an empty bar; no bar for the outside temperature | live |
| 1 | `tyres` | "Шини"; our own top-view outline at (960, 430), 110 × 230; pressure (Noto 40) and "бар" at the four corners; temperature under each; amber when a pressure is ≥ 0.2 bar under its target. The TPMS getters are read every 10 s **only while the page shows** | dark: `config.pages.tyres` |
| 2 | `msg` | the title "Повідомлення" only (the body is B3's sheet) | live |
| 3 | `media` | M3: "Медіа" and the source pictogram, 66 px at (960, 392) | live |
| 3 | `radio` | M2: "Радіо", the band as the meta line, `td_radio` 54 px at 344, the station at 424, the radio text at 471, a footer "P3 · 101.7 · TP" | dark: `config.pages.media` |
| 3 | `track` | M1: "Медіа", the source as the meta line, title at 400, artist at 444, a progress line x 800–1120 at y 500, elapsed / total / "4 / 12" at 530, a mute mark | dark: `config.pages.media` |
| 4 | `phone` | idle: "Телефон", `td_phone` 54 px at 344, line 1 ("Немає даних" / "Підключено · CarPlay" / "Телефон не підключено"), line 2 (battery, signal) | live ("Немає даних" until P9) |
| 4 | `call` | "Вхідний дзвінок" / "Розмова" / "Виклик…"; a green handset 66 px at (960, 372) for an incoming call; our own timer (Saira 72) at baseline 410; "Контакт" / "Номер" (or the name, see below) at 478; muted-microphone mark; the path as the meta line | dark: `config.pages.phone` |
| 5 | `map` | the map window: no title, only a road bar at the window's foot | experiment: `config.mapWindow` |
| 5 | `guide` | "Навігація"; the manoeuvre pictogram 120 px at [770, 318, 890, 438] with the roundabout's exit number; distance (Saira 72) at x 915 baseline 410 with its unit; next road at 480 (clipped at 1180); lanes (≤ 8, 34 px pitch, 30 px arrows) at y 498–532; footer "прибуття 09:32 · 14 км" at 560 | dark: `config.pages.guidance` |
| 5 | `calc` / `road` / `none` | the fallback pages: "Розрахунок маршруту…"; the road at 400 with the grey line at 452; "Маршрут не прокладено" | live |

**Choosing the page:** `twin_pages.decide()` takes the selected tab from `hud.tabs.tab` (SB / B2's state) or, failing that, `hud.twinTab` (B1's note). It shows tab 1 until either exists.
- Tab 1 follows the setting `centre`: годинник / поїздка / технічні дані / по колу (`clock` / `trip` / `tech` / `cycle`). In the cycle each page stays 10 s while the car stands and is held above 5 km/h; the dwell restarts when the car stops.
- The setting **"Технічні дані" = показувати / сховати** (`techData`) takes the technical page out of both the choice and the cycle. With `centre = tech` and the page hidden, the cycle runs instead.
- The tyre page joins the cycle only when `config.pages.tyres` is on.

**Map window (SPEC-R3 §4.5):** `config.mapWindow` = null | "W1" | "W2" (default null). The window can open only while tab 5 is selected:
- **S1:** cluster-render's row `slot 0x100 status N: … map 1`, read from the status text every 2 s while tab 5 is selected. This applies only when `config.mapSlots` is true; until then S2 is used.
- **S2:** the cluster's map-view setting (`KombiIF.statusConfigurationKombi5.statusNavigationDisplayType` = KARTENANSICHT) **and** either active guidance or `Guidance.visualizationInKombiNonNaviEnabled`.
- The window closes at once on any doubt (stale rows, the setting left, no route).
- It stays shut for `config.mapShutMs` (8 s) after a fresh panel mapping (a layout build).
- `config.mapForce` (for B7's "Примусове вікно карти") opens it on tab 5 regardless of S1 / S2.
- `config.mapSlotLog` logs the parsed row once per change (numbers only).

Following B1's note, the window reaches the engine as `hud.twinMap` = null | "W1" | "W2". The engine's `_twinBackSend` turns that into `u_map` / `u_mapF`. `_twinBackForce()` (new) resends the backdrop when the window opens or shuts, and the **title rule is switched off while the map page shows**, which B1 asked for. The page layer draws nothing inside the box except the road bar.

**Settings (app.json):**
- `centre`: relabelled "Сторінка бортового комп'ютера", options Годинник / Поїздка / Технічні дані / По колу, default cycle.
- `techData`: new, "Технічні дані" Показувати / Сховати, default show. It is on the MAIN screen beside `centre` and skipped in SETTINGS.
- `callerName`: new, "Показувати ім'я абонента" Ні / Так, default off.

All three are applied in place: a `TW_PAGE_KEYS` hook calls `twin_pages.changed()`, and nothing is rebuilt.

**Signals (SPEC-R3 §11), all read only.** Each has `"rs"` with non-zero getter and notifier ids, and `tools/signals/check_signals.py` passes:
- `FES.statusSwitchDriveDynamicSport2`: the boost row. The engine already read it, but 0.1.0 did not declare it.
- `KombiIF.statusConfigurationKombi5`.
- `HmiMediaState` (HMI_CID): `trackProgress`, `menu`.
- `TunerFmAmDab.currentStationFmDabAm`.
- `MediaPlayer` (CarPlayMedia): `currentItemPosition`, `playerState`.
- `VoiceCall` (Call1): `state`, `contactID`, `name`.
- `VoiceCallManager.micMuted`.
- `DevicePresentation.deviceList`.
- `Guidance` (Main_Instance): `currentRoad`, `conclusiveDart`, `currentLaneGuiding`, `nextDestinationInfo`, `visualizationInKombiNonNaviEnabled`.
- `TPMS`: `statusTyrePressure`, `statusTyreTemperature`, `statusTargetTyrePressure`.

The handlers are chained behind the engine's own, through one marked call in `twin_tokens.wire()`, and each sets its instance through `$instance`.

**Finding (0.1.0, for the lead):** `twin_tokens.wire` chains `HmiMediaState.playerMetadata` with no `$instance`. The kit's Car therefore subscribes instance "1", and HmiMediaState has no such instance (only HMI_CID / HMI_FoMo_*). On 0.1.0 that field probably never arrived. This is a hypothesis: no log line has been read. B4's wiring sets `$instance: 'HMI_CID'` on the same table entry, so the existing chain is fixed as well.

**Privacy:**
- Titles, artists, station names, road names and the caller's name are drawn and never logged. The log gets lengths, enum names and counts only (`nav page: road 14 characters`, `media page: source CARPLAY`, …).
- The caller's name is kept only while `callerName` is on and the call lasts. It is dropped on DISCONNECTED.
- `friendlyName`, positions, bearings and cover art are never read.
- A canary test checks that no log line holds any of 12 invented texts.

## 2. Files

New:
- `shared/twin_pages.js` (page choice, models, signal handlers, tokens, painter, map rule, TPMS poll)
- `bench/test-twin-centre.js` (163 checks)
- `bench/twin-centre-states.js` (22 page states, shared by the test and the gallery)
- `tools/twin-dial/r3b/b4_gallery.js` (PNGs of every state)
- `tools/twin-dial/r3b/b4_compare.py` (side by side with K2's mockups)
- this report

Changed (mine):
- `design/gen_twin.py`: `centre()` replaced by `page_items()` / `pages_widget()`; `BASE['title']` 282 → 281; the title rule.
- `apps/twin_dial/hud/layouts/twin.json` (regenerated)
- `bench/test-twin-layout.js`

Edits outside my own files, each a marked block:

| File | Hunk |
|---|---|
| `shared/hud.js` | `twinPages` optional require; `IMAGE_TYPES.tdpage`; `TW_RULE.title` (205) and `TW_PAGE_KEYS`; one settings line (in place); `c.on('status')` also hands the text to `twinPages.onStatus`; the title-rule skip in `_twinBackSend`'s rule loop; `_twinBackForce()`; `_create` and `_updateOne` branches for `tdpage` |
| `shared/layouts.js` | `tdpage: ['pages']` |
| `shared/twin_tokens.js` | a lazy `pages()` require; `pages().wire(hud, extra)` at the end of `wire`; the `default:` of `resolve` answers `pg…` tokens |
| `apps/twin_dial/app.json` | `shared` + `twin_pages.js`; the signal blocks above; settings `centre` / `techData` / `callerName`; MAIN item and SETTINGS skip; `config.pages`, `mapWindow`, `mapSlots`, `mapForce`, `mapShutMs` |

The `c_title`, `c_time`, `c_weekday`, `c_date`, `t1_*`, `t2_*` and `t_from` widgets are gone from the layout. The old `cTitle` / `cTime` / `tConsAvg` … tokens and `twin_tokens.page()` are left untouched for `bench/test-twin-pages.js` (B2's). They are no longer drawn and can be deleted once B2 agrees.

## 3. How to run

```
python3 design/gen_twin.py                       # regenerate twin.json (the layout test checks it byte for byte)
node bench/test-twin-centre.js                   # B4's behaviour suite
node bench/test-twin-layout.js                   # geometry, keep-outs, every page's ink inside its box
node tools/twin-dial/r3b/b4_gallery.js           # bake/work/twin-dial/r3b/b4/<state>.png (git-ignored)
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3b/b4_compare.py
```

## 4. Tests

- `bench/test-twin-centre.js`: **163 passed, 0 failed**. It covers:
  - the page of each tab; the cycle, its dwell and its hold above 5 km/h; the choices; the hide setting; the tyre page only with config
  - every page's empty and full state
  - every pg token
  - "dark stays dark"
  - every handler with real catalogue shapes (names and numbers), the instances, and rubbish input that must not throw
  - the TPMS poll: three getters, read only, only while the page shows
  - caller-name privacy; the log canaries
  - the map rule: S1 and S2, stale rows, the 8 s shut, force, `hud.twinMap`
  - B6's manoeuvre names
  - one paint and then none while nothing changes; a repaint on a change and on a night change
  - the settings applied in place; the engine hooks present
  - f30's tree loads without the file
  - Node 8 syntax; `check_signals.py`; the declared fields and instances
- `bench/test-twin-layout.js`: **87 passed** (main: 61; +26 checks).
  - The checks I changed on purpose: the title rule (now 2.5 px with role `title`); the text table (the 13 old centre widgets are gone); "the centre pages are two sheets" became "one own layer, no sheet".
  - New checks: the layer's rect, connection and keep-outs (belt, gear gap, lamps, lamp strip, stored-message marker, both black-box rects); it ends above BMW's panel at 595.75; no backdrop hole under it; every page exists; each page's grammar and SPEC-R3 numbers; and, over all 22 rendered states, every ink box inside the layer and the window's sides, titles above the rule, no token left unanswered, no Cyrillic in a Saira item, every glyph in its atlas.
- `bench/test-twin-pages.js` (B2's file): **one check changed on purpose**. "The layout carries both pages' texts" became "the layout carries every page in one layer, clock first", because the old widgets are gone. 101 passed.

## 5. Picture comparison against the mockups (K2, `bake/work/twin-dial/mockup/r3/`)

`b4_compare.py` crops the window from ours and from K2's mockup. The body's ink box (y 300–570), ours against the mockup:

| Page | ours | mockup | note |
|---|---|---|---|
| clock | 814,340–1100,519 | 823,339–1092,520 | same lines (the mockup's ink is narrower because its "14:43" has different digits) |
| trip | 732,304–1190,570 | 732,304–1190,570 | matches |
| tech | 745,323–1189,550 | 745,323–1191,551 | matches |
| tyres | 753,313–1170,547 | 752,315–1169,545 | ≤ 2 px |
| radio | 814,304–1188,565 | 811,304–1187,560 | SPEC's footer at 565 (the mockup's at 550) |
| track | 800,304–1189,530 | 745,304–1189,570 | SPEC: the progress line x 800–1120 (the mockup's 745–1176); no play glyph |
| phone | 761,320–1164,471 | 775,334–1147,561 | SPEC: no missed-call count, no charging line; text only on line 2 |
| call (incoming / active) | — | — | SPEC: no "Прийняти…" hint; the active card is the timer only (no handset) |
| nav road / calc / none | ≈ | ≈ | 7–28 px higher than the mockup: SPEC's y 400 is used as the baseline |
| guide | 773,323–1173,567 | 772,321–1128,570 | the lanes show as soon as B6's arrows are merged |
| media (certain) | 66 px pictogram only | 110 px pictogram + "Медіа" | SPEC-R3 4.3 (66 px, nothing else) is followed, not the mockup |

## 6. Open problems, decisions and hypotheses (named)

1. **B6's atlases** are not on this branch. Each font role names its atlas and the stand-in to use until it exists:
   - n29 → `td_sub` (stand-in `td_body` 31)
   - s72 → `td_dist` (stand-in `td_clock` 92)
   - the stacked unit uses `td_u19` (K2 drew Noto 15; no such atlas)

   Baselines are the same either way. After B6 merges, the layout test re-checks every glyph and every width against the real atlases.
2. **B6's pictograms** are named per B6's note: `td_proj`, `td_handset`, `td_road`, `td_mic_off`, `td_mute`, `td_turn_*` / `td_uturn_*` / `td_fork_*` / `td_exit_*` / `td_merge_*` / `td_flag_*` / `td_lane_change_*` / `td_rb<n>_r|l`, `td_dot`. An icon that does not exist is simply not drawn; on this branch the trip page's road pictogram falls back to `td_nav`.
3. **"бар" on the technical page** starts 2 px after the value, not 6. The layer ends at x 1191, and 6 px would clip its last letter. The mockup has the same clip.
4. **The map's road bar:** baseline **588**, not SPEC's 590. A layer ending at 595 keeps every descender above BMW's panel (y 595.75). The bar is [760, 556, 1160, 594], black at 0.6, drawn only when a road is known.
5. **Tab 5 with guidance active but `config.pages.guidance` off** shows the road page with "Маршрут прокладено" instead of "… не прокладено". SPEC has no row for that case; this is my choice.
6. Scales and enum readings are hypotheses until the probe:
   - the TPMS pressure (0.1 × unit; the engine's plausible-range reading)
   - the temperature (raw − 40)
   - the battery (0–100) and the signal (0–5, or 0–100 → 0–4)
   - `rawDistance` in metres
   - the first metadata line as the title when no type arrives
   - `navType` 2 / KARTENANSICHT as the map view
   - the slot row meaning `status ≠ 0 && map 1` (SN's rule)
7. **The tachometer hub (SPEC-R3 §2.7) was added afterwards at the lead's request** and is done: see §8.
8. There is no bench-server check that a `centre` change makes no layout build: the in-place path is tested at the function level and by source. B2's tab test counts builds on the bench.

## 7. Final run of every suite (this branch, one at a time, BENCH_PORT 8604)

bottom-row 254, cc-release 57, daynight 24, driver-profiles 105, fonts 34, mb-exp 46, native-ui 47, night 48, probes 25,
scene-tex 54, strip-mask 40, twin-bake 35, twin-budget 75, twin-cc 149, **twin-centre 163 (new)**, twin-fonts 219,
**twin-layout 87** (61 on main), **twin-pages 101** (one check changed, §4), twin-probe 115, twin-sim 39, twin-trip 82.
All green, and the f30_cluster suites keep main's counts.

`test-night` failed 8 checks once, in the batch run right after another bench test on the same port. Run again alone it passed 48 of 48. I take that as a port or timing flake, not this change: B4 adds only inert hooks in the f30 path.

## 8. The tachometer hub (follow-up, SPEC-R3 §2.7)

`twin-b/b6` is **merged into `twin-b/b4`** (merge commit `ec82364`, clean), so the hub is built against B6's real atlases (`td_big` with the gear letters, `td_prog`). When the lead merges B6 first, nothing of it conflicts. B1's final `gen_twin.py` uses the same three baselines, so there is one hub, not two.

| Item | Font / box | Baseline | Ink centre measured from the atlas | SPEC-R3 §2.7 | Result |
|---|---|---|---|---|---|
| gear | `td_big` (Saira 92), GPU text, `maxLen` 2, box 164 px (two pitches of 82), centred on x 380 | 432 | (−1.5, +0.5) px from the dial centre ("D3": the ink is not symmetric in its advance) | (0, 0) R | on target |
| drive programme | `td_prog` (Saira 24), box 150 px, centred on x 380 | 471 | y +62.5 px | +0.209 R = +62.7 | on target |
| READY | `td_label` (Saira 22), box 100 px, centred on x 380 | 321 | y −86.5 px | −0.29 R = −87.0 | on target |

The unit label is B1's face bake at +0.40 R (not touched here).

- **Gear cap height** measures 63 px on the "D" (65 on the speed's "8", which overshoots). SPEC says 0.222 R = 66.6 and "the digital speed's size": same face and size, so same size. The test allows 4 px against 66.6 and 2 px against the digital speed.
- **Clearance to the inner ring:** the ring's outer edge is 0.548 R = 164.4 px. The farthest box corner is 110.0 px (READY), 105.4 (programme) and 89.2 (gear), so ≥ 54 px inside it, far over the 4 px asked. The ink gaps are 47 px (READY to gear) and 21 px (gear to programme).
- **GPU fit:** the gear's GPU layer is four 41 px cells (164 px) whatever the box. The widest ink of any gear string is "M4", 166 px: 1 px of the M's outer stems may be clipped on each side (M8 is 164). This is a hypothesis until a photo; widening the box does not widen the layer (the engine's `_gpuGrid` fixes four cells for `maxLen` 2).
- All 29 gear strings (P R N D –, D1–8, M1–8, S1–8) have their glyphs in `td_big`; every programme fits its box (widest "ADAPTIVE", 142 px); no Cyrillic reaches the three Saira widgets.
- Layout planner after the change: connection 1 has the same number of layers; the left hub's label sheet is 150 × 172 (it was 140 × 250). `td_gear` is no longer used by the layout (B6: its `TWIN_FONTS` line can go).

Files: `design/gen_twin.py` (`HUB` baselines, the two x terms, fonts), `apps/twin_dial/hud/layouts/twin.json`, `bench/test-twin-layout.js` (the three old text rows replaced; a hub section of 15 checks; Saira list extended with B6's names). Layout test: 102 passed.

Merge note for B1's hunk: B1 keeps `title: 282` in `BASE`; B4 has 281 (SPEC-R3 §4 header). Keep 281. B1's `BASE` hub entries and mine are the same numbers; take B4's `HUB` block.

Budget test: it failed twice mid-session with a kit-build error and a few highlight checks, then passed 75 of 75 on the next two runs with identical code. I believe other packages run the same test in the shared `bake/work/.../budget-root` at the same time. Rerun it alone at the end.
