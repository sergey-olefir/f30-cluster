# Package F (round 2): probe mode, log only

Branch `twin-dial/r2-f` (from `twin-dial/r2`). SPEC section 17.1. No push, no version bump, no car.

## What was built

- `shared/twin_probe.js`: with `config.probe` on it subscribes the fields of P1 to P12 (40 fields, 22 interfaces) read only and logs
  each once per change as numbers, enum names and text lengths (`probe P3 range-tank #2 t=41.3: fuel=38 ... mileage=48215`). Rate
  limit (1 line per second per field, the last value wins, "+k folded"), line cap (60, coolant and voltage 240), summaries at 30 s /
  2 min / 10 min that name the silent fields, `config.probe.only` (a subset of items). The probe handler is chained in front of the
  handler already on a field; a throwing handler logs one warning and the app's own handler still runs. No write of any kind: the file
  never touches `ctx.signals` (the test greps for setters, method calls, requestDefaultSymbols, message injection). Node 8.16 syntax only
  (the car's Node; the test greps for newer syntax).
- `apps/twin_dial/probe/probe.json`: the probe's `signals` block (22 interfaces, flags r and s only, no `_methods`, no `_broadcasts`)
  and its config (`probe`, `legacyProbes: false`). It is a separate file because package C owns `app.json`; it is not `app.json`.
- `tools/twin-dial/probe_build.py`: `on` / `off` / `status` / `check` on `apps/twin_dial/app.json`. `on` merges the probe block, sets
  `config.probe`, adds `twin_probe.js` to `shared`, optionally sets `--version`, and records what it added under `_probeBuild`; `off`
  takes exactly that out (the file is re-written with `json.dump`, layout may change, content does not). `check` runs
  `check_signals.py` on both states.
- `docs/twin-dial/PROBE-PROTOCOL.md`: the owner's step-by-step for P1 to P12, the lines to read, how each result becomes a config value.
- `bench/test-twin-probe.js`: 108 checks, about 25 s.

## Hooks outside my files (all marked `// twin_dial:`)

`shared/hud.js` (+21 lines, 6 hunks):
1. after `_probeWire(extra)`: if `config.probe`, `require('./twin_probe').wire(extra, ...)`; inert (no require) otherwise;
2. `start()`: `twinProbe.start()`; `stop()`: `twinProbe.stop()`;
3. **`_legacyProbesOff()`** gates `_probeWire` and `_probeSymbolsLater` (the 0.7.18 probes). Off when `config.legacyProbes === false`, or
   when it is unset and the app id starts with `twin_dial`. Unchanged for f30_cluster and every other app.
`bench/run-app.js` (+1 line): `/fake` takes `{ feed: { iface, field, value } }` and calls `hu.feed` (any raw field; used by the test).

## Finding the lead must decide on (item 3 above)

The 0.7.18 probes in `hud.js` always run in every app using it. In twin_dial they would (a) register handlers for `ccListRiskClass` and
`basicList`, fields SPEC section 11 does not declare (the normal build declares only `ccList` there), which on the car may make the
interface's watch fail (hypothesis: not tried), and (b) call `requestDefaultSymbols` once after 8 s, which SPEC sections 1 and 11 forbid.
The gate above turns both off for twin_dial; the test proves it (a control run with `legacyProbes: true` shows them back). If the lead
prefers another gate (for example C sets `config.legacyProbes: false` explicitly, which wins), the hunk can be reduced; do not drop it
without one.

## Tests

- `node bench/test-twin-probe.js`: **108 passed, 0 failed.**
  1. source and table: no write tokens, Node 8 syntax, `probe.json` and the table declare the same 40 fields, every column of the
     table checked against the car catalogue's types (133 columns + 12 custom members: no text member is read as a number, enum or bool);
  2. declarations: `check_signals.py` passes on the probe block alone, on a normal block (a stand-in for SPEC section 11 built from VS's
     block) and on the merged probe build; `on` then `off` gives back the normal app.json exactly (also with `--version`); a probe file
     with a "w" flag or a method is refused;
  3. every item's line from injected values, exact; canary words in every text member (capitals too) never reach the log; hostile values;
     rate limit, cap, summary, subset, instance clash, chained handler;
  4. the real `hud.js` on a copy of the built f30_cluster (config patched, no port, no cluster-render): probe off gives nothing; on gives
     all 40 lines equal to step 3 and the app's own handler still runs; as `twin_dial` the 0.7.18 handlers and `requestDefaultSymbols` are
     off (12 s watched), with `legacyProbes: true` they are on.
- Mutations tried (each made the test fail): a length formatter leaking text, the chained handler dropped, the legacy gate removed, the
  hud hook removed.
- f30 suites on this branch: bottom-row 254, native-ui 47, strip-mask 40, fonts 34, probes 25, daynight 24, night 48: all pass, same counts as main.

## Not proven (hypotheses)

- Everything about the car: that any unseen field notifies, that the binding hands enums as names or numbers (both are logged as seen),
  the scales (every number is raw). The probe exists to find out.
- Node 8.16: not run (not installed here); the source is checked for newer syntax by pattern, nothing more.
- `apps/twin_dial/app.json` does not exist on this branch (package C): `probe_build.py check` on the real file is skipped here. After
  the merge run `python3 tools/twin-dial/probe_build.py check` and `node bench/test-twin-probe.js` (the test then checks the real file too).
- 22 interfaces watched at once in the probe build: load and start time on the car untested.
- The config keys in PROBE-PROTOCOL section 4 (`odometer`, `trip.counter`, `coolant`, `media`, `phone`) are proposals; `trip.factors` is
  SPEC 14.2's. C's tokens read what they read.

## For C / the lead

- `app.json` `shared` should list `twin_probe.js` (SPEC 14.1; `probe_build.py on` adds it if missing); the normal build has no
  `config.probe`; set `config.legacyProbes: false` (or rely on the id gate).
- Package A2's message to E about faces and the panel mask does not concern this package (no face or mask is used).
- Untracked at start in the main checkout: briefs and two reports under `docs/`; not touched.
