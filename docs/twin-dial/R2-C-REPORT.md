# R2-C: the app, the layout generator, the pages and the tokens

Branch `twin-dial/r2-c` (from `twin-dial/r2`). Nothing pushed, no version bumped, `apps/f30_cluster/` and
`apps/driver_profiles/` untouched. Authority: `docs/twin-dial/SPEC.md` rev 2 and `docs/twin-dial/ENGINE-CONTRACT.md`
(package B's contract, `bake/work/twin-dial/pub/R2/B/CONTRACT.md`).

## 1. What was built

| File | What |
|---|---|
| `apps/twin_dial/app.json` | id `twin_dial`, "Twin Dial", 0.1.0, `loggingId` OATD, glyph "TD"; `shared` per SPEC 14.1 plus `twin_tokens.js`, `twin_icons.js` (A1), `twin_cc.js` (D), `twin_probe.js` (F); `signals` = SPEC 11 (14 interfaces: VS's block minus what round 2 does not draw, `_about` notes on the unseen ones); settings; config. `tools/signals/check_signals.py` against the 2026-11-15 catalogue: all declarations pass. |
| `apps/twin_dial/main.js` | kit `mgu.run`, `require('./twin_icons')`, engine, `shared/menu.js`; no gallery. |
| `apps/twin_dial/NOTICE` | Saira, Noto Sans (OFL), the kit, cluster-render. No maker's name. |
| `apps/twin_dial/hud/layouts/twin.json` | generated (below). 38 widgets. |
| `design/gen_twin.py` | the layout generator (gen_6wb pattern: text placed by its BASELINE, box built round it from the atlas as baked now). |
| `shared/twin_tokens.js` | the `{{td:...}}` tokens, the centre pages' cycle, the extra signal wiring, the live tab-bar icons. |
| `bench/test-twin-layout.js`, `bench/test-twin-pages.js`, `bench/twin-harness.js` | the two tests the brief asks for (60 + 98 checks) and the harness that requires the real engine headless. |
| `tools/twin-dial/c/font_snapshot.py`, `design/twin-dial/c/font_metrics.json` | the generator's fallback while the atlases are not in the tree (and a test that the two agree once they are). |
| `tools/twin-dial/c/a1_td_clock.patch` | the proportional clock atlas, as a patch on package A1's files (see 5). |

`mgu-repo.json` needs no entry: it lists `"path": "apps/*"`, so `apps/twin_dial` is found by the glob exactly as `f30_cluster` is.

### Settings (SPEC 14.3) and the on / off

`hudLayout` ("Cluster": Twin Dial | Off, BMW's own), `centre` (clock | trip | cycle, default cycle), `redline` (number, 5000..7500
step 250, default 6500), `nightLook` (auto | on | off), `bandGain` (0.6..1.7 step 0.1, default 1.0), `demo` (off | on, default off).
The "enabled" switch is `hudLayout = off`, which the engine already turns into "nothing drawn, no layer, no asset" (the same
mechanism as f30_cluster's Off). Coexistence (SPEC 14.5), found: `shared/screen.js` keeps only `cluster` and `hud` apart, and both
cluster apps are `cluster`, so **twin_dial and f30_cluster do not see each other**; the owner turns one of them to Off. The menu says so
nowhere yet (a hint line is a lead's call).

### Layers (SPEC 13.2), as the engine's own planner plans them (`test-twin-layout.js`)

| Conn | Layers |
|---|---|
| 0 | `bg_l`, `bg_rt`, `bg_rb` (tdback), `dial_tach`, `dial_speed` (tdial), `speed` (GPU text, one layer) = 6 |
| 1 | `gear` (GPU, two layers: odd figure pitch 57), the tab bar's sheet 672x45, the clock page's sheet 440x285, the trip page's sheet 446x218, the left hub's sheet 140x250 = 6 |
| 2 | the bottom row's sheet 488x93, the plate's sheet 441x57 = 2 |

Text sheets cost **2.73 MiB** (each image counted twice); with A2's faces (1.32 MiB), the mask (0.11 MiB) and the GPU atlases that is the
SPEC's ~4.4 MiB. B's `bench/test-twin-budget.js` is the authority; I could not run the whole layout through it (B's engine is not in my
tree). The centre pages are **two** sheets, not the SPEC's one 540x400: a text of the clock page overlaps a text of the trip page, and the
planner never puts overlapping boxes into one sheet (their repaint would erase each other). Cost: 1.72 MiB against 1.65 MiB.
The page change is still a repaint: both pages' texts are in the layout all the time, and a token answers "" while its page is not the
one showing.

## 2. The tokens (`shared/twin_tokens.js`)

The brief put the tokens in `shared/hud_text.js` / `hud_data.js`; those two files draw a bitmap text and open the data folder, the tokens
live in `hud.js _token`. So: a new C-owned module, and **one marked hook** in `hud.js _token`'s default branch. All `{{td:...}}`:
hub `speed gear program ready`; tab bar `rangeTab media`; centre `cTitle cTime cWeekday cDate`, `tConsAvg tSpeedAvg tDist tTime tFrom`
and the four units; bottom row `odo clock r1 ambient`. A value that is missing is "–" (U+2013), the clock "––:––", never a stale one.
Local time and date come from the car's zone (`hud._tzMinutes()`, the f30_cluster path: `config.clock`, then `config.clockLocal`); with no
zone there is no time at all (the head unit runs on UTC, so no guess). The weekday is computed from the local date, in Ukrainian lower
case (the apostrophe U+02BC). Odometer: `mileageKilometre` with a thin space. Temperature: sign always shown, one decimal.
Trip: from the car's raw fields through `config.trip.factors` (`null` = dashes everywhere, P4); `factors.bc` picks BC1 or BC2.

Centre pages: `centre` = clock | trip | cycle. Cycle: 10 s per page while standing; above 5 km/h the page is held and the dwell starts
at the stop; a missing speed counts as standing; the page is decided at most every 250 ms so every widget of one tick sees one page
(`config.twin.cyclePageMs`, `holdAboveKmh`).

Signals wired (`wire(hud, extra)`, only when `config.twin` is set, chained BEHIND the engine's own handlers, a throw is caught): the odometer
and the reserve flag's raw value (`statusRangeTankStatus`; the reserve's drawing is B's `_raw('reserve')`), the three trip structs,
`UnitBN2020`, the call state, `guidingState`, the media text's two LENGTHS (the text is kept only when `config.twin.media` is on after P8).
Log lines are numbers, enums and lengths; `test-twin-pages.js` feeds a secret string and proves it is in no log line.

The tab bar's pictograms are `icon` widgets with `"tdLive"`: `twin_tokens.updateIcon` repaints them when their state (call, route, message
severity) or the night colours change, so a night change needs no rebuild (`_nightLive` counts them as live).

### Every edit outside my own files (all marked `// twin_dial`, all inert for another app)

* `shared/hud.js`: the `twin_tokens` require (**guarded**: f30_cluster's `app.json` does not pack it, so a missing file is `null` and every hook below does nothing; any other load error is rethrown); the `{{td:...}}` branch of `_token`; `twin.wire` before `new Car`; `config.carGroups || [...]` for the Car's groups (twin_dial does not declare accel / torque); the icon branch of `_updateOne`; `tdLive` icons in `_nightLive`'s `live()`.
* `shared/menu.js`: two lines, `byMode` is not declared by twin_dial (no "Same theme in every drive mode" line).
* `tools/bake_fonts.py`, `bench/test-twin-fonts.js`, `tools/twin-dial/a1/test_bake.py`, `design/twin-dial/font_slots.json`: only as the patch in 5.

## 3. Evidence

| Check | Result |
|---|---|
| `node bench/test-twin-layout.js` | 60 passed, 0 failed, 2 skipped (below), with the atlases (A1's, lent by `TWIN_FONTS=<dir>`; in my branch only `td_clock.json` is committed) |
| `node bench/test-twin-pages.js` | 100 passed, 0 failed |
| `tools/signals/check_signals.py` on `apps/twin_dial/app.json` | all declarations pass |
| kit build `python3 kit/tools/build.py twin_dial` (in a scratch merge of A1 + C with stub `twin_cc.js` / `twin_probe.js` / the bench's `oap-sdk` stub, all uncommitted) | builds, 1428 KiB, `hud/` 4.5 MB packed to 0.44 MB; no stub in anything tracked |
| bench start (`node bench/server.js twin_dial`, 15 s, port 8204, stopped by the script) | the app starts, subscribes all 14 interfaces, the menu fills (STATUS says why nothing is drawn: "layout twin: unknown type tdback", B's types are not in my tree), no exception |
| f30_cluster suites on this branch | bottom-row 254, native-ui 47, strip-mask 40, fonts 34, probes 25, daynight 24, night 48: **unchanged** (see the last line of 6) |
| A1's `bench/test-twin-fonts.js` on the merged tree | 219 passed after the patch of 5 (it had 1 failure on my layout: its token list did not know `{{td:...}}`) |
| mutation checks | cycle dwell 10 s -> 5 s: 4 failures; `ready` baseline +1: fails; the layout test also fails on a changed font cell (snapshot vs atlas) |

Skipped in `test-twin-layout.js`, both because B's engine is not merged: `shared/layouts.js` does not know `tdial` / `tdback` (the rest of the
layout is validated with those two taken out; after the merge the same line validates the whole file), and the theme `twin` is not in
`hud_themes.js` (the colour roles are checked against the contract's list: fg dim hot ready amber grey rule bg).

**Not proven** (hypotheses until the car or the merged engine says): the two dial layers and three background layers rendering (B's shaders);
the GPU text of the gear with letters in the engine's spare cells (the engine's `_gpuTextWhy` accepts it and the pitch is whole; the shift
traffic is not simulated); the pixel position of every text against the mockup (E's comparison); any signal on the car (odometer, trip,
phone, media are "unseen", P3-P9); the dim level of the phone / navigation icons (SPEC "dim (0.5)": I use the theme role `grey`, 111, the tab ramp's bottom).

## 4. Findings and decisions for the lead

1. **Unit labels are in the faces.** A2 bakes "1/хв × 1000", "км/год", OFF, the bar ends and the icon under each dial into the faces
   (its NOTE, SPEC 13.1); the brief also listed "unit" as C's hub label. I draw only READY, the drive programme, the speed and the gear.
   Drawing the units too would double them.
2. **Contract typo, B:** ENGINE-CONTRACT 1.1 says the speedometer bar runs `x0..x1 = 1394..1646`; the dial centre is 1540, so it is
   **1414..1666** (A2's face: 182..434 + 1232). The layout uses 1414/1666; `test-twin-layout.js` asserts it. B should fix the text (the
   shader should take the bar from the widget).
3. **The dial layer rects meet BMW's lamp holes** (the speedometer's [1230, 90, 1850, 660] covers the three right lamps' holes, the tachometer's
   the left four): unavoidable for a 620 px layer. Both rings keep 3.0 px from every lamp box (`test-twin-layout.js` measures it), so the
   `tdial` shader must be fully transparent outside its disc (the contract says alpha 1 only inside 1.0128 R). `shared/visible.js` would warn
   about the rects; the test checks the dials by their ink (the ring), the texts by their boxes.
4. **`shared/visible.js` black-area model:** the digital speed (1540, 400) lies in the model's "BMW's black area" [1420, 320, 1611, 440]. SPEC 3.3 does not list it as a
   keep-out and 17.3 keeps the gear gap closed so that it is not provoked; the test allows exactly that one warning.
5. **Bottom-row toggle** is `!cc:open` (the engine's own today). Package D refines it (`cc.state` none | window | ours); the plate is only a
   placeholder (`plate_head`, a `{{ccHead}}` text, toggle `cc:ours`) so the layer exists in the budget; D replaces it.
6. **f30_cluster does not pack `twin_tokens.js`** and `hud.js` now requires it: hence the guarded require. Packages D and F need the same
   guard for `twin_cc.js` / `twin_probe.js` if hud.js requires them (their files are not in f30's `shared` list either).
7. **Media text** is clipped to 14 characters with "…" by the token (the engine has no pixel clip with an ellipsis for a tab text); round 2 draws
   no media text anyway (icon only until P8). The range value in the tab bar is right-aligned to its widest form ("888"), so a 2-digit range
   leaves a gap after the icon (the mockup's left-aligned unit would need one widget per width).
8. **The gear atlas pair:** two GPU layers (pitch 57 is odd). Clock page: **`td_clock`**, proportional digits, see 5.
9. Settings not in SPEC 14.3 and not added: none. `config.probe` is not in `app.json`; `legacyProbes: false` is (package F's gate).

## 5. For the lead to merge: the proportional clock atlas (instruction 4)

A1's `tools/bake_fonts.py` has the twin_dial list; mine does not (I merge nothing). `tools/twin-dial/c/a1_td_clock.patch`
(`git apply`, after A1's merge) adds a `tabular=True` keyword to `bake()` / `make_font()` (digits keep their tabular advance unless
it is False) and the 17th slot `td_clock` (Saira 92, `DIGITS + ':-–'`, stretch 1.06, proportional: "1" advance 45, "0" 80, ":" 26),
updates `font_slots.json`, `bench/test-twin-fonts.js` (17 atlases; `{{td:speed}}` style token names; td_clock is proportional) and
`tools/twin-dial/a1/test_bake.py` (7 Saira atlases). `apps/twin_dial/hud/fonts/td_clock.json` (+0.07 MiB R8 atlas) is committed on my
branch and is exactly what `python3 tools/bake_fonts.py twin_dial` writes after the patch (nothing else of A1's atlases changes: checked).
`c_time` of the layout uses it; the digital speed keeps `td_big` (the GPU text needs one pitch).

## 6. How to run

```
python3 design/gen_twin.py                    # regenerates apps/twin_dial/hud/layouts/twin.json
node bench/test-twin-layout.js                # TWIN_FONTS=<A1's fonts dir> before A1 is merged
node bench/test-twin-pages.js
python3 tools/signals/check_signals.py reference/car/2026-11-15/someip/someip-interfaces.json apps/twin_dial/app.json
python3 kit/tools/build.py twin_dial          # needs the files of D and F in shared/ and the bench's oap-sdk stub (git-ignored)
```
After the merge of A1, B, D and F: regenerate (`python3 design/gen_twin.py`; with the atlases in the tree it reads them and the test
compares the snapshot with them), run the three tests above and A1's `test-twin-fonts.js`, B's budget test.
