# Cruise simulator — the contract between the five parallel agents

Written by the lead before the start (2026-11-19) so nobody waits for anybody. Brief: `docs/AGENT-BRIEF-cruise-sim.md`; parent: `docs/cruise-set-speed-brief.md`. SC1 copies this file to `tools/cruise-sim/CONTRACT.md` in its first commit and keeps it current; a change is announced in `bake/work/cruise-sim/pub/NOTES.md` (append, with your id and time) and is additive whenever possible.

## Owners (one owner per file; others read, never edit)

| Agent | Branch / worktree | Owns |
| --- | --- | --- |
| **SC1** engine and world | `cruise-sim/sc1` / `.claude/worktrees/cs-sc1` | `core/rng.js`, `core/sim.js` (`createSim`, `run`), `core/plant.js`, `core/vehicles.js` (scripted, IDM, replay, lane changes), `core/road.js`, `core/driver.js`, `core/command.js`, `core/failures.js`, `core/schema.js` (the settings-schema helpers), `test.js` (the runner), `README.md` |
| **SC2** sensing and control | `cruise-sim/sc2` / `cs-sc2` | `core/sensor.js`, `core/estimator.js`, `core/controller.js`, `core/warning.js`, `core/baselines.js` |
| **SC3** scenarios and batch | `cruise-sim/sc3` / `cs-sc3` | `scenarios/**/*.json`, `core/scenario.js` (loader, validation, expansion of a sweep), `core/metrics.js`, `core/mixed.js` (family L generator), `sweep.js`, `report.js`, `fixtures/traces/*` |
| **SU1** page shell and scene | `cruise-sim/su1` / `cs-su1` | `ui/index.html`, `ui/app.js` (shell, state, URL, playback, worker), `ui/scene.js`, `ui/style.css` |
| **SU2** charts, settings, batch views | `cruise-sim/su2` / `cs-su2` | `ui/charts.js`, `ui/settings.js`, `ui/batch.js` (matrix, feasibility map, tornado, tuning), `ui/report-view.js` |

All under `tools/cruise-sim/`. Tests: each owner writes `tests/<file>.test.js` for its own files; `test.js` (SC1) runs every `tests/*.test.js`.

**Until a module exists, code against this contract with a stub of your own in your branch** (`tests/stubs/` or inline), never by editing the other owner's file. The lead merges SC1 → SC2 → SC3 → SU1 → SU2 and fixes the seams.

## Language and style

Plain JavaScript, no build step, no dependency, no network. Every `core/` file works under Node (CommonJS `module.exports`) and in the browser (the page loads them with a tiny `define`-free loader: each file ends with
`if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['<name>'] = X;`
and requires its siblings through `typeof require !== 'undefined' ? require('./x') : self.CS.x`). `estimator.js`, `controller.js`, `warning.js` are **Node 8.16 syntax** (no `?.`, `??`, object spread, class fields) and pure. Units: SI inside (m, s, m/s, m/s²); km/h only at the edges (settings, display) and named `_kmh`.

## Every model module

```js
{
  NAME: 'plant',                       // the config key it reads
  SCHEMA: [ { key, label, unit, default, min, max, step, group, help, options? } ],   // drives the settings page
  PRESETS: { name: { ...params } },    // optional
  create(params, rng) -> instance      // params = defaults merged with the config's object
}
```

`core/schema.js` (SC1): `defaults(SCHEMA)`, `merge(SCHEMA, partial)` (unknown keys are an error), `validate(SCHEMA, params)`.

## Random numbers

`rng.create(seed) -> { next() /* [0,1) */, normal(mean, sd), int(lo, hi), pick(arr), fork(label) /* an independent stream, stable per label */ }`. Every module that needs randomness gets `rng.fork('<module>')`; nothing calls `Math.random`.

## The world (what `sim.js` advances every `dt` = 0.01 s)

```js
world = {
  t,                                     // s
  road:   { grade(x) /* fraction, + uphill */, curvature(x) /* 1/m */, lanes: n, speedLimit(x) /* m/s or null */ },
  ego:    { x, v, a, lane, jerk },
  others: [ { id, kind /* 'car'|'truck'|'moto'|'static' */, x, v, a, lane, lat /* m, 0 = lane centre */, length, width } ],
  cruise: { state /* 'off'|'active'|'suspended'|'override'|'dropout' */, setHeld /* m/s, what the cruise holds */, vMinActive, vMaxActive },
  driver: { vMax /* m/s, the driver's chosen maximum */, brake /* m/s² demanded, 0 none */, accel /* 0..1 */, reacting: bool },
  app:    { alive: bool },               // failures can stop it
}
```

## The pipeline per tick (sim.js calls these in this order)

(SC1, as built: the state of everything is at t through steps 2–7; the others and ego move to t + dt after recording,
so the sensor, the driver and the plant see one instant. Step 1 is therefore done last, together with step 8.)

1. `vehicles.step(world, dt)` — moves the others (scripts, IDM, replay, lane changes). **Runs after step 7.**
2. `failures.apply(world, t)` — sets flags read below (`world.faults = { sensorBlind, gapFrozen, appDead, commandsLost, ... }`).
3. `sensor.sample(world, t) -> meas | null` — null when it is not a sample time. `meas = { t /* delivery time */, tMeas /* when measured */, valid, id /* target id or null */, gap /* m or null */, vrel /* m/s, + = lead faster, or null */, lat, kind }`. Latency, jitter, noise, dropouts, outliers, wrong / ghost targets, curve loss are inside the sensor.
4. On the controller's clock (`config.controller.rateHz`), if `world.app.alive`:
   - `est = estimator.update(meas /* the latest delivered since last call, or null */, t, { egoV, egoA }) -> { valid, id, gap, vrel, vlead, alead, stale, reset /* true on a target change */ }`
   - `out = controller.step({ t, est, egoV, egoA, vDriver: world.driver.vMax, cruise: world.cruise }) -> { vSet /* m/s or null = leave it */, vRef, dDes, reason }`
   - `w = warning.step({ t, est, egoV, aMin: <plant's decel limit as configured> }) -> { warn, reason, dNeeded, ttc }`
   - `command.send(t, out.vSet)` when `vSet` changed.
5. `command.deliver(t) -> [ { tSent, tApplied, vSet, status: 'applied'|'dropped'|'rejected' } ]` — delay, jitter, rate limit, drops, stalls.
   (SC1: `plant.request(t, vSet, faults)` is called for every 'applied' arrival; a refusal turns it into `cmd.rejected`.)
6. `driver.step(world, t, { warn: w }) -> world.driver` — reaction model (delay, braking level), overrides, maximum changes.
7. `plant.step(dt, { t, grade, driver: world.driver, faults }, world.ego) -> { a, cruiseState, setHeld, setEff, aDemand }` — the
   plant keeps the set speed itself (`world.cruise` is its object); then `sim.js` integrates ego.
8. Collisions, metrics hooks, series recording (decimated to `config.out.dt`).

`baselines.js` (SC2) offers `idealAcc` and `human` as drop-in replacements of steps 4–7 for ego: `create(params) -> { step(world, t, meas) -> { a } }`.

## The config (one JSON object fully describes a run)

```js
{
  version: 1, seed: 1, dt: 0.01, duration: 120, out: { dt: 0.05 },
  scenario: { id, overrides: { ... } },           // or an inline scenario object under `scenario.inline`
  plant: { preset: 'liftoff'|'mild'|'firm', model: 'P1'|'P2'|'P3', ...params, file: null },   // file: an identified plant (JSON) -> assumed: false
  sensor: { ... }, estimator: { ... }, controller: { rateHz: 10, ... }, warning: { ... },
  command: { ... }, driver: { ... }, failures: [ { kind, at /* s or 'worst' */, duration, ... } ],
  ego: { mode: 'ours'|'idealAcc'|'human' },
  thresholds: { ... }                              // the pass thresholds, SC3's metrics.js SCHEMA
}
```

## The result

```js
run(config) -> {
  meta:    { config, seed, plant: { name, assumed }, version, ms /* run time */ },
  t:       Float64Array,                                   // on out.dt
  series:  { name -> Float64Array },                       // names below
  events:  [ { t, kind, ...detail } ],                     // kinds below
  metrics: { name -> number|boolean|null },                // SC3 metrics.js
  verdict: { pass, failed: [ names ] }
}
createSim(config) -> { step() /* one dt */, advance(seconds), state() /* world + last est/out/w */, done, result() /* as run() so far */ }
```

**Series names** (all SI): `ego.x ego.v ego.a ego.jerk lead.x lead.v lead.a lead.id gap.true vrel.true gap.meas vrel.meas meas.valid est.gap est.vrel est.vlead est.alead est.valid set.cmd set.held v.driverMax d.des d.needed v.ref timegap ttc warn cruise.state driver.brake driver.accel grade follower.gap follower.a`. Booleans and enums as numbers (an enum's names in `meta.enums`). A missing value is `NaN`.

**Event kinds:** `cmd.sent cmd.applied cmd.dropped cmd.rejected target.acquired target.changed target.lost warn.on warn.off driver.react driver.brake driver.override driver.resume driver.vmax cruise.state fault.on fault.off collision`.

## Scenario files (SC3)

```js
{ id: 'D.brake.-3', family: 'D', name, description, duration,
  road: { grade: [[x, frac], ...], curvature: [[x, 1/m], ...], lanes: 2, speedLimit: [[x, kmh], ...] },
  ego: { v0_kmh, vMax_kmh, lane: 0 },
  vehicles: [ { id, kind, lane, x0 /* m ahead of ego, - = behind */, v0_kmh, length, width,
                profile: { type: 'piecewise', points: [[t, v_kmh], ...] } | { type: 'accel', points: [[t, a]] } | { type: 'sine', ... }
                       | { type: 'idm', params } | { type: 'replay', file } } ],
  events: [ { t, kind: 'cutIn'|'cutOut'|'laneChange'|'driverVmax'|'driverBrake'|'driverOverride'|'fault', ... } ],
  sweep: { 'vehicles[lead].profile.points[1][1]': [ ... ], 'ego.v0_kmh': [40, 60, 90, 120, 150] },
  decide: [ 'minTimeGap', 'minTTC', 'collision' ], scope: 'in'|'warnOnly'|'outOfEnvelope' }
```

`scenario.js` (SC3): `load(idOrObject)`, `validate(s)`, `expand(s) -> [concrete scenarios]` (the sweep's cross product), `list() -> [{ id, family, name }]`.

## The page

`ui/index.html` loads `core/*.js` by `<script>` and `ui/*.js`. The shell (SU1) owns the state object and the run; SU2's views are mounted into elements with these ids: `#charts`, `#settings`, `#batch`, `#report`; they receive `app` (SU1) with `app.config`, `app.result`, `app.cursorT`, `app.on('result'|'cursor'|'config', fn)`, `app.setConfig(partial)`, `app.run()`, `app.loadResultFile(json)`. Long runs go to a Web Worker (`ui/worker.js`, SU1) that loads the same `core/*.js`.

## SC1 additions and changes (2026-11-19, all announced in bake/work/cruise-sim/pub/NOTES.md)

- **Loading in the browser.** Every `core/*.js` is wrapped in `(function () { 'use strict'; ... })();` — classic scripts
  share one global scope. The page loads them in `sim.LOAD_ORDER`: `rng schema road vehicles plant driver command failures
  sensor estimator controller warning baselines metrics scenario mixed sim`, then any other core file.
- **`create(params, rng, ctx)`.** SC1 passes a third argument `ctx` (`{ emit(kind, detail, t?), road, dt, ... }`); modules may
  ignore it. Params are the module's SCHEMA defaults merged with the config object (`schema.merge`, unknown keys throw;
  `rateHz` and `preset` are let through when the SCHEMA lacks them; `config.<module>.preset` applies `PRESETS[preset]`).
- **`run(config, deps)` / `createSim(config, deps)`.** `deps = { <module>: module }` replaces a module. A missing module of
  SC2 / SC3 is replaced by a stand-in (`sim.STUBS`); `meta.modules` names the source of each (`'x.js'`, `'stub'`, `'injected'`).
- **Clock.** The controller is due at 0, 1/rate, 2/rate, … on the first 10 ms tick at or after (the mean rate is exact); it
  does not run while `world.app.alive` is false or the head unit is stalled. The state at t = duration is recorded
  (`t.length = duration / out.dt + 1`). A collision ends the run (`config.stopOnCollision`, default true).
- **Geometry.** Every x is the FRONT bumper. `vehicles.gap(behind, ahead) = ahead.x - ahead.length - behind.x`;
  `vehicles.trueLead(world)` (nearest ahead in ego's lane), `vehicles.follower(world)`, `vehicles.leaderOf(world, veh)`.
  Each other vehicle also carries `y = lane * road.laneWidth + lat` (m, + = left; lane + = left; curvature + = left).
  A scenario vehicle's `x0` is its bumper-to-bumper gap (x0 < 0: its front |x0| behind our rear); `xFront_m` (front
  relative to ego's front) places a car alongside. Ego: length 4.7 m, width 1.85 m.
- **world.cruise** = `{ state, setHeld, setEff /* the set speed in effect after the dead time */, vMinActive, vMaxActive }`.
  `world.faults` = `{ appDead, restart, sensorBlind, blindMode, gapFrozen, commandsLost, setStuck, cruiseDropout, stalled,
  ghost, sensorRangeCut, latencyExtra, dropBurst, sensorDegraded, active }`; sim.js itself enforces gapFreeze and
  sensorBlind on whatever the sensor returns.
- **Warning input** `aMin` = `plant.params.aMin_ms2` (negative, the configured deceleration limit), and `aCmdMax` =
  `controller.rateDown_kmhps / 3.6` (m/s², positive) when the controller has that key.
- **Controller input, added** `curvature` (1/m at ego's x, + = left) and `yawRate` (= v · curvature). **Output** `send`:
  true = send vSet now (a change or a resend), false = do not; undefined = send when vSet changed.
- **Metrics.** At the end sim.js calls `metrics.compute(result, config)` (a plain object back) and
  `metrics.verdict(metrics, config.thresholds, scenario.decide)`. Before that, `result.meta.core` holds SC1's exact (10 ms)
  numbers: `minGap minTimeGap minTTC collision collisionWith collisionT collisionFrom impactSpeed peakDecel peakAccel
  peakJerk accelRms cmdSent cmdApplied cmdDropped cmdRejected cmdPerMin warnCount warnTime driverBrakes driverReactions
  followerMinTimeGap followerPeakDecel timeNotActive minSpeed duration` (Infinity -> null).
- **Result meta, added.** `duration dt outDt modules params /* every module's merged params */ enums core ego vehicles road
  scenario { id family name scope decide }`, and `worst` after a worst-time search. Enums: `cruise.state` (the plant's
  STATES), `id` (vehicle / target ids, for `lead.id meas.id est.id`), `warn.reason`.
- **Series, added.** `set.eff meas.id meas.wrong est.id warn.reason warn.ttc app.alive curvature elevation follower.v a.demand
  ego.lane ego.y`, and per
  vehicle `veh.<id>.x|v|a|lane|lat|y`. `timegap` and `ttc` are the TRUE ones (truth gap and speeds); the warning's own TTC
  is `warn.ttc`.
- **Events, added.** `vehicle.lane { id, phase: 'start'|'end', change, from, to }`, `driver.cancel`; `collision` carries
  `{ with, from: 'ahead'|'behind'|'side', impactSpeed }`; `fault.on/off` carry `{ fault, id }`; `cmd.*` carry
  `{ id, tSent, vSet, reason?, silent?, dup? }`; `cruise.state` carries `{ from, to, reason }`; `driver.react`
  `{ cause, rt, brakes }`; `driver.brake { level, cause }` (level 0, cause 'release' when let go).
- **Scenario events SC1 consumes.** `cutIn | cutOut | laneChange { vehicle /* or 'ego' for our own lane change */, toLane?, duration_s: 3, gap_m?, v_kmh? | dv_kmh?,
  whenGap_m? }`, `driverVmax { vMax_kmh }`, `driverBrake { level_ms2, duration_s }`, `driverOverride { accel, duration_s }`,
  `driverResume`, `driverCancel`, `fault { fault: <kind>, at | t, duration?, ...options }`. Scenario `ego` may also carry
  `cruise: 'off'` and `set_kmh`. Profile types: `const piecewise accel steps sine stopgo idm replay static`.
- **Failures.** Kinds `appStop huRestart gapFreeze sensorBlind commandLost setStuck cruiseDropout stall ghost rangeCut
  latencySpike dropBurst degraded`; `at: 'worst'` (one per run) is resolved by `run()` through `failures.searchWorst`.
- **Driver keys** (for reaction cases): `driver.reactionCase: 'nominal'|'late'|'none'` ('normal' = 'nominal').
