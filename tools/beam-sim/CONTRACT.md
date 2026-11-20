# Auto Beam — the contract between the algorithm, the app and the capture tool

Written by HA on 2026-11-20, before the code. Three packages build against it:

- **HA** owns `shared/beam_logic.js` (the algorithm) and `tools/beam-sim/` (the simulator). A copy of this file is kept as
  `tools/beam-sim/CONTRACT.md` (docs/ is not in git).
- **HD** (`apps/auto_beam`) turns raw signals into the **input frame** (§2), calls `step`, draws the **output** (§3).
- **HS** (`tools/car/hb_analyse.py`) writes recorded drives as **scenario files** (§5).

**Stability rule.** Names in this file do not change. If something must change, it is **added** (a new key, a new
enum value, a new optional field) and logged in §9 with the date. Readers ignore keys they do not know. Writers may omit
every optional key. A new reason code may appear later: a reader that does not know a code shows `beam.reason.unknown`.

Units are in the key names: `_ms` milliseconds, `_kmh` km/h, `_m` metres, `_deg` degrees, `_dps` degrees per second,
`_lux` lux. Times (`t`, `since`, `holdUntil`) are milliseconds on one monotonic clock chosen by the caller (the app's
`Date.now()`, a recording's time since its start, the simulator's clock); the algorithm only ever subtracts them.

## 1. The module

```js
const B = require('../shared/beam_logic');       // Node 8.16 syntax, pure: no I/O, no timers, no globals, no Date, no random
const inst = B.create(config);                   // config: a partial object, merged over B.DEFAULTS (§4); bad values -> defaults
const out  = inst.step(frame);                   // one tick, §2 in, §3 out. Never throws (a caught error -> B.failOutput)
inst.reset();                                    // back to the first tick's state (a new drive)
inst.config                                      // the merged config actually in use (read-only by convention)
inst.configErrors                                // [ 'zone.head_m: NaN -> 400', ... ] what create() replaced

B.DEFAULTS                                       // the default config (§4)
B.SCHEMA                                         // [ { key: 'zone.head_m', unit, def, min, max, step, assumed, source, help } ]
B.STATES                                         // ['UNAVAILABLE', 'STANDBY', 'HIGH', 'DIPPED', 'OVERRIDE']
B.STATE_KEYS                                     // { HIGH: 'beam.state.high', ... }
B.PRESETS                                        // { early, normal, late }: the sensitivity setting, partial configs
B.mergePartial(a, b)                             // b over a, group by group (a preset over the user's config)
B.REASONS                                        // { clear: { states: ['HIGH'], key: 'beam.reason.clear' }, ... } (§6)
B.failOutput(t, reason)                          // the fail-safe output: want 'low', state 'UNAVAILABLE'
B.guard(inst, frame)                             // step() inside try/catch: the call the app makes every tick
B.VERSION                                        // the contract version this module implements (1)
```

**The caller's duty.** Call `step` on every tick of the app's loop (10–20 Hz is right; the logic does not depend on the
rate) with the latest values. Use `B.guard(inst, frame)` or your own try/catch: on any exception the advice is
`B.failOutput(t, 'error')` (want `low`). An `undefined` / `null` / non-object frame gives `want: 'low'`, reason `nodata`.

## 2. The input frame (one per tick)

```js
frame = {
  t: 123456,                                  // ms, monotonic; required (a missing or non-finite t -> want low, 'nodata')
  lights:  { v: [ light, ... ], age: 40, ok: true },   // the camera's light objects (RecogFrontCameraLightDetection)
  verdict: { v: { ... }, age: 300, ok: true },         // the camera's own high-beam verdict (controlHighBeamAssistant)
  objects: { v: [ obj, ... ], age: 60, ok: true, qual: 0 },   // fallback: the camera's general object list (the ACC set)
  car:     { v: { speed_kmh, yaw_dps, steer_deg, gear }, age: 20, ok: true },
  lamps:   { v: { low, high, fog, switch }, age: 100, ok: true },
  stalk:   { v: [ { t, kind } ], age: 0, ok: true },  // the driver's stalk EVENTS since the previous frame
  env:     { v: { brightness, sun, dayNight, wiper, limit_kmh, urban, camWeather, sight_m }, age: 500, ok: true },
  signs:   { v: [ { t, kind } ], age: 0, ok: true },   // the camera's town signs passed since the previous frame (§2.5)
  app:     { v: { rearm: false } }                     // optional: the app's own controls
}
```

**Every group** is `{ v, age, ok }` and may carry `qual` (a raw qualifier):
- `v`: the value. Members are optional; a missing member is "unknown", never "zero".
- `age`: ms since the source's last message at time `t` (0 = this tick). Missing = unknown age = **stale**.
- `ok`: the adapter's own judgement that the last message decoded (false: a decode error, a default "no value").
- A **missing group** means the source is not available at all (never seen, or not declared by the app).

The algorithm, not the adapter, decides staleness (`config.stale.*_ms`). The adapter never invents values and never
scales: raw numbers stay raw; the scales are in the config.

### 2.1 `lights.v[]` — one detected light source each (up to 15, raw camera units)

```js
{ id, cls, status, x, y, w, h, dist, wl, wr, age? }
```

| Member | From (catalogue: all UInt8) | Catalogue default ("no value") | Physical, via `config.scale` |
|---|---|---|---|
| `id` | `IdObjectN` | 15 | track id, 0..14 |
| `cls` | `ClassObjectN` | 15 | `config.classes[cls]` → `head` `tail` `street` `reflector` `bike` `other` |
| `status` | `StatusObjectN` | 7 | `config.status` lists → strong / weak / none |
| `x` | `XPositionObjectN` | 255 | azimuth `az_deg = (x − scale.x.center) × scale.x.gain`, **+ = right** |
| `y` | `YPositionObjectN` | 255 | elevation `el_deg = (y − scale.y.center) × scale.y.gain`, **+ = up** |
| `w`, `h` | `WidthObjectN`, `HeightObjectN` | 255, 63 | angular size, deg (`× scale.w.gain`, `× scale.h.gain`) |
| `dist` | `DistanceObjectN` | 127 | `dist_m = dist × scale.dist.gain + scale.dist.offset` |
| `wl`, `wr` | `AngularSpeedLeftObjectN`, `…RightObjectN` | 255 | deg/s (`(raw − center) × gain`), + = moving right |
| `age` | optional | | ms since this slot's last event; older than `stale.object_ms` is dropped |

The adapter puts in the list every slot that has a message (it may drop slots whose `status` equals the catalogue default
7). The algorithm drops an object whose status is in `status.none`, or whose `id`/`cls` is the "no value" default and
whose `x` is 255. **Every scale and class/status mapping is assumed until a night drive confirms it** (§4, `assumed`).

### 2.2 `verdict.v` — the camera's own verdict (raw)

```js
{ allow, reason, vehicles, signs, pedestrians, calibration, qualifier, qualifierExt }
```
`allow` = raw `controlHighBeam` (UInt8, default 3), `reason` = raw `reasonSwitchOffHighBeam` (UInt16, default 65535),
`vehicles` / `signs` / `pedestrians` = raw counts (default 15), `calibration` = raw `statusCameraCalibration` (default 3),
`qualifier` / `qualifierExt` = raw `qualifierDataControlHighBeamAssistant` / `qualifierExtended…` (default 15).
How the logic uses it: `config.verdict` (§4): `use: 'log'` by default (shown, compared, never decides).

### 2.3 `objects.v[]` — the fallback object list (the general camera list)

```js
{ id, cls, x, y, vx, lane,       // raw; x = longitudinal distance, y = lateral offset (+ left), vx = relative speed
  move, head, rear, vabs }       // added 2026-11-20 (HR §3.2), all optional:
```
- `move`: `'oncoming'` | `'same'` | `'stopped_oncoming'` | `'stationary'` | `'crossing'` | null — the list's movement status
  (`ObjectRecognitionFrontCamera.statusMovement` ONCOMMING 4 / SAME_AS_EGOVEHICLE 5 / STOPPED_…_WAS_ONCOMING 1 /
  CROSSING 7; `…2` adds STATIONARY_OR_PARKING_OBJECT_*). The adapter maps the enum to these words.
- `head`, `rear`: `'on'` | `'off'` | null — `objectlistTCP` `lights.status_head_light` / `status_rear_light`
  (UNKNOWN → null).
- `vabs`: absolute longitudinal speed, m/s (`velocity_absolute.x`), when the list has it.

How the logic reads an object (conservative, as HR §3.2 advises): `move` oncoming / stopped_oncoming → oncoming; `move`
same → a vehicle ahead; else by `vx` (closing faster than own speed + `objects.oncomingMargin_kmh` → oncoming);
else `head` on → oncoming; else an unclassified light. A `stationary` object with neither lamp on is ignored (a parked
car); a pedestrian class is ignored. Scaled by `config.objScale` (defaults: gain 1 = the adapter already hands metres
and m/s, assumed) and classified by `config.objClasses`. Used only when `config.objects.use` is `'fallback'` (lights silent) or `'both'`. `objects.qual` is
the list's qualifier (raw), judged by `config.objects.qualOk` / `qualReduced`.

### 2.4 `car.v`, `lamps.v`, `stalk.v`, `env.v`, `app.v`

| Group | Member | Type | Meaning |
|---|---|---|---|
| car | `speed_kmh` | number | own speed |
| car | `yaw_dps` | number \| null | yaw rate, + = left (either this or `steer_deg` is enough) |
| car | `steer_deg` | number \| null | steering-wheel angle, + = left |
| car | `gear` | `'P' 'R' 'N' 'D'` \| null | `P` and `R` mean "too slow" |
| lamps | `low` | bool \| null | low beam (dipped) is lit |
| lamps | `high` | bool \| null | high beam is lit (null until the member is identified on the car) |
| lamps | `fog` | bool \| null | a fog lamp (front or rear) is lit |
| lamps | `switch` | `'off' 'park' 'auto' 'low'` \| null | the light switch |
| stalk | `[{ t, kind }]` | events | `kind`: `'high_on'` (driver switched high on), `'high_off'` (driver switched it off), `'flash'` (a flash pull). The adapter maps the stalk bits to these (the bit meaning is in its config, unidentified today: ROUND.md §1a) |
| env | `brightness` | number \| null | raw ambient brightness; lux = `brightness × config.brightness.gain + offset` |
| env | `sun` | `'day' 'night'` \| null | the app's `shared/sun.js` verdict, null without a position or clock |
| env | `wiper` | number \| null | wiper level: 0 off, 1 intermittent / rain-sensor slow, 2 continuous slow, 3 fast (the adapter maps the car's enum) |
| env | `limit_kmh` | number \| null | the speed limit in force (TrafficSignRecognition `presentClassLimitSpeed` × 5) |
| env | `urban` | bool \| null | a built-up-area flag if any source gives one (none on this car: navigation is CarPlay) |
| env | `dayNight` | `'day' 'night'` \| null | the car's `Vehicle.statusDayNightChangeOver` (1 day, 2 night, else null); used like `sun` when `sun` is null |
| env | `camWeather` | `'CLEAR' 'RAIN' 'SNOW' 'FOG' 'GLARE'` \| null | the camera's `RecognitionWeather` enum name |
| env | `sight_m` | number \| null | the camera's `rangeOfSightCamera` bucket as its lower bound in metres (0, 1, 50, 100, 150, 300) |
| app | `rearm` | bool | the driver asked automatic operation back (an on-screen action); one tick |

### 2.5 `signs.v` — the camera's town signs (owner, 2026-11-20)

```js
[ { t, kind: 'town_in' | 'town_out' } ]     // events since the previous frame; t = when the adapter received it
```
From `de.bmw.dass.TrafficSignRecognition` (and `SignRecognitionFrontCamera`) `TrafficSignType`: `CITY_LIMIT_START_OF` →
`town_in`; `CITY_LIMIT_END_OF` → `town_out`; `CITY_LIMIT_START_END_OF` → `town_in` (hypothesis: the back-to-back sign
"end of one place, start of the next", so still built-up). Report a sign once (the logic ignores an event whose `t` it
has already seen). A missing group means "no sign source"; the limit and the street lights still work.

## 3. The output

```js
{
  t,                        // the frame's t
  want: 'high' | 'low',     // the advice ('low' whenever in doubt)
  state: 'UNAVAILABLE' | 'STANDBY' | 'HIGH' | 'DIPPED' | 'OVERRIDE',
  reason: '<code>',         // §6, never free text
  cause: null | { src: 'light' | 'object' | 'verdict', id, kind, dist_m, az_deg },   // what caused a dip (null otherwise)
  since: 1234,              // t when this state + reason began
  holdUntil: null | 1500,   // DIPPED: the earliest t of a return to high if nothing new appears; null = not counting
  confidence: 0.0 .. 1.0,   // how well the inputs support this output (§3.1)
  switched: false,          // want differs from the previous tick's want
  details: {                // for the app's data table and the analysis; may grow
    mode: 'advise' | 'auto',
    dark, speedOk, town, weather, lowBeam, curve: bool,
    stale: [ 'lights', ... ],         // the groups found stale or missing this tick
    lights: [ { id, kind, az_deg, el_deg, dist_m, strong, inZone } ],   // interpreted objects, nearest first
    counts: { head, tail, street, reflector, bike, other },
    street: n,                        // distinct street lights within the window
    switchesPerMin: n, dips: n,       // in the last minute / the flicker window
    override: null | 'high' | 'low',  // auto mode only
    verdict: null | { allow: true | false | null, use: 'log' | 'follow' | 'ignore', agrees: bool | null },
    driver: null | 'high' | 'low',    // lamps.high as seen this tick (the label in advise mode)
    urban: { on, src: null | 'sign' | 'limit' | 'lights' | 'flag', since, evidence_ms }   // §7a; details.town = urban.on
  }
}
```

### 3.1 Confidence
`1.0` for every fail-safe low (`UNAVAILABLE`, `STANDBY`) — the logic is sure low is right. `HIGH`: `1 − 0.5 × (lights
age / stale.lights_ms)`, × 0.7 when the object list's qualifier says "reduced", × 0.8 when the verdict is followed and
silent. `DIPPED`: 1.0 for a strong object, 0.6 for a weak one, 0.5 for street lights, 0.5 while only holding.
`OVERRIDE`: 1.0. It is a display hint; nothing depends on it.

### 3.2 Modes
- **`advise`** (default, Stage 1): the driver owns the lamps. Stalk events and `lamps.high` are **labels**, never
  inputs to the decision. `OVERRIDE` never happens. `details.driver` carries the driver's state for the score.
- **`auto`** (the simulator, and a future stage only on the owner's approval): the logic assumes its `want` is what the
  lamps do, and the driver's stalk overrides it (§7). Nothing in this round turns `want` into a lamp.

## 4. The config

`create(config)` merges each group one level deep over `B.DEFAULTS`. Unknown keys are kept and ignored. A value of the
wrong type, NaN, or outside `[min, max]` is replaced by the default and listed in `inst.configErrors`.
`B.SCHEMA` carries for every key: unit, default, min, max, step, `assumed` (true = the car has not confirmed it) and
`source` (`research` + the reference, `assumption`, `tuning` + the run, `catalogue`). The current values and their
sources are in `docs/highbeam/HA-REPORT.md`; the table here is the **shape** (defaults may be retuned; keys stay).

| Group | Keys |
|---|---|
| `mode` | `'advise'` \| `'auto'` |
| `stale` | `lights_ms`, `object_ms` (one light object), `verdict_ms`, `objects_ms`, `car_ms`, `lamps_ms`, `env_ms`; **0 = never stale** (a field the car notifies only on change, such as `LowBeam`) |
| `scale` | `x: { center, gain }`, `y: { center, gain }`, `w: { gain }`, `h: { gain }`, `dist: { gain, offset, max }`, `ang: { center, gain }`, `none: { x, dist, cls, id, status }` |
| `classes` | `{ '<raw cls>': 'head' \| 'tail' \| 'street' \| 'reflector' \| 'bike' \| 'other' }`; an unknown raw class is `other` |
| `status` | `strong: [raw…]`, `weak: [raw…]`, `none: [raw…]`; an unknown raw status is weak |
| `objects` | `use: 'off' \| 'fallback' \| 'both'`, `qualOk: [raw…]`, `qualReduced: [raw…]`, `reducedMeans: 'camera' \| 'ok'`, `oncomingMargin_kmh`. A present `objects.qual` outside both lists = camera blind |
| `objScale` | `x: { gain, offset }`, `y: { gain, offset }`, `vx: { gain, offset }` |
| `objClasses` | `{ '<raw cls>': 'car' \| 'truck' \| 'moto' \| 'bike' \| 'ped' \| 'other' }` |
| `zone` | `head_m`, `headSide_m`, `tail_m`, `tailSide_m`, `bike_m`, `other_m`, `core_deg`, `edge_deg`, `returnMargin` (while low a light holds the dip out to this × the zone), `noDist` (`'in'` \| `'out'`), `reflector` (`'ignore'` \| `'other'`) |
| `confirm` | `weakFrames` (extra consecutive frames a weak object needs), `strongFrames`, `jump_deg`, `jumpFrac` (a track that jumps this far starts over: a reused id) |
| `street` | `window_ms`, `count`, `minEl_deg` |
| `dark` | `on_lux`, `off_lux`, `onHold_ms`, `offHold_ms`, `useSun` (`'agree'` \| `'fallback'` \| `'off'`) |
| `brightness` | `gain`, `offset` |
| `speed` | `on_kmh`, `off_kmh` |
| `town` | `signs` (bool), `limit_kmh`, `limitHold_ms`, `clear_ms`, `litHold_ms`, `exitSpeed_kmh`, `exitSpeed_ms`, `maxNoEvidence_ms` (§7a) |
| `weather` | `wiperLow` (level ≥ this means "heavy"), `wiperClear_ms`, `fog` (bool: fog lamps mean low), `camFog` (bool: the camera's FOG means low), `minSight_m` (the camera's range of sight below this means low) |
| `curve` | `yaw_dps`, `steer_deg`, `mode` (`'delay'` \| `'dip'` \| `'off'`), `hold_ms` |
| `verdict` | `use: 'log' \| 'follow' \| 'ignore'`, `allow: [raw…]`, `deny: [raw…]`, `calibBad: [raw…]`, `qualBad: [raw…]` |
| `timing` | `clearHead_ms`, `clearTail_ms`, `clearBike_ms`, `clearOther_ms`, `clearStreet_ms`, `clearVerdict_ms`, `enter_ms`, `minLow_ms`, `flickerWindow_ms`, `flickerDips`, `flickerExtra_ms`, `maxPerMin`, `rateHold_ms`, `unavailableHold_ms` |
| `override` | `resume: 'dip' \| 'rearm'` (what the driver's dip after a manual high does, §7), `lowHold_ms` (0 = no time-out), `highMax_ms` (0 = no time-out), `flashMax_ms` |

A sensitivity preset for the app's three-step setting (earlier dip / normal / later dip) is `B.PRESETS.early`,
`B.PRESETS.normal` (= `{}`), `B.PRESETS.late`: partial configs merged over the user's config.

## 5. The scenario file (JSON)

One format for hand-written scenarios, the simulator's generated ones and recorded drives.

```js
{
  format: 'beam-scenario', version: 1,
  id: 'B03.oncoming.stream',            // unique, file name = id + '.json'
  family: 'B',                          // a letter (§5.2); recorded drives use 'R'
  name: 'A stream of oncoming cars',
  purpose: 'one line: what this scenario proves',
  source: 'hand' | 'generated' | 'recorded',
  meta: { created: '2026-11-20', tool: 'hb_analyse 0.1', notes: '' },   // numbers and enum words only; nothing personal
  duration_s: 60,
  seed: 1,                              // optional, the simulator's default seed for this scenario
  config: { ... },                      // optional: a partial beam_logic config this scenario runs with
  sim: { ... },                         // optional: simulator settings (sensor, mode, driver model)

  // EITHER a world the simulator turns into frames (hand-written / generated) ...
  world: { road, ego, users, lit, statics, weather, env, faults, driver },   // §5.1

  // ... OR the frames themselves (recorded / exported)
  frames: [ frame, ... ],               // §2, t ascending
  framesFile: 'x.jsonl',                // instead of frames: JSON Lines next to this file, one frame per line

  // optional ground truth and labels (any source)
  truth: [ { t, glare: [ { id, kind, dist_m } ], allowHigh: bool } ],      // what was really ahead (simulator / annotation)
  driver: [ { t, kind: 'high_on' | 'high_off' | 'flash' } ],               // what the driver did (else from frames' stalk)
  labels: [ { t0, t1, kind, note } ],                                       // HS's labelled events (kind: a reason code)
  expect: { ... },                      // optional pass limits (§5.3)
  limit: false                          // optional: true = the scenario documents a known limit of a light camera
}                                       //   (an unlit cyclist, a silently blind camera); kept out of the core totals
```

A recorded drive needs only `format`, `version`, `id`, `source: 'recorded'`, `frames` (or `framesFile`) and, when
known, `driver`. Times in `frames[].t`, `truth[].t`, `driver[].t`, `labels[]` are ms from the drive's start.

### 5.1 The world (the simulator's input; hand-written scenarios)

```js
world: {
  road: { lanes: 2, laneWidth_m: 3.5, median_m: 0, screen: false,   // median_m > 0: a divided road; screen: a glare screen
          segments: [ { len_m: 500, curve_r: 0 }, { len_m: 300, curve_r: 250 /* + left, − right */ }, ... ],
          profile: [ [s_m, z_m], ... ],          // elevation, linear between points (crests and dips)
          sight_m: 8 },                          // clear corridor beside the road in curves (trees, cuttings)
  ego: { s0_m: 0, speed: [ [t_s, kmh], ... ], lane: 0, lat: [ [t_s, d_m], ... ] },
  users: [ { id: 'c1', kind: 'car' | 'truck' | 'moto' | 'bike' | 'ped' | 'parked',
             dir: -1 /* oncoming */ | 1 /* same way */ | 0 /* standing */,
             s0_m: 900, ahead_m: null /* or: start relative to ego */, speed: [ [t_s, kmh], ... ],
             lane: 0, lat: [ [t_s, d_m] ], t0_s: 0, t1_s: null,
             lamps: 'on' | 'off' | 'weak', faces: 1 | -1 /* parked: which way its lamps point */ } ],
  lit:     [ { s0_m, s1_m, spacing_m: 35, side: 1, height_m: 8 } ],      // street lights
  statics: [ { kind: 'sign' | 'house' | 'station', s_m, d_m, height_m } ],  // things that fool cameras
  weather: [ [t_s, 'clear' | 'rain' | 'heavy' | 'fog' | 'snow'] ],       // also sets wipers / fog lamps unless env does
  env:     { brightness_lux: [ [t_s, lux] ], sun: 'night' | 'day' | [ [t_s, w] ], wiper: [ [t_s, lvl] ], fog: [ [t_s, bool] ],
             limits: [ [s_m, kmh] ], towns: [ { s0_m, s1_m, limit_kmh } ], wet: bool, lowBeam: bool },
  faults:  [ { kind: 'blind' | 'dirty' | 'stale' | 'silent' | 'verdictSilent' | 'freeze', t0_s, t1_s, reported: true } ],
  driver:  [ { t_s, kind: 'high_on' | 'high_off' | 'flash' | 'rearm' } ]    // scripted stalk actions
}
```

### 5.2 Families
`A` empty and baseline · `B` oncoming · `C` vehicles ahead · `D` divided roads · `E` towns and lit roads · `F` things that
fool cameras · `G` weak road users · `H` weather and camera faults · `I` the driver · `J` dusk, tunnel, speed, stops ·
`K` flicker and cut-ins · `R` recorded drives.

### 5.3 `expect` (all optional)
`maxGlareW` (weighted glare integral), `maxGlare_s`, `maxReaction_ms`, `maxSwitchesPerKm`, `maxSwitches`, `minHighFrac`
(time high / time high was allowed), `maxMissed_s`, `mustState: ['DIPPED', ...]` (visited), `neverState: [...]`,
`finalState`, `finalWant`. The safety invariants (§8) are always checked and need no entry.

## 6. Reasons and states (the app draws these)

| Code | State | i18n key | Українська | English |
|---|---|---|---|---|
| `clear` | HIGH | `beam.reason.clear` | Дорога вільна | Road clear |
| `settle` | DIPPED | `beam.reason.settle` | Перевірка дороги | Checking the road |
| `oncoming` | DIPPED | `beam.reason.oncoming` | Зустрічне авто | Oncoming vehicle |
| `preceding` | DIPPED | `beam.reason.preceding` | Авто попереду | Vehicle ahead |
| `cyclist` | DIPPED | `beam.reason.cyclist` | Велосипедист | Cyclist |
| `light` | DIPPED | `beam.reason.light` | Світло попереду | Light ahead |
| `streetlights` | DIPPED | `beam.reason.streetlights` | Освітлена дорога | Lit road |
| `curve` | DIPPED | `beam.reason.curve` | Поворот | Curve |
| `camera_verdict` | DIPPED | `beam.reason.camera_verdict` | Камера радить ближнє | Camera says dip |
| `flicker` | DIPPED | `beam.reason.flicker` | Пауза перемикань | Switching pause |
| `town` | STANDBY | `beam.reason.town` | Населений пункт | Built-up area |
| `slow` | STANDBY | `beam.reason.slow` | Замала швидкість | Too slow |
| `daylight` | STANDBY | `beam.reason.daylight` | Ще світло | Still light |
| `weather` | STANDBY | `beam.reason.weather` | Туман / дощ | Fog / rain |
| `lights_off` | STANDBY | `beam.reason.lights_off` | Фари вимкнено | Headlights off |
| `camera` | UNAVAILABLE | `beam.reason.camera` | Камера не бачить | Camera blind |
| `nodata` | UNAVAILABLE | `beam.reason.nodata` | Немає даних | No data |
| `error` | UNAVAILABLE | `beam.reason.error` | Помилка | Error |
| `driver` | OVERRIDE | `beam.reason.driver` | Рішення водія | Driver's choice |
| (any other) | — | `beam.reason.unknown` | Невідомо | Unknown |

| State | i18n key | Українська | English | `want` |
|---|---|---|---|---|
| `UNAVAILABLE` | `beam.state.unavailable` | Недоступно | Unavailable | low |
| `STANDBY` | `beam.state.standby` | Очікування | Standby | low |
| `HIGH` | `beam.state.high` | Дальнє | High beam | high |
| `DIPPED` | `beam.state.dipped` | Ближнє | Dipped | low |
| `OVERRIDE` | `beam.state.override` | Вручну | Manual | the driver's |

The words live in `shared/i18n/*.json`, which HD owns; `beam_logic.js` carries only the codes and keys (no Cyrillic).

The precedence when several reasons hold at once (the first wins): `error` › `nodata` › `camera` › `lights_off` ›
`slow` › `daylight` › `weather` › `town` › `driver` › `flicker` › `camera_verdict` › `oncoming` › `cyclist` ›
`preceding` › `light` › `streetlights` › `curve` › `settle` › `clear`.

## 7. The override rule (auto mode only)
- A `flash` is never an override (nor a `high_on` + `high_off` pair shorter than `override.flashMax_ms`).
- `high_on` by the driver → `OVERRIDE`, want `high` (`details.override: 'high'`). It ends when the driver switches off
  (`high_off`): with `resume: 'dip'` (default) the logic resumes in `DIPPED` and may return to high after
  `timing.minLow_ms`; with `resume: 'rearm'` the driver's dip becomes a manual low (next item). (`highMax_ms` > 0 also
  ends it.)
- `high_off` by the driver while the logic is `HIGH` → `OVERRIDE`, want `low` (`details.override: 'low'`). It ends on
  `app.rearm`, on the driver's next `high_on` (which becomes an override to high, as above), on a context change
  (the logic passes through `STANDBY` or `UNAVAILABLE`: a stop, a town, daylight), or after `lowHold_ms` when set.
- A `high_off` while the logic is already `DIPPED` / `STANDBY` / `UNAVAILABLE` is not an override: the driver agrees
  with the logic.

## 7a. The built-up area (owner, 2026-11-20: no map flag, the camera's signs instead)

The logic keeps one small state, `details.urban = { on, src, since, evidence_ms }`. The sources:

| Source | Starts the town | Counts as evidence while |
|---|---|---|
| `sign` | a `town_in` event, at once | — (a sign needs no evidence; it is ended by the rules below) |
| `limit` | `limit_kmh` ≤ `town.limit_kmh` (60) standing `town.limitHold_ms` (3 s), so one misread does not | the low limit stands |
| `lights` | street lights (`street.count` in the window) for `town.litHold_ms` (15 s) | the street lights continue |
| `flag` | `env.urban` true (kept for another source; none on this car) | the flag is true |

How it ends (the first that applies):
1. a `town_out` event ends it at once, whatever the source;
2. a `limit`, `lights` or `flag` town ends `town.clear_ms` (3 s) after its last evidence;
3. a `sign` town ends when a limit **above** `town.limit_kmh` is first seen after the entry (a country limit sign);
4. **the missed exit sign:** any town ends after `town.exitSpeed_ms` (20 s) at or above `town.exitSpeed_kmh` (70 km/h)
   with no street lights in view (nobody drives that through a town for 20 s legally);
5. the backstop: a `sign` town with no evidence at all ends after `town.maxNoEvidence_ms` (5 min).

When a town ends, the limit value then shown is **spent**: it cannot start a town again until the shown limit changes. So
a sign recognition that keeps showing "50" after a missed exit does not hold the high beam off for ever. The reason
shown while in a town is `town` (state `STANDBY`).

## 8. Safety invariants (the simulator's must-be-zero counters; the app may assert them too)
- `highStale`: `want: 'high'` from automatic operation (state `HIGH`) while lights, car or lamps data is stale or missing.
- `highSlow`: state `HIGH` while `speed_kmh < speed.off_kmh`.
- `highFog`: state `HIGH` while `lamps.fog` is true (and `weather.fog` is on).
- `highNoLow`: state `HIGH` while `lamps.low` is false.
- `exception`: any exception out of `step`, or any output that breaks §3's shape.

## 9. Change log
- 2026-11-20 HA: first version.
- 2026-11-20 HA, additions after the owner's decisions and HR-REPORT: `signs` group (§2.5); `env.dayNight`,
  `env.camWeather`, `env.sight_m`; fallback objects' `move`, `head`, `rear`, `vabs` (§2.3); `details.urban` and §7a;
  config keys `town.*`, `weather.camFog`, `weather.minSight_m`, `zone.returnMargin`, `confirm.jump_deg`,
  `confirm.jumpFrac`, `objects.reducedMeans`; scenario `limit`. Defaults from HR: `speed.on_kmh` 50, `speed.off_kmh`
  38. Nothing renamed or removed.
