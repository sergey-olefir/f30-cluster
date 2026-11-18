# Twin Dial 0.1.1 — package FIN (the owner's decisions of 2026-11-18)

Branch **`twin-b/fin`** from `release/0.1.1` (1e20f7d = twin-b/integrate + car-fix/1, /2, /3), worktree `.claude/worktrees/fin`.
Nothing pushed, no version changed, `apps/driver_profiles`, `apps/signal_probe` and `apps/f30_cluster` untouched (the
`shared/hud.js` hunks run only on a twin layout with live tabs; f30's suites keep their counts). Every hunk is marked `FIN`.

Labels: **verified** = measured here (suites, bench, bake). **car** = only the car can show it.

## 1. What changed, item by item

| # | Decision | What was done | Test that fails without it |
|---|---|---|---|
| 1 | Red strip **L2** | `config.limit.strip = "L2"` (app.json). The shader already had L2 (B1): red only between the limit's marker and the needle, only while over (needle past the marker or the car's warning). | `test-twin-limit`: the app.json check now wants "L2"; the engine's speedometer layer carries `u_lim.w = 2` with a 50 limit. Mutation L1 → 2 failures. |
| 2 | Cruise **C1, green unit** | Already so (CF2): `config.cruise = { place: "C1" }`; `paintCruise` paints number, "км/год" and symbol in one colour (green when active). Verified, unchanged. | `test-twin-limit`: new check that the unit's own band (y 545–566, left of the symbol) is green. |
| 3 | **No numeral shadow** | `SHADOW_MODEL = None` in `tools/twin-dial/bake_face.py` (the SD / K1 models stay in the file, one word to undo). Both faces re-baked with `sh tools/twin-dial/bake_all.sh`; a second bake gave identical bytes (sha256 tach a34c9470…, speed c915abff…); the panel mask is unchanged. Same 616 × 560 R8: no pixel-memory change. | `test_bake.py`: SHADOW_MODEL is None; regions JSONs and manifest name no model; the shipped tachometer equals a no-shadow bake and an SD bake is darker at > 2000 px. The decode-against-mockup edge tolerance went 40 → 60 for the tachometer (the K1 mockup draws a shadow: shadow-free gives 49, SD gave 16); a face shifted 3 px still gives > 1000. |
| 4 | **No page dots** | None were drawn (B4 never built K2's 1Kb dots). Asserted absent. | `test-twin-centre` "FIN: no page dots": no ink in [900, 1020] × [299, 311] on all 27 page states; no page item of a dots kind; the check sees one mockup dot painted in (self-test). |
| 5 | "Технічні дані: сховати" hides **both** technical pages | `twin_pages.computerList`: with `techData = hide` the list is clock, trip only (the tyre page leaves the choice and the cycle too, and its TPMS poll stops). | `test-twin-centre`: hide + `pages.tyres` → clock, trip; a cycle standing on the tyre page never shows tech / tyres; no poll. Mutation → 3 failures. |
| 6 | Setting **"Навігація"** = авто / карта / стрілки | New setting `navView` (main screen, skipped in the list), in place (`TW_PAGE_KEYS` → `twinPages.changed`, no rebuild). `twin_pages.mapState`: **авто** = the existing strict presence rule (map view AND BMW's guidance or "map without a route"), else the arrow / CarPlay-route page; **карта** = the map view alone opens the window (a CarPlay route included), else the same fallback; **стрілки** = never the map, not even forced. No key: `config.tabKey` is still the TRIP bit alone. | `test-twin-centre` "FIN: the setting Навігація": three readings × (BMW guidance, CarPlay route, no map view), forced window, `mapWindow` off, in-place switch shuts / reopens the window, menu entries. Mutation → 4 failures. |
| 7 | Map window **W2** | W2 was already B1's box [700, 173, 1220, 600], fade 1 px, radius 1 (no fade inside, BMW's edge shows), top at the tab rule's bottom (y 173). The Діагностика choice "Вікно карти" is now **вимк. / W2 / W1** (and `config.diag` in the same order): the menu's cycle from off lands on W2. Still off by default (`config.mapWindow: null`). No lens. | `test-diag`: options off,W2,W1 and the first step from off writes `mapWindow "W2"`; the bench press of row 1 now gives W2. `test_shader.py` (GPU, not in run_all): open to 2 px from every edge, the rule y 170–173 opaque and drawn, open from y 174. |
| 8 | **Tab 2 hidden with no messages** | See §2. | `test-twin-tabs` §8 (unit) and the real-engine block; mutation "always shown" → 21 failures. |

## 2. Tab 2 hidden (item 8)

**When is tab 2 in the bar** (`shared/twin_tabs.js tab2Shown`; narrowed by the lead after the first commit): with live tabs
on, **only while ccList holds an entry other than the resting id 0**, and while tab 2 is selected or held (the fixed setting
"2"; the open settle of SPEC-R3 5.4.4: a selected tab never vanishes under its own fill). A displayed number with no ccList
entry (285 type) and 65535 do not bring tab 2 in by themselves. Live tabs off (a stand-in app, the round-2 look): always shown.
**But see §6 item 3:** the kept selection rule still selects tab 2 for an unlisted 285.

**Exact x positions** (panel px; the bar is 618–1302):

| | separators | tab 1 | tab 2 | tab 3 (media) | tab 4 | tab 5 | media group lies in / centred on |
|---|---|---|---|---|---|---|---|
| with a message | 780, 848, 1168, 1237 | 618–780 | 780–848 | 848–1168 (320) | 1168–1237 | 1237–1302 | 858–1158 / 1008 |
| no message | 780, 1168, 1237 | 618–780 | — | **780–1168 (388)** | 1168–1237 | 1237–1302 | 791–1158 / 974 |

(Each separator: a dark column x−1..x+1, the light line x+2..x+3, as before.)

**How:**
- `tdback` part L: the separators were already a `vec4` uniform (`u_sep`); `_twinBackSend` now sends them (and picks the
  selected cell) from `twinTabs.barGeometry(seps, rect, shown)`, the 4th separator at −10 (off) when tab 2 is hidden; the
  key includes the shown state. **No shader change**: `tdback` part L stays 2672 bytes after `compact()` (≤ 6 KB), `tdial`
  5763 (≤ 8 KB); highp unchanged; no sampler added.
- The widgets: `tab_warn_i` stays [791, 837) and paints nothing of its own while hidden; `tab_media` became
  [837, 1158) (was [858, 1158)), carrying `seps` and `leftMost`. The media group is laid out in the cell it has now
  (`mediaRegion`) and each of the two widgets paints its slice — with tab 2 hidden a group wider than 321 px reaches into
  the warning widget's box. No two boxes overlap (no extra sheet, no layer added).
- Same turn: `_twinSync` repaints both widgets when the shown state flips; the message push's `warn` op repaints the media
  widget too. A message selecting tab 2 (rule 1) and the bar gaining its cell happen in the same sync.
- The key (TRIP) cycle uses `tab2Shown`: with no message 1 → 3 → 4 → 5 → 1.
- The safety machine (`shared/twin_cc.js`) is untouched; `test-twin-cc` (with its per-frame pixel audit and the eight
  mutants) passes at its CF1 count.

## 3. Test counts

`RUN_ALL_PORT=8960 sh tools/twin-dial/run_all_tests.sh` on the FIN tree, every suite alone (nothing else running a suite on the
Mac; load average about 10 from other work):

```
bottom-row 282 · cc-release 75 · daynight 24 · diag 104 · driver-profiles 105 · fonts 34 · mb-exp 46 · native-ui 47 · night 48 ·
probes 25 · scene-tex 54 · strip-mask 40 · twin-bake 37 · twin-budget 95 · twin-cc 266 · twin-centre 242 · twin-fonts 327 ·
twin-layout 106 · twin-limit 224 · twin-pages 100 · twin-probe 115 · twin-sim 39 · twin-tabs 240 · twin-trip 89 ·
check_signals ok (f30_cluster, driver_profiles, twin_dial) · bake-py 88 passed, 0 failed
24 suites, 2764 passed, 0 failed - ALL GREEN
```

Changed by FIN against `release/0.1.1` (base counts run on a clean checkout of it today): twin-centre 221 → 242, twin-tabs
209 → 240 (244 after the follow-up), twin-limit 222 → 224, diag 101 → 104, bake-py 85 → 88 (and its byte-for-byte re-bake now passes on this Mac: the
faces were baked here), `tools/twin-dial/test_shader.py` (GPU, not in run_all) 44 → 46. twin-layout stays 106 (one check
rewritten). Every other count is release/0.1.1's. `check_signals.py` separately on every app in `apps/` (driver_profiles,
f30_cluster, twin_dial): all declarations pass (catalogue `reference/car/2026-11-15`).

Mutations (each change undone, the suite run again): strip L1 → twin-limit 2 failures; tyre page not hidden → twin-centre 3;
navView rules removed → twin-centre 4; tab 2 always shown → twin-tabs 21; the map choice order → test-diag 2 (seen while
updating it). The shadow and the dots have self-checks in their tests (an SD bake is darker; a painted dot is seen).

The safety machine: `test-twin-cc` 266 / 0, the same as release/0.1.1 — every audited case 0 violations, all eight mutants
still break the audit. Its stand-in app has no live tabs (tab 2 always in the bar there); the real app's message path with the
bar is in test-twin-tabs' engine block (the door message: tab 2 appears and is selected; its end: hidden again; a stored entry:
shown, not selected).

Follow-up (tab 2 only for a non-resting ccList entry), re-run alone on port 8960: twin-tabs 244 / 0, twin-cc 266 / 0,
twin-centre 242 / 0, diag 104 / 0.

## 4. Budget

Measured with `node tools/research3/mp/measure.js twin_dial --quick` (bench accounting: images and assets counted twice):

| connection | layers | pixel memory |
|---|---|---|
| 0 | 7 (tdback L / RT / RB, two dials, the GPU texts, the bottom row's sheet) | 1.92 MiB (two R8 faces 0.66 each, mask, atlas, bottom-row sheet) |
| 1 | 4 (tab-bar sheet 658 × 51, page layer 462 × 347, hub sheet, atlas) | 1.82 MiB |
| 2 | 3 (tab-2 sheet 462 × 270, sign 96 × 88, cruise C1 140 × 70) | 1.09 MiB |
| **all** | **14 layers + 5 assets (878 KB)** | **4.83 MiB steady, 4.83 MiB peak** (no rebuild over the run) |

Against R3B-INTEGRATION §7 (13 layers, 4.75 MiB): +1 layer and +77 KiB are CF2's cruise sheet. FIN adds no layer and no
pixel memory: the re-baked faces are the same size, the tab bar's sheet is the same 658 × 51 (the media box grew inside it), and
tdback / tdial are byte for byte the same (2672 / 5763 bytes after compact()). Limits: ≤ 8 layers per connection, ≤ 6 MiB
steady, ≤ 8 MiB peak, tdial ≤ 8 KB, tdback ≤ 6 KB — all held. First complete frame on the bench +405 ms, 2295 KB of pixels
(1.15 s at the 2000 KB/s floor).

## 5. Gallery and comparison with the r3b mockups

**State gallery** (`tools/shots/twin/run.py`, real app, 79 pictures, 0 failed jobs; `bake/work/twin-dial/fin/gallery/`,
git-ignored). 45 pictures fail two checks, "warning tab not lit with no message" (33) and "warning tab lit while a message
shows" (12). Both read the **round-2 warning cell x 746–757** (SPEC 8.2: the cell lit in the severity colour), which since
round 3 lies inside tab 1's red fill. The same gallery on a clean checkout of `release/0.1.1` fails the same 45 pictures on
the same two checks (`bake/work/twin-dial/fin/gallery-base/`): not caused by FIN; the checks are out of date (open, §6). The
pictures show: no message → four tabs, the media group centred on 780–1168, no numeral shadow; a message → tab 2 back at
780–848, selected, the media cell 848–1168.

**Against the r3b mockups** (`tools/shots/twin/compare.py`, ours | mockup | difference in `bake/work/twin-dial/fin/compare/`):

| ours | mockup | tacho rec2 / prec2 | speedo | tab bar | centre | note |
|---|---|---|---|---|---|---|
| A/day_none_clock_driving | ka/A01_full_base_look | 0.996 / 0.991 | 0.996 / 0.990 | 0.987 / 0.984 (mae 0.12) | 0.957 / 0.941 | the mockup has the numeral shadow (ink ratio 1.04 / 1.08: ours brighter round the numerals) and tab 2 present; its media text and bottom-row values differ |
| A/day_none_clock_driving | kb/tab1/1A_clock | 0.996 / 0.991 | 0.986 / 0.990 | 0.986 / 0.982 (mae 0.14) | 0.957 / 0.941 | as above; the mockup's R1 is the range (412.6 км), ours the trip |
| A/day_ours_clock_driving | kb/tabs/T02_sel2 | 0.996 / 0.991 | 0.986 / 0.990 | 0.997 / 0.989 (mae 0.09) | 0.831 / 1.000 | with a message both have five tabs: the bar matches to 2 px; the centre differs by content (our card vs the mockup's page) |

The deliberate differences are the owner's decisions: no shadow (item 3), tab 2 absent without a message (item 8). L2 and the
cruise readout have no gallery scene; the suites check them (u_lim.w 2 on the engine; the C1 unit's green).

## 6. Not done / for the lead

1. **"Навігація": the difference between авто and карта is my reading.** As written, both say "map when present, else the
   fallback". I took **авто** = the strict presence rule (map view AND BMW's guidance or "map without a route"; a CarPlay route
   with BMW's guidance idle shows our route page) and **карта** = the cluster's map view alone opens the window (a CarPlay route
   included). стрілки = never the map, which also overrides the forced window. Everything is moot until `config.mapWindow` is
   switched on (Діагностика); the lead should confirm the reading.
2. **"W2 when switched on"** is done by the option order вимк. / W2 / W1 (the menu cycles to the next value). If the lead
   meant a separate on/off plus a W1/W2 choice, that is two settings instead of one.
3. **An unlisted 285 still SELECTS tab 2 on the real app (existing behaviour, not changed: the selection rules were to be kept).**
   The machine gives a shown number with no ccList entry the severity grey (`shared/twin_cc.js` line 427, `sev || 1`), and B2's
   rule 1 (`twin_tabs.update`, `msgNow` = window / ours with any severity) selects tab 2 on it; CF1's `unlistedPullsTab: false`
   gates only the machine's own tab, and CF1 tested it on the stand-in app without live tabs. So for each 285-type message
   (about 6 s, several per drive) tab 2 appears selected with the pointer page, then goes back. Seen on the bench (test-twin-tabs'
   engine block now pins it). Fix if wanted (one line, a selection-rule change): in `msgNow` ignore the machine's state while
   `hud.twinMsg.unlisted` is true and `config.ccActive.unlistedPullsTab` is not. 65535 with the list at rest pulls nothing (severity 0).
4. **Gallery checks out of date**: tools/shots/twin's "warning tab lit / not lit" read the round-2 cell x 746–757 (fails on
   release/0.1.1 too). Not changed here (outside the brief); they should read tab 2's icon (791–837) and accept its absence.
5. **The car**: none of this has run on the car. To watch there: the bar switching between four and five tabs as messages
   come and go (a stored message makes tab 2 stay); the L2 strip over a limit; the faces without the shadow.
6. Not done: nothing of the eight items is left out. No lens (as decided). SPEC-R3's text (§2.4 shadow, §3.1 separators
   "always present", §8 strip, §10 settings) still describes the old decisions; updating the spec is the lead's.
