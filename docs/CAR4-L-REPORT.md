# Car 4 L: the gear tray under the tacho, the same in every 6WB layout (report)

Owner's go-ahead: 2026-11-13. Branch `car4/l` (local, from `main` 970f010; not pushed). Bench: port 8097, own Chrome profile (DevTools 9297). Proof: `docs/car4/l/`.

## 1. What each layout did, and does now

| Layout | Tray | Before | After |
|---|---|---|---|
| 6WB Comfort (`wb_comfort`) | baked in `scene/tacho` | empty tray, no mode label | our gear (`gearTray`) in the tray, our mode (`modeLabel`) above it |
| 6WB Comfort + BMW map (`wb_comfort_map`) | baked in `scene/tacho` | empty tray, no mode label | the same as 6WB Comfort |
| 6WB Dials + G20 (`wb_dials`) | baked in `scene/tacho_d` | our gear and mode label | unchanged widgets; the new tray shape |
| 6WB Sport (`wb_sport`) | **none** | mode label at RV + 0.42 R (red), no gear | unchanged |
| 6WB Eco Pro (`wb_eco`) | **none** | mode label at RV + 0.42 R, no gear | unchanged |

- **One set of widgets.** `design/gen_6wb.py` `tray_row()` returns the three widgets (`mode`, `gear`, `gear_l`). Both `comfort()` (so also `comfort_map`) and `dials()` use it. They sit at the same place, in the same fonts (`wb_capb`, `wb_gear`), on the same connection (2), with the same toggles (`modeLabel`, `gearTray=gear`, `gearTray=letter`). `wb_dials.json` came out byte-identical.
- **Why Comfort had no gear.** The generator's comment said: "we draw no gear letter, as in the bimmer-lab themes". BMW draws its own gear letter over any theme, in the bottom row at x 1392–1428, y 664–706 (`docs/BAKE-C9-overlays.md`). In 6WB Comfort, BMW's letter stays where it is, over the ED arc's left tip. So Comfort now shows the gear twice: ours "D3" in the tray, and BMW's "D" below the tacho. The owner chose this.
- **Settings.** `app.json` labels now read "6WB: drive mode above the gear" and "6WB: gear in the tray" (they said "Dials + G20:"). The keys, defaults and `reset` are unchanged.
- **Sport and Eco Pro have no tray.** They are the earlier glowing pass on the old geometry (R 290). The WBDIAL shader has no tray in those styles: `u_mode.w` ("gear box") is sent but never used. They already print `{{mode}}` themselves, so no second label was added. In the 6WB (ref 02), Sport and Eco Pro do have a tray: a closed outline in the mode's colour (red, blue), with the gear inside and the mode name above it. Drawing that is a new piece of work (§6).

## 2. Where the tray is drawn, and the one place it changed

- **Where it is drawn.** The tray is part of the static tacho bake. P2 draws it procedurally (`bake/src/C2/draw.py` `pbox`, parameters `bake/src/C2/params.py` `PBOX`). `tools/bake_scene.py` composites it into both 670 × 670 tacho textures: `scene/tacho` (6WB Comfort, + BMW map) and `scene/tacho_d` (6WB Dials + G20). WBDIAL draws nothing of it. With `baked` off, no layout shows a tray.
- **The one place.** The shape is now set only in `PBOX`. `bake_scene.py` used to read a git-ignored render, `bake/work/C2/proc/tacho.p-box.albedo.png`. Now it draws the tray from `C2.draw.pbox` itself, so both textures always follow the code. Before the change, its output matched the committed textures to within the old render's 8-bit dither (≤ 8/255, tray box only).
- **Re-baked.** Only `tacho` and `tacho_d`, with the new `bake_scene.py tacho tacho_d` option. Both are the same size as before. Only the tray's box changed (panel x 1387–1629, y 551–643). Outside the tray, the pixels are still pure black (0).
- **Bookkeeping.** `bake/manifest/C2.json` now carries the new `PBOX` parameters for `tacho.p-box`, and its fit holds this measurement in place of P2's ssim. `validate_manifest.py` passes. `bake/report/C2.md` has a note. `C2.build` was not re-run: it would rewrite the shared `bake/work/C2` and every C2 asset.

| `PBOX` | Before | After |
|---|---|---|
| shelf half-width `top_hw` | 0.145 R | 0.130 R |
| top corners `corner_r` | 0.035 R | 0.012 R |
| sides | to (±0.300 R, on the arc) = the arc's ends | `shoulder_deg` 42°, meeting the arc at ±0.26 R |
| shelf line `top_rim` u0 / s | +0.025 / 0.075 | +0.015 / 0.093 |
| shoulder line `side_rim.level` | 0.12 | 0.15 |
| shelf y, bottom arc (r 0.683, ±27.5°, levels, glow), fill | – | unchanged |

## 3. The reference against ours (numbers only)

Measured by `tools/ref/measure_tray.py` on the rectified crop `bake/work/rect/05_comfort_tach-closeup.comfort.C2` (panel px, white = 235), and on our bench shots. No photo pixels are committed. Luma levels are given as fractions of the bottom arc's peak.

| | 6WB ref 05 | ref 02 (comfort) | Ours before | Ours after |
|---|---|---|---|---|
| shelf y | 552.5 (v 0.515) | own scale* | 552.5 | 552.5 |
| shelf half-width | 0.130 R (ends −41 / +46 px) | – | 0.116 R (±39) | 0.128 R (±43) |
| shoulder angle (from horizontal) | 42.0° / 40.7° | 43.4° / 42.5° | 31.6° / 31.5° | 41.9° / 41.9° |
| shoulder meets the arc at | −87 / +90 px (0.265 R) | – | ±101 px (0.301 R) = the arc's ends | ±87 px (0.260 R) |
| shelf width / arc chord (10 % ends) | 0.44 | 0.52 | 0.37 | 0.42 |
| shelf width / shoulder-to-shoulder at the arc | 0.49 | 0.55 | 0.39 | 0.49 |
| arc: radius, lit span | 0.683 R, −24.5° … +26.8° | – | 0.683 R, ±27° | unchanged |
| arc run-on past the shoulders | 8 / 13 px, fading | yes | none | 15 px a side |
| shelf line peak / arc peak | 0.91 | 0.66 | 0.90 | 0.90 |
| shelf line, width at half peak | 58 px | 89 px (flat) | 47 px | 58 px |
| shoulder line / arc peak | 0.14 | 0.04 | 0.12 | 0.13 |
| arc profile at ±20° / ±25° | 0.33–0.50 / 0.10–0.17 | – | 0.67 / 0.18 | 0.66 / 0.16 (kept) |

\* 02 is a small press render. In our frame its arc is r 0.65 R and its shelf sits at v 0.46, so only its ratios and angles are used. Its line levels are a render's, not a photo's.

- **Shape.** Before, the top was a dome: a short bright middle, 32° sides and no run-on. Now it is a flat shelf with straight 42° shoulders, and the bright arc runs on past them. That matches 05 to within 1–2 px. The dashed outline in `tray_before_after.png` is drawn from 05's numbers.
- **Kept on purpose.** Our arc stays brighter toward its ends than 05's (0.66 against ~0.4 at ±20°), as asked ("keep the bright lower arc").
- **Not changed.** Our tray's fill is flat, 12 at the top falling to 5. 05 is darker at the top (2–4) and has a soft glow inside the tray, just above the arc (~0.2 of the arc's peak, falling off over ~8 px). This would be a small further `PBOX` change if wanted.

## 4. Budgets (bench 8097, `rm -rf dist bench/.data`, Comfort drive mode, D3)

| Layout | Layers per connection (0 + 1 + 2), before → after | Max uniforms on a layer (samplers counted) | Pixel memory, before → after | Assets |
|---|---|---|---|---|
| 6WB Comfort | 7 + 6 + 7 → 7 + 6 + 7 | 20 → 20 | 11.27 → 11.63 MiB | 11 → 11 |
| 6WB Comfort, `wbFoot` glass (worst case) | 7 + 6 + 7 → 7 + 6 + 7 | 20 → 20 | ≈ 11.62 → 11.98 MiB | 12 |
| 6WB Comfort + BMW map | 7 + 6 + 7 → 7 + 6 + 7 | 20 → 20 | 10.54 → 10.90 MiB | 9 → 9 |
| 6WB Dials + G20 | 7 + 6 + 6 (unchanged) | 23 | 11.12 MiB (unchanged) | 9 |
| 6WB Sport | 7 + 3 + 4 (unchanged) | 18 | 2.52 MiB | 1 |
| 6WB Eco Pro | 7 + 7 + 2 (unchanged) | 18 | 2.63 MiB | 1 |

- **Layers.** In 6WB Comfort, the three new texts joined existing image sheets on connection 2: 13 sheets before and after. Pixel memory grew 0.36 MiB, for the larger sheet and the `wb_gear` glyphs. The worst case was measured on the bench with glass on. Its "before" figure is today's default 11.27 MiB plus the `bar` texture's 0.35 MiB (POLISH-F measured 11.7).
- **Layout switches.** The bench switched between layouts (Comfort → map → Dials → Sport → Eco → Comfort, and Comfort ↔ Dials) without one pixel-memory refusal.
- **Samplers.** Every effect layer binds every sampler it declares: wbback `u_t0..2`, wbdial `u_base` and `u_deco`, wbsign `u_s0` and `u_s1`. WBMSA has none.
- **Shaders and fp16.** No shader changed. The tray is a texture, so there is no new px-distance maths in the shaders.
- **Black.** Empty space stays pure black (§2).

## 5. Proof (`docs/car4/l/`, bench renders over the bench's own G20 simulation; no photo pixels)

| File | What |
|---|---|
| `tray_before_after.png` | 3× crops: 6WB Comfort before and after (P), the same with the 05-measured outline dashed over them, and 6WB Dials + G20 before and after (D3). |
| `tray_settings.png` | 6WB Comfort, D3: `gearTray` gear / letter / empty, and `modeLabel` off. |
| `<layout>_P.png`, `<layout>_D3.png` | Every 6WB layout at P (0 km/h) and at D3 (50 km/h), `modeLabel` on. Comfort, + map and Dials are in the Comfort drive mode. Sport is in Sport (drive 1) and Eco Pro in Eco Pro (drive 7). |

- **Reproduce.**
  - Shots: bench API `/drive`, `/setting` (each posted twice), `/signals` manual (`gear` 0 = P, 3 = D3).
  - Proof sheets: `tools/ref/tray_proof.py <shots> docs/car4/l`.
  - Numbers: `tools/ref/measure_tray.py`.
  - Re-bake: `cd bake/src && ./P9/py.sh ../../tools/bake_scene.py tacho tacho_d`.
  - Layouts: `python3 design/gen_6wb.py apps/f30_cluster/hud/layouts`.

## 6. For the owner, and to check on the car

1. **Two gear indications in 6WB Comfort.** Ours "D3" sits in the tray and BMW's "D" below the tacho, over the ED arc's tip (BMW draws its letter over any theme). Look at both at P, R, N, D, and in S / M if the car has them. If BMW's letter disagrees with ours, ours is the one to suspect, since its stage and gear come from `statusGearboxDrive` and MDrive.
2. **The mode label in Comfort.** In photos 33 and 41, 6WB Dials + G20 showed an empty label, because the car sent no drive mode (car3 G and H). If Comfort's label is empty on the car too, the cause is the same signal. `modeLabel` off hides it.
3. **The new tray shape.** Check it on the car's panel. It is the same in 6WB Comfort, + BMW map and Dials + G20. Two things differ from the 6WB on purpose or by choice: the arc ends stay brighter than 05's, and the tray's fill has no inner glow. Either can be tuned in `PBOX` if wanted.
4. **Sport and Eco Pro.** They have no tray. To match the 6WB, they would need a tray drawn in their own look: a closed outline in the mode colour, with our gear inside, and their existing mode label moved above it. That means new WBDIAL code (the unused `u_mode.w` "gear box" hook) or a baked texture per mode. It is not in this package. Say if you want it.
5. **Long mode names.** "SPORT INDIVIDUAL" is wider than "COMFORT". The label's box is 240 px wide, the same as in Dials + G20, and it reaches the MSA sign's box (x 1373–1417, y 498–542). Only the text's own pixels matter. Check with that mode if the car offers it.
