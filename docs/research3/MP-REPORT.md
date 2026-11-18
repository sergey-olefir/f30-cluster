# MP: why Twin Dial is fast and f30_cluster heavy (research round 3)

Package MP of `docs/AGENT-BRIEF-research3.md`. Branch `research3/mp` (local, from `main` at 82927e5). Nothing pushed, no version bumped, no app or `shared/` code changed. **The car was offline**: everything here is measured on the Mac (Apple M1 Max, Node 22.22.3; the drive cache holds no Node 8, so the app ran on Node 22). Labels: **verified** = measured here, with the command and the spread of 3 runs; **hypothesis** = needs the car; **refuted** = measured here and it is not the cause.

What transfers to the car and what does not:

- **Transfers as is:** bytes on the wire, pixel bytes (what cluster-render's upload budget paces), message counts, layer and asset counts, pixel memory (each image counted twice), shader source bytes, the order of uploads, how many builds happen.
- **Transfers as a ratio only:** GPU time per layer (Mac GPU, fp32; the KOMBI's GPU is unknown and fp16 `mediump`).
- **Does not transfer:** milliseconds of JS (M1 + Node 22 against an Atom-class core + Node 8: about 8x slower, `docs/PERF-AUDIT.md` §2).

## 0. The short answer

The weight of f30_cluster is **upload volume caused by rebuilding on every drive-mode change**. Most of that volume is **two RGBA8 dial textures** that are dropped whenever Comfort is left and uploaded again whenever it comes back. Twin Dial does none of this. It has one layout and never rebuilds on a mode change. Its faces are R8 (a quarter of the bytes per texel) and its whole scene stays loaded in 4.7 MiB. Steady driving is **not** the difference: both apps send about 4.5 KB/s and 50 to 60 messages a second. JS time is not the difference either: Twin Dial's rebuild JS is the heavier of the two.

| | f30_cluster (6WB Comfort) | twin_dial | ratio |
|---|---|---|---|
| Start: pixels to the first complete frame | 5.8 MB, so **2.9 s** at the 2000 KB/s floor (1.05 s at 5500) | 2.3 MB, so **1.14 s** (0.42 s) | 2.5x |
| Start: pixels until the start-up rebuilds settle | 8.0 MB, so 4.0 s (1.45 s) | 4.1 MB, so 2.07 s (0.75 s) | 1.9x |
| Drive-mode change | **rebuild every time**: to Sport 0.85 MB, to Eco Pro 1.04 MB, **back to Comfort 5.68 MB, so 2.84 s** (1.03 s) | **no rebuild**: 6 KB of pixels (the mode label) | 0.85 to 5.7 MB against 6 KB |
| G20 toggle | rebuild: 5.55 MB on, 5.68 MB off | (no such toggle) | |
| Day / night, a message | in place: 125 KB / 3 to 8 KB | in place: 228 KB / 34 KB | similar |
| Pixel memory, settled | 11.41 MiB (8.38 of it assets) | 4.73 MiB (1.66 assets) | 2.4x |
| Identical pixels re-sent over the scripted drive | **19.8 MB** (31 images; speedo and tacho 4 times each) | 4.1 to 4.8 MB (start-up and settings rebuilds) | 4.4x |
| Steady driving | 49 to 51 msgs/s, 4.2 to 4.4 KB/s | 61 to 62 msgs/s, 4.5 to 5.3 KB/s | equal |
| GPU per frame (Mac, rank only) | 0.34 to 0.36 ms | 0.27 to 0.29 ms | 1.2 to 1.3x |

### Ranked causes of f30's weight

Share = part of the 34.5 MB f30 wrote over the scripted drive (start, 3 mode changes and back, night and day, G20 on and off, a message, Sport and Comfort again). Twin Dial wrote 10.4 MB over its own script.

| # | Cause | Evidence (verified on the bench) | Share | Twin Dial technique that removes it |
|---|---|---|---|---|
| 1 | **A rebuild on every drive-mode change and G20 toggle.** The three themes are three layouts; `_rebuildInner` drops every layer and makes the new set. | 6 rebuilds in the script: 15 to 21 layers dropped and made each time, plus 40 to 54 KB of GLSL each. | All of f30's switching cost: 26.1 of the 34.5 MB (75 %) went out in switch phases. | **One layout.** The drive mode, night, redline and band gain are uniforms or dirty rects in place (`TW_LIVE_KEYS`, `_twinNightLive`). Measured: 12 to 13 KB on a mode change, 7 to 8 KB on a redline or gain change. |
| 2 | **RGBA8 baked dial faces.** `speedo` and `tacho` are 670x670 RGBA8: 1754 KB each on the wire, 3.43 MiB each in pixel memory. | They are 61 % of every Comfort build's pixels (3.5 of 5.7 MB) and 60 % of its pixel memory (6.85 of 11.41 MiB). `speedo_d` / `tacho_d` do the same for G20. | Assets are 21.0 MB (61 %) of all bytes. 17.5 MB of that is dial faces: `speedo` and `tacho` 4 uploads each (14.0 MB), `speedo_d` and `tacho_d` once each (3.5 MB). | **R8 luma faces coloured in the shader** (`tdial`: one R8 616x560 face, 337 KB, one texture read). That is 4 bytes per texel down to 1. |
| 3 | **Drop on leave.** Sport and Eco Pro do not use the big textures, so they are dropped to stay within 16 MiB (`_dropsUnused`), then uploaded again on the way back. | Comfort → Sport: pixel memory 11.41 → 2.10 MiB. → Comfort: 4.13 MB of assets again. 19.8 MB of identical pixels re-sent in all. | 57 % of all bytes were pixels already sent once. | **Nothing to drop**: 4.73 MiB holds everything. |
| 4 | **Start-up rebuilds (shared engine, both apps).** The car's first time zone (`clock`) and the first `ccList` that fits each trigger a whole rebuild once cluster-render is ready (hud.js lines 1198, 1365). | 3 builds at start in every run. The 2nd is torn down before it completes (its sheets are partly sent anyway). f30: +2.0 to 2.2 MB after the first build. Twin Dial: +1.9 MB. | 25 % of f30's start bytes (2.2 of 8.0 MB) | **None**: Twin Dial has it too. A fix belongs in `shared/hud.js` (§7). |
| 5 | **Text sheets re-sent whole at every build** (both apps) | f30: 0.78 MB (Sport), 1.04 MB (Eco Pro), 1.55 MB (Comfort) per build. Twin Dial: 1.57 MB per build. | 12.3 MB (35.5 %) | Twin Dial rebuilds rarely: only at start and on a settings change, not on mode changes. |
| 6 | **Shader source and compile per build** | f30 sends 40 to 54 KB of GLSL per build, 35 KB of it unique (WBDIAL 13.3 KB, WBBACK 9.0 KB). Twin Dial: 15 KB per build, 8 KB unique. | 1.5 % of bytes. The KOMBI's compile time is **unknown**. | Small specialised shaders (`#define STYLE`), and no rebuild means no recompile. |
| 7 | **GPU per frame** | Mac GPU: Comfort 0.34 to 0.36 ms against Twin Dial's 0.27 to 0.29 ms (1.2 to 1.3x). Static arithmetic, dials: WBDIAL has 10 exp, 10 trig, 27 smoothstep and 38 `if`; tdial has 2, 4, 9 and 6. | **Hypothesis** for the car: the M1 hides arithmetic, an embedded GPU may not. | Lighter shaders, and fewer image layers (6 against 14). |
| — | Steady state (needles, digits, clock) | 4.2 to 4.8 KB/s and 38 to 51 msgs/s (f30) against 4.5 to 5.3 KB/s and 61 to 62 msgs/s (Twin Dial) | — | **Refuted** as a cause. |
| — | App JS (rebuild, texture parsing) | f30 rebuild JS 44 to 48 ms at start, Twin Dial 67 to 82 ms. Scene-texture loads: 51 ms over the f30 script against 2.6 ms for Twin Dial, at most 10 ms each. | — | **Refuted** as the difference. Twin Dial's sheets cost more JS. |

**What-if estimates** (arithmetic on the measured bytes, not built):

- Keeping f30's scene textures across mode changes: back to Comfort 5.68 → about 1.6 MB, so 0.8 s at the floor. Pixel memory in Sport would be about 10 MiB instead of 2.1.
- R8 dial faces at today's size (MT measures the picture quality): a Comfort build 5.68 → about 3.1 MB.
- Both together: about 1.6 MB per return to Comfort.
- No rebuild on a mode change (Twin Dial's way): 0.

## 1. Method

Tools (`tools/research3/mp/`, new, bench only, never shipped):

- **`measure.js <app> [--runs N] [--out f.json] [--snap dir] [--steady ms]`**
  - Builds the app with the kit (`kit/tools/build.py`, the Store's build) and stands in for cluster-render on its own Unix socket.
    - It speaks protocol v1 and enforces the bench's limits: 32 layers, 16 assets per connection and 32 in all, 16 MiB of pixel memory with every image and asset counted twice.
    - It records every message with its time, connection, op, ref and bytes on the wire, and hashes every whole frame, so identical pixels sent again are found.
  - Runs the built app in the kit's stub head unit (`bench/run-app.js`, demo driving), with `preload.js` for the app's JS times.
  - Feeds car-like first values 300 ms after start, as the car's getters answer on subscribe: the time zone, the resting `ccList` entry, "no message shown now" and day.
  - Then drives a scripted scenario per app.
    - It prints per phase: bytes, pixel bytes, layers and assets made or dropped, the pixel-memory peak, the builds, and the time to the first complete frame.
    - "Complete" means every layer of a build is made, every image layer's whole pixels have arrived, and every sampled asset is bound with its pixels. The tool reports that time on the bench and at the upload budget.
    - It also reports steady rates per layer and uniform.
  - It ends its own child and exits. **Any app**: `node tools/research3/mp/measure.js <app id>` prints the same numbers.
- **`preload.js`**: app-side JS times (`_rebuildInner`, `_scene`, atlases, sheets, tick, needle timer), event-loop lag and CPU. It also puts a bench-only `mp-mark` message on each connection at the start of every build, so the recorder can assign interleaved socket traffic to builds.
- **`inventory.js`**: the per-layout inventory (§2) from `measure.js`'s JSON.
- **`summary.js`**: the per-phase tables across runs (§3 to §5).
- **`gpu.py`**: each settled layout's layers timed on the Mac's GPU through moderngl.
  - It uses no browser. It reuses `tools/strip/O/render.py`'s GLSL ES shim and its texture rules.
  - Each layer is drawn blended over its rect 60 times, the median of 7, against a one-line fill floor.
  - It also reports the share of each rect that comes out transparent.

Commands (run here, 3 runs each; bytes identical across runs, times as ranges):

```sh
node tools/research3/mp/measure.js f30_cluster --runs 3 --out design/research3/mp/f30_cluster.json --snap bake/work/research3/MP/snap
node tools/research3/mp/measure.js twin_dial  --runs 3 --out design/research3/mp/twin_dial.json  --snap bake/work/research3/MP/snap
node tools/research3/mp/summary.js   design/research3/mp/f30_cluster.json design/research3/mp/twin_dial.json --md design/research3/mp/summary.md
node tools/research3/mp/inventory.js design/research3/mp/f30_cluster.json design/research3/mp/twin_dial.json --md design/research3/mp/inventory.md --out design/research3/mp/inventory.json
UV_CACHE_DIR=$PWD/bake/work/.uvcache uv run --offline -q --no-project --with numpy --with pillow --with moderngl \
  python -I tools/research3/mp/gpu.py bake/work/research3/MP/snap/{f30_cluster,twin_dial}/<step> --out design/research3/mp/gpu-run1.json
```

Bench artefacts I kept out of the numbers:

- On macOS, `fs.watch` reports the creation of the data folder's `layouts/` a moment later, and the app takes that for a pushed layout and rebuilds. `measure.js` creates the folder beforehand, as on a car that has run the app before.
- The drive mode is fed once a second by `run-app.js`, so a mode phase's "since the phase began" includes up to 1 s of waiting. The tables use the build's own time.

## 2. Inventory (verified; bytes transfer as they are)

Full tables (every asset with its sampler, every layer with its widgets, every shader): `design/research3/mp/inventory.md`, and as JSON in `inventory.json`. Published for MT at `bake/work/research3/pub/MP/`.

| Layout | Layers (per connection) | Effect / image | Assets: wire KB / pixel memory | Sheets: wire KB / pixel memory | Pixel memory | Effect px (screens) | Overdraw mean / max / % px under 3+ layers | Shader source per build |
|---|---|---|---|---|---|---|---|---|
| f30 wb_comfort | 21 (7+7+7) | 7 / 14 | 4291 / 8.38 MiB | 1551 / 3.03 MiB | 11.41 MiB | 2.34 M (1.69) | 2.00 / 5 / 29.7 % | 54 KB |
| f30 wb_sport | 18 (7+6+5) | 8 / 10 | 298 / 0.58 MiB | 778 / 1.52 MiB | 2.10 MiB | 2.36 M (1.71) | 1.86 / 5 / 16.8 % | 40 KB |
| f30 wb_eco | 15 (7+6+2) | 6 / 9 | 162 / 0.32 MiB | 1039 / 2.03 MiB | 2.35 MiB | 2.32 M (1.68) | 1.89 / 4 / 19.9 % | 36 KB |
| f30 wb_dials (Comfort + G20) | 15 (6+5+4) | 6 / 9 | 4411 / 8.62 MiB | 1303 / 2.54 MiB | 11.16 MiB | 2.32 M (1.68) | 1.93 / 4 / 25.3 % | 50 KB |
| twin | 14 (6+6+2) | 8 / 6 | 850 / 1.66 MiB | 1570 / 3.07 MiB | 4.73 MiB | 2.11 M (1.53) | 1.83 / 5 / 14.4 % | 15 KB |

`wb_sport_dials` is not reachable: `G20_OF` maps only `wb_comfort` to `wb_dials`.

Assets, largest first:

- **f30 Comfort**:
  - `speedo` and `tacho`, RGBA8 670x670, 1754 KB each, sampled by WBDIAL `u_base`;
  - `window` 320x286, 358 KB (WBBACK);
  - `ed_seg` and `range_seg`, about 93 KB each;
  - `fuel` and `oil`, 144x144, 81 KB each;
  - `sign_limit` and `sign_nopass`, 31 KB each;
  - `horizon`, 17 KB;
  - one 1x1 blank.
- **f30 G20**: `speedo_d` and `tacho_d` in place of `speedo` and `tacho`, plus `collar_r8` (R8, 480x180) and `strip_mask` (R8, 1908x353, 673 KB).
- **Twin Dial**: `face_tacho` and `face_speedo`, R8 616x560, 337 KB each; two exact-text atlases, R8, 73 and 45 KB; `panel_mask`, R8, 59 KB.

Every RGBA8 asset of f30's is a baked look. Every asset of Twin Dial's is R8.

Shaders (bytes after `compact()`, as sent):

| Shader | Bytes | Samplers / texture reads | `if` | exp / pow / trig / smoothstep | Uniforms | Area |
|---|---|---|---|---|---|---|
| f30 WBBACK (Comfort) | 9005 | 3 / 5 | 27 | 5 / 0 / 1 / 14 | 26 | 1920x720 |
| f30 WBDIAL (Comfort, speedo and tacho) | 13267 | 2 / 2 | 38 | 10 / 3 / 10 / 27 | 21 | 2 x 670x670 |
| f30 WBDIAL (mini, fuel and oil) | 7224 | 2 / 1 | 22 | 0 / 1 / 7 / 11 | 21 | 2 x 140x140 |
| f30 WBSIGN / WBMSA | 3531 / 1703 | 2 / 1, 0 / 0 | 9 / 3 | | | 214x93 / 44x44 |
| Twin Dial tdback L | 1995 | 1 / 1 | 2 | 0 / 1 / 0 / 0 | 13 | 1380x720 |
| Twin Dial tdback RT and RB | 537 | 0 / 0 | 0 | | 2 | 540x660, 460x60 |
| Twin Dial tdial | 4461 | 1 / 1 | 6 | 2 / 2 / 4 / 9 | 10 | 2 x 620x570 |
| atext (both apps) | 1169 | 1 / 1 | 1 | | 4 | digits |

GPU text atlases:

- f30 Comfort's glyphs are pixels in sheets (no atlas). Sport adds the exact atlas `wb_big`, R8 832x92, 75 KB.
- Twin Dial has `td_big`, R8 1066x70, 73 KB, and `td_gear`, R8 912x50, 45 KB.

The install package (not a runtime cost):

- f30's `hud.pack` is 4.6 MB (package 6.2 MB). Twin Dial's is 0.6 MB (package 1.6 MB).
- f30's pack carries `hud/baked/` (72 PNGs, 1.17 MB compressed), which no runtime code reads. `grep` finds no `baked/` path in `shared/*.js`; the shaders read `hud/scene` only.
- It also carries `previews/` (1.1 MB, used by the menu and the gallery).

## 3. Start-up (verified on the bench; the seconds at the budget are the car's arithmetic)

| | f30_cluster | twin_dial |
|---|---|---|
| Builds at start (3 of 3 runs) | 3: the first; the time zone; `ccList` wired. The 2nd is torn down before it completes. | 3, the same triggers |
| 1st build: pixels / time at 2000 / 5500 KB/s | 5.79 to 5.82 MB / **2.9 s / 1.05 s** | 2.28 MB / **1.14 s / 0.42 s** |
| All 3 builds: bytes, pixels | 8.2 MB, 8.0 MB (4.0 s / 1.45 s) | 4.36 MB, 4.29 MB (2.07 s / 0.75 s) |
| Assets in the 1st build | 11, 4291 KB | 5, 850 KB |
| Bench build time (layers made to all pixels in) | 69 to 84 ms (1st), 7 ms (3rd) | 58 to 66 ms (1st), 18 to 26 ms (3rd) |
| App rebuild JS, the 3 together | 44 to 48 ms | 67 to 82 ms |
| Bench: process start to the first complete frame | 178 to 193 ms | 135 to 252 ms |

- **Order of uploads.** In f30's 1st build the client's `_pump` sends:
  - connection 1: the backdrop's `window` (358 KB), then `speedo` (1754 KB), `range_seg`, `tacho` (1754 KB), `ed_seg`, `fuel` and `oil`;
  - connections 2 and 3 in the meantime: their text sheets.

  **The two dial textures are the last big uploads.** The dials cannot be complete before 3.5 MB of their own pixels have gone through the budget. RAMSES does not draw an effect whose sampler has no asset (memory note `ramses-unbound-sampler`), so what the driver waits for is the dials. Twin Dial's first build needs 2.3 MB in all.
- **The torn-down build.** The 2nd build's layers are dropped 15 ms after they are made (run 1). Some of their sheets are written to the socket anyway, which the bench sees as "never complete". Whether cluster-render forwards a dropped layer's pending pixels to the KOMBI is unknown (§8).

## 4. Switching (verified on the bench)

From `design/research3/mp/summary.md`, 3 runs:

| Switch | Rebuild? | Layers made / dropped | Assets made | Bytes / pixels | Time at 2000 / 5500 KB/s | Pixel memory peak → after |
|---|---|---|---|---|---|---|
| f30 Comfort → Sport | yes | 18 / 21 | 1 (75 KB) | 915 KB / 853 KB | 0.39 / 0.14 s | 11.41 → 2.10 MiB |
| f30 Sport → Eco Pro | yes | 15 / 18 | 0 | 1086 KB / 1039 KB | 0.52 / 0.19 s | 2.35 → 2.35 |
| f30 Eco Pro → Comfort | yes | 21 / 15 | 8 (4129 KB) | **5762 KB / 5683 KB** | **2.84 / 1.03 s** | 11.41 → 11.41 |
| f30 Sport → Comfort | yes | 21 / 18 | 6 (4068 KB) | 5705 KB / 5623 KB | 2.78 / 1.01 s | 11.41 → 11.41 |
| f30 G20 on | yes | 15 / 21 | 4 (4249 KB) | 5625 KB / 5554 KB | 1.9 / 0.69 s (to complete) | 11.41 → 11.16 |
| f30 G20 off | yes | 21 / 15 | 8 (4129 KB) | 5757 KB / 5680 KB | 2.84 / 1.03 s | 11.41 → 11.41 |
| f30 night / day | no (in place) | 0 | 0 | 136 KB / 125 KB (text repaints) | | unchanged |
| f30 a message / none | no | 0 | 0 | 8 to 14 KB | | unchanged |
| Twin Dial drive mode → Sport | **no** | 0 | 0 | **12 to 13 KB** / 6 KB | | 4.73, unchanged |
| Twin Dial night / day | no | 0 | 0 | 235 to 238 KB / 228 KB | | unchanged |
| Twin Dial a message / none | no | 0 | 0 | 42 to 43 KB / 34 KB | | unchanged |
| Twin Dial redline, band gain | no | 0 | 0 | 7 to 8 KB, uniforms only | | unchanged |
| Twin Dial centre page by the **setting** | yes (any setting outside `TW_LIVE_KEYS`) | 14 / 14 | 0 | 1602 KB / 1570 KB | 0.72 / 0.26 s | unchanged |
| Twin Dial centre page by the **cycle** (parked) | no | 0 | 0 | about 240 KB of dirty rects per flip | | unchanged |

- **The incomplete screen on a switch.** All of f30's old layers are dropped before the new ones are made, so the screen is incomplete from the drop until the new build's last upload.
  - On the bench that is 9 to 91 ms.
  - On the car it is bounded by the pixels at the budget: **1.0 to 2.8 s back to Comfort** (and after G20 off), and 0.14 to 0.52 s to Sport or Eco Pro.
  - Twin Dial never makes the screen incomplete on a mode change, night, a message or a look change.
- **Pixel-memory peak.** It never went above max(before, after) in any switch: the earlier drop-before-make fix holds. The peak is 11.41 MiB.
- **Twin Dial's own soft spot.** Changing the `centre` setting rebuilds the whole layout (1.6 MB). Putting `centre` in `TW_LIVE_KEYS` would make it in place, the way the cycle already is. This is minor: it happens only from the menu.

## 5. Steady state (verified; the bytes transfer)

| | Messages/s | Bytes/s | As uniforms | As image dirty rects |
|---|---|---|---|---|
| f30 Comfort | 49.0 to 51.4 | 4214 to 4409 | needles `u_dyn`: 22 to 27/s per dial | about 1.06 KB/s (the gear and mode sheet) |
| f30 Sport | 37.6 to 38.2 | 4608 to 4747 | needles, plus the big speed as `u_text` (atext): 3/s | about 1.9 KB/s (gear and mode) |
| f30 Eco Pro | 20.7 to 22.4 | 1340 to 1564 | needles | about 0 |
| f30 Comfort + G20 | 21.0 to 22.4 | 1367 to 1640 | needles | 0.2 KB/s |
| Twin Dial, driving | 61.0 to 62.0 | 4476 to 5308 | needles 27 to 30/s per dial, speed `u_text` 4.4/s, gear `u_text` | 0 |
| Twin Dial, parked (the page cycles) | 0.7 | 20103 to 23635 | | the page flip as rects |

App CPU in steady driving on the bench: 1.8 to 2.25 % of an M1 core for f30, 1.8 to 2.15 % for Twin Dial (`preload.js`).

**Steady state is the same weight in both apps (refuted as a cause).** f30 sends more needle messages than `docs/PERF-AUDIT.md` §4 measured on 2026-11-14 (49 to 51 a second against 20). Since 0.7.14 the smooth needles run on their own 33 ms timer, and Twin Dial uses the same timer.

### GPU per frame (Mac GPU via moderngl; rank only, never car milliseconds)

Two runs of `gpu.py` (`design/research3/mp/gpu-run1.json`, `gpu-run2.json`):

| Layout | Frame ms (run 1 / 2) | Effects | Image layers | Biggest layers (ms, and times the fill floor) |
|---|---|---|---|---|
| f30 Comfort | 0.336 / 0.359 | 0.223 / 0.249 | 0.113 / 0.111 (14 sheets) | WBBACK 0.079 to 0.085 (6.5x); WBDIAL 0.043 to 0.066 (2.7 to 7x) |
| f30 Comfort, night | 0.337 / 0.323 | 0.230 / 0.215 | 0.107 / 0.109 | as by day |
| f30 Sport | 0.308 / 0.281 | 0.230 / 0.202 | 0.078 / 0.079 | WBBACK 0.074 to 0.096 |
| f30 Eco Pro | 0.260 / 0.205 | 0.191 / 0.143 | 0.070 / 0.062 | |
| f30 Comfort + G20 | 0.263 / 0.267 | 0.199 / 0.203 | 0.064 / 0.063 | WBBACK is 63 % transparent here |
| Twin Dial | 0.287 / 0.270 | 0.240 / 0.223 | 0.047 / 0.047 (6 sheets) | tdback L 0.080 (7x); tdial 0.038 to 0.073 |
| Twin Dial, night | 0.255 / 0.292 | | | |

On the M1 the two apps' frames are within 1.2 to 1.3x of each other. The difference is mostly f30's 14 image layers against Twin Dial's 6. By static count, the dial shaders differ about 3x in arithmetic, but the M1 does not show it. Whether the KOMBI's GPU does is a **hypothesis** (§8).

## 6. Verified, hypothesis, refuted

| Claim | Status | Number |
|---|---|---|
| f30 rebuilds on every drive-mode change and G20 toggle; Twin Dial on none | **verified** | 6 of 6 switches rebuild in each of 3 runs; Twin Dial 0 of 1 |
| Back to Comfort costs 5.6 to 5.7 MB, 72 % of it the dropped scene textures | **verified** | 4129 of 5683 KB of pixels are assets |
| Two RGBA8 670x670 faces are most of f30's upload and pixel memory | **verified** | 3.5 MB per Comfort build; 6.85 of 11.41 MiB |
| f30's first build needs 2.5x Twin Dial's pixels | **verified** | 5.8 against 2.3 MB |
| Both apps build 3 times at start when the time zone and `ccList` arrive after cluster-render is ready | **verified on the bench**; **hypothesis** for the car (the order there is unknown) | f30 +2.0 to 2.2 MB, Twin Dial +1.9 MB |
| Steady driving differs | **refuted** | 4.2 to 4.8 against 4.5 to 5.3 KB/s |
| App JS makes f30 heavier | **refuted** | rebuild JS: f30 44 to 48 ms against Twin Dial 67 to 82 ms at start |
| The pixel-memory peak passes 16 MiB on a switch | **refuted** | peak 11.41 MiB, never above max(before, after) |
| GPU per frame makes f30 much heavier | **hypothesis** (the M1 says 1.2 to 1.3x; arithmetic is about 3x) | §5 |
| On the car, a switch back to Comfort leaves the dials missing for about 1 to 2.8 s | **hypothesis**: arithmetic of measured bytes at the configured budget | §4 |
| The KOMBI's shader compile per rebuild matters | **hypothesis** | 40 to 54 KB of GLSL per f30 build |

## 7. What would remove each cause (for the lead and MT; nothing built here)

1. **No rebuild on a mode change.** Either f30's three themes become one layout whose look is uniforms (Twin Dial's way; a large change), or the engine reuses unchanged layers across layouts. Saves everything in §4's f30 rows.
2. **Keep the scene textures across mode changes** when the pixel memory allows: about 10 MiB in Sport and Eco Pro instead of 2.1 to 2.35. Back to Comfort 5.7 → about 1.6 MB. Small change in `_rebuildInner`'s two drop loops. The risk is the 16 MiB shared with Waze.
3. **R8 faces** (MT measures the quality): speedo and tacho 1754 → 438 KB each at today's size.
4. **Start-up (shared engine, both apps):**
   - hold the first build until the car's first time zone and `ccList` have answered (bounded, say 1 s);
   - or make the clock and the message line's toggles live, instead of `_rebuild()` on the first value (hud.js lines 1198, 1209, 1302, 1365, 1400).

   Either saves 2 MB (f30) or 1.9 MB (Twin Dial) at every start.
5. **Upload order.** Make the dials' textures before the text sheets, so the needles' faces arrive first.
6. Twin Dial: put `centre` in `TW_LIVE_KEYS` (1.6 MB per menu change → about 0).

## 8. What the car must answer

1. **How many builds at start, and when.** In the app log of each app, count the lines `layout "<name>": N widgets, ... whole-sheet writes ...` in the first 10 s after the app starts. The bench says 3: the first, the time zone, then `ccList`. 1 means the car's getters answered before cluster-render was ready. Numbers only.
2. **What a mode change costs on the link.** In cluster-render's own log and status (`/run/cluster-render/status.txt`), around a Comfort → Sport → Comfort cycle, read:
   - the upload cap: does it step down from 5500?
   - slow flushes;
   - the "in the last 60 s ... KB" lines.

   Expected: about 0.9 MB out and 5.7 MB back per cycle.
3. **How long the screen is incomplete.** Film the cluster (60 fps phone video) while pressing Sport, then Comfort. Count the frames from the press to the dials complete. The bench and the budget predict:
   - 0.14 to 0.4 s to Sport;
   - **1.0 to 2.8 s back to Comfort**, the dial faces last;
   - 0 for Twin Dial.

   Plus 0 to 1 s for the car to report the mode, which is the same for both apps.
4. **GPU.** Same road, same speed: f30 Comfort against Twin Dial. Do the needles move equally smoothly? If f30's step visibly more, the GPU arithmetic (cause 7) is real on the KOMBI.
5. **Dropped pixels.** Does cluster-render still upload a layer's pixels when the layer is dropped before its upload finished (the torn-down start-up build)? This is in the service's source or its log (`asset N ... writes, KB` lines in status.txt).

## 9. Files

- Tools: `tools/research3/mp/measure.js`, `preload.js`, `inventory.js`, `summary.js`, `gpu.py`.
- Data: `design/research3/mp/f30_cluster.json` and `twin_dial.json` (3 runs each), `summary.md`, `inventory.md`, `inventory.json`, `gpu-run1.json`, `gpu-run2.json`.
- Scratch, git-ignored: `bake/work/research3/MP/`, which holds the app logs, the snapshots (`snap/<app>/<step>/`, tools/strip/O format, for render diffs) and the data folders.
- Published for MT: `bake/work/research3/pub/MP/READY`, `inventory-f30.*`, `inventory-twin.*`, `inventory-all.md`.
