# Twin Dial 0.1.1 — the integration of round 3b (B1 … B7)

The merge candidate is **`twin-b/integrate`** (worktree `.claude/worktrees/b3-int`), made by package B7 from `main` (c1f53f2).
Every package was merged with `--no-ff` in the brief's order (B6 → B1 → B2 → B3 → B4 → B5) as each one became usable; B3
landed last, so the actual order of the final merges was B6, B1, B2, B4, B5, B4's hub follow-up, then B3. Conflicts were
resolved only in the packages' marked hunks; every integration edit of my own is a commit named "Integrate: …" and is listed
in §4. Nothing pushed, no version changed. Nothing here has run on a car except the values of §6, which the lead verified on
the owner's car on 2026-11-18.

## 1. What was merged

| Package | Branch tip merged | What it brings |
|---|---|---|
| B6 fonts, pictograms, atlases | `twin-b/b6` 452ed20 | 24 atlases (td_big with the gear letters, td_prog, td_cru, td_dist, td_sign, td_sign3, td_sub, td_tabs …), 83 icons, slot tables, `bake_b6.sh` |
| B1 faces, shaders, textures | `twin-b/b1` 9d820f7 | re-baked R8 faces (look B, SD's shadow, the rings), `tdial` (red arc, `u_lim`, `u_cru`, strip L1/L2/L3), `tdback` (tab colours, cells, `u_map`), hud.js hooks `_twinMarks`, `twinTab`, `twinMap` |
| B2 live tabs | `twin-b/b2` 64e10fc | `shared/twin_tabs.js`, settings Таба / Не перемикати таби вище, auto rules, the tab bar, the bottom row by tab |
| B4 centre pages | `twin-b/b4` ed4fb94 (includes B6 via ec82364) | `shared/twin_pages.js` (one `tdpage` layer), tabs 1–5, technical data, dark pages, the map window rule, the tachometer hub |
| B5 limit and cruise | `twin-b/b5` de25533 | `shared/twin_limit.js`, the sign sheet on connection 2, the markers, the cruise readout (dark) |
| B3 messages in the centre | `twin-b/b3` 4ccb34e | `shared/twin_cc.js` (SC's machine, the tab-2 sheet), the bottom row on connection 0, the narrowed release |
| B7 integration layer | `twin-b/b7` ab1fe8f | `shared/diag_settings.js` (Діагностика, start-up hold), `tools/twin-dial/run_all_tests.sh`, `bench/test-diag.js` |

## 2. Every shared-file hunk, by package (as on the branches)

New files (no conflict possible): `shared/twin_tabs.js` (B2), `shared/twin_pages.js` (B4), `shared/twin_limit.js` (B5),
`shared/diag_settings.js` (B7); tests `bench/test-twin-tabs.js` (B2), `test-twin-centre.js` + `twin-centre-states.js` (B4),
`test-twin-limit.js` (B5), `test-diag.js` (B7).

**`shared/hud.js`** (`git diff -U0 main...twin-b/<pkg>`):

| Package | Hunks |
|---|---|
| B1 (65 lines, marked `twin_dial B1`) | `TW_NIGHT` amber 0.80 + `tab`; `TW_RULE.tab` 230; new `TW_TAB`, `TW_FLOOR`, `TW_ARC_END`, `TW_MAP`, `TW_LIM_STRIP`, `twinLin`, `twinEnc`; `_twinDialSend` `u_red.w` 143.6 and `_twinMarks(x)`; new `_twinMarks`; `_twinBackInit` the five `cells`; `_twinBackSend` key with tab and map, separators 84, the fill / rule-under-cell / `u_map` uniforms |
| B2 (20 lines, `twin_dial: tabs (B2)`) | `twinTabs` require; `TW_TAB_KEYS`; the settings listener's in-place branch; `twinTabs.wire` in `_setupVehicleData`; `_twinSync` → `twinTabs.update`; `_twinTabsOn` / `_twinTabsChanged`; the tick's `_twinSync` |
| B3 (273 lines) | `IMAGE_TYPES` `ccplate` → `ccsheet`; `TW_TAB_FILL` (stand-in); `TwinCentre` construction; the sheet's refusal path; `_twinBackInit` cells / `_twinBackSend` fill (stand-in); the rebuild's machine step; `cc:row` toggles; `ccsheet` init; `ccReleased` and the narrowed `leftList` in `_ccRelease`; `_twinInputs` (entries); `_twinTabNow`, `_twinTabMoved`, `_twinTabChosen`; `_twinPush` with the re-entrancy guard; the sheet painter; the tick's sheet branch |
| B4 (20 lines, `round 3 B4`) | `twinPages` require; `IMAGE_TYPES.tdpage`; `TW_RULE.title`, `TW_PAGE_KEYS`; the listener's page branch; cluster-render status → `twinPages.onStatus`; the title rule's hide on the map page; `_twinBackResend`; `tdpage` init and tick |
| B5 (13 lines) | `twinLimit` require; `IMAGE_TYPES.tdsign/tdcru`; `twinLimit.wire`; `twinLimit.dial(this, x)` in `_twinDialSend`; the `tl:` toggle; `tdsign` init and tick |
| B7 (7 lines, `b7:`) | `DiagSettings` require; the overlay in the constructor; the listener's first line (diagnostics settings); `hold()` at the top of `_rebuildInner`; `release()` in `stop()` |

**`shared/twin_tokens.js`**: B2 (62: `cTitle`, `TITLES` for tabs 2–5, `iconState` / `updateIcon` → twin_tabs, the row tokens
`rowL1 … rowR2u`, `page()` by tab), B3 (15: `TAB2_TITLE`, `WARN_ICON`, its own `iconState`), B4 (8: `pages()` require, page
names). **`shared/layouts.js`**: B3 `ccplate` → `ccsheet`, B4 `tdpage`, B5 `tdsign` / `tdcru`. **`shared/shaders.js`**: B1
only. **`shared/menu.js`**: B7 only (2 lines). **`shared/twin_icons.js`**: B6 (generated). **`design/gen_twin.py`**: B1 (hub
baselines), B2 (tab bar, `ICON_Y` 147, `ICON_BOX` 46, `TAB_FONT`, the row's tokens), B3 (row on connection 0 with `cc:row`, the
tab-2 sheet `tab2_sheet()`, the plate removed), B4 (`pages_widget()`, title 281, the hub `HUB`), B5 (`limit_seam()`).
**`apps/twin_dial/app.json`**: B2 (settings `tab`, `tabLock`; `config.tabs`, `tabKey`), B4 (`techData`, `callerName`;
`pages`, `mapWindow`, `mapSlots`, `mapForce`, `mapShutMs`; the media / phone / guidance / TPMS signals), B5 (`twin_limit.js`;
`TrafficSignDisplayControl`; `config.sign`, `limit`, `cruise`), B7 (`diag_settings.js`; BTN_DIAG, DIAG, five settings,
`startupHold`, `diag`), B3 (the narrowed release's comment). **`apps/f30_cluster/app.json`**: B7 only (§3 of B7-REPORT).
Tests edited by more than one package: `test-twin-layout.js` (B1, B2, B3, B4, B5), `test-twin-pages.js` (B2, B3, B4),
`test-twin-budget.js` (B1, B3), `test-twin-fonts.js` (B4 via B6, B6). **B3 also edited an f30 suite**, `bench/test-cc-release.js`
(4 lines: the narrowed leftList's reading), still 57 checks.

## 3. Conflicts found and their resolution

| Merge | File | Conflict | Resolution |
|---|---|---|---|
| B6, B1 | — | none | — |
| B2 | `app.json` | SETTINGS `skip`: B7's diagnostics keys against B2's `tab` | both lists |
| B2 | `test-twin-layout.js` | the hub line (B1) against B2's tab-range line | B1's hub line and B2's tab-range line (a first resolution kept the wrong line: fixed in ff482a3) |
| B4 | `app.json` (3) | MAIN items, SETTINGS `skip`, `config` tail | both settings rows (`tab`, `techData`), both skip entries, both config blocks |
| B4 | `hud.js` (3) | the requires; `TW_RULE`; the settings listener | both requires; `TW_RULE` = B1's tab 230 **and** B4's title 205; **one** in-place branch for B2's tab keys and B4's page keys (§4 a) |
| B4 | `gen_twin.py`, `test-twin-layout.js`, `twin_tokens.js` | `BASE`; the tab-bar check; requires | B4's `BASE` (title 281) with B2's tab-bar constants; B2's tab-bar check + B4's title-rule check; both requires |
| B5 | `app.json` (3), `hud.js` (4), `layouts.js`, `gen_twin.py`, `test-twin-layout.js` | shared list, signals, config, `IMAGE_TYPES`, the widget lists, the centre check | both sides everywhere (`tdpage` + `tdsign` / `tdcru`; `[pages_widget()] … + limit_seam()`; B4's centre check + B5's "cc:" sheets check) |
| B4 hub (ed4fb94) | `gen_twin.py` (3), `test-twin-layout.js`, `twin.json` | the hub: B1's baselines in `BASE` against B4's `HUB` with td_big / td_prog | **B4's HUB** (gear td_big 164 px box baseline 432, program td_prog 471, READY 321), as the lead asked; B2's tab-bar constants kept; twin.json regenerated |
| B3 | `hud.js` (7) | `IMAGE_TYPES`; B3's `TW_TAB_FILL` stand-in; the cells; the backdrop key; the fill; init; tick | `ccsheet` + `tdpage` + `tdsign` / `tdcru` (the plate gone); **B1's colour table and cells** (B3's stand-in dropped, as its report asks); the tab for the fill: B2's when live tabs run, else B3's machine's (§4 f); B3's sheet init and tick, B4's `tdpage` lines |
| B3 | `gen_twin.py` (3) | the docstring; `row()`; `widgets()` | **B2's row tokens with B3's connection 0 and toggle `cc:row`** (with `cc:rest` the row would never return while our card covers the panel); `tab2_sheet()` replaces `plate_seam()`, B4's `pages_widget()` and B5's `limit_seam()` kept |
| B3 | `twin_tokens.js` (2), `layouts.js`, `test-twin-pages.js`, `test-twin-layout.js`, `test-twin-budget.js` (5) | `TITLES`/`cTitle`, `iconState`; the types; the icon check; the connection-2 check; the fill checks | B2's `TITLES` / `iconState` (B3's report says so); `cTitle` reverted to B2's form (B3's `TAB2_TITLE` would be undefined) with a no-tabs fallback; B1's fill checks + B3's "window with no severity" check; connection 2 = tab 2's sheet as the only "cc:" sheet beside B5's sign |

## 4. Integration fixes (each a commit "Integrate: …" on `twin-b/integrate`)

a. **One in-place settings handler** for B2's `TW_TAB_KEYS` and B4's `TW_PAGE_KEYS` (both had `centre`: the first branch would
   have swallowed B4's page change); B2's and B4's tests read the new text (de3c957, fd63c8b). `techData` moved after
   `tabLock` in the settings list (B2's test wants tab / tabLock right after centre).
b. **twin.json regenerated** after B6's atlases were in the tree (B2's note: td_tabs is picked up), and after every later merge.
c. **Tab icon slot 46 px** (the lead's item 3): `tools/twin-dial/a1/build_twin_icons.js` slot `tab` 36 → 46 (a 46 px box whose ink
   is the spec's 36 px: the pump's ink is exactly 36), `icons.json` and `twin_icons.js` regenerated, `test-twin-fonts.js` expects
   46. **The icon centre line stays at y 147, not SPEC-R3 3.1's 143**: 36 px of ink centred on 143 would stand 1.5 px above the
   bar's top (127); 147 is K2's approved mockups. A deliberate deviation from the spec's number, kept.
d. **ResetLogic3 `bcData3` is an array** (CP's finding; the lead's item 6): `twin_tokens.rl3Entry()` takes the first entry that
   carries a value (else the first object; a plain struct as before), so the rl3 trip fallback can now produce values;
   `test-twin-trip.js` §3b (array of one, unfilled entry skipped, all unfilled and empty → dashes).
e. **td_gear retired** (B4's hub draws the gear in td_big): the atlas (69 KB), its bake line, its slot entry, the font
   snapshot entry, twin_limit's digit fallback; `test_bake.py` counts 11 Saira atlases, `test-twin-fonts.js` checks it is gone.
f. **B3's machine and B1/B2's tab bar agree**: the backdrop's fill uses B2's tab (mirrored on `twinTab`) while live tabs run,
   else B3's machine's tab (an app without `config.tabs`, e.g. test-twin-cc's stand-in); `twin_tabs.selected()` and `cTitle`
   fall back to the machine the same way. `test-twin-cc.js`'s stand-in packs `twin_tabs.js` / `twin_pages.js` (twin_tokens'
   icon state lives in B2's module now) and checks B1's linear-light fill and B2's icon-state form (`color: 'red'`, not `rgb`).
   `test-twin-tabs.js` holds B3's push while it injects a message state (B2's rule alone; B3's suite drives a real message).
g. **The tab bar's inputs from B4's page model** (the lead's item 4: B4 did not set them): `twin_pages.tabBridge()` sets
   `hud.td.mediaSource` (tuner / player / projection) and `hud.td.phoneConnected` from the media menu and the device list,
   **only while `config.pages.media` / `config.pages.phone` are on** (until the probes the tabs keep the plain icons, SPEC-R3
   3.3); tested in `test-diag.js`. The media text stays with twin_tokens (`config.twin.media`).
h. **The slot-log setting writes B4's `config.mapSlotLog`**, not `mapSlots` (which switches the map window's presence rule to S1,
   unproven); the slot rows are asked every 2 s on tab 5 while the log is on, and logged once per state (B4 logged once per run).
i. **The start-up hold reports the blind state** while it waits (found by test-twin-sim on twin-b/b7: "ready and none" for up to
   1 s); fixed on twin-b/b7 (ab1fe8f) before its merge.
j. **The car-verified values of §6** (tab key, trip distance factor, MileageSupreme in metres).
k. **B4's page layer goes up whole after a build** (`twin_pages.init`: `x.px = null` instead of a zero buffer that was never sent,
   so `_blitDiff` sent only the changed rectangle into a fresh layer). Found with `measure.js` on a forced rebuild (§7).

## 5. Test results (every suite alone, `sh tools/twin-dial/run_all_tests.sh`, port 8651)

At `twin-b/integrate` c9fca28 (every package merged, the car values in) — the full run, every suite alone on port 8651:

```
suite                   passed  failed    main  note
bottom-row                 254       0     254  
cc-release                  57       0      57  
daynight                    24       0      24  
diag                        98       0       -  new
driver-profiles            105       0     105  
fonts                       34       0      34  
mb-exp                      46       0      46  
native-ui                   47       0      47  
night                       48       0      48  
probes                      25       0      25  
scene-tex                   54       0      54  
strip-mask                  40       0      40  
twin-bake                   37       0      35  ! count differs from main
twin-budget                 95       0      75  ! count differs from main
twin-cc                    249       0     149  ! count differs from main
twin-centre                163       0       -  new
twin-fonts                 327       0     219  ! count differs from main
twin-layout                106       0      61  ! count differs from main
twin-limit                 152       0       -  new
twin-pages                 100       0     101  ! count differs from main
twin-probe                 115       0     115  
twin-sim                    39       0      39  
twin-tabs                  199       0       -  new
twin-trip                   89       0      82  ! count differs from main
check_signals               ok       0       -  (apps/f30_cluster, driver_profiles, twin_dial)
bake-py                85 passed, 0 failed       0       -  
---
24 suites, 2503 passed, 0 failed, 7 count(s) differ from main
ALL GREEN
```

After it only §4 k changed (B4's page layer); the suites it touches were run again alone: see the last line of this section.

Counts that differ from `main` (all on purpose): twin-bake 35 → 37 (B1), twin-budget 75 → 95 (B1, B3), twin-cc 149 → 249 (B3's
rewrite), twin-fonts 219 → 327 (B6, B4, integration), twin-layout 61 → 106 (B2–B5, integration), twin-pages 101 → 100 (B3
removed the plate's check, B2 / B4 changed others), twin-trip 82 → 89 (integration §4 d, j); new: diag, twin-centre,
twin-limit, twin-tabs. f30_cluster's suites (bottom-row, cc-release, daynight, fonts, mb-exp, native-ui, night, probes,
scene-tex, strip-mask) and driver-profiles keep main's counts. Timing: `bottom-row` (f30) failed twice (two different timing checks, 253 / 254) while other packages' suites ran on the same Mac (load average about 9); alone it passed 254 / 254 both times it was repeated. `twin-cc` 3c ("the window shut 106 ms after the plate went up") failed once the same way and passed alone. Never run two suites at once (test-twin-budget and the bench share `bake/work`). After §4 k (7eb236e), run again alone: twin-centre 163, twin-pages 100, twin-tabs 199, twin-sim 39, twin-budget 95, twin-cc 249, diag 98 — all 0 failed.

## 6. Car-verified (the lead, the owner's car, 2026-11-18, signal_probe log; the owner confirmed the presses)

1. **The tab key**: the stalk's TRIP button is bit **0x40** of `de.bmw.body.Light` `IndicatorSteeringColumn.operationColumnStalks`
   (UInt8, notifier 32773, no getter): declared `"s"` in `apps/twin_dial/app.json` (check_signals passes);
   `config.tabKey = {iface: "de.bmw.body.Light", field: "IndicatorSteeringColumn", path: ["operationColumnStalks"], mask: 64,
   invalid: [255]}`. 17 presses gave 17 clean 0 → 0x40 → 0 pairs, held ~0.15 s, ~0.5 s apart; only the rising edge is a press
   (B2's handler; the rate limit 300 ms is below the 0.5 s spacing). Integration addition: **255**, the catalogue's unfilled
   default with every bit set, is no state (a 0 → 255 change would otherwise have been a press). `test-twin-tabs.js` §2a injects
   the car's bytes: a rising edge advances one tab, held and falling do nothing, other bits are ignored, 255 is ignored, 17
   presses give 17 steps.
2. **Trip factors** against the car's own trip page (15.5 l/100 km, 13.7 km/h, 19.2 km, 1:28): `config.trip.factors` = speed 0.1,
   cons 0.1, **way 1** (not 0.1), bc 1; hours and minutes plain. ResetLogic3's factors stay unverified (`trip.verified` stays
   false, so its first arrivals are still logged UNVERIFIED).
3. **Odometer**: `statusRangeTankStatus.mileageKilometre` factor 1 (114747 km); **MileageSupreme carries metres** (114747213):
   factor 0.001, and twin_tokens now reads it as a UInt32 (the 24-bit "unfilled" marker 0xFFFFFF would have thrown every real
   value away).
4. **f30's stuck window**: `statusActiveCCMessage` sits on **65535** from start (once for 6842 s) = research3/MC's case A1/A2: the
   f30 Діагностика setting "Release a stuck check-control message" (`deferValues [65535], leftList`) is the switch for it.
   Twin Dial keeps D7 strict: no "shown now" number has matched a list entry on the car yet.

## 7. The layer and memory budget of the merged layout

Measured, not estimated (bench accounting: each image and each uncompressed asset counted twice, as cluster-render does):

| | layers per connection | pixel memory | how |
|---|---|---|---|
| the layout plan | 7 / 4 / 3 (connection 0 gained the bottom row's sheet; connection 2: tab 2's sheet, the sign, and the cruise readout's slot) | — | `bench/test-twin-layout.js` |
| on the bench, cruise off | 13 layers made, 5 assets (878 KB) | **4.75 MiB steady** | `node tools/research3/mp/measure.js twin_dial --quick` |
| **a full rebuild of the merged layout** (forced by `mbRebuild.onMode` on a drive-mode change, and the three start-up builds with `startupHold: false`) | the same 13 | **peak 4.75 MiB** (before 4.75, after 4.75) | the engine drops every layer before it makes the new set, so old and new never coexist |
| the budget suite's own app | 5 / 3 / 2 | 4.31 MiB steady, 4.31 MiB peak across switches | `bench/test-twin-budget.js` |

B3's estimate of 8.2 MiB assumed old and new together; the drop-first order of `_rebuildInner` keeps the peak at the steady
figure: **4.75 MiB, inside the 6 MiB steady and the 8 MiB peak budget** (and the scene textures are kept across builds). Shader
sizes (B1's report, `test-twin-budget.js`): `tdial` 5763 bytes ≤ 8 KB, `tdback` part L 2672 bytes ≤ 6 KB.

The start-up hold on the merged app (`measure.js`, start phase): with `startupHold` (shipped) **1 build, 2802 KB** on the wire,
the complete screen at +417 ms on the bench; without it 3 builds, 5199 KB, the final one complete at +366 ms. At the upload
floor of 2000 KB/s that is 1.4 s against 2.6 s.

The measurement found one fault, fixed (§4 k): after a rebuild B4's page layer got only a rectangle of pixels, never a whole
frame (its "previous" buffer was a zero buffer that was never sent); now every build's first paint of it is whole and every
build reaches "complete".

## 8. Open for the lead

- f30's `startupHold` (B7-REPORT §1.2): off; one line when wanted.
- B3's rebuild peak: see §7.
- `bench/test-cc-release.js` (f30) was edited by B3 (same count).
- Not merged, as told: the probe edits of `twin-r3/{sm,sp,sn,sv,sb}`; main's probe files are unchanged.
