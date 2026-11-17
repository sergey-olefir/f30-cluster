# R2-A2: baked dial faces and the fallback-window mask

Package A2 of Twin Dial round 2. Branch `twin-dial/r2-a2`, from `twin-dial/r2`. Nothing pushed, no version bump, nothing under `apps/f30_cluster/` or `apps/driver_profiles/` touched.

## What was built

| File | What |
|---|---|
| `tools/twin-dial/bake_face.py` | the two R8 luma faces (616 x 560, drawn at 3x, LANCZOS to 1x) and a regions JSON beside each, from SPEC numbers only |
| `tools/twin-dial/bake_mask.py` | the fallback-window mask (`zc.panel` dilated 3 px), R8 536 x 112, with the plate and keep-out checks |
| `tools/twin-dial/face_shade.py` | numpy reference of the `tdial` decode (tint, wedge, red ink, bar fills): executable documentation for B and E |
| `tools/twin-dial/compare_face.py` | baked faces against the mockup's dial crops |
| `tools/twin-dial/test_bake.py`, `bench/test-twin-bake.js` | tests (63 and 35 checks), several of which break the rule on purpose |
| `tools/twin-dial/_bakecommon.py`, `bake_all.sh`, `BAKE.md` | helpers, the one command, the bake note |
| `apps/twin_dial/hud/scene/face_tacho.json`, `face_speedo.json`, `panel_mask.json` | R8 scene textures in the engine's format (`_scene()`): `{w, h, format: "r8", r8, sampling: "bilinear", mask: <entry>}` |
| `apps/twin_dial/hud/scene/face_*.regions.json` | region ranges, numerals, ticks, bar segments, decode rules |
| `bake/manifest/twin_dial.json` | sha256 of every payload, font hashes, tool versions |

Run: `sh tools/twin-dial/bake_all.sh` (faces + mask + manifest; `--stretch 1.0` rebakes Saira as the mockup), `sh tools/twin-dial/bake_all.sh --check` (both test files), `... python -I tools/twin-dial/compare_face.py` (the mockup comparison; pictures in the git-ignored `bake/work/twin-dial/r2/A2/`). Every committed payload regenerates byte for byte (test).

## The faces

- Face rect = [cx - 308, 90, cx + 308, 650] panel px: tacho [72, 90, 688, 650], speedo [1232, 90, 1848, 650]. Dial centre at face px (308, 310) = panel (cx, 400), R = 300, 1 texel = 1 panel px. Inside the layer rects (tacho [70, 90, 690, 660], speedo [1230, 90, 1850, 660]); ends at y 650, above the furniture limit y 657 and the gear gap.
- Byte = the **neutral sRGB code** (the picture's G channel), no tint, day look, `bandGain` 1. Content: band with the two-way shading (codes 23..158 inside the sweep, up to 173 at the lit ends past +-125), tick strip 137, near-black major lines 6, minor/major ticks 255, numerals 255, bezel ring open at the bottom 255, inner rim 255 (open below +-150 deg as the mockup), "OFF" (tacho), unit labels (tacho "1/хв × 1000" Noto 20, code 227; speedo "км/год" Noto 21), five empty bar segments 47, end labels ("0" "1/1" / "C" "H", Noto 21), the 32 px icon under each dial. Not baked (the shader's): needle, wedge, bar fills, READY, gear, program, digital speed.
- Numerals: Saira 550 / wdth 125, tach 1-8 at 57 px (rho 0.745), speedo large 28 px (rho 0.76) and small 18 px (rho 0.78), 90 and 120 not drawn. Saira is baked with the **1.06 horizontal stretch** of SPEC §9 (the mockup draws 1.00).
- **How the shader applies the cool tint** (`face_shade.py`, and `decode` in the regions JSON): inside the band region (rho 0.58..0.94, |theta| <= 144) `c = max(0, k^(1/2.4) (g + 0.055) - 0.055)` per channel with `g` = byte / 255 and `k = (0.96, 1.0, 1.08) x bandGain` (exact for sRGB(Y k) while Y k > 0.0031308), and `rgb = mix(g, c, 1 - smoothstep(0.70, 0.80, g))` so white ink on the band stays white. Outside the band `rgb = g`. Verified: band, strip and the 6-code lines decode to the mockup's colours (strip 135/137/142 vs 134/137/142).
- **Wedge and red ink**: the shader replaces the band inside rho 0.55..0.94, theta(redline)..125 and keeps only the face's ink there: `alpha = clamp((g - t0) / (1 - t0))`, `t0` 0.54 for the ticks (the strip is the constant 137, so exact) and 0.52 for the numerals (the band under them is 0.30..0.50). Ticks red from theta(redline) - 0.45 deg, numerals red from theta(ceil(redline / 1000) - 0.5), both only for theta <= 140 (the bar end label "1/1" and the icon lie beyond). Outside the wedge a red tick or numeral (the lower half of the 8) is recoloured over the band colour at g = t0, which removes the white of its antialiased edge.
- **Clearance (SPEC §5.3, checked at bake time and in the tests)**: every numeral's ink to every other numeral, every tick and the needle's rest position, rule 4 px. Tacho: numeral-numeral 71.8 px, numeral-tick 20.1 px, numeral-needle-rest 123 px; speedo: 7.6 px, 7.7 px, 37 px (with the 1.06 stretch). No violation. By design the needle at rest covers "0" (speedo) and "OFF" (tacho). The 4 px rule alone drops a 120 added to the set (gap 0.65 px) but would keep a 90 (the owner's thinning drops 90, the rule does not).

## The mask

`zc.panel` dilated 3 px = `message_panel.json` `fallback_window.polygon_px` (already dilated, not dilated again), rasterised with `tools/strip/bake_mask.py` `shape_cover` (hard edge = exact area coverage, 8 x 8 samples), cut to [694, 592, 1230, 704] = 536 x 112, panel rect [694, 592, 1230, 704], texture px = panel px. **Polarity: 255 = inside the window (the car's own panel shows through, our layer see-through), 0 = ours**, which is B's contract (no `maskKeep`); it is the inverse of the strip's `msg` lane. Window bbox [696, 595, 1226, 704]. Checks (also in both tests): the plate [694.5, 592, 1230, 720] covers it with margins left 1.5, top 3.75, right 4.0, bottom 16 px (>= 1.5 required); gap to the belt group 8 px, to the gear gap 154 px, to the stored-message marker 14 px; no side-lamp hole touched. Pixel memory of the three textures: 0.658 + 0.658 + 0.115 = 1.43 MiB counted twice (SPEC §13.2 budgeted 0.3 each for three assets).

## Pixel comparison against the mockup's dial crops

`compare_face.py`: both faces rebaked, decoded with `face_shade.py` (wedge at 6500 rpm, bar fills 3.2 / 2.6 segments as the mockup, no needle), compared in the same 616 x 560 crop of `bake/work/twin-dial/mockup/` renders; needle pixels (found by rendering the mockup twice with different values), the dynamic hub text (READY, gear, program, digits) and the neighbours the crop catches (tab bar, bottom rule) are excluded. Geometry = distance from every ink-bright (luma >= 128) pixel of one picture to the other's; band-edge = the same at luma >= 40.

| Face, Saira stretch | compared px | mean abs diff / channel | p99 | ink edge beyond 2 px (decoded→mockup / mockup→decoded) | max edge distance | band-edge px beyond 2 px |
|---|---|---|---|---|---|---|
| tacho 1.00 | 315 514 | 0.43 | 9 | 19 / 4 of 40 000 | 7 / 3 | 32 (max 5) |
| speedo 1.00 | 315 269 | 0.34 | 3 | 8 / 0 of 46 300 | 3 / 2 | 45 (max 5) |
| tacho 1.06 (baked) | 315 514 | 0.72 | 15 | 21 / 2 | 7 / 3 | 32 |
| speedo 1.06 (baked) | 315 269 | 1.34 | 37 | 8 / 0 | 3 / 2 | 45 |

The few pixels beyond 2 px are (a) the fringe of the lower half of the 8 beyond the wedge edge (the alpha rule loses the faintest antialiased edge pixels, a 1 px fringe, max 7 px in one corner) and (b) the five bar frames, which now follow B's contract segment formula (below) and sit up to 4 px off the mockup's. Per zone, mean abs diff at stretch 1.00 (tacho / speedo): bezel 0.0 / 0.0, ticks and strip 0.47 / 0.22, band and numerals 0.91 / 0.71, rim 0.59 / 0.01, hub static labels 0.0 / 0.24, bars, end labels, icon 1.07 / 0.91. With the stretch the numerals widen about 1.4 px per side (speedo band-and-numerals zone 3.3): geometry stays inside 2 px (the ink-edge distance of the stretch alone is 2 px).

## For the lead to decide or know

1. **Saira stretch**: baked at 1.06 (SPEC §9 is the authority; the owner approved the 1.00 mockup and A1's gallery compares both). One command to switch: `sh tools/twin-dial/bake_all.sh --stretch 1.0`. Package A1 uses the same 1.06 for the text atlases, so the two must be switched together.
2. **Inner rim**: SPEC §4 says a full circle ("none" of the hub needs a gap); the mockup, which the owner approved, leaves it open below +-150 deg and the drive-program label at (0.02, +0.56) R crosses the rim's radius, so I followed the mockup. `RIM_OPEN` in `bake_face.py` (360 for a full circle).
3. **Bar frames follow B's contract, not the mockup**: the contract's segments `sw = (x1 - x0 - (segs - 1) gap) / segs` = 47.2 px at pitch 51.2 over 254..506 / 1394..1646; the mockup pitched 50.4 and ended 4 px short at 502. The fills are B's, so the frames must agree with them; the mockup comparison shows the deviation (up to 4 px at the right end). If the lead prefers the mockup's, both must change.
4. **Band level in B's ink separator**: the contract's `ink = smoothstep(0.62, 0.90, code)` assumes no band texel above code 158. True inside the +-125 deg sweep (max 157.8), but the SPEC band formula goes to code 173 at the lit ends (125..144 deg, rho up to 0.893), where it reads ~10 % ink. Harmless in the picture (a few codes brighter and slightly less tinted there); B may narrow to `smoothstep(0.70, 0.85, ...)`. My decode (`face_shade.py`) uses 0.70..0.80.
5. **Wedge ink alpha is an approximation** (`t0`): inside the wedge the baked band is gone and the face's ink is told from the band by its level only; faint antialiased edge pixels of a red numeral or tick are lost (about a third of a pixel of stroke), and a 1 px pale fringe remains on the part of the 8 outside the wedge. Measured above; the alternative (an analytic band in the shader, or a second ink channel) costs shader size or +0.66 MiB per face.
6. The mask rect is [694, 592, 1230, 704] (536 x 112); B's contract example has x 696, y 596. Use the real numbers in `twin.json`.
7. Face rect y is 90 (the contract's example said 96): `tdial.face` = { tex, x: 72 | 1232, y: 90, w: 616, h: 560 }.

## Evidence and limits

Verified: `test_bake.py` 63 checks and `bench/test-twin-bake.js` 35 checks pass (the files regenerate byte for byte; shifting the face by 3 px fails the 2 px check with 3118 px beyond; a 120 added to the speedometer set is dropped by the 4 px rule and kept with the rule off; a numeral put on the ticks is reported; a window 10 px too far left and a pixel left of the plate edge are refused by the plate check). f30_cluster suites after my change, unchanged from `main`: bottom-row 254, native-ui 47, strip-mask 40, fonts 34, probes 25, daynight 24, night 48 (all passed). Not verified: nothing here has been drawn by the real `tdial` shader (B's), on the bench or on a car; the decode is my numpy reference of the contract, so the tint, wedge-ink and fade rules are a hypothesis until B's shader and E's gallery reproduce them. The band level (`bandGain`) and the night multipliers are not mine and not measured. The fonts used by the bake come from `bake/work/twin-dial/refs/vt-fonts/` until A1's `tools/fonts-src/` lands (the bake looks there first; the sha256 of the files used is in the manifest).

## Changed outside my files

None. `bake/manifest/twin_dial.json` is a new file. (Pillow 13.0.0 and numpy 2.4.6 made the committed payloads; a different Pillow build may differ by a code or two; the test then says so.)
