# Smooth needles, corked writes, one data copy per tick, GPU speed readouts (0.7.14, branch `perf/needle`)

The package follows `docs/PERF-AUDIT.md`, section 7, items 2, 3, 6 and 9. All work is on the bench only: nothing was run on the car, and the car was offline. The version is not bumped (app.json still says 0.7.13), nothing is pushed, and no shader source was changed.

**Bench setup.** Mac M1 Max on Node 22.22.3. The bench has no Node 8: `.cache/node8` is missing, so the app ran on Node 22, and the code was kept to Node 8 syntax by hand. There were two benches, each with the probe preload (`tools/perf/probe_preload.js`):
- **before:** commit bb89116 (0.7.13) in a separate worktree, port 8121;
- **after:** this branch, port 8120.

The headless Chrome used its own profile, DevTools 9330, SwiftShader.

## 1. What changed

### 1.1 Smooth needles are the default (`shared/hud.js`, "the needles")

- **The prototype is now engine code.** Package P's prototype has left the PERF block. Its parts are now `_isNeedle`, `_needleApply`, `_needleSample`, `_needleAt` and `_needleTick`.
- **How it moves the needles.** The speed and rev needles are the `dial` and `g20dial` widgets whose `measure` is `speed` or `rpm`.
  - They leave the 50 ms tick for their own 33 ms timer (`NEEDLE_MS`).
  - They show rpm and speed interpolated between the car's samples, one sample period back. The period is learnt from the samples, between 20 and 150 ms.
  - The rpm keeps the tick's 120 ms filter.
  - This is the same algorithm as the prototype. Its only knob, `rpmTau`, is gone (fixed at 120 ms).
- **The new setting.** `app.json` has `needleSmooth`, labelled "Smooth needles": a bool (checkbox), on by default.
  - It sits after "Baked 6WB textures".
  - MAIN shows only its placed rows (`"settings": "placed"`), so the kit puts the new row on the **SETTINGS** screen. The build confirms it: container SETTINGS holds `SET_NEEDLESMOOTH`, and MAIN still holds only its 5 rows.
  - A change applies at once, with no rebuild.
  - **Off** stops the needle timer. The tick then draws the needles exactly as in 0.7.13. The bench numbers with the setting off match 0.7.13 (section 2.2), and so do the screenshots (section 2.5).
- **The samples are always recorded.** They are a few array operations, 20 a second. So switching the setting on needs no warm-up. Until the first samples arrive, the needles read the car's values as before.
- **The shift-light test (`_testRpm`) works in both modes.** In the needle timer the test rpm goes through the same filter, as in the prototype.
  - Checked on the bench: the car stands at 900 rpm, then `testShift()` runs (a new probe command, `testshift`).
  - The tacho climbs from 0.14 to 0.92 of its sweep and comes back to 0.12, the same with the setting on and off.
  - It sent 110 needle messages smooth and 74 on the tick.
- **`perf.json` `"needle"` is dropped, not kept as an override.** The setting is the only switch. If `perf.json` still names `"needle"`, the log says once that it is ignored. `rpmTau` is ignored too.
- **The perf log** (`"log": true`) still works. Its line now says `needles smooth` or `needles on the tick`, and adds `JS in needle timer ms`.
- `stop()` turns the needle timer off for good (`needleHalt`). Every timer callback runs inside `_guard`.

### 1.2 Corked writes, always (`_cork` / `_uncork`)

- **What is corked.** Every client socket is corked around:
  - a tick's widget updates, uniforms and image frames alike;
  - each run of the needle timer.

  Each is uncorked in a `finally`.
- **Guards.** Only a socket that exists, is `connected` and not `destroyed`, and has `cork` and `uncork` is corked (Node 8 has both). Each `uncork` sits in its own try.
- **The effect.** All the messages a tick sends on one connection leave as one write, so one service wake and one scene flush.

### 1.3 One car-data copy per tick (`_data()`)

- **The copy.** `_tick` and `_needleTick` each copy `car.data()` once into `this._d` when they start. A `finally` clears it.
- **The readers.** Every `this.car.data()` call in `hud.js` is now `this._data()`: `_raw`, `_resolve`, `_update`, `_shift`, `_trip`, `_smoothRpm` and the others. `_data()` returns `this._d` inside a tick, and a fresh copy anywhere else. The one exception is the guarded `this.car && this.car.data()` in the consumption decoder.
- **Why the values are the same.** The car's data changes only in events, never during a synchronous tick, so every call inside a tick returned equal values before.
- **No caller changes the object.** This was checked: every caller only reads it.

### 1.4 The big speed readouts on the GPU (`"gpu": true` on a text widget)

- **The evidence that `atext` has drawn on the car.** Photo 10 (`reference/g20/10_grid_over-stock.jpg`) was taken on the car with the calibration grid layout (`grid.json`). It shows our atext widget reading **"ATLAS", a clock and "950"**. The crop is at x 700 to 1350 and y 780 to 920 of the photo. `docs/OVERLAY-PHOTO-PROTOCOL.md` (photo 10 row) and `design/overlay/g20_comfort.json` (photo 10 entry: "ATLAS 14:29 950") describe the same picture. **So the conversion was done.**
- **What `"gpu": true` does.** On a text widget it makes the engine (`_gpuTexts`, run on the shown widgets at each rebuild) draw that text with the existing ATEXT shader, unchanged, and an R8 atlas.
- **Why it is pixel-exact by construction:**
  - In both fonts every figure has one advance, and its ink stays inside it (measured).
  - The shader's cells sit on the figures' grid.
  - The atlas cells are `hud_text.mask`'s own coverage, cut on that grid.
  - The atlas is sampled `nearest`, and the layer is exactly cells × cell width by the font's cell height. So each screen pixel is one atlas texel.
- **Centred text and the grid.** Centred, a text of odd and of even length sits half an advance apart:
  - **F30 basic** (`n_speed`, advance 132, even): the cells are half a figure, 66 px, and **one layer** shows every length.
  - **6WB Sport and Sport + G20** (`wb_big`, advance 67, odd): **two layers**, `speed` (lengths 1 and 3) and `speed#2` (length 2). Both are written in the same corked tick, so no frame shows both or neither.
- **Other characters ("--" while the speed is unknown).** They are cut from the laid-out text and uploaded once into a spare atlas cell (6 spare). On the bench this is exact too (section 2.5).
- **Limits.**
  - `"maxLen": 3` on the speed widgets keeps the layers small.
  - Only plain readouts qualify: one colour, no fit, glow, slot or colour rules. Anything else stays an image text, with a warning in the log.
  - Night colours change in place (`u_color`, `_nightLive`).
  - The atlas is dropped like a scene texture when the layout shown does not use it (`_dropsUnused`).
- **The layouts.** `wb_sport.json`, `wb_sport_dials.json` and `f30.json`: `"gpu": true, "maxLen": 3` on `speed`.

### 1.5 Tools

- **`tools/perf/probe_preload.js`** counts the socket's own writes per connection (`flushes`), one per syscall, so one service wake each. It also times `_needleTick` and adds the command `testshift`.
- **`tools/perf/needle_test.sh`** switches the setting for its A/B. It also still writes the old `perf.json` key, so it runs against 0.7.13 too.

## 2. Numbers, before and after

### 2.1 Default settings, 20 s of demo driving, page closed (`bench_sweep.sh`)

In this table, "JS" is the tick plus the needle timer, in % of one M1 core. "Writes" are socket writes, which are service wakes.

| Layout | Tick JS ms / call before → after | Needle timer ms / call (30/s) | JS % of a core before → after | `car.data()` copies/s | Bytes/s, all connections | Messages/s | Writes/s | App CPU % before → after |
|---|---|---|---|---|---|---|---|---|
| 6WB Comfort | 0.312 → 0.129 | 0.151 | 0.62 → 0.71 | 351 → 65 | 2,494 → 5,175 | 25.1 → 49.0 | 25.1 → 28.0 | 1.75 → 1.67 |
| 6WB Dials + G20 | 0.320 → 0.123 | 0.151 | 0.63 → 0.70 | 311 → 65 | 2,305 → 5,008 | 24.2 → 50.6 | 24.2 → 28.6 | 1.80 → 1.66 |
| G20 Comfort | 0.197 → 0.069 | 0.127 | 0.39 → 0.52 | 154 → 65 | 3,166 → 3,517 | 37.7 → 55.0 | 37.7 → 55.0 | 1.55 → 1.35 |
| 6WB Sport | 0.455 → 0.119 | 0.134 | 0.91 → 0.64 | 304 → 65 | **82,332 → 5,035** | 27.2 → 51.8 | 27.2 → 31.0 | 2.22 → 1.60 |
| 6WB Sport + G20 | 1.100 → 0.132 | 0.140 | 2.15 → 0.68 | 311 → 65 | **138,188 → 3,825** | 43.2 → 40.1 | 43.2 → 24.6 | 2.89 → 1.59 |
| 6WB Eco Pro | 0.506 → 0.103 | 0.086 | 1.00 → 0.46 | 212 → 65 | 1,409 → 948 | 21.3 → 14.4 | 21.3 → 14.4 | 2.75 → 1.22 |
| F30 basic | 0.615 → 0.095 | 0.022 | 1.22 → 0.26 | 146 → 65 | **279,517 → 755** | 13.5 → 8.8 | 13.5 → 4.6 | 3.11 → 1.00 |

How to read it:
- **More needle messages, about the same number of writes.** The needles now send up to 30 times a second instead of at most 20, so the needle messages roughly double, and so do the needle bytes (1 to 2 KB/s more). Corking keeps the writes, which are the service's wakes and flushes, close to before: 28 instead of 25 a second for 6WB Comfort, against 49 messages.
- **G20 Comfort gains nothing from corking.** Its two needles are on different connections, so its writes equal its messages.
- **Image uploads of the speed readout:**
  - 6WB Sport, connection 2: 79,153 B/s → 696 B/s.
  - 6WB Sport + G20: 134,157 → 522.
  - F30 basic: 279,517 → 755.

  The audit measured 113 and 492 KB/s on another stretch of the demo drive.
- **Tick JS.** The tick itself is 2.5 to 6 times cheaper. Part of that is the needles moving to their timer, part the single data copy and the readout no longer drawn as pixels.
- **JS overall.** In the layouts without a big readout, the JS per second is slightly higher (+0.1 % of an M1 core), because the needles update 30 times a second instead of 20. In the readout layouts it is lower.
- **Noise.** The bench CPU numbers are noisy: one sweep each. The 1.1 ms mean tick of Sport + G20 before had a 39 ms outlier.
- **On the car.** Multiply the CPU figures by about 8 (audit, section 2).

### 2.2 The tick alone: setting off, 0.7.13 → 0.7.14 (`needle_test.sh` "base", idle loop)

This isolates corking and the single data copy. The needles are on the tick in both runs.

| | 6WB Comfort 0.7.13 | 6WB Comfort 0.7.14 | G20 Comfort 0.7.13 | G20 Comfort 0.7.14 |
|---|---|---|---|---|
| Tick JS, mean ms | 0.486 | 0.342 | 0.330 | 0.189 |
| `car.data()` copies/s | 351 | 35 | 154 | 35 |
| Messages/s | 30.3 | 20.4 | 35.3 | 37.6 |
| **Socket writes (service wakes) per tick** | **1.51** | **0.62** | 1.76 | 1.88 |
| Messages per write | 1.0 | 1.65 | 1.0 | 1.0 |
| Needle judder / frames that move | 1.60 / 0.32 | 1.61 / 0.32 | 1.60 / 0.32 to 0.33 | 1.60 / 0.32 to 0.33 |

- **Corking works.** On a connection that carries both dials (6WB), the speedo and tacho of one tick go out as one write. G20 Comfort's dials are on two connections, so it has one write per connection per tick, as before.
- **The two runs drove different demo stretches.** That is why their message counts differ.
- **The needle figures are identical.** With the setting off, the needles behave as in 0.7.13.

### 2.3 Needle smoothness (`needle.py`, a 60 Hz frame grid, demo driving)

| Case | Judder (0 = even) | Frames that move | Longest stand-still while moving |
|---|---|---|---|
| 0.7.13, any layout, idle loop | 1.59 to 1.61 | 0.31 to 0.33 | 100 to 200 ms |
| **0.7.14 default, idle loop** (all 6 dial layouts, sweep) | **0.83 to 0.98** | **0.40 to 0.49** | 67 to 200 ms (slow speedo: under one step per frame) |
| 0.7.14, setting off | 1.60 to 1.61 | 0.32 to 0.33 | 67 to 200 ms |
| 0.7.13, loop busy 60 ms in every 100 | 1.61 | 0.16 | 117 to 200 ms |
| **0.7.14 default, loop busy 60 / 100** | **1.22 to 1.41** | **0.28 to 0.33** | 67 to 167 ms |

- **These match the audit's prototype figures.** The prototype run against 0.7.13 gave the same: judder 0.84 to 1.00, frames that move 0.38 to 0.48.
- **The cost is latency.** The speed needle trails by one sample period, about 50 ms, interpolated, and the digital readout does not. The rev needle trails by the same period plus the filter it always had.

### 2.4 Layers, pixel memory and switch writes (the layouts with a GPU readout)

| Layout | Layers per connection | Pixel memory | Whole-sheet writes on a switch |
|---|---|---|---|
| 6WB Sport | 7 + 2 + 5 = 14 → **7 + 7 + 5 = 19** | 3.3 → 2.1 MiB | 1.50 → 0.78 MB |
| 6WB Sport + G20 | 7 + 3 + 5 = 15 → 7 + 6 + 5 = 18 | 4.5 → 3.2 MiB | 1.61 → 0.80 MB |
| F30 basic | 5 → 7 | 1.9 → 1.0 MiB | 1.02 → 0.21 MB |

- **The new layers.** 6WB Sport's connection 2 grows by the two speed layers. The readouts that shared a sheet with the speed now pack into 4 small sheets instead of 1: without the speed's area in the sheet, the layout's `packWaste` of 8 splits them.
- **Within the limits.** Every connection stays at 8 layers or fewer. 6WB Comfort already runs 21 layers (7 + 7 + 7) on the car.
- **The atlases:**
  - `wb_big`: 1072x90 R8, 0.2 MiB of pixel memory.
  - `n_speed`: 1716x192 R8, 0.6 MiB.

### 2.5 Screenshots

The bench ran with manual signals (2,500 rpm, gear 4, oil 100, coolant 90) and 3 speeds: 7, 88 and 123. Every 6WB layout, G20 Comfort and F30 basic was shot before and after, 21 pairs in all.

- **6WB Comfort, 6WB Dials + G20, 6WB Eco Pro, G20 Comfort:** 0 pixels differ.
  - The needles converge to the same positions with constant signals. A moving needle differs only in timing, which a still picture cannot show.
- **6WB Sport, 6WB Sport + G20 (speed 7, 88, 123):** 72 to 470 pixels differ.
  - Every one is inside the speed glyphs' anti-aliased edges, at most 7 of 255 apart: for example 13 vs 14, or 4 vs 0.
  - Glyph shapes, sizes and positions match. The glyph cores are identical, and the side-by-side crops cannot be told apart.
- **F30 basic (speed 7, 88, 123):** 249 to 990 pixels differ, at most 6 of 255, again only on glyph edges.
- **"--" (speed unknown, a layout override with the text fixed):**
  - 6WB Sport: 0 pixels differ.
  - F30 basic: 368 pixels differ, at most 4 of 255.
- **With the setting off:** the same results for all 7 layouts at speed 88.
- **The page's console was clean.** This was with no shader errors (cdp2).

The edge differences come from how the bench page draws an image layer and an effect layer. The image layer carries 8-bit straight alpha. The effect layer takes the mask byte times the colour in float.

### 2.6 Tests

- **`BENCH_PORT=8111 node bench/test-native-ui.js`:** 42 passed, 0 failed.
- **`app.json` validation.** There is **no `kit/tools/validate.py` in this repo**, nor in its history. The only validators are the overlay and bake ones. `app.json` and the layouts were checked as follows:
  - They parse as JSON.
  - `kit/tools/build.py f30_cluster` builds: 3 screens, SETTINGS 17.
  - The kit placed the row on SETTINGS (section 1.1).

## 3. Skipped, and why

- **perf.json `"needle"` as an override:** dropped, so the setting is the one switch. The log says so if the key is still there.
- **Moving the needle onto the GPU (`time` / `time_fps`, audit item 4):** not in this package. It would need a shader change, and only that option survives a blocked event loop. With the page open, 0.7.14 still loses frames (section 2.3, busy-loop rows).
- **Version bump, push, merge:** for the coordinator, on the owner's word.

## 4. What to check on the car

Take a slow-motion phone video of the cluster, 120 or 240 fps, and of the needles while accelerating and braking. Use the same road for each run:
1. **6WB Comfort, "Smooth needles" on** (the default). The speedo and tacho should sweep evenly with no visible steps, and never stand still for a beat while the speed changes.
2. **The same with the setting off** (Settings → Smooth needles). It should look like 0.7.13: the steps and the occasional 100 to 200 ms stand-still.
3. **6WB Sport, and F30 basic if it is used.** The big digital speed should look exactly as before, same font, size and place, for 1, 2 and 3 digits. Look for:
   - no flicker when it passes 9 → 10 and 99 → 100 km/h;
   - "--" right after start, before the car sends a speed;
   - night colours after sunset.
4. **With the centre-screen page open (setting on).** The needles will still hitch while the page draws (audit item 1). That is expected, not a regression.
5. **Optional, the perf log** (`{ "log": true }` in `perf.json`). The `perf:` line should say `needles smooth`, and give `JS in needle timer ms` and `bytes/s per connection`. The cluster-render log should show about 0.6 to 0.7 writes per tick for 6WB Comfort's connection 1, and far fewer KB a minute in 6WB Sport.

**What would mean a problem:**
- the KOMBI resetting, or a layer "waiting" in 6WB Sport or F30 (the new ATEXT layers, nearest-sampled atlas);
- the speed digits doubled or missing at a length change;
- a needle that lags visibly behind the digital speed (more than about 0.1 s).
