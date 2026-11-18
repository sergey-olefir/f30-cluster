# B3: messages in the centre (Twin Dial 0.1.1)

Branch `twin-b/b3` (from `main` c1f53f2). No car; nothing here is proven on a car. No push, no version bump, `apps/f30_cluster` and
`apps/driver_profiles` untouched. Authority: `docs/twin-dial/SPEC-R3.md` section 5; the model is SC's (`twin-r3/sc`,
`docs/twin-dial/r3/SC-REPORT.md`).

Labels: **verified** = a test on this branch fails when the behaviour breaks; **hypothesis** = needs the car or the service.

## 1. What was built

| Item | Where | Status |
|---|---|---|
| SC's machine ported into **production code**: `TwinCentre` (verdict + tab overlay + the per-turn plan + the two 150 ms settles), `layoutTab2`, `paintSheet` | `shared/twin_cc.js` (rewritten; round 2's `TwinCC` verdict kept as it was; `paintPlate`, the plate geometry and `wrapHeadline` removed) | verified |
| States none / window / ours with **tab 2 selected** as part of the transition; the card for the shown message; the bottom row returns only after the window has shut (so also in `ours`, with the rule in the severity colour); leaving tab 2 while a message shows opens BMW's window in the same turn | `TwinCentre.update`, `hud.js _twinPush` | verified (model: 35 cases x 6 modes; real engine: cases 3, 4, 6, 7) |
| **The 150 ms open settle**: the centre may not remove our text until the window has been open >= 150 ms (`openSettleMs`), the close settle 150 ms (`settleMs`) | `TwinCentre.update` (`deferred`) | verified; breaking it fails the audit |
| **The tab-2 sheet** [729, 298, 1191, 568], ONE image sheet painted in one go: card (cell [922, 306, 998, 382], symbol 54, headline Noto 42 up to 3 lines at 424 / 471 / 518, "..." when cut, counter top right: right edge 1180, baseline 326), rows (pitch 44, symbol 32, Noto 33, 6 / 2 / 1 / 0 by card height, severity order, scroll line x 1188..1191), pointer page, empty page; a row counts as our text only when its whole name fits and every glyph exists | `layoutTab2`, `paintSheet`; widget type `ccsheet` (replaces `ccplate`) | verified (raster checked pixel by pixel in the unit part) |
| The old bottom plate removed from the layout and the code path | `design/gen_twin.py` (`plate_seam` -> `tab2_sheet`), `shared/hud.js`, `shared/layouts.js` | verified (`test-twin-layout`) |
| **Bottom-row sheet on connection 0** (the window's), toggle `cc:row` | `design/gen_twin.py row()`, `hud.js _toggleOn` | verified |
| **Narrowed release** `config.ccActive.release.leftList: "kept"` (only a number that was set before its entry left the list is released; 65535 deferred via `deferValues`), off by default (`"release": null` in `app.json`) | `hud.js _ccRelease`, `_ccListEval`, `_twinInputs` | verified: the wide rule (`"wide"`) is caught by the audit, `"kept"` and `true` (read as `"kept"` on Twin Dial) are not |
| Severity shown on the card's cell, the warning icon (while tab 2 is not selected), the bottom rule (4 px, only while `ours`); **never in the tab's fill** | `twin_tokens.js iconState`, `hud.js _twinBackSend` | verified (`tabFillChecks`, `test-twin-budget`) |
| `hud._twinTabMoved(from, to, why)` for B2, `hud._twinTabChosen(n, who)`, `hud._twinTabNow()`, `hud.tabs.hold` while the card is kept for the open settle | `hud.js` | verified through `_twinTabChosen`; B2's real module is not merged here (hypothesis until B7 merges) |

## 2. Files

New: `tools/twin-dial/r3/sc/{centre_cc,cases,test,mc_s3b}.js`, `tools/twin-dial/r3/sc/card_draw.py`, `design/twin-dial/r3/sc/{card,states}.json` (SC's, with the counter's baseline set to the SPEC's 326).
Changed (mine): `shared/twin_cc.js`, `bench/test-twin-cc.js` (rewritten), `design/gen_twin.py` (+ regenerated `apps/twin_dial/hud/layouts/twin.json`).
Edits outside my files, each a marked `// twin_dial` hunk or a one-line change:
- `shared/hud.js`: `IMAGE_TYPES` (`ccsheet`), the `TwinCentre` construction, the `refused` handler, the rebuild hook (the new layers are born in the machine's state), `_create` (`ccsheet`), `_toggleOn` (`cc:row`), `_ccListEval` (`ccReleased`), `_ccRelease` (the narrowed `leftList`), `_twinInputs`, `_twinPush` (rewritten and split in `_twinPushOnce`, with re-entrancy for B2's tab rules), `_twinSheets`, `_twinCcAssign`, `_twinTabNow`, `_twinTabMoved`, `_twinTabChosen`, `_twinSheetBuf`, `_twinSheetSend`, `_twinHoles`, `_twinWarnIcons`, `_updateOne` (`ccsheet`), `_twinBackInit` / `_twinBackSend` (the selected tab's cell is the highlight, never the severity; `TW_TAB_FILL` stand-in table).
- `shared/twin_tokens.js`: `cTitle` on tab 2, `iconState` for the warning icon.
- `shared/layouts.js`: `ccsheet` replaces `ccplate`.
- `apps/twin_dial/app.json`: `config.ccActive.release: null` (+ `_release` text).
- `tools/research3/mc/engine.js`: `t.painted` guarded (the centre machine keeps its own stamps).
- Tests changed on purpose, with the reason: `bench/test-twin-layout.js` (connection 2 now holds only tab 2's sheet; the row is on 0: 4 checks replace 2; 64 pass), `bench/test-twin-pages.js` (the warning icon is no longer black on an amber cell, it takes the severity colour: 102 pass), `bench/test-twin-budget.js` (the highlight is the selected tab's cell, never the severity: 7 checks reworded, 75 pass), `bench/test-cc-release.js` (Twin Dial takes the narrowed release now; see 5).

## 3. How the safety rule is held (and how it is tested)

The rule: a BMW warning is never hidden unless our own text for that exact message is on the screen in the same frame.
- **Cover (window shut) only when** the verdict is `ours`: shown-now named a number, D7 has fallen, no latch, tab 2 selected, and the sheet carries the WHOLE text of that message (card, or a row whose whole name fits and whose glyphs exist) since >= 150 ms, sent in an earlier turn, and no page change that takes text away is pending (`deferred`).
- **A message that shows but cannot be drawn** (D7, no entry, empty name, missing glyph, throw, sheet refused, released, witnesses disagree, a layout with no sheet) keeps BMW's panel open; tab 2 then shows the pointer page, which never counts as our text.
- **Order inside one turn:** rows aside, window open (connection 0, one socket) first; then tab, sheet (connection 2), warning icon; window shut and rows back last. One corked write.
- **Real-engine audit** (`bench/test-twin-cc.js`, per frame, after every turn in which the engine sent anything), V1 covered without our text (pixel-compared with an independent render, and >= 140 ms of presence, per message); V2 the row's ink in an open panel; V3 text taken away < 140 ms after the window opened; V4 row and window on one connection; V5 keep-outs (belt group, gear gap).
- **Six broken engines each fail it:** the row never steps aside, the window never opens (card late), a stale card stays, a card for the wrong message, the 150 ms waits removed, the row left on connection 2.
- **Model:** SC's 35 cases x {atomic, serial, every interleaving of the connections} x {strict, narrowed release}: 0 violations in about 100 000 audited frames; eight broken machines each fail.

## 4. Deviations from SC and from the brief (named)
1. **Counter baseline 326** (SPEC-R3 5.1), SC proposed 334. `design/twin-dial/r3/sc/card.json` carries the SPEC's number.
2. **A message that shows but ours cannot draw also pulls tab 2** (the pointer page), once per period and never after the driver has left. SC pulled only for a drawable card. Reason: B2's convention and the lead's instruction (tab 2 is selected automatically when `twinCc` is window / ours **with a non-null severity**; a blind-start keep-open has severity null and does not pull). The pointer page exists for exactly this.
3. **SC's model had a bug**, found because the extra pointer pages changed its random latency draws: a later sheet could overtake an earlier one on the same connection, which no socket does. `Screen` now delivers in send order (FIFO). All 35 cases stay at 0 violations.
4. **`leftList: true` on Twin Dial is read as `"kept"`** (never MC's wide rule); `"wide"` exists only so the bench can prove the narrowing is needed. f30_cluster keeps `true` = MC's rule, unchanged.
5. The old bottom plate's **severity rule** (4 px, y 611..615) is kept as is in `tdback` (`rules[1].ours`); the highlight cell no longer takes the severity.
6. The title "Повідомлення" is the existing `c_title` text widget (token `cTitle`), not part of the sheet (SPEC-R3 5.1).

## 5. Cost and connections
Layers per connection (the engine's own planner on the generated layout): **7 / 5 / 1** (main: 6 / 5 / 2; the gear's GPU text adds one on connection 1 as before). Connection 0 = the three backdrops, two dials, the digital speed, the bottom row's sheet (7 of 8). Connection 2 = tab 2's sheet alone.
Image sheets: 3.07 MiB on main, **3.49 MiB** here (+0.43: the sheet 462 x 270 replaces the plate 536 x 128). With R2-E's 4.7 MiB steady (14 layers) that is **about 5.13 MiB steady** (limit 6) - arithmetic, not measured: `test-twin-budget` builds a stand-in layout (4.31 MiB, peak 4.31 MiB, 75 pass), not the real one.
**Rebuild peak: not measured on the real layout.** SPEC's own figure for a layout switch is about 7.8 MiB; +0.43 gives about 8.2 MiB, **over the 8 MiB ceiling if that model holds**. The engine drops the old layers before it makes the new ones (`_rebuildInner`), which the bench's peak (equal to steady) reflects, so the real peak should be lower; the car's service freeing a dropped layer at once is unconfirmed. If the lead wants margin, SC's **option b** (one page sheet 462 x 331 for every centre page, replacing the clock sheet, the trip sheet and the tab-2 sheet: about 3.65 MiB steady) is the way; it needs B4's pages and an engine change, so it was not started.

## 6. Tests (all run one at a time on this branch)
`twin-cc` 249 (was 149; includes SC's model 52), `twin-layout` 64, `twin-pages` 102, `twin-budget` 75, `twin-bake` 35, `twin-fonts` 219, `twin-probe` 115, `twin-sim` 39, `twin-trip` 82; f30 / shared: `bottom-row` 254, `cc-release` 57, `daynight` 24, `driver-profiles` 105, `fonts` 34, `mb-exp` 46, `native-ui` 47, `night` 48, `probes` 25, `scene-tex` 54, `strip-mask` 40: every count equals `main`'s except the ones listed above. No signal was added or changed (`tools/signals/check_signals.py apps/twin_dial/app.json` gives the same 18 refusals on this checkout as on `main`: the catalogue is not in the tree; not caused by this package). `node tools/twin-dial/r3/sc/test.js` 52, `mc_s3b.js` reproduces MC's wide rule being unsafe on f30.
(`twin-budget` writes into `bake/work/.../budget-root`, which every worktree shares through its symlink; two agents running it at once collide. I ran it with a private `bake/work` for the duration.)

## 7. Open problems and what is not proven
- Nothing on a car: that 150 ms covers the sheet's upload and the window uniform's application; whether the service applies one turn's writes on several connections together (the design no longer needs it for V1 and the row now shares the window's connection); what "shown now" carries (probe P1).
- The pixel audit's stand-in service applies a whole turn at once; the open settle is checked by its timing predicate (V3) and by SC's model in every interleaving, not by a reordering service.
- Text widths use the atlases' advances (no kerning): a line may break a word differently from a renderer with kerning.
- B2's `twin_tabs.js` is not merged here: the hooks are built to its note and tested through `_twinTabChosen`; the real pair is first exercised at the merge.
- The tab fill colour table in `hud.js` (`TW_TAB_FILL`) is a stand-in for B1 / B2's.

## 8. For the merge (B7 / the lead)
- `shared/hud.js`: B2 and I both edit `_twinBackInit` / `_twinBackSend` (the highlight) and the tick; take B2's tab fill and B1's colour table, keep my `tab` key part only if B2's `_twinTabNow` is not used. My `_twinTabNow()` already prefers `hud.tabs.tab`.
- `design/gen_twin.py row()`: B2 changed the row's text tokens; mine changes `conn` 2 -> 0 and the toggle `cc:rest` -> `cc:row` on the same lines. **The toggle matters**: with `cc:rest` the row would not return while our card covers the panel.
- `shared/twin_tokens.js`: my `cTitle` / `iconState` hunks are superseded by B2's (`TITLES.msg`, `SEV_ICON`); take B2's.
- `bench/test-twin-layout.js`, `bench/test-twin-pages.js`: both B2 and I edited; the checks about connection 2 and the warning icon are mine.
- B2's `select()` calls `hud._twinTabMoved` inside `_twinSync`, i.e. inside my `_twinPush`: handled by the re-entrancy guard (`twinPushing` / `twinRepush`).
- When B1's `tdback` reads `twinTab` it needs nothing more from me; the severity is never in the fill.
