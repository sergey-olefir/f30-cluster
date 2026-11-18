# Twin Dial round 3b, package KA: the dials, the speed limit, cruise and the limiter

Branch `twin-r3b/ka` (from `twin-r3/k1`). Mockups only: nothing under `apps/`, `shared/`, `bench/`, `design/gen_twin.py`, `tools/twin-dial/bake_*.py` changed. Pictures: `bake/work/twin-dial/mockup/r3b/ka/` (git-ignored; 61 pictures + close-ups in `closeup/`, annotated copies in `annotated/`, sheets in `sheets/`, `index.json`, `measurements.json`, `checks.json`).
Rebuild: `UV_CACHE_DIR=<main>/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3b/ka/make_ka.py [A L C sheets]` (about 80 s).
Shader costs: `node tools/twin-dial/r3b/ka/shader_cost_r3b.js`. Old pictures byte-identical: `tools/twin-dial/r3b/ka/test_old_pictures.py` (16 pictures, 0 changed).

## 1. What was built

- `tools/twin-dial/mockup/mockup.py` (dials, KA's file): new `Look` fields with 0.1.0 defaults (`major_w`, `arc_color`, `arc_half`, `num_shadow_sd`, `night`, `gear_pos='centre2'`); looks of round 3b in `design/twin-dial/r3b/ka/looks.json` (`r3b_base` = `look_06` + SPEC-R3 §2: major lines 0.010 R, arc (210, 20, 21) at ρ 0.990–1.010, SD's shadow, hub of §2.7; `r3b_k1shadow`, `r3b_noshadow`, `r3b_night`); `look_named` reads both files. New drawing functions (listed in the READY note for KB): `Limit`, `Cruise`, `limit_strip`, `draw_sign`, `sign_figure`, `cruise_readout`, `draw_dials(..., ready, limit, cruise, strip, place)`, `finish(cv, scale)`, `Canvas.nm` (night), `Canvas.sdf_icon`, `Canvas.cap_text`.
- `pictos_r3b.py`: our three symbols (`cr_cruise`, `cr_acc`, `cr_lim`, step format, box 38 px = 36 px of ink) and a distance-field renderer.
- `frame_r3b.py`: a minimal frame (tab bar, clock page, M3 page, bottom row, BMW's panel) so KA's pictures are whole panels. KB's `pages.py` stays the authority for tabs and pages; icon of tab 4 is the plain `td_phone` here.

## 2. Numbers and findings

**Base look (A01–A08).**
- Ring ends measured on our render by unrolling (A05): bezel 143.68, rim 143.63, band 143.03; 06 (speedometer): 143.73 / 143.78 / 143.58; 0.1.0: 144.03 / 150.14 / 144.03. The three rings end together within 0.1 deg of SD (the half-pixel offset is the measuring step 0.05 deg). 06's tachometer band reading is spoiled by its unit text (154.4), use the speedometer's.
- Gear: Saira 92 gives cap 63.3 px (spec 66.6 = 0.222 R; SD measured the digital speed at 0.217 R, "the same size as the digital speed" holds at Saira 92; Saira 96 would give 66). Program Saira 24: cap 16.3 (spec 17.4). Widest values: "M4" ink 167.7 px, corner 89.6 from the centre, **72.4 px inside the inner ring**; "D3" 84.1; "COMFORT" corner 97.1 (**64.9 px inside the ring**), "ADAPTIVE" 63.9. Gear bottom to program top 22.9 px, READY bottom to gear top 47.8 px, program bottom to the unit 42.0 px. Nothing collides (A06, `measurements.json`).
- **A04, the shadow.** K1's was one soft drop shadow ((0.008, 0.020) R, σ 0.009, 0.70, no outline); SD's is a tight dark ring round every numeral (0.008 R wide, band to 25 %) plus a short soft shadow ((0.010, 0.012) R, σ 0.008, only 0.35). Measured on the tachometer's band: mean darkening 1.95 % (K1) against 2.85 % (SD); share of the band darker than half 0.8 % against 2.7 %; the numerals look outlined, not floating. Against 06's crop SD's outline matches the reference's dark halo; K1's soft shadow matches its drop shadow better. SPEC-R3 §2.4 takes SD's.
- A07 (engine off) and A08 (redline 5000 / 6500 / 7500: arc starts at 31.25 / 78.13 / 109.38 deg; red numerals 5–8 / 7–8 / 8 only; minor tick 7.5 red at 7500).
- **Keep-out finding (existing, not new).** On every picture (also on 0.1.0's) the speedometer's bezel touches the corner of the side-lamp hole 4 [1774, 176, 1873, 208] at pixel (1774, 207): 1 pixel of value 142, 7 more of value ≤ 5 (hole 2: 2 pixels of value 1 = filter tail). Everything else (belt group, gear gap, holes 0–1, 3, 5–6) is 0. A bezel half width of 0.0100 R instead of 0.0105 brings hole 4 to 5 pixels of value ≤ 34 and hole 2 to 0; to get 0 the bezel would have to lose about 0.0005 R more. Not changed (a layout decision; VG's `tt.abs` clearance is 4.3 px to the lamp, 1.3 px to its hole).

**Speed limit (L01–L21).**
- Strip: red body (181, 26, 17) at 0.45 (dim, **in linear light**; (126, 15, 8)) or 1; the bright line over it is +45 % in linear light; ticks stay white; the marker is drawn over the ticks (it hides the tick under it: at 100 it sits on the major tick, L21). L1 ends at +125 deg as the spec says (18 deg before the band's cut, the red then stops at "300"). A conditional limit gets the hollow marker and no red strip (the spec is silent; my reading). While **over**, in L1 and L3 the marker merges with the strip's start (same red): only its first 1 deg shows as a step.
- Sign: shrink rule (mine, SV gives none): largest Saira bold, at most 0.95 r, whose ink corners stay 2 px inside the white disc: 30 and 50 at 31.4 px (corner gap 2.5 / 2.3), 100 at 24.9 px (2.2), 130 at 25.4 px (2.5). Dashes of the unknown sign scaled from G20-DESIGN-SPEC's 9.4 × 4.9 (pitch 13.07) by 33/40.95.
- Clearances on this render (L20, `measurements.json`), against SV: stored marker 10.7 (10.7), fallback window bbox 41.0 (41.0), gear gap 47.0 (47.0), panel bottom 15.0 (15.0), **our ink 25.1 (26.0)**: the nearest ink is the bottom rule's right end (1290, 614), SV's render ended it a little earlier. To the open window's polygon 54.3 px; **our ink inside the open window: 0 px** (L18). Spacing (L16, L17): sign to the bottom row's text 36.1 px, to the speedometer's ink (band foot) 26.2 px. Tab 1 and tab 3 give the same numbers (the row's right edge is x 1153 + unit in both).
- mph: 30 mph draws the marker at 48 km/h (L15).

**Cruise and limiter (C00–C10).**
- C1: number right edge 1536, baseline 540, unit baseline 560 (same colour as the number: my reading of "with its unit"), symbol centred (1572, 528). Clears our ink; the readout lies 72 px under the black box [1420, 320, 1611, 440], the symbol 70, the unit 106.7 (C09). The speed digits "103" lie **86 % inside** the black box (existing: SPEC-R3 §12 already says so), the speed unit is clear by 24.5 px.
- C2 (my layout; the spec gives the area): symbol centred (c.x − 33, c.y + 217), number right at c.x + 77, baseline c.y + 218, unit baseline c.y + 241: ink x 1489–1617, y 590–644, inside [1470, 590, 1650, 650]; 150 px under the box. The coolant bar, its labels and icon are not drawn.
- **C3 does not fit, no picture drawn.** The readout area x 1556–1666 is 110 px; symbol 36 + gap 6 + number needs 106.7 ("90") / 109.3 ("88") / **111.0 ("110")** / **122.7 ("130")** / 125.0 ("199"): only two-digit set speeds fit. Saira 40 with the face's width (125) is 69.0 px for "110", 80.7 for "130".
- Markers: the green triangle (base 2 deg at ρ 0.985, apex at 0.943) never touches the red marker (which ends at 0.94): C07, C08 (both at the same angle, closeup 5×).
- Night (C10) uses SPEC rev 2 §7.2's multipliers (hypotheses).

## 3. What each variant costs to build

Shader bytes on `tdial` (today 4461; budget 8192; 06 look +81 from K1): sketch patches, `shader_cost_r3b.js`.

| | shader bytes | uniforms | layers / assets | re-bake |
|---|---|---|---|---|
| L1 strip (dim / full) | +174 (strip) | `u_lim` (+1) | none (the sign sheet is SV's) | no |
| L2 (between limit and needle) | +174, same code, end angle = needle (`u_dyn.x` already holds it: no extra host value) | `u_lim` | none | no |
| L3 (always full) | +174 | `u_lim` | none | no |
| limit marker solid / solid or hollow | +206 / +375 (strip + solid marker together +310) | `u_lim` | none | no |
| cruise marker | +175 | `u_cr` (+1) | none | no |
| C1 readout | 0 | — | number as a text widget, symbol 36 px in the speedometer's hub-label sheet (SPEC §12): no new layer | no |
| C2 readout | +111 hide rule (the bar track and labels are baked in the face) or a face variant | `u_cr.w` | as C1; the coolant icon, if it is its own image, needs hiding too | the hide rule avoids it |
| C3 | not built (does not fit) | | | |
| everything (strip, hollow marker, cruise marker) | **+654** (+746 with C2's rule) | 13 of 32 | | |

tdial would be 4461 + 81 + 654 = 5196 (5288 with C2), under 8 KB. The face re-bake of SPEC-R3 §2 is needed anyway and carries nothing of L or C.

## 4. Recommendation (not a decision)

- **Red strip: L1.** It shows the limit before it matters (dim) and answers when it is exceeded (full); L2 is the quietest below the limit but gives no standing hint; L3 paints most of the scale permanently red on every 50 road (the pictures L03 / L06 are the loudest). If the owner finds L1's dim red busy, L2 is the second choice and costs the same.
- **Cruise place: C1.** No shader cost, the coolant stays, clear of the black box by 72 px, the number sits under the speed it belongs to. C2 puts the readout far from the digits, costs +111 bytes and hides the coolant (which then lives only on the technical page); C3 does not fit.
- Open for the owner: the unit's colour in C1 (green as drawn, or grey 227); the hollow marker with no red strip for a conditional limit.

## 5. For the other packages

KB: use `M.draw_dials(cv, look, speed, rpm, gear, program, ready, limit, cruise, strip, place)`, `M.draw_sign(cv, limit)`, `M.finish(cv, scale)`; `Canvas.sdf_icon` draws step-format icons (`pictos_r3b.paste_sdf`); icons of `pictos_r3.py` can be added to `pictos_r3b._DRAW`. KC: `index.json` of this folder lists every picture with its data status.
