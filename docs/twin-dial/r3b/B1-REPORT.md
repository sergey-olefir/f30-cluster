# B1 — faces, shaders, every texture (Twin Dial 0.1.1, build round)

Branch `twin-b/b1` (worktree `.claude/worktrees/b3-b1`), from `main` c1f53f2. Authority: `docs/twin-dial/SPEC-R3.md` §2, §3, §4.5, §8, §9.
Nothing here is proven on a car. Everything below was run headless: Python bake, the real GLSL on the Mac's GPU (moderngl), the bench.

## What was built

1. **Both R8 faces re-baked** (`tools/twin-dial/bake_face.py`, still 616 x 560): band look B (Y = 0.0188 exp(4.60 (rho - 0.60)) exp(0.59 (1 - cos th)), rho 0.5795-0.9375, cut at 143.0); the strip G 109 with its bright line G 124 (rho 0.924-0.934);
   major lines 0.010 R; bezel to 143.6, rim thin (0.008 R, rho 0.544) to 143.55; numerals with the shadow behind **`SHADOW_MODEL`** (`'SD'` default = outline 0.008 R at 0.75, drop (+0.010, +0.012) R, sigma 0.008 R, 0.35, all in linear light; `'K1'` and `None` also work);
   the tachometer's unit "1/хв x 1000" at (0, +0.40) R; the hub centre is free of ink (tested). Regions JSONs rewritten (`red_arc` replaces `wedge`; `strip`, `strip_line`, `major_lines`, `numeral_shadow`, `hub`).
   Same file names, same size: **no pixel-memory change**. `sh tools/twin-dial/bake_all.sh` re-bakes byte for byte (the test regenerates and compares), `--check` runs `test_bake.py`, `test_shader.py` (GPU), `test-twin-bake.js`.
   **How the shader applies the tint:** on the neutral G code, in linear light, per channel: band (0.76, 1, 1.064); strip own tint from its sRGB (98, 109, 111) = (0.799, 1, 1.040); line (0.851, 1, 1.035); bandGain scales band and strip. Constants are in `shaders.js` (`TINT`, `STINT`, `LTINT`, computed by `tintOf()`), and in the regions JSON.
2. **`tdial`**: the wedge is gone; **red arc on the bezel** from the redline to `u_red.w` = 143.6, (210, 20, 21) less the G20 black floor = (210, 18, 6); the bezel is all "ink" (its antialiased edge stays red), and a red tick/numeral takes its edge earlier (no grey halo around the 7 and 8);
   `u_lim` (marker deg, state 0 / 1 / 2 / 3, warn, strip mode) and `u_cru` (deg, state): the limit marker (rho 0.893-0.94, 2 deg, (181, 26, 17) -> (181, 25, 0)), hollow in states 2 and 3; the strip red L1 (dim 0.45 below / full over or warn >= 1), L2 (only marker..needle and only over), L3 (always full), to +125.5 deg, ticks stay white; the cruise marker (green triangle in the gap, rho 0.94-0.985, tip inward). The needle is unchanged. **5.76 KB** after `compact()` (was 4.46; limit 8 KB).
3. **`tdback`**: the selected tab's cell filled in its colour (colour table, fill law `colour_linear x ramp / 0.16`, rule under it +0.15 white), the ramp's cool tint, separators 780 / 848 / 1168 / 1237 (2 px dark + 1 px light code 84, as K2's approved mockup), the 3 px rule code 230, the map window (`u_map`, `u_mapF`: W1 [750, 180, 1170, 564] fades 120 / 80 / 80 radius 24; W2 [700, 173, 1220, 600] hard), closed by default. **2.67 KB** (was 2.0; limit 6 KB). Every sampler bound as before (`u_face`; `u_mask`).
4. **Textures**: nothing new is needed. Faces 2 x 616 x 560 R8 (460 KB JSON each, 0.658 MiB counted twice each), `panel_mask` 536 x 112 (unchanged, 0.115 MiB): the textures cost **1.43 MiB**. The sign is a sheet (B5), the markers and the map window are shader only. Pixel memory of the final layout as it is on this branch: text sheets 2.98 MiB (`test-twin-layout.js`) + textures 1.43 = **4.41 MiB steady**; across layout switches the bench peak is **4.31 MiB** (stand-in layout of the budget test) — both under 6 / 8. Layers `{conn0: 6, conn1: 5, conn2: 2}` (+1 for a two-layer GPU text) = unchanged: B3's connection move and B5's sign sheet are theirs to count.
5. **Comparison with the mockup** (`tools/twin-dial/compare_face.py`, against K1's `80_look_06.png`, the owner's choice; needle + shadow, hub text, bars, mockup neighbours excluded): table below. A gallery of the dials alone (11 states: idle, driving, redline, L1 below/over, L2, L3, conditional, limit + cruise, night) is `bake/work/twin-dial/r3b/B1/gallery/gallery.png` (git-ignored; `tools/twin-dial/gallery_dials.py`), and `dials_day.png`, `cmp_*.png` beside it.

| Face (Saira stretch) | mean abs diff / channel | bright-ink px beyond 2 px (ours→mockup / mockup→ours) | strip zone | band + numerals zone |
|---|---|---|---|---|
| tacho 1.00 | 1.63 | 16 / 39 of ~13.5 k | 0.36 | 2.44 |
| speedo 1.00 | 2.25 | 0 / 0 of ~18.7 k | 0.22 | 4.01 |
| tacho 1.06 (shipped) | 2.11 | 24 / 39 | 0.36 | 3.31 |
| speedo 1.06 (shipped) | 3.83 | 0 / 0 | 0.22 | 6.88 |

   Geometry is inside 2 px everywhere (the few px beyond are the 7/8 edges). The remaining differences are by design: the spec's major lines 0.010 R (the mockup drew 0.006 R), the arc's colour (210, 20, 21) vs the mockup's (218, 16, 48), SD's shadow vs K1's by-eye one, the Saira stretch 1.06. The tdial shader on the GPU equals the numpy reference (`face_shade.py`) to 0.000 codes outside the needle area (`test_shader.py`).

## Files

New: `tools/twin-dial/render_dials.py` (the real shader on the GPU: `render_dial`, `compare`), `test_shader.py` (44 checks on the GPU: tdial and tdback L, with guards broken on purpose), `gallery_dials.py`. Rewritten: `face_shade.py`, `compare_face.py` (the numpy decode and the mockup comparison of the new look). Changed: `bake_face.py`, `bake_all.sh`, `test_bake.py` (+ `test_r3_faces`), `shared/shaders.js` (TDIAL, TDBACK; helpers `linF`, `tintOf`), `bench/test-twin-budget.js`, `bench/test-twin-bake.js`, `bench/twin-fixture.js`, baked `apps/twin_dial/hud/scene/*`, `bake/manifest/twin_dial.json`, `docs/twin-dial/ENGINE-CONTRACT.md` (changelog). Hand-off note: `bake/work/twin-dial/r3b/pub/B1/NOTE.md` (+ `READY`).

## Edits outside my files (name them for the merge)

* `shared/hud.js`, hunks marked `twin_dial B1`: constants (`TW_NIGHT.amber` 0.85 -> 0.80 and `tab` 0.75, `TW_ROLE_NIGHT.amber` 0.80, `TW_RULE.tab` 237 -> 230, `TW_TAB`, `TW_FLOOR`, `TW_ARC_END`, `TW_MAP`, `TW_LIM_STRIP`, `twinLin`, `twinEnc`), `_twinDialSend` (`u_red.w` = 143.6, calls `_twinMarks`), new `_twinMarks(x)`, `_twinBackInit` (five cells from the separators), `_twinBackSend` (selected tab fill / rule colour, map window, key now includes `twinTab` and `twinMap`; the severity no longer lights the cell). **State other packages write:** `this.twinTab` (B2), `this.twinMap` (B4), `this.twinLim`, `this.twinCru`, then `_twinSync()` / `_twinMarks()` (B5).
* `design/gen_twin.py` + regenerated `apps/twin_dial/hud/layouts/twin.json` (5 lines): the hub texts move for SPEC-R3 §2.7 — gear centre (0, 0) baseline 432 (font still `td_gear`, 64 px: B6 decides the 92 px / `td_big` extension), program baseline 471, READY baseline 321, both x on the dial's centre. Without it the gear would sit over the moved unit. B2/B3/B4 also edit this generator: take theirs, re-apply these three `BASE` values and the two `x` terms, regenerate.
* `bench/test-twin-layout.js`: one line (the `spec` table of text baselines: gear 432, ready 321, program 471, x 380), because the hub moved.
* `bench/twin-fixture.js`: the stand-in's tab block (seps 780 / 848 / 1168 / 1237, rule [170, 173]) and three bench hooks (`twinTab:`, `twinMap:`, `twinMarks:`).

## Tests changed on purpose

`test-twin-budget.js` (was 75): the wedge checks became arc checks (`u_red.w` 143.6); the "the severity lights the warning cell" checks became "the fill is the selected tab's colour and never the severity" (SPEC-R3 3.2); the stand-in work folder is per port (`budget-root-<port>`: `bake/work` is shared between checkouts and two agents collided on it); added: tabs 1-5, the rule under the cell, rule/separators, the markers, strip mode, clamping, the map window, all in place with no layer made again. `test-twin-bake.js` (35 -> 37): band 0.5795-0.9375 / 143, tint, ring ends, arc instead of wedge. `test-twin-layout.js`: the hub baselines. `test_bake.py`: the decode test now compares with the approved mockup.

## Results

All 20 `bench/test-*.js` suites run one at a time on this branch (port 8601), 0 failures. Counts against `main` today: bottom-row 254, cc-release 57, daynight 24, driver-profiles 105, fonts 34, mb-exp 46, native-ui 47, night 48, probes 25, scene-tex 54, strip-mask 40, twin-cc 149, twin-fonts 219, twin-layout 61, twin-pages 101, twin-probe 115, twin-sim 39, twin-trip 82 — all identical (f30_cluster's seven suites unchanged; `apps/f30_cluster` and `apps/driver_profiles` untouched);
**twin-bake 35 -> 37**, **twin-budget 75 -> 94**. `sh tools/twin-dial/bake_all.sh --check`: `test_bake.py` 85, `test_shader.py` 44 (GPU), `test-twin-bake.js` 37, all green. Static budget: tdial 5763 bytes, tdback L 2672, RT/RB 537; 13 / 17 uniforms; no `length()` of an unnormalised offset; one sampler each (`u_face`, `u_mask`).
`tools/signals/check_signals.py` was not run for a change: B1 declares no signal and does not touch `app.json`.

## Open problems and decisions for the lead

* **Marker vs full strip:** when the strip is full red (L1 over, L3) the marker (same red, same radial extent) merges with the strip's leading edge: the marker is the strip's start. Below the limit in L1 the marker is plainly visible (full against 0.45). If the owner wants the marker visible inside a full strip, it needs a light edge (not in the spec).
* **State 2 vs 3:** the brief names "conditional" and "hollow" separately; the spec only says conditional = hollow marker. Built: 2 = hollow marker, strip not red; 3 = hollow + red strip. B5 chooses.
* The black-floor correction is applied to flat colours (arc, markers, cruise, tab fills); the band, strip and line are baked and tinted as the spec gives them (their floor shift is under 1 code in G, 2 % in B of the strip).
* **Hypotheses I named:** the ramp's cool tint (0.96, 1.0, 1.08) (spec: "with band look B", K2's mockup draws it neutral); the strip red ends at +125.5; the cruise marker's triangle size (3 deg wide at its base); separators follow K2's mockup (the spec's "light line 3 px to its right" is ambiguous); major lines 0.010 R follow the spec, not the mockup; the map window's W2 (hard edge) corner radius 1.
* **Not verified:** the shader on the KOMBI's fp16 mediump path (it asks for highp, every length is normalised by R, checked statically); the map window on the bench is only a uniform check (`test_shader.py` renders `tdback` L on the GPU too: cell colours, separators, rules, map W1 / W2 alpha; the engine path to it is the bench uniform checks); no car.
* The tests above rebuild `dist/`; ports used 8601 only.
