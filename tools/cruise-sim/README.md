# Cruise set-speed simulator

An offline simulator for one question: can car-following be done by **only moving the set speed of the stock cruise
control** (BMW's Dynamic Cruise Control on the G20), leaving throttle and brakes to the car? The parent brief is
`docs/cruise-set-speed-brief.md`, the build brief `docs/AGENT-BRIEF-cruise-sim.md`, the module contract `CONTRACT.md`
(this folder).

Nothing here reads from or writes to a car. **Until a plant identified from the car's logs is loaded, every result is
for an assumed plant** (`meta.plant.assumed: true`) and is not a verdict.

Plain JavaScript, no build step, no dependency, no network. The same `core/*.js` files run under Node (batch runs,
tests) and in the browser (the page).

## Open the page

`tools/cruise-sim/ui/index.html` — open it from the disk, or serve the folder on a port 8980–8989
(`python3 -m http.server 8981 -d tools/cruise-sim`) and open `http://localhost:8981/ui/`. The page loads
`core/*.js` in `sim.LOAD_ORDER`. (Page: SU1 / SU2.)

## Run from Node

```js
const sim = require('./tools/cruise-sim/core/sim');
const r = sim.run({ seed: 1, scenario: { id: 'demo.approach' }, plant: { preset: 'liftoff' } });
r.meta.plant      // { name: 'liftoff / P1', assumed: true }
r.meta.core       // exact (10 ms) minGap, minTimeGap, minTTC, collision, impactSpeed, peakDecel, cmdPerMin, ...
r.metrics, r.verdict
r.series['gap.true'], r.t   // Float64Array on the out.dt grid
```

- `sim.run(config[, deps])` → `{ meta, t, series, events, metrics, verdict }`; `sim.createSim(config[, deps])` →
  `{ step(), advance(s), state(), done, result() }` for real-time playback; the same model either way.
- A run is fully described by its config (`result.meta.config` reproduces it byte for byte; `sim.hashResult(r)`).
- `sim.defaultConfig()`, `sim.schemas()` (every module's settings with unit, default, range), `sim.BUILTIN`
  (`demo.approach`, `demo.free`: work without the scenario catalogue).
- `deps` replaces modules (`{ controller: myModule }`), for tests and experiments without touching the core.

Scenario files live in `scenarios/<family>/*.json` (SC3; loader `core/scenario.js`). Batch sweeps and the report:
`node tools/cruise-sim/sweep.js <plan.json>` and `node tools/cruise-sim/report.js` (SC3; results and reports go to
`bake/work/cruise-sim/`, never into git).

## Load an identified plant

When Phase 2 has fitted the cruise from the step logs, write a JSON file:

```json
{ "name": "G20 DCC, drive 2026-12-03", "model": "P2",
  "params": { "deadTime_s": 0.9, "tau_s": 3.1, "deadTimeDown_s": 0.7, "tauDown_s": 2.2,
              "aMax_ms2": 1.3, "aMin_ms2": -1.1, "brakeMax_ms2": 0.8, "resolution_kmh": 1 },
  "source": "bake/work/cruise-ident/2026-12-03/fit.json" }
```

and run with `plant: { file: 'path/relative/to/tools/cruise-sim.json' }` (Node) or `plant: { data: <that object> }` (the
page). Any key of the plant's settings may appear in `params`; missing ones keep their defaults. The run is then marked
`assumed: false` (and `modified: true` if the config overrides any of the file's values). No code changes.

## Load a recorded lead trace

A vehicle with `profile: { type: 'replay', file: 'fixtures/traces/x.csv', t0: 0 }` (Node, path relative to this
folder) or `profile: { type: 'replay', data: ... }` (browser). Formats: JSON `{ "t": [...], "v": [...] }` (m/s),
`{ "t": [...], "v_kmh": [...] }`, `{ "points": [[t, kmh], ...] }`, or CSV with a header naming `t` and `v` (m/s) or
`v_kmh` (`,` `;` or tab; `#` comment lines). `t` must increase; the speed is linear between samples and held after
the last one.

## Tests

```
node tools/cruise-sim/test.js            # every tests/*.test.js, each in its own process (a few seconds)
node tools/cruise-sim/test.js plant sim  # only files whose name contains a word;  -v prints everything
```

`tests/harness.js` is an optional tiny harness (`test`, `assert`, `near`); a test file may also be a plain script that
exits non-zero on failure. `tests/stubs/sc2.js` pins the stand-in sensor / estimator / controller / warning / metrics of
`sim.js`, so a test of the engine keeps its numbers when the real modules change.

## What is where

| File | What | Owner |
| --- | --- | --- |
| `core/rng.js` | the one seeded generator; `fork(label)` streams | SC1 |
| `core/schema.js` | settings-schema helpers (`defaults`, `merge`, `validate`, `withPreset`) | SC1 |
| `core/sim.js` | the engine: `run`, `createSim`, recording, events, exact core metrics, the worst-time search hook | SC1 |
| `core/plant.js` | the stock cruise: P1 / P2 / P3, presets `liftoff` / `mild` / `firm`, drag, grade, states | SC1 |
| `core/vehicles.js` | other cars: scripted profiles, IDM, replay, lane changes; `gap`, `trueLead`, `follower` | SC1 |
| `core/road.js` | grade, curvature, lanes, speed limits along x | SC1 |
| `core/driver.js` | our driver: maximum speed, accelerator, brake / resume, the reaction to a warning | SC1 |
| `core/command.js` | the command path: delay, jitter, rate, drops, silent rejection, duplicates, reorder, stalls | SC1 |
| `core/failures.js` | failure injection at a time or at the worst time | SC1 |
| `core/sensor.js` `estimator.js` `controller.js` `warning.js` `baselines.js` | sensing and control | SC2 |
| `core/scenario.js` `metrics.js` `mixed.js`, `scenarios/`, `sweep.js`, `report.js`, `fixtures/` | scenarios and batch | SC3 |
| `ui/` | the page | SU1, SU2 |

Until a module of another owner exists, `sim.js` runs a small stand-in for it (`sim.STUBS`) and `meta.modules` says so.

## The models of SC1 in one paragraph each

**Plant.** The demand is `(v_set(t − Td) − v) (1 − e^(−dt/τ)) / dt` (P1, exact first order), with separate `τ` and `Td`
for slowing down (P2) or a second-order state `a' = ωn² (v_set − v) − 2 ζ ωn a` (P3); clipped to `[aMin, aMax]` and an
optional jerk limit; then realised through the powertrain: the force it needs (demand + aerodynamic drag + rolling + g ×
grade) is clipped between engine braking plus the brake authority the cruise may use (`brakeMax_ms2`, 0 = lift-off only)
and engine power / traction. Presets: `liftoff` (no brake, aMin −0.7: about −0.5 … −0.8 m/s² on the flat, nothing on a
steep downhill), `mild` (brake 2, aMin −1.8), `firm` (brake 3.5, aMin −2.8). The set speed is quantised
(`resolution_kmh`), clipped to the active range, accepted at most once per `acceptInterval_s`; states off / active /
suspended / override / dropout (below `dropoutBelow_kmh`, a fault, or a set far below the speed with
`farBelowMode: 'cancel'`).

**Command path.** Per write: delay + uniform jitter, then with set probabilities lost, silently rejected, duplicated,
held back (reorder) or applied late; a maximum accepted rate; random head-unit stalls during which the app does not run
and nothing is delivered. Preset `worst` for the robustness runs.

**Driver.** Reacts to a warning after a lognormal reaction time (median 1.2 s, clipped to 0.8 … 2.5 s; cases `nominal`,
`late` = 2.5 s, `none`), brakes at 6 m/s² (0.3 s build-up) only if actually closing on the lead, releases at the lead's
speed, resumes 3 s later when the time gap allows (by hand up to the cruise minimum first). Scripted maximum changes,
accelerator, brake, cancel, resume; optional: follows speed limits, brakes unwarned below a TTC.

**Failures.** `appStop`, `huRestart` (30–60 s, fresh app after), `gapFreeze`, `sensorBlind`, `commandLost` (the next
decrease, or all in a window), `setStuck`, `cruiseDropout`, `stall`, and the sensor faults `ghost`, `rangeCut`,
`latencySpike`, `dropBurst`, `degraded` (carried out by the sensor). `at: 'worst'` searches the injection time: every
1 s over the window, then every 0.2 s around the worst, by collision and impact speed, then the smallest gap (or a
metric named in `worstBy`); `result.meta.worst` lists every time tried and its score.
