# Package M: the strip mask (the mechanism)

Brief: `docs/AGENT-BRIEF-strip.md` (not committed), package M. Branch `strip/M`, based on `integrate/bottom-row`
(`3c8ef46`). No car, no browser, no push, no version bump. Bench on port 8162.

**Verified** means measured from the engine's own output (the bench's scene stream: compiled shaders, live uniforms,
asset bytes) or computed from the baked bytes. **Hypothesis** means it still needs the car.

## 0. Verdicts

1. **The mask is plain coverage at full size, one byte per pixel (R8).** It is not a distance field at half size.
   Measured on eight synthetic shapes (`tools/strip/M/encodings.py`, `design/strip/M/encodings.json`): full size
   reproduces every shape to the 8-bit step (≤ 0.002). A distance field at half size is good on long straight edges
   (p99 error 0.03–0.05) but fails where the strip is tight. At corners the error reaches 0.41–0.56. A 2–3 px
   corridor between two holes loses about 0.2 px on each side, with errors up to 0.56. Plain alpha at half size
   blurs every hard edge (p99 0.25–0.38). Corners and narrow corridors are exactly the places where the owner wants
   the black to hug the stock items, so full size is the right choice. R8 costs a quarter of RGBA, and that makes
   full size affordable. **Verified.**
2. **There is one atlas with one lane per row state.** The cover lanes are `ours`, `bmw` and `standby`, and all three
   share one box. The hole lane is `msg` (BMW's panel, its symbol and its marker), and the shader multiplies it in
   for `bmw_msg`. Switching lanes costs one uniform message and never an upload. Each edge's feather is baked in
   with whatever profile and width the shape asks for, so feathers are not limited to one uniform width.
3. **Synthetic mask, transition state.** A mask baked from today's rectangles (`bake_mask.py --today`) draws within
   **0.60/255** of the rectangles in all seven bench states: BMW's row unread, with a message, standby with and
   without a message, driving again, ours, and ours with a message. 0 px are off by more than 1/255. **Verified**
   (engine uniforms plus a numeric replay of WBBACK; see §4).
4. **Shapes and feathers survive the bake.** A round hole with a 2 px soft edge comes back off the baked bytes with
   its centre at (537.300, 621.300) and radius 42.499 (declared 42.5). The fit residual is rms 0.004 px, and the
   left, right and bottom radii agree to 0.001 px. An arc-and-slants panel with a 3 px shadow comes back within
   0.01 px of the declared outline. **Verified** (`demo_check.py`).
5. **fp16 is handled.** With mediump coordinates, 60 of 1920 columns would land on the wrong texel (up to 0.94 texel
   off). WBBACK already runs highp, and the mask's lookup also snaps to the texel centre (`floor(p - box) + 0.5`).
   Under highp the worst offset is 5e-5 texel. **Verified** numerically; that the car's GPU really honours highp is
   **hypothesis**, carried over from 0.7.5.
6. **The sign window can move into the mask below the dial's fade (y ≥ 630), and that is where it matters.** Above
   y 630 the dial is opaque, so only its own round window can open it. The cost is no memory, about 0.5 KB less
   WBDIAL source, and one shader edit plus one bake rule. It is not done on this branch; §7 has the recipe. O found
   the lopsided ring is a **centring** problem: BMW's sign is off our window's centre. The mask does not cure that.
   One shared centre from ZL does.
7. **Budget.** The worst state on the bench goes from **13.22 MiB before to 13.34 MiB after** the clean-up, and the
   switch peak is the same 13.34. Layers do not change. WBBACK's source drops from 9030 to 8595 bytes (Comfort) and
   its uniforms from 29 to 27. Removing the cover and the rects pays for the mask, and converting the collar to R8
   pays for the rest. §9 has the table.

## 1. What the renderer can do (brief M.1)

| Fact | Source | Status |
|---|---|---|
| An effect shader samples an asset through `bind(ref, sampler, asset)`. Every declared `sampler2D` must have one bound, or RAMSES skips the layer (`_bindBlanks`). | `cluster-and-hud.md`, `cluster_render_client.js`, memory note | verified (code) |
| Assets are R8 or RGBA8, 1–2048 px on a side, and `w*h*bpp ≤ 1920*720*4`. They can use `nearest` or `bilinear` sampling with clamp wrap. A connection holds 16 assets, the service 32. | `cluster_render_client.js` `_add`, `bench/server.js` | verified (code) |
| Pixel memory is the asset's bytes counted twice: R8 costs `w*h*2`, RGBA8 costs `w*h*8`. | `bench/server.js` `pixelBytes`, `hud.js` | verified |
| "sheet limit 345600 px" belongs to the **image-sheet packer** (a sheet is at most a quarter of the target). It is not an asset limit. | `hud.js` `_plan`, `SHEET_AREA_FRAC` | verified (code) |
| The upload budget ceiling is 5500 KB/s, with a 2000 KB/s floor. The 1540×332 R8 atlas (511 KB) uploads once per layout build, in about 0.1–0.25 s. A state change is a uniform message, not an upload. | `cluster-and-hud.md` | verified (code), timing estimated |
| **The bench page** uploads every asset through a 2D canvas, which premultiplies alpha, and always samples it LINEAR. An R8 asset reaches the page as (v, v, v, v), so `.r` comes back rounded and values below about 15 are lost, while `.a` stays exact. RGB lanes would be zeroed wherever A < 255. | `bench/page.html` `textureOf`, `bench/server.js` `pixelRect` | verified (code) |
| On the car an R8 asset samples as (r, 0, 0, 1): the glyph atlases are R8 and ATEXT reads `.r` correctly on the car. | ATEXT on the car (0.7.14) | `.r` verified by ATEXT, `.a = 1` hypothesis |

Because of the last two rows, WBBACK reads an R8 asset with `r8a(s) = s.a < 0.999 ? s.a : s.r`. That read is exact on
both the car and the bench, including under bilinear filtering.

## 2. Full-size alpha or a half-size distance field (brief M.2)

The tool is `tools/strip/M/encodings.py`. Ground truth is the 8×8-supersampled coverage of each shape. Each encoding
is sampled the way GLSL `texture2D` samples it (bilinear, clamped) at the panel pixel centres. `half_sdf` stores a
*normalised* distance (distance ÷ the edge's own ramp width), so a distance field can still carry one feather per
edge.

| Shape | Feather | full alpha: max / p99 err | half alpha: max / p99 | half SDF: max / p99 / mean shift px |
|---|---|---|---|---|
| CC_TOP-like rect, fractional edge | hard | 0.002 / 0.002 | 0.44 / 0.25 | 0.41 / 0.027 / +0.004 |
| sign hole r 41.5 | hard | 0.002 / 0.002 | 0.35 / 0.33 | 0.067 / 0.047 / +0.007 |
| sign hole r 41.5 | 2 px | 0.002 / 0.002 | 0.16 / 0.15 | 0.063 / 0.053 / +0.009 |
| panel with arc and slanted ends | hard | 0.002 / 0.002 | 0.61 / 0.38 | 0.56 / 0.036 / −0.002 |
| the same | 3 px | 0.002 / 0.002 | 0.18 / 0.10 | 0.13 / 0.042 / −0.010 |
| 3 px corridor between two holes | hard | 0.000 / 0.000 | 0.53 / 0.38 | 0.56 / 0.25 / **−0.19** |
| 2 px corridor | hard | 0.001 / 0.001 | 0.48 / 0.31 | 0.48 / 0.13 / **−0.20** |
| slanted straight edge | 4 px | 0.002 / 0.002 | 0.087 / 0.075 | 0.041 / 0.026 / +0.001 |

Memory per lane (counted twice): **0.66 MiB at full size versus 0.16 MiB at half size**. Because each lane is cropped
to its box, the real cost is smaller (§9). A distance field also needs a ramp-width uniform or per-edge storage, and
it can never reproduce today's output (smoothstep feet, bilinear collar tails), so the reproduction test in brief M.3
could not pass with it. **Decision: full-size R8.**

## 3. The mechanism

- **Atlas** (`hud/scene/strip_mask.json`, written by `tools/strip/bake_mask.py`). It is `{w, h, format: "r8", r8:
  base64, sampling: "nearest", mask: {atlas, cover, hole, lanes}}`. The lane table lives in the texture's own file,
  and `hud.js` reads it from there. A new bake therefore needs no new layout: the layout only names the texture
  (`"mask": {"tex": "strip_mask"}`, from `gen_6wb.strip_mask()`). Rows sit on 4-byte boundaries. Identical lanes
  share a tile; in the synthetic mask `standby` shares `bmw`'s.
- **WBBACK, collar path** (`shared/shaders.js`, marked `package M`). Inside `u_mk` (the cover lanes' box) the lane
  *is* our black. Outside the box the collar draws. The shade, the map window's veil and the foot line run live on
  top, as before. At the end, `u_mh` (the hole lane's box) multiplies BMW's panel open. `u_mo` holds both lanes'
  atlas origins, so one message switches the cover lane.
- **Lane choice** (`hud.js _maskLanes`, the mask block):
  - **Cover lane:** `ours` when every row item is ours. Otherwise the row counts as BMW's (all-or-nothing, brief
    1.5): `standby` in P with the engine off, and `bmw` otherwise.
  - **Hole lane:** `msg` whenever the info field is **not** ours and BMW's panel must show (`_ccOpen`). That includes
    standby, because a warning is never covered unless our own text for it is on screen. While the row is ours the
    panel stays covered, as brief 1.7 asks.
- **Switching order.** Every frame between two messages is a whole picture. A lane goes off before the origins move
  and comes on after them. Moving between cover lanes is a single `u_mo` message.
- **Collar as R8** (`collar_r8`): its alpha byte for byte, 0.16 MiB instead of 0.66 MiB. `bake_mask.py` rewrites it
  on every bake.
- **Safety guard in the bake.** Every cover lane is forced to 0 over the catalogue's belt and airbag boxes, whatever
  the shapes or the collar say. The bake also prints the most black left within 3 px of those boxes (the brief's
  SAFETY footprint).
  - Today's rects left a **2/255 collar tail at the top-left corner of `bottom.belt_driver`** (593–596, 666–668).
    The guard removes it.
  - Today's rects also leave **0.120 within 3 px**, from CC_TOP's soft foot. This matches O's measurement. The bake
    prints "a shape should clear them".

## 4. Reproducing today (brief M.3)

`tools/strip/M/lane_states.js` drives the bench through the states and dumps each scene, meaning every layer's
compiled shader, live uniforms and binds. `tools/strip/M/verify_mask.py` then runs WBBACK's collar path in numpy over
the whole panel twice. The first run uses the engine's own uniforms, with the lanes. The second uses the same
uniforms through the rects as they were at `3c8ef46`: RGBA collar, cover, shade, patches, map veil, foot line, u_cc.

| State | Lanes (mk / mh / mo) | max \|Δα\| | max \|Δ rgb·α\| | px off > 1/255 |
|---|---|---|---|---|
| all6WB, message | ours / – / 0,0 | 0.500/255 | 0 | 0 |
| all6WB, no message | ours / – | 0.500/255 | 0 | 0 |
| allG20, no message | bmw / – | 0.500/255 | 0 | 0 |
| allG20, message | bmw / msg | 0.602/255 | 0.082/255 | 0 |
| P engine off, message | standby / msg | 0.602/255 | 0.082/255 | 0 |
| P engine off | standby / – | 0.500/255 | 0 | 0 |
| driving again | bmw / – | 0.500/255 | 0 | 0 |

That table is the transition state (commits 1–3), where a row that is half ours still draws the rects.

After the clean-up commit (§10), the same seven states compared with `--against` (the rects from the earlier dumps)
match to 0.60/255. The one exception is **all6WB with a message: 2401 px differ**. That is the symbol column
`[700, 628, 757, 690]`, which the rects opened and the mask keeps covered, as brief 1.7 decided (no window for BMW's
symbol). The rest of today's behaviour is unchanged, apart from two other deliberate changes in the clean-up:
- a row that is half ours now falls back to `bmw` (brief 1.5);
- the belt-corner tail described in §3 is gone.

## 5. A shaped hole and a feather (brief M.3, second half)

`design/strip/M/demo_shapes.json` is a DEMO, not a proposal. It contains:
- a floor over the row;
- the belt group as an always-open hole;
- BMW's sign as a round hole with a 2 px soft edge outward;
- range, clock, street, mode label and temperature holes;
- an arc-and-slanted-ends panel with per-edge feathers (3 px on the arc, 2 px at the ends, hard at the foot);
- the marker;
- odometer and mode label holes for standby.

Baked outside the app with `bake_mask.py design/strip/M/demo_shapes.json --dir …`, it gives a 1560×489 atlas with
three distinct cover tiles, 1.455 MiB. `tools/strip/M/demo_check.py` (`design/strip/M/demo_check.json`) measures it
off the bytes:

- **Sign hole:** a circle fitted to the 0.5 contour (194 points) gives centre (537.300, 621.300), r 42.499 against a
  declared 42.5. The rms residual is 0.004 px and the worst is 0.013 px. Lower-left, lower-right and bottom radii are
  all 42.499.
- **Rim profile at 20° and 160°:** the lane matches the declared 2 px ramp at the pixel centre to ≤ 0.05 (area
  against centre sampling).
- **Panel arc:** the 0.5 contour sits 1.5 px outside the polygon, as a 3 px feather should, in 42 columns. Mean −0.002
  px, max 0.01 px.
- **Belt group:** every cover lane is 0.000 over it.

To see the demo on the bench, bake it into `hud/scene` as `strip_mask`; the bench reloads by itself. I did not view
it: no browser was used.

## 6. fp16 (brief M.4)

`encodings.py fp16`: in mediump (fp16) the panel coordinate is spaced 1.0 px apart above x 1024. WBBACK's
`v_uv * u_size` therefore lands **60 of 1920 columns on the wrong texel, up to 0.94 texel off**, and with bilinear
sampling that error mixes in up to 0.94 of the neighbouring texel. The fix has three parts:

1. WBBACK keeps `precision highp float` under `GL_FRAGMENT_PRECISION_HIGH`, as it has since 0.7.5. `v_uv` is a highp
   varying.
2. The lookup snaps to the texel centre, `(floor(p − box) + 0.5 + origin) / size`, so any coordinate error under half
   a pixel still hits the right texel.
3. The atlas is sampled `nearest` on the car.

In fp32 the worst offset is 5e-5 texel. `gl_FragCoord` is no help, because GLSL ES 1.00 declares it mediump. If a
car GPU had no highp in fragment shaders, every effect we draw would already be broken (0.7.1–0.7.4); highp is
assumed, as in the rest of the theme.

## 7. The sign window (brief M.5)

O's finding (`bake/work/strip/pub/O/O-REPORT.md` §1): our window is round to 0.005 px. The lopsided red ring happens
because BMW's sign is not concentric with our window, by about (+0.4, +0.7) px on the new photos and +1.94 px on
photo 08's bench backdrop. Since 3bfce09 our r 40 circle has been the ring's outer edge. The collar's own clear disc
is centred at (539.05, 622.20), a third centre.

Where the sign window can live:

- **Below the dial's cut fade (y ≥ 630).** Today the dial's 10 px black ring and the collar decide this region
  together. It can move entirely into the mask.
  - The `bmw` lane gets ZL's hole: any shape, with a per-edge feather.
  - The `ours` and `standby` lanes stay black there, as the closed disc does today.
  - The dial loses its ring (`u_cut.z` 1: just the round window) and its closed-disc extension (`u_cut.z` 3: just
    the cut fade).
  - Cost: no memory (those lanes cover that area anyway), WBDIAL −498 bytes, and one bake rule. To reproduce today
    exactly, the dial's old ring is baked into each lane as `1 − (1 − ringA)(1 − wb)/(1 − cutK)`.
  - This is only exact once no state uses the rects, which is why it is not on this branch. It belongs after the
    clean-up commit.
- **Above the fade (y < 630).** The dial is opaque here, so only the dial can open it. There are two options:
  - **(a) Keep the dial's analytic circle.** It is exact in highp. Centre it on ZL's measured centre with radius at
    least the mask hole's outer edge; the mask then decides wherever it is smaller. Cost: a rim of black at most
    (r_dial − r_hole) px wide where the dial face (grey, at most 27/255) used to be.
  - **(b) Have WBDIAL sample the lane.** One more sampler and three uniforms on both dials, about 250 bytes of WBDIAL
    (Comfort is 13.2k; the KOMBI reset at 26.7k), and the same asset bound on connection 0. Exact, with no rim.
- **Recommendation.**
  - **First, one centre for everything.** Set `SIGN_WIN` from ZL's centre, use ZL's hole in the `bmw` lane, and move
    `SIGN_CLEAR` in `plan_dials.py` to the same centre (it stops mattering below y 592 once the lanes cover the
    sign).
  - **Then take (a)**, with r_dial equal to ZL's ring outer radius.
  - **Then move the ring into the mask** after the switch-over.
  - Use (b) only if the owner can see the rim.

## 8. The bake tool (brief M.6)

```
python3 tools/strip/bake_mask.py shapes_L.json shapes_C.json shapes_R.json [--out strip_mask] [--preview DIR]
python3 tools/strip/bake_mask.py --today            # the synthetic mask: the rects of 3c8ef46, exactly
```
(numpy is needed, and pillow for `--preview`. Use the repo's `uv run … python -I` line.)

**Input.** The zone packages' lists (brief ZL–ZR.4), in panel px:
`{id, channel: ours|bmw|bmw_msg|standby|all, kind: hole|cover, polygon | circle [cx, cy, r] | rect [x0, y0, x1, y1],
feather_in_px, feather_out_px, per_edge: [[in, out] per polygon edge] (optional), reason, evidence, clearance}`.
- A shape's inside-ness is 1 from `feather_in` inside its outline and 0 from `feather_out` outside, linear in
  between. A hard edge is the pixel's exact area. Shapes are 8×8 supersampled.
- Covers raise the lane. Holes multiply it by 1 − inside-ness. All covers go first, then all holes, so a hole always
  wins.
- `bmw_msg` takes holes only; they become the `msg` lane. `all` applies to the three cover lanes.
- Every lane starts from the collar plus package F's cover (BMW's bottom lines, hooks and grey dash). `--no-cover`
  starts from the collar alone.

**Output.**
- `hud/scene/strip_mask.json` (atlas plus lane table) and `hud/scene/collar_r8.json`.
- On stdout: the boxes, the memory, and the safety line per lane.
- With `--preview`, a 1× PNG of each lane.
- No layout change is needed. **No photo pixel ever enters the texture:** the inputs are polygons and our own baked
  collar.

## 9. Budget (brief M.7)

Measured on the bench (`tools/strip/M/peak.js` over the scene stream, every switch of the row and of the layout) and
with node (sources as the KOMBI gets them). `design/strip/M/budget.json` holds the numbers.

| | base 3c8ef46 | mask, rects kept (transition) | after clean-up |
|---|---|---|---|
| pixel MiB, allG20 | 10.73 | 11.21 | **10.85** |
| pixel MiB, all6WB (clock and message ours, the worst) | 13.22 | 13.70 | **13.34** |
| switch peak (row, g20 off/on) | 13.22 | 13.70 | **13.34** |
| layers, allG20 / all6WB (per connection) | 15 (6+5+4) / 20 (7+7+6) | same | same |
| assets, allG20 / all6WB | 7 / 9 | 8 / 10 | 7 / 9 |
| WBBACK source, Comfort / Sport, bytes | 9030 / 8376 | 9621 / 8967 | **8595 / 7941** |
| WBBACK uniforms declared (cap 32) | 29 | 32 | **27** |
| WBDIAL Comfort, bytes | 13234 | 13234 | 13234 (−498 possible, §7) |

What pays for the mask (0.975 MiB for the synthetic atlas):
- the cover goes (−0.36 MiB);
- the collar becomes R8 (−0.49 MiB);
- the patches, u_cc in the collar path and the cover sampler go from WBBACK. Against the base, with the mask's own
  code added, that is −435 bytes, and the uniforms `hud.js` sets go from 24 to 22.

F reports +0.37 MiB from its font changes. Together that is about 13.7 MiB of 16.

A real bake with three distinct cover tiles (the demo) costs 1.455 MiB, i.e. +0.48 over the synthetic, so about
14.2 MiB. That is still below 16, but the lanes' box should stay tight: every extra row of box costs about 3 KB per
cover tile.

`nav_bg` becomes redundant once the `ours` lane covers the road label's place, which the synthetic mask does not do
because today's nav_bg is its own layer. Dropping it saves one layer on connection 1 (7+7+6 → 7+6+6). That change
belongs to package X's `nav_row`, so it is not made here.

## 10. Commits, files, and what is left

The commits on `strip/M`, oldest first. All are new, separate, commented blocks, except where noted.
1. **Strip mask:** WBBACK lanes (`shaders.js`), the mask block plus three one-line hooks and the R8 scene loader
   (`hud.js`), `gen_6wb.strip_mask()`, `bake_mask.py`, the synthetic `strip_mask.json`, and the measuring tools.
2. **Collar as R8:** `collar_r8.json`, `r8a()`, and the layouts' collar tex.
3. **Test:** `bench/test-strip-mask.js` (29 checks, then 36 after the clean-up) and `peak.js`.
4. **This report** and `design/strip/M/budget.json`.
5. **Clean-up (last, separate):**
   - Removes the patches, the cover and u_cc from WBBACK's collar path and the layouts.
   - Removes `_wbPatches` and `WB_PATCHES` from `hud.js`.
   - A row that is half ours now gets the `bmw` lane.
   - The `bake_mask.py` safety guard is added, and `TODAY` freezes the rects for `--today`.
   - **It touches package X's `bench/test-bottom-row.js`:** the patch block (9 checks) becomes 2 checks, with the
     geometry moved into `test-strip-mask.js`. 91 checks become 84.
   - Merge it only after package X's all-or-nothing fallback, which makes "half ours" disappear.

Layout JSON: I ran `gen_6wb.py`, then kept **only the bg widget's hunks** (mask, collar tex, and the removed rect
keys). The text drift is package F's. The lead regenerates after merging F.

Tests at the clean-up tip: `test-bottom-row` 84/84, `test-native-ui` 44/44, `test-strip-mask` 36/36. Before the
clean-up: 91, 44 and 29, all passing.

**What the lead does next:**
1. Merge.
2. Bake from the three zone proposals (`bake_mask.py ZL.json ZC.json ZR.json`).
3. Read the safety lines.
4. Run `test-strip-mask.js`. The rects comparison is skipped for a mask baked from shapes; the safety and coverage
   checks still run.
5. Run `peak.js`.

**Open:**
- The car must confirm the R8 `.a = 1` read and highp.
- The owner decides the sign window (§7).
- Package X decides whether `nav_bg` goes.
