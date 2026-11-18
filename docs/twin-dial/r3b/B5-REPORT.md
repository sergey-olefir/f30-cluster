# B5 report: the speed limit and cruise (Twin Dial 0.1.1)

Branch `twin-b/b5` (from `main` c1f53f2). No push, no version bump, nothing in `apps/f30_cluster` or `apps/driver_profiles`.
Labels: **verified** = tested on the bench / by test output; **hypothesis** = needs the car; **not verified** = not run.

## What was built

| Part | Where | Status |
|---|---|---|
| Sign signal: `TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction` (`s`) and `config.sign` copied key for key from f30_cluster (`signOf` is the engine's own, used as it is: `hud.sign`) | `apps/twin_dial/app.json` | verified (`check_signals.py`: all declarations pass; test compares `config.sign` with f30's) |
| Display state, the `limit:` log line per change (numbers and enum names only, capped at 200), `holdMs`, the marker hand-over, the cruise struct reader | `shared/twin_limit.js` (new) | verified on the bench |
| (a) The sign: image sheet 96 x 88 at [1252, 628] on connection 2, own z 11 (so the engine never packs it with anything), painted by the engine: red ring 7.6, white disc, Saira figure (B6's `td_sign` / `td_sign3` when merged, else a scaled `td_tach`), three dashes, our derestriction sign (five diagonal stripes), the dot of a conditional limit. **Not a `cc:` widget**: no toggle, no hole condition. | `design/gen_twin.py` `limit_seam()`, `design/twin-dial/b5/limit.json`, `apps/twin_dial/hud/layouts/twin.json` | verified (pixels, and in the real engine with BMW's window open) |
| (b) Marker and red strip: sets `hud.twinLim = { deg, state, warn }`, `hud.twinCru = { deg, state }` and calls B1's `hud._twinMarks()` (B1's contract, `pub/B1/NOTE.md`); `config.limit.strip` "L1" default. Alone (no `_twinMarks`) it sends `u_lim` / `u_cru` itself, only if the compiled `tdial` has them | `shared/twin_limit.js` `dial()` | marker values verified; the shader side is B1's and was **not** in this tree: not seen on a GPU |
| Cruise and limiter, built dark: `displayDriverAssistanceLongitudinal` (`s`) declared and read; `config.cruise: null` = the readout's sheet is not even built (toggle `tl:cruise:<place>`); lit by `config.cruise = { place: "C1" }` (C2 too): set speed Saira 40 green right-aligned x 1536 baseline 540, unit Noto 19 baseline 560, symbol 36 px at (1572, 528); grey for standby; nothing when off; marker via `u_cru` active only | same files | verified on the bench (injected values) |

Angle law: -125 + 1.25 deg/(km/h) to 100, + 0.625 above (equal to the engine's `_twinDeg`, tested at 9 speeds); mph converted for the marker, number shown as the car gives it.
States (SPEC-R3 8): limit / unknown (254, 255, unit "not available") / end (0) / none (invalidFlag, nothing, out of 5..250) / conditional (supplemental != none: dot, `u_lim.y` = 2 = hollow marker and NO red strip, my reading) / warn level to `u_lim.z`; the sign is never flashed.

## Files

New: `shared/twin_limit.js`, `bench/test-twin-limit.js`, `design/twin-dial/b5/limit.json`, this report.
Edited (marked `// twin_dial:`): `shared/hud.js` (13 lines: require of `twin_limit`; `IMAGE_TYPES` + `tdsign`, `tdcru`; `twinLimit.wire` after `twin.wire`; the `tl:` toggle in `_toggleOn`; create and `_updateOne` for the two types; `twinLimit.dial` first line of `_twinDialUpdate`), `shared/layouts.js` (types `tdsign`, `tdcru`; the toggle regex accepts `tl:cruise[:C1]`), `apps/twin_dial/app.json` (signals, `shared` += `twin_limit.js`, `config.sign`, `config.limit`, `config.cruise`), `design/gen_twin.py` (`limit_seam()` + one term in `widgets()`), `apps/twin_dial/hud/layouts/twin.json` (regenerated: +3 widgets).
Test I had to change on purpose: `bench/test-twin-layout.js`, the connection-2 check ("the bottom row's sheet and the plate's sheet, both cc: layers") now counts only the `cc:` sheets, because the sign's and the readout's sheets share connection 2 (checked by `test-twin-limit.js` instead).

## Layers and memory
Connection 2: 2 -> 3 (sign), 4 while the readout is on. Engine run: layers per connection {0: 6, 1: 6, 2: 3}. Sign sheet 96 x 88 x 4 x 2 = 66 KiB; readout 140 x 70 (C1) 76 KiB, 188 x 64 (C2) 94 KiB, only when on. Layer rects: none touches the belt group or the gear gap; the readout is below y 492, out of the G20 black box [1420, 320, 1611, 440]. For B7: the sign is z 11 and the readout z 12, both on connection 2; if B3's changes fill connection 2 the readout (dark by default) is the one to move.

## Clearances (layout numbers, `test-twin-limit.js`)
Stored-message marker 14.0 (SV: 10.7 on a render), bottom-row rule 25.1 and speedometer ring 26.6 to our ink (SV: 26.0), fallback window 54.3 (SV 41.0: SV measured to the dilated panel mask; mine is to the polygon), gear gap 47.0, panel bottom 15.0. All meet the brief's minimums except that the rule is asserted at >= 25 (geometry of the rule's end, not an AA threshold), not 26.

## Tests
`node bench/test-twin-limit.js`: 150 passed, 0 failed: the angle law and marker list, every state, u_lim modes, invalid markers, the cruise struct (dark / active / standby / off / limiter / bad values), pixels (ink inside the disc for 5 .. 888; night x 0.8 / 0.85), geometry against `limit.json` and the layout, clearances, handlers (hold, cap, canary string never logged, no throw), the hand-over to `_twinMarks`, and the real built twin_dial engine against a stand-in cluster-render (sign pixels per state, sign unchanged with the fallback window open, rebuild, night in place, cruise dark / C1 / C2 / dark again, layer counts). `test-twin-layout` 61 passed (changed as above). `tools/signals/check_signals.py`: all declarations pass.
Other suites: see the end of this file (run with `BENCH_PORT` in 8651+ because other agents' servers share the default ports and made the first parallel run fail).

## Not verified / hypotheses
- The shader side (`u_lim`, `u_cru`, the strip) is B1's: with B1 merged the test's dial-layer check switches itself on (`shaderReady()`); here it printed "skip".
- That the sign field arrives on the car (SV: arrives-brief). The build logs `limit:` lines; the car session confirms.
- The cruise struct is unseen: which enum is cruise / adaptive (`XCC_AKTIV` + `DISP_ACC` read as adaptive cruise, `SLD_AKTIV` as the limiter, `HDC_AKTIV` not drawn), the unit flag's sense (`true` = mph), the speed scale (1), invalid values (0, 255, 65535) are all hypotheses, each a `config.cruise` key.
- C2: only the box is the spec's; the positions inside it are mine. C2 does not hide the coolant bar (its empty segments are baked in the face: that needs B1 / a re-bake).
- The unknown sign's grey / ring: drawn as a red ring with three dashes as in the mockup `La_unknown`; the derestriction sign's colours are mine (mockup `La_end`).
- B6's icon names (`td_cruise`, `td_cruise_acc`, `td_limiter`) were read from B6's worktree, not yet merged; until then the readout has no symbol.
