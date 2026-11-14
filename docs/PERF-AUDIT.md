# Performance audit (package P, 2026-11-14)

The owner's request: "I need a full performance audit. I want to understand how much and what can be optimised, and what takes the most. Right now the needle seems to freeze slightly; it isn't smooth enough."

Branch `perf/audit` (local, from `main` at 8fe3c81). Bench on port 8100, its own headless Chromes (DevTools 9311 Metal, 9312 SwiftShader). Nothing was run on a car. Every number below says where it comes from. **Bench** means measured on the Mac (Apple M1 Max, Node 22.22.3, the bench's fake cluster-render). **Car** means an estimate until `scripts/perf_probe.sh` and the opt-in perf log have been run on the car (section 8).

## 0. The short answer

1. **Our process is not busy while the centre-screen page is closed.** The whole app uses about 2 % of one M1 core in steady demo driving, in every layout. The engine's 50 ms tick takes 0.3 to 0.5 ms. Estimated on the car (about 8 times slower, section 2): about 15 % of one core, and 3 to 4 ms per tick. There are no long tasks.
2. **The centre-screen page costs about 25 times the engine while it is open.** One software frame is 8.8 ms on the M1, at 10 frames a second, which is 9.6 % of a core. The time goes to the kit's JavaScript rasteriser (`canvas.js fillRect`, `roundRect`, `strokeRoundRect`). On the car that is about 70 ms a frame, before the PNG encode, against the app's `cpuLimit` of 60 %. While the page is open the event loop is blocked for about 70 ms every 100 ms. That alone explains a needle that stops and jumps.
3. **The needle moves 20 times a second at best, never at the display's rate.** The value is sampled by a 50 ms `setInterval` with no interpolation. The speed is not filtered at all. The rpm passes a 120 ms filter. On a 60 Hz cluster only one frame in three moves (measured 0.31 to 0.33). The steps are uneven ("judder" 1.6, where 0 would be even motion), because the car's samples and our tick run on two unsynchronised clocks. Even on the bench the needle stands still for 100 to 117 ms at a time while it is moving.
4. **The GPU cost is set by the 6WB backdrop and the two big dials.** The 6WB layouts shade 1.69 screens of effect pixels per frame, with 2.0 layers over the average pixel. In SwiftShader that is 57 to 64 ms per frame, against 5 ms for F30 basic and 38 ms for G20 Comfort. WBBACK (full screen) is about half of that and the two 670x670 WBDIALs about 45 %. Whether this reaches the cluster GPU's 16.7 ms frame budget is **not known**: the bench cannot tell, and the KOMBI's GPU is not identified (section 5).
5. **The socket is not the problem.** In steady driving the traffic is 1.7 to 4 KB/s, except where a large text readout changes. 6WB Sport sends 113 KB/s and F30 basic sends 492 KB/s, against an upload budget of 2,000 to 5,500 KB/s. A layout switch writes 1.0 to 6.2 MB. At the budget's floor, that is up to 3 s of uploads.

**The needle's "freeze": the cause.** Evidenced on the bench: the stepping comes from a 20 Hz update with no interpolation, plus the beat between the two clocks. A hypothesis, to be checked on the car with the probe: the visible stalls come from the event loop being blocked, mainly by the centre-screen page while it is open, and possibly by the cgroup's CPU throttling. That hypothesis is strong. A further unknown is how often the car actually sends speed and rpm. Section 3 has the timeline and the evidence.

### Ranked costs

The car figures are estimates (CPU at about 8 times the bench, section 2) until the probe runs.

| # | Cost | How measured | Bench | Car estimate | Share of its budget |
|---|---|---|---|---|---|
| 1 | Centre-screen page, software frames, while open | probe: `Page.render` + `display.present` per frame; cpuprofile | 8.8 ms a frame, 10 a second = 9.6 % of a core | about 70 ms a frame plus the PNG, so 75 to 100 % of a core | **Over** the app's `cpuLimit` of 60 %. It blocks the loop about 70 ms in every 100. |
| 2 | GPU: the 6WB backdrop (WBBACK, full screen) | WebGL timing of the real shader, blended | SwiftShader 28.6 to 34 ms, 50 % of the layout | unknown GPU | about half of whatever the 6WB frame costs on the KOMBI |
| 3 | GPU: the two big 6WB dials (WBDIAL 670x670) | as above | SwiftShader 25 to 28 ms, 45 % of the layout | unknown | about 45 % of the frame |
| 4 | Layout switch uploads | probe: bytes in the 4 s after a switch | 1.0 to 6.2 MB | the same bytes | up to 3 s of the upload budget at its 2,000 KB/s floor. Every other app's writes wait meanwhile. |
| 5 | Big text readouts that change while driving (F30 basic speed 700x192, 6WB Sport speed 260x90) | probe: frame bytes per widget | 492 KB/s (F30), 113 to 133 KB/s (Sport) | the same | 9 to 25 % (F30) or 2 to 7 % (Sport) of the upload budget |
| 6 | Pixel memory, 6WB Comfort | the client's images and assets times two | 11.5 MiB (8.4 of it scene textures and atlases) | the same | 72 % of the service's 16 MiB, shared with every app |
| 7 | The engine's tick (every widget, 20 a second) | probe: `_tick` wall time | 0.30 to 0.54 ms mean, 7.5 ms max | 3 to 4 ms mean | 6 to 8 % of the 50 ms tick |
| 8 | Layout rebuild JS | probe: `_rebuildInner` | 2 to 16 ms | 20 to 130 ms, in one piece | one or two missed ticks per switch |
| 9 | Uniform messages (needles) | probe: messages per connection | 17 to 40 a second, 1 to 2.5 KB/s | the same | negligible bytes. Up to 4 service flushes per tick (not corked). |
| 10 | The app in steady driving, page closed | `process.cpuUsage` | 1.8 to 2.5 % of a core | about 15 % | a quarter of `cpuLimit` |

## 1. The system, as checked in the code

The brief's description was checked against the code. Where it was wrong, it is corrected here.

| Part | What the code says |
|---|---|
| The app | One Node process: `main.js` starts `HudApp` (`shared/hud.js`) and `Page` (`shared/page.js`). OAP package settings from `kit/tools/build.py`: **`cpuLimit` 60** and `priority PRIO_LOW` (app.json sets neither, so the defaults apply). |
| Signals | `kit/runtime/car.js` subscribes to SOME/IP: `CDS.statusEngineSpeed2` (rpm), `Vehicle2.statusCarSpeed2` (speed), and so on. Each notification is decoded and stored in `live`, and `onSample` listeners are called for rpm, speed and gLong. **No arrival time is kept for drawing.** Demo: `sim.js`, stepped every 50 ms on its own `setInterval`. |
| The engine tick | `hud.js start()`: `setInterval(_tick, TICK_MS = 50)`. Each tick runs `_smoothRpm` (a 120 ms exponential filter, the readout in 50 rpm steps) and then `_update` for every widget. A dial sends `u_dyn` / `u_val` when its value, quantised to 1/1000 of the sweep (1/2000 for g20dial), changes. Text repaints at most every `TEXT_MS = 200`. |
| The client | `shared/cluster_render_client.js`: every uniform is its own `sock.write` (one JSON message each, no batching). Image changes go out from `_pump` as dirty rects. A rebuild re-sends sheets and assets whole. |
| Connections | Up to 4 (`MAX_CONN`). The 6WB layouts use 3, F30 basic uses 1. |
| cluster-render (upstream, read only) | Its loop is `poll()` on every client socket, with a timeout of 1000 / `fps` (30) while a target is shown. **Each wake** reads up to 4 MB per client, applies the messages and then runs `Compositor::render`. Any layer with a dirty uniform stages it, and the scene is **flushed at once** (`ESceneFlushMode_Synchronous`). Uniforms are therefore applied at the next wake, not on a 30 fps grid, and every write that wakes the loop can cost a flush. `fps` paces image and video writes and `time_fps`, not uniforms. Source: `src/service.cpp` `timeout_ms` / `after_poll`, `src/compositor.cpp` `render_target`, `src/layer.cpp` `EffectLayer::stage`. |
| `u_time` | `time: 1`: a RAMSES animation (0 to 3600 s, looping) that the **renderer plays itself, with nothing sent per frame** (`EffectLayer::cluster_time`). `time_fps: n`: the service sets `u_time` = seconds since the layer was made, n times a second, and each of those is a flush. Neither is used by any of our shaders today. |
| `animate` | Uniform keyframes are played by the renderer. A **`stop` (and every restart of the same animation) destroys and rebuilds the whole animation system** (`graph_ramses19.cpp stop()`, "VERIFIED ... crashes" notes). That rules out a fresh animation for every needle update. |
| Upload budget | 5,500 KB/s ceiling, 2,000 floor, steps of 500. It covers image and asset writes (`cluster-render.conf`). |
| The centre-screen page | `ctx.loop('MAIN', 10, render)`. **The kit already pauses it while the page is hidden** (`mgu.js loop`: `ui.onVisible` → `set(false)`). While it is visible: about 10 fps in software (`display.present` → `play()` into a new `Canvas`, then PNG to the HMI, every frame, changed or not), or up to 60 fps with mgu-renderd (`display.active`). The software path also calls `global.gc()` every third frame when `--expose-gc` is given. |
| The head unit's CPU | The brief says ARM. **Upstream builds the service for the unit as amd64**, with Ubuntu 18.04 amd64, gcc 7.5 and "SSE2 paths" (`docker/Dockerfile`, README "make test-x86"). That fits the Intel Atom (Apollo Lake) usually reported for the MGU. Treat this as unconfirmed: the probe prints `/proc/cpuinfo`. |

## 2. Method, and how far the bench carries

- **The probe in the app** (`tools/perf/probe_preload.js`, bench only, loaded with `NODE_OPTIONS=--require`; nothing in the app requires it). It wraps prototypes after the modules load and records the following:
  - the event-loop lag (a 5 ms timer);
  - the JS time per function;
  - each widget's socket messages and bytes;
  - every needle uniform with its time;
  - the pixel memory as the service counts it;
  - cpuprofiles, taken in a separate window from the CPU % so that the profiler is not counted.
- **The sweeps.** `tools/perf/bench_sweep.sh`: 20 s of demo driving per layout, with the page loop stopped as on the car while driving. `switch_sweep.sh`: ten layout switches. `needle_test.sh`: an A/B of the needle prototype. `gpu_sweep.sh` / `gpu_time.mjs`: each effect layer's real shader, with the uniforms and textures the app sent, timed in the bench page's WebGL. `summarise.py`, `needle.py`, `overdraw.py` and `profile_top.py` read the results.
- **The CPU factor, M1 Max on Node 22 to the car on Node 8: about 8 times (range 5 to 12), an estimate.**
  - About 4 to 5 times comes from the core: single-thread, an Apple M1 Max Firestorm against an Apollo Lake Goldmont core at 1.9 to 2.4 GHz. Public single-core benchmarks put them about that far apart.
  - About 1.3 to 2 times comes from Node 8's V8 6.8 against V8 12. Our hot paths are Buffer work, `JSON.stringify` and string building, which have improved a lot since.
  - The rest comes from `PRIO_LOW` and sharing the CPU with the HMI.
  - The probe settles the factor: compare the app's CPU % on the car (`/proc/<pid>/stat`) with the bench's 2 % for the same layout.
- **The GPU.** The M1 Max's Metal numbers are 0.04 to 0.23 ms per frame. They only rank layers and layouts. SwiftShader (software GL on the CPU) follows each shader's arithmetic and is used for the shares. The cluster's GPU is unknown: it renders the RAMSES scene in the KOMBI. Our note "mediump is fp16 on the car" says it is an embedded GPU. Absolute frame times on the car cannot be derived from either number.

## 3. The needle

### 3.1 One value, notification to glass

| Step | Where | Time | Rate |
|---|---|---|---|
| The car sends rpm / speed | SOME/IP notification → `car.js` `put()` → `live` | ? | **Unknown on the car.** Nothing in the repo or logs measures it. The demo sim is 20 Hz. The opt-in perf log measures it (`rpm changes N/s (gap ms ...)`). |
| Waits for the next tick | `hud.js setInterval(_tick, 50)` | 0 to 50 ms (average 25), more if the loop is busy | 20 Hz, unsynchronised with the samples |
| Filter | rpm: `_smoothRpm`, τ 120 ms (a ramp lags about 120 ms). Speed: none. | | |
| Quantise and compare | dial `round(v*1000)/1000` (0.27° of a 270° dial), g20dial 1/2000 | | sent only on change |
| Encode and write | `JSON.stringify` + `sock.write`, one message and one syscall per uniform (no cork) | 0.1 to 0.2 ms bench | 20 to 48 messages/s |
| Service wake | poll → read → `uniform` → `render` → `flush` (synchronous) | ? on the car (`slow_flush_ms` = 150 is its alarm) | one flush per wake that carries a change: up to 4 per tick, because our 4 dial writes are separate |
| KOMBI renderer | shows the newest flushed scene at its own vsync | 60 Hz assumed (not measured) | |

### 3.2 Measured on the bench (demo driving, M1)

From `tools/perf/needle.py`. Each send is replayed on a 60 Hz frame grid, counting only the frames in which the needle is moving.

| Case | Needle | Updates/s | Frames that move | Longest stand-still while moving | Judder (0 = even) |
|---|---|---|---|---|---|
| Today, page closed | 6WB speedo / tacho | 8 to 12 (sent only on change) | 0.32 / 0.31 | 100 ms | 1.60 |
| Today, page closed | G20 speedo / tacho | 17 to 18 | 0.32 / 0.32 | 117 / 100 ms | 1.60 |
| Today, **page open** | 6WB speedo / tacho | 13 to 14 | 0.31 | 117 ms; tick period max 70 ms, loop lag p99 9.7 ms | 1.61 |
| Today, **loop busy 60 ms in every 100** (the car's page, stand-in) | 6WB | 9 | **0.16** | 183 to 200 ms | 1.61 |
| Prototype `needle: smooth`, page closed | 6WB speedo / tacho | 22 to 25 | 0.40 / **0.48** | 100 to 167 ms (slow needle below one quantum a frame) | **1.02 / 0.87** |
| Prototype, loop busy 60 / 100 | 6WB | 12 | 0.27 / 0.29 | 117 ms | 1.33 / 1.25 |
| Prototype, page closed | G20 | 20 | 0.42 / 0.48 | 83 to 117 ms | 1.01 / 0.89 |
| Prototype, loop busy 60 / 100 | G20 | 15 | 0.29 / 0.32 | 100 to 167 ms | 1.29 / 1.24 |

Each value was sampled 20 s per case, in `run2/n_*.dump.json` (the scratch folder). Twenty updates a second on a 60 Hz display can at best move one frame in three (0.33), and 30 a second one frame in two (0.5).

### 3.3 Where the stepping and the freezing come from

1. **The low update rate (evidenced).** 20 Hz at best. That is two still frames out of three on a 60 Hz display, and the eye reads a fast sweep as steps.
2. **The beat between the two clocks (evidenced on the bench).** The car's samples and our 50 ms tick are not in phase. In the demo both run at 20 Hz, and the tick sometimes reads the same sample twice (a 100 ms stand-still) and then skips one (a double step). On the car any sample rate that is not a multiple of 20 Hz beats the same way. Judder 1.6.
3. **A blocked event loop (evidenced as a mechanism, hypothesis for the car).**
   - While the centre-screen page is open, one software frame is 8.8 ms on the M1. On the car (about 8 times slower, plus the PNG) that is about 70 ms every 100 ms.
   - The stand-in run (60 ms busy in every 100) halves the needle's frames that move (0.16) and stretches its stand-stills to 200 ms. That is the "slight freeze".
   - With mgu-renderd present, the loop runs up to 60 times a second instead, a few ms each (recording only), but continuously.
   - If the app goes over its `cpuLimit` of 60 %, the cgroup also throttles it, which freezes the whole process for the rest of a period. The probe prints `nr_throttled` and `throttled_time`.
4. **Not the cause on the bench: socket back-pressure.** Uniforms are about 65 B. Only a layout switch writes megabytes, and the service reads them at memory speed and paces only the upload to the KOMBI. **Not the cause either: text repaint, JSON or GC in steady driving.** Text is 0 to 5 repaints a second, at 0.9 to 1.4 ms each on the M1 including the diff, and there are no long tasks over 8 ms in any layout with the page closed.
5. **Unknown: GPU frame time on the KOMBI.** If the 6WB scene does not fit the cluster GPU's frame budget, every animation drops frames, ours included. See section 5. To test it: drive the same road with 6WB Comfort and then G20 Comfort (about 65 % of the shading) and compare the needles by eye. A clear difference points at the GPU.
6. **Unknown: the car's own sample rate.** If speed arrives at, say, 10 Hz, the speed needle steps at 10 Hz whatever we do, unless we interpolate. That is what the prototype does.

## 4. CPU on the head unit

Steady demo driving, 20 s, centre-screen page closed. **Bench numbers. For the car, multiply by about 8** (section 2).

| Layout | App CPU (% of one M1 core) | Tick JS mean / max ms | Text repaints/s | Uniform msgs/s / B/s | Image frames/s / B/s | Socket B/s |
|---|---|---|---|---|---|---|
| 6WB Comfort | 2.1 | 0.38 / 3.5 | 0.3 | 20 / 1,306 | 0.3 / 914 | 2,220 |
| 6WB Dials + G20 | 2.5 | 0.39 / 4.9 | 0.4 | 22 / 1,452 | 0.4 / 1,149 | 2,600 |
| G20 Comfort | 2.0 | 0.30 / 2.8 | 0.1 | 40 / 2,549 | 0.1 / 1,541 | 4,090 |
| 6WB Sport | 2.3 | 0.53 / 6.3 | 4.4 | 34 / 2,260 | 4.4 / 111,101 | 113,361 |
| 6WB Sport + G20 | 2.2 | 0.54 / 3.7 | 5.1 | 35 / 2,337 | 5.1 / 130,838 | 133,175 |
| 6WB Eco Pro | 1.8 | 0.31 / 1.4 | 0 | 26 / 1,745 | 0 / 0 | 1,745 |
| F30 basic | 2.2 | 0.44 / 7.5 | 4.7 | 17 / 1,053 | 4.7 / 490,905 | 491,957 |
| **The page open** (6WB Comfort) | **13.9** (9.6 of it the page) | 0.19; tick period max 70 ms | | | | |

- **What the CPU goes to, page closed** (cpuprofile, M1, 12 s windows). The probe's own inspector is the largest item. Of the app:
  - `_update` (the dials: `_raw` → `car.data()`, which copies the whole data object on every call, 3,000 to 7,000 copies in 20 s);
  - `_resolve` (the token strings, 7,500 to 15,000 calls in 20 s);
  - `JSON.stringify` of the uniforms;
  - `tint` and `changes` in the text layouts (6WB Sport, F30);
  - GC.
  
  All of it is small: the tick is 0.6 to 1.1 % of an M1 core.
- **What the CPU goes to, page open.** `canvas.js fillRect` 42 %, `roundRect` 17 %, `strokeRoundRect` 15 %, `_blit` 10 %, `drawImage` 7 %. That is the kit's software rasteriser, called from `display.present` → `play()`. The page's own `render()` (building the recording) is a small part. On the car, add the PNG encode for the HMI (`ui.timing.png`, which the kit logs as `loop MAIN: ... ms per frame (draw, png, hmi)`).
- **Signal decode, logging.** `car.js` decoding is 0.06 to 0.1 % (the `car sample listeners`, 20 a second). Logging in steady driving: none (it happens only on events).
- **Estimate for the car, page closed:** about 15 % of one core for the whole app, with a 3 to 4 ms tick. Page open, software: about 75 to 100 % of a core plus the PNG, which is over the 60 % `cpuLimit`.

## 5. GPU

Measured per effect layer, with its real shader, uniforms and textures, drawn blended over its whole rect (`tools/perf/gpu_time.mjs`). "Floor" is a one-line shader over the same rect: the cost of filling it at all.

| Layout | Effect layers (full screen) | Image layers | Effect px per frame (screens) | Layers over a pixel: mean / max / % of pixels with 3+ | SwiftShader ms/frame | Metal (M1) ms/frame | Relative |
|---|---|---|---|---|---|---|---|
| 6WB Comfort | 7 (1) | 14 | 2.34 M (1.69) | 2.00 / 5 / 31 % | 57.5 | 0.21 | 1.00 |
| 6WB Dials + G20 | 7 (1) | 12 | 2.34 M (1.69) | 1.98 / 5 / 29 % | 59.1 | 0.23 | 1.03 |
| 6WB Sport | 7 (1) | 7 | 2.34 M (1.69) | 1.98 / 5 / 27 % | 56.9 | 0.18 | 0.99 |
| 6WB Sport + G20 | 7 (1) | 8 | 2.34 M (1.69) | 2.00 / 5 / 29 % | 64.3 | 0.22 | 1.12 |
| 6WB Eco Pro | 6 (1) | 8 | 2.32 M (1.68) | 1.95 / 4 / 27 % | 61.7 | 0.17 | 1.07 |
| G20 Comfort | 4 (0) | 4 | 0.98 M (0.71) | 0.76 / 3 / 0 % | 37.7 | 0.15 | 0.66 |
| F30 basic | 3 (1) | 2 | 1.43 M (1.04) | 1.22 / 3 / 0 % | 5.3 | 0.04 | 0.09 |

Per layer (SwiftShader, 6WB Comfort; the other 6WB layouts are within 20 %):

| Layer | Rect | ms (floor) | Cost over its fill floor | Share |
|---|---|---|---|---|
| WBBACK, the backdrop | 1920x720 | 28.6 (4.2) | 6.8x | 50 % |
| WBDIAL speedo | 670x670 | 14.1 (1.3) | 11x | 25 % |
| WBDIAL tacho | 670x670 | 12.7 (1.2) | 11x | 22 % |
| WBDIAL fuel, oil | 140x140 each | 0.8 (0.1) | 6 to 8x | 3 % |
| WBSIGN, WBMSA | 214x93, 44x44 | 0.3, 0.1 | | under 1 % |
| G20DIAL tacho / speedo | 684x681 / 684x626 | 19.1 / 15.2 (1.5 / 1.4) | 13x / 11x | (G20 Comfort) |

What makes them expensive (static count, `shared/shaders.js`):

- **WBDIAL**: 413 lines, 12 `exp`, 4 `pow`, 31 `smoothstep`, 9 `sin`/`cos`, an `atan`, 2 samplers, `precision highp` throughout. It has one early-out (outside the radius). The four looks (`u_style`) are uniform branches in one program, so a GPU that flattens branches pays for all four.
- **WBBACK**: 289 lines, 5 samplers, 8 `exp`, 18 `smoothstep`, highp, over every pixel of the screen. Most of the panel is constant black.
- **G20DIAL**: 4 samplers (base, LUT, fill) and 4 `exp`.
- The image sheets are one texture read and a blend each. They cover 0.06 to 0.41 M px.

**How far this carries.** The ranking holds: the 6WB layouts cost about the same as each other, G20 Comfort about two thirds, and F30 basic a tenth. Whether 6WB fits the KOMBI's frame budget cannot be told from here. If its GPU is about 100 times slower than the M1 Max (common for an embedded GPU), 6WB is about 20 ms a frame, so 40 to 50 fps, not 60. If it is about 30 times slower, 6WB is 6 ms. Both are guesses. Car check: the needle A/B in section 3.3, item 5.

## 6. Rebuild and switch

Bench, `tools/perf/switch_sweep.sh`. "Written" is every byte that went to cluster-render in the 4 s after the switch, including assets and whole sheets. It all goes through the upload budget.

| Switch | Rebuild JS (M1) | Written | At 5,500 / 2,000 KB/s | Pixel memory before → after (MiB of 16) |
|---|---|---|---|---|
| 6WB Comfort → 6WB Sport | 5.3 ms | 2.20 MB | 0.4 / 1.1 s | 11.5 → 3.3 |
| 6WB Sport → 6WB Eco | 2.8 ms | 1.63 MB | 0.3 / 0.8 s | 3.3 → 3.0 |
| 6WB Eco → 6WB Comfort | 5.5 ms | 6.02 MB | 1.1 / 2.9 s | 3.0 → 11.5 |
| 6WB Comfort → 6WB Dials | 16.1 ms | 5.77 MB | 1.0 / 2.8 s | 11.5 → 11.1 |
| 6WB Dials → 6WB Sport + G20 | 3.2 ms | 2.30 MB | 0.4 / 1.1 s | 11.1 → 4.5 |
| 6WB Sport + G20 → G20 Comfort | 13.1 ms | 4.71 MB | 0.9 / 2.3 s | 4.5 → 8.7 |
| G20 Comfort → F30 basic | 2.3 ms | 1.03 MB | 0.2 / 0.5 s | 8.7 → 1.9 |
| F30 basic → 6WB Comfort | 7.0 ms | 6.17 MB | 1.1 / 3.0 s | 1.9 → 11.5 |
| 6WB Comfort → G20 Comfort | 4.8 ms | 4.62 MB | 0.8 / 2.3 s | 11.5 → 8.7 |
| G20 Comfort → 6WB Comfort | 7.4 ms | 6.19 MB | 1.1 / 3.0 s | 8.7 → 11.5 |

- **Pixel memory now and at its peak.**
  - The peak, measured as the client's sum of every image and asset times two after every make and drop, never went above max(before, after). The rebuild drops the old layers and the unused scene textures before it makes the new ones (the earlier "16 MiB on a switch" fix holds).
  - The highest is 6WB Comfort at 11.5 MiB. Of that, 8.4 MiB are scene textures and glyph atlases, mostly `speedo` and `tacho` at 670x670 RGBA (3.4 MiB each, counted twice).
  - That leaves 4.5 MiB for every other app, Waze included.
- **Rebuild JS.** 2 to 16 ms on the M1, so about 20 to 130 ms on the car, in one piece (the event loop is blocked for that long). The longest runs (to 6WB Dials, to G20 Comfort) are the ones that load scene textures out of the pack: `data.json` of a 2.3 MB JSON, then base64.
- **The drive-mode switch is the common case** (Comfort to Sport to Eco). Coming back to 6WB Comfort re-sends 6 MB because Sport and Eco do not use the big textures, and they are dropped to keep the pixel memory down.

## 7. Optimisations, ranked by gain against effort

| # | What | Expected gain | Effort | Risk | Verify on the car |
|---|---|---|---|---|---|
| 1 | **Close or slow the centre-screen page while driving.** The kit already stops the loop when the HMI hides the page. Make the page cheap when it is shown: render on change only (`kick()` on settings and status) plus a 1 fps refresh for live values, instead of 10 fps of identical frames; skip identical software frames in `display.present` as `_send` already does for the GPU path. **Recommendation only: page.js belongs to the parallel package.** | Removes the largest CPU cost (about 75 % of a core on the car while the page is open) and the 70 ms loop stalls behind the needle freeze | S (kit, page owner) | Low | Probe twice, page closed and page open: app CPU %, `nr_throttled`, `loop MAIN: N ms per frame`, and the perf line's `loop lag` and `tick` maximums |
| 2 | **Needle interpolation in JS at a steady rate.** The prototype on this branch (`perf.json` `"needle": "smooth"`): the needles leave the 50 ms tick for a 33 ms timer and show the value interpolated between the car's samples, one sample period back. | Judder 1.6 → 0.9 to 1.0. Frames that move 0.32 → 0.48 (30 Hz). About one sample period (50 ms) of added latency on speed. Under a busy loop, frames that move 0.16 → 0.28. | S, done (opt-in) | Low: opt-in, a file in the data folder, off by default | Section 8: `"log": true` and then `"needle": "smooth"` on the same road, perf lines plus watching the needle |
| 3 | **Coalesce the uniform sends**: `sock.cork()` around a tick's writes, `uncork()` after (Node 8 has both). The prototype does this in smooth mode only. | Up to 4 dial writes a tick become 1 write, so 1 service wake and 1 flush instead of up to 4. Fewer RAMSES scene updates over the link. | XS | Low | cluster-render log: CPU % of the service (probe), slow-flush evidence |
| 4 | **Needle on the GPU: `time_fps` or `time` plus target and velocity uniforms.** The shader computes `v = mix(from, to, clamp((u_time - t0) / dt, 0, 1))` or extrapolates `v0 + vel * (u_time - t0)`. Node sends only what the car sent. | Motion at the service's or renderer's own rate, immune to Node stalls. The only option that fixes the freeze while the page is open. | M | Medium. `time: 1` is the renderer's clock, whose zero (the layer's attach, restarted on republish) the client cannot see. `time_fps` has a known zero (the layer's make, within a few ms) but costs a flush per frame. WBDIAL and G20DIAL change. **Do not use `animate`**: each restart rebuilds the whole animation system. | Bench first. On the car: needle smoothness with the page open (the hardest case) |
| 5 | **Remove the clocks' beat without interpolation**: drive the needle widgets from `car.onSample` (on arrival) instead of the 50 ms tick, at most one send per sample. | Removes the double reads and skipped samples (judder down). The update rate stays the car's. | XS | Low | Perf line: needle sends/s matches `rpm changes/s` |
| 6 | **Big text readouts as `atext`** (the GPU glyph atlas already in the engine): the 6WB Sport speed (260x90) and the F30 basic speed (700x192). | 6WB Sport 113 KB/s → about 2 KB/s, F30 basic 492 KB/s → about 1 KB/s of image uploads. 4 to 5 `drawText` / `changes` a second fewer. | S | Low (atext is proven on the calibration layout; check the glyph shapes) | Probe: cluster-render "in the last 60 s ... KB" line |
| 7 | **WBBACK cheaper.** Skip the rows and columns that are constant black early (a cheap `if` on `v_uv` before any texture or `exp`). Bake more of the static window, foot and glow into the textures it already samples. Or split the backdrop into the window strip only, and let the panel's black come from a `fill` (cheap). | Up to half of the 6WB GPU cost (WBBACK is 50 %, 6.8x its fill floor) | M | Medium (looks must match; bench screenshots against `ref_comfort_bench_1920x720.png`) | Needle A/B against G20 Comfort (section 3.3, item 5), before and after |
| 8 | **Specialise WBDIAL per look**: prefix `#define STYLE n` and compile only that look's code, instead of `u_style` branches in one 413-line program. Use `mediump` wherever no pixel-scale distance is taken (colours, mixes). | Smaller programs, no flattened branches. Gain unknown without the GPU: anything from 0 to 4 times on the 45 % of the frame the dials take. | M | Medium (fp16 limits, see the memory note "fp16 mediump overflow") | As in 7 |
| 9 | **Fewer copies in the tick**: `_raw` calls `car.data()`, which copies the whole data object 150 to 350 times a second. Take one snapshot per tick. | About 5 to 10 % of the tick's JS | XS | Low | Perf line: `JS in tick` |
| 10 | **Keep the big scene textures through Comfort → Sport → Comfort** when the pixel memory allows (8.4 MiB now), or make them smaller (the 670x670 dials as R8 masks plus a colour). | A switch back to 6WB Comfort: 6 MB → about 1 MB, so 3 s → 0.5 s at the budget floor | M | Medium (the 16 MiB is shared with Waze) | Probe: cluster-render budget lines on drive-mode changes |
| 11 | **Fewer full-screen layers.** The 6WB layouts already have only one (WBBACK). The other 0.7 screens of effect pixels are the two dial rects, which overlap the backdrop. Moving the dial faces into WBBACK as textures would cut overdraw from 2.0 to about 1.4, but would put all the cost in one layer. Lower priority than 7 and 8. | Overdraw 2.0 → 1.4 | L | High (layout architecture) | GPU A/B |

**Not worth doing now:** smaller dirty rects. In steady driving the 6WB Comfort and Dials sheets send 0.3 to 0.4 rects a second, about 1 KB/s. The cost is in the two large readouts (item 6).

## 8. Car measurement kit

Read only. Nothing is written, killed or restarted on the car.

```sh
./scripts/perf_probe.sh root@<car> 30
```

- **What it does.** One `ssh` session runs `sh` with only `cat`, `grep`, `tr`, `cut`, `head`, `tail`, `top -b -n 1` and `sleep`, and reads:
  - `/proc/cpuinfo`, `/proc/stat`, `/proc/loadavg`;
  - our app's and cluster-render's `/proc/<pid>/{stat,status,sched,cgroup}`, twice, `<seconds>` apart;
  - the app's cpu cgroup: `cpu.cfs_quota_us`, `cpu.shares`, `cpu.stat` (`nr_throttled`, `throttled_time`);
  - the app log (`/var/opt/public/oap/oap_*/data/f30_cluster.log`): perf lines, `loop MAIN` lines, layouts, warnings;
  - `/run/cluster-render/status.txt`;
  - cluster-render's log: per-minute writes, flushes, budget, RAMSES periodic lines.
- **What it prints.** `tools/perf/probe_report.py` writes the summary: CPU model and cores; the app's and the service's CPU (% of one core); the whole unit's busy %; throttling; memory; the log lines. Both files go to `reference/perf/` (git-ignored).
- **When to run it.** Do 3 runs on the same road, each about 30 s:
  1. page closed;
  2. our page open on the centre screen;
  3. page closed with the perf log on (below).

**The opt-in perf log.** This is the owner's own step, because it is a write; the probe stays read only. It is the one marked block in `hud.js` ("PERF ... package P"). It is off unless the app's data folder holds `perf.json`:

```sh
ssh root@<car> 'echo "{ \"log\": true }" > /var/opt/public/oap/oap_<uid>/data/perf.json'      # on (read within 10 s)
ssh root@<car> 'echo "{ \"log\": true, \"needle\": \"smooth\" }" > /var/opt/public/oap/oap_<uid>/data/perf.json'   # plus the prototype
ssh root@<car> 'rm /var/opt/public/oap/oap_<uid>/data/perf.json'                            # off again (within 10 s)
```

Every 10 s it adds one line:

```
perf: 10.0 s, layout wb_comfort; car samples 20.1/s, rpm changes 20.1/s (gap ms p50 50 p90 50 p99 50 max 50), speed changes ...;
tick ms p50 51 p90 53 p99 60 max 62, JS in tick ms ...; loop lag ms p50 1 p90 3 p99 9 max 18 (>50: 0); bytes/s per connection ...; cpu 1.9 %, rss 106 MB, heap 15 MB
```

That line answers the open questions directly:
- the car's real sample rate and gaps for rpm and speed;
- whether the tick runs late (`tick ms max`);
- whether the loop stalls (`loop lag >50`);
- the app's CPU.

**What to look for.**

| Seen | Means | Do |
|---|---|---|
| `loop lag` max over 50 ms, or `nr_throttled` > 0, with the page open | The page blocks the needle | Item 1 |
| Same with the page closed | Something else blocks: a rebuild, DME reads, GC | Send the log |
| `rpm changes` / `speed changes` well under 20/s, or gaps p90 over 60 ms | The car is the slow part | Items 2 and 4 (interpolation) |
| All fine, needle still uneven | Stepping (20 Hz, the beat) or the GPU | Items 2, 3 and 5. Then the 6WB / G20 A/B, and items 7 and 8 |

## 9. The prototype

The needle prototype is in `shared/hud.js`, in the PERF block. It is opt-in and off by default.

- **Without `perf.json` nothing changes.** The bench baseline sweep (`run2`) ran with this code and no `perf.json`, and its numbers match a run before the change (`run1_old`).
- **What it changes with `"needle": "smooth"`:**
  - The dial and g20dial widgets with `measure` speed or rpm are skipped by the tick, and updated by their own 33 ms timer instead.
  - That timer reads rpm and speed interpolated at now minus one sample period. The period is learnt from the gaps between changes, between 20 and 150 ms. A value that has sat still is held until one period before its next change.
  - rpm keeps the 120 ms filter (`"rpmTau"` overrides it).
  - The value goes into the same `_update` code through a guarded override in `_raw`.
  - The batch is corked.
- **Result on the bench:** see 3.2. Judder about halves, and twice as many frames move. It cannot help while the loop is blocked: under a 60 / 100 busy loop the gain is smaller, and only the GPU option (item 4) is immune.
- **Not yet checked on the car.**

## 10. Reproduce the bench numbers

```sh
rm -rf dist bench/.data
BENCH_PORT=8100 PERF_DIR=<dir> NODE_OPTIONS="--require $PWD/tools/perf/probe_preload.js" node bench/server.js f30_cluster
tools/perf/bench_sweep.sh <dir> 8100              # per layout: <layout>.dump.json, .layers.json, .cpuprofile
tools/perf/switch_sweep.sh <dir> 8100             # sw_<from>_to_<to>.dump.json
tools/perf/needle_test.sh <dir> 8100              # n_<layout>_<base|smooth>_load<ms>.dump.json
python3 -I tools/perf/summarise.py <dir>
python3 -I tools/perf/needle.py <dir>/n_*.dump.json
# GPU: two headless Chromes with their own --user-data-dir, --remote-debugging-port 9311 (default GPU) and 9312
# (--use-angle=swiftshader --enable-unsafe-swiftshader), then:
tools/perf/gpu_sweep.sh <gpu dir> 8100
python3 -I tools/perf/overdraw.py <dir> --gpu <gpu dir>
```

Notes:
- The bench rebuilds and restarts the app whenever `shared/`, `kit/` or the app folder changes. Do not edit them during a sweep.
- `PAGE=on tools/perf/bench_sweep.sh ...` keeps the page loop running.
