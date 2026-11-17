# Twin Dial round 2, package E: bench simulation, state gallery, mockup comparison

Branch `twin-dial/r2-e` (it already contains `twin-dial/r2` at 94a21f2 merged in, so merging it back is clean). Nothing pushed,
no version bump, nothing under `apps/f30_cluster/`, `apps/driver_profiles/` or `apps/twin_dial/` touched. Manual for the
gallery: `docs/twin-dial/R2-GALLERY.md`.

## What was built

1. **The bench runs twin_dial with every SPEC 11 input** (`bench/twin-sim.js`, installed by `bench/run-app.js` for the app id
   `twin_dial` only). POST `/signals` (manual) now also takes `reserve` and `odometer` (fuel, range, coolant, ambient, gear,
   program, condition, engine were already there); POST `/fake {twin: {trip, units, media, phone, guiding, displayed, sweep,
   reset}}` feeds the rest; day/night, the clock, ccList, the cluster's "shown now" number and the frame counter go through the existing
   fake-signs parts, which twin_dial's `config` blocks (copied from f30_cluster) make work. Also: a ledger of every raw value fed;
   the car's "rs" behaviour (an app that subscribes after a value was fed gets the last one at once); `GET /probe` `twin`
   (which SPEC 11 field the app never watches, what was fed, last raw values with text as lengths, the engine's `hud.twinCc`);
   the demo sweep (4 s, rpm 0..8000, speed 0..300, then the manual values return); `BENCH_NOW` (clock pinned) and
   `BENCH_CONFIG` (merged over app.json config). Enums go in by name (`BENCH_ENUM=number`: wire numbers). The G20 simulation of the
   browser bench (`?backdrop=1`) already draws BMW's lamps, belts, gear letter and panel under and over any panel app; nothing there changed.
2. **The state gallery, no browser** (`tools/shots/twin/`): 79 pictures per run: the 48-cell matrix {day, night} x {no message, ours, window,
   blind} x {clock, trip} x {engine off, ready, driving}, the mockup's extra scenes, 24 dial-law pictures, demo and two settings.
   Benches on 8205+, a render pool on the Mac's GPU (`tools/strip/O/render.py` through `tools/shots/paint.py`).
3. **The comparison against the mockup** (`compare.py`): side by side + difference image and per-region numbers (mae, ink ratio, centroid,
   2 px recall / precision, colour dE).
4. **A pixel audit** (`tools/strip/O/twin_audit.py`) over the real tdback and plate: BMW's panel is covered by our plate or our black
   (alpha >= 0.98 over the whole window polygon) in states ours / none and fully open (alpha 0 over the real panel) in window; the belt group,
   the gear gap (pixels and layer rectangles) and the lamp boxes are never ours; layer, connection and pixel-memory budget; every layer
   drawn. Plus content checks: needle angles against the SPEC laws (measured from pixels), READY, warning tab, night level.
5. **A stand-in app** (`tools/shots/twin/standin/twin_dial`) for developing the tools before B, C, D landed; `selftest.py` makes it
   leak on purpose (belt, gear gap, window, half-open window) and requires exactly the right check to go red.

## Files

Mine: `bench/twin-sim.js`, `bench/test-twin-sim.js`, hooks in `bench/run-app.js` (all marked `// twin_dial:`), a section in `bench/README.md`,
`tools/shots/twin/` (`run.py`, `scenes.py`, `tdrive.py`, `tpaint.py`, `backdrop.py`, `measure.py`, `compare.py`, `gallery.py`, `root.py`,
`selftest.py`, `standin/`), `tools/strip/O/twin_audit.py`, these two documents. `run-app.js` hooks: the date shim and config patch at the
top, the twin-sim install, the range struct, the sweep in the 50 ms loop, `/fake {twin}`, `/probe` `twin`, and three hardenings that
only matter to an engine without the f30 members (the probe's f30 block in a try/catch, the `values` event guarded, `press()` taking
"on" / "off" for a bool setting). f30_cluster's paths are unchanged.

## Tests (run on this branch, one at a time)

| Suite | Result |
|---|---|
| f30: test-bottom-row / native-ui / strip-mask / fonts / probes / daynight / night | 254 / 47 / 40 / 34 / 25 / 24 / 48 passed, as on `main` |
| `bench/test-twin-sim.js` (new) | 39 passed: the fake-head-unit part (ledger, late subscriber, raw shapes of every field, enum names and numbers, text never in the probe, the sweep) and a bench (injection through the real app, the coverage report shown to FAIL on an app that does not watch the speed, the blind start sampled at 40 ms, a real sweep, pinned clock) |
| `tools/shots/twin/selftest.py` (new) | 26 passed: needle measurement, comparison, audit on synthetic images, four stand-in leaks each turning exactly its own check red |
| twin: budget 75, layout 61, pages 100, cc 149, probe 110, fonts 219, bake 35 | all passed on this branch |
| Gallery on the real app (`twin-dial/r2` + E) | 79 pictures, 0 failed jobs, 0 failing checks, 79 warnings (below), nothing unstable, no bench-log problem |

A test is trusted only if it fails when the feature is broken: the selftest and the coverage negative above are that proof for the tools; the
gallery's own checks go red on a leak (shown with the stand-in). What was NOT proven: anything on a car; the media text, trip scale and
odometer factor are probe questions (P3, P4, P8) the bench cannot answer; the browser G20 simulation was not run (no browser allowed).

## Problems found in the merged pieces (precise)

1. **B, `shared/hud.js` line ~1007 (the `statusRangeTankStatus` handler): the fuel reserve is read wrongly.** `typeof sp === 'string' ? /AKTIV|ACTIVE/i.test(sp)`
   is true for `"NICHT_AKTIV"` (not active), so with the car saying "no reserve" the first fuel segment is drawn red. Every picture of the gallery shows it
   (e.g. `A/day_none_clock_driving.png`: the first segment under the tachometer is red; the mockup's is white). C's own reader (`shared/twin_tokens.js`
   `enumIs`) logs the same value correctly ("fuel reserve raw: NICHT_AKTIV -> no reserve"), so the two readers disagree. Fix: anchor the test, `/^(AKTIV|ACTIVE)$/i`.
   If the binding hands the enum as a number, 1 is read correctly; the bench feeds names (`BENCH_ENUM=number` tries the other).
2. **C, `apps/twin_dial/app.json` `config.trip._about` documents the wrong keys.** It says the factors are `{ speedAvg, consAvg, wayPassed }`; `shared/twin_tokens.js`
   `tripValues()` reads `{ bc, speed, cons, way }`. An owner who follows the note gets dashes for every trip value (reproduced: `B/M2_trip` with the documented keys
   shows "ø – л/100 км"). With `{"bc":1,"speed":0.1,"cons":0.1,"way":0.1}` the page matches the mockup (centre rec2 / prec2 0.997 / 0.994).
3. **B, the digital speed `atext`: three-digit speeds with a "1" are spaced wide.** `B/M2_trip.png` (112 km/h): "1 1 2", the mockup's "112" is tight
   (difference image: doubled digits). Two-digit "87" and "0" are fine. Probably a fixed cell per digit with the narrow "1" centred in it.
4. **A2 face / lamp margin (warning, every picture).** Three pixels of the speedometer's bezel, (1774, 206), (1774, 207), (1775, 207), have alpha up to 0.95 inside the
   3 px margin of the auto-hold lamp's hole [1774, 176, 1873, 208] (SPEC 3.3's "box + 3 px"). BMW's lamp box itself is clear (the box check is green in all 79). The
   source is `face_speedo.json` texel (542, 117), code 84. Decide whether the margin is a rule or a hole's allowance; the audit keeps it orange.
5. **Layers: 14, not 12** (conn 4: 6, conn 5: 6, conn 6: 2 in the bench; pixel memory 4.7 MiB steady). Within every hard limit (8 per connection, 24, 6 MiB); SPEC 13.2 plans 12
   (orange "layers in all (SPEC plans 12)"). The lead should either update the SPEC table or look for two layers to merge.
6. Differences from the mockup that are the SPEC (no action): media text only with `config.twin.media` (without it the tab shows the radio icon only; the gallery
   sets it), the warning cell lit flat grey for a white message, dim phone / navigation icons, the bottom row's R1 shows the trip distance once the trip factors are set.
7. Not a bug, noted because it looked like one at first: with the bench feeding `statusDisplayedCCMessage = 0` before anything else, the engine says `none`, not `window`
   (the second witness has spoken). A blind start with no message field fed says `window` from the first ready answer (tested, 12 samples at 40 ms).

## Hooks the lead must resolve in a merge

`bench/run-app.js`: package F's `/fake {feed}` branch and my `/fake {twin}` branch sit side by side (resolved already on this branch, which contains `twin-dial/r2`). No other
file of another package is edited.

## Open problems

- The headless gallery draws BMW's parts as bold boxes at the SPEC numbers, not the stock cluster; the browser G20 simulation was not re-checked on twin_dial.
- The trip scale (tenths) and the media line types the bench feeds are hypotheses until probes P4 and P8 are read on a car.
- The gallery's `demo` pictures are volatile by nature (the kit's demo drive moves); they get the audit but no comparison.
- Re-run on the final merge candidate: `python -I tools/shots/twin/run.py` (about two minutes), then read `summary.json`; the selftest and `node bench/test-twin-sim.js` first.
