# Package O: our side of the strip, to the pixel

Brief: `docs/AGENT-BRIEF-strip.md` (not committed). Base `integrate/bottom-row` 3c8ef46, branch `strip/O`. Analysis
only: nothing in `shared/`, `apps/`, `design/gen_6wb.py` or any layout was touched. No car, no browser.

Boxes are panel px `[x0, y0, x1, y1]`, half-open, continuous coordinates (pixel (i, j) covers [i, i+1) x [j, j+1)).
**Verified** = read from the engine's own output (uniforms, shaders, pixels) or measured on a photo or screenshot;
**hypothesis** = everything else.

## 0. Method

`tools/strip/O/` replays the bench's engine with no browser:

- `states.py` drives a private bench (port 8161) through every state of brief section 4.2 with the bench's own
  steering (`/signals`, `/fake`, `/click`, `/restart` before each group and before each latched case), and `snap.py`
  freezes each one: the last `scene` event (every layer, its compiled fragment shader, every live uniform and sampler
  binding) and every image layer's and asset's pixels (`GET /px`).
- `render.py` runs each effect layer's **real fragment shader** on the Mac's GPU (moderngl, GL 4.1; the only changes
  are the GLSL ES -> 4.10 shim: `varying`/`texture2D`/`gl_FragColor`, and renaming identifiers that are 4.10 keywords,
  e.g. WBBACK's function `patch`), with page.html's vertex mapping, uniform rules, LINEAR/CLAMP textures after the
  page's canvas round trip, and its rule that an unbound sampler is not drawn; image layers come from their raw pixels;
  layers stack as page.html stacks them (class, z, arrival; source-over). At 4x and 16x effects are re-evaluated at the
  finer sample centres (a sub-rect viewport, so GL's viewport limit never bites); image layers are replicated.
- **Check against the bench's own WebGL** (`check69.py`): the owner's screenshot 69.png (all6WB, nothing read yet,
  green matte) registered to our replay of the same state (scale 1.13023 screenshot px per panel px, offset
  (45.98, 82.22)): over the STRIP the matte's visible fraction differs from 1 - our coverage by **median 0.000, mean
  0.009**; every blob over 0.5 is dynamic content that differs between the two moments (gear digit, temperature
  digits, a mini gauge needle). The replay is the engine's output. **Verified.**
- Consistency: 1x from the sub-rect renderer = 1x from a whole-layer viewport to 4e-5; the 16x box mean = the 4x box
  mean to 0.002.

Products (git-ignored, `bake/work/strip/pub/O/`, README in `ABOUT.txt`): per layout / mode / state, `alpha_1x.png`
and `alpha_4x.png` (uint16), `rgba_1x.png` / `rgba_4x.png` (uint16, straight sRGB colour + coverage),
`maps_1x.npz` (alpha, premultiplied sRGB and linear colour, one coverage map per layer), `breakdown.json` (each
layer's role, rect, coverage, semi-transparent count, key uniforms; each text widget's real ink box). Numbers in
`design/strip/O/` (`states.json`, `analysis.json`, `sign_ring.json`, `switch_peak.json`, `widest_wb_dials.json`).

## 1. The lopsided sign ring (68.png)

**Our coverage round the sign is round to 0.005 px. Verified** (`signring.py`, 16x, every degree, r 30-60 in 0.25 px):

| | window edge (coverage 0.5) | fitted centre | rms | full black | outer edge |
|---|---|---|---|---|---|
| tip 3c8ef46 (r 40, ring reach 10) | r 40.47-40.50 | (537.303, 621.299) | 0.0045 | r 41.5-51.0 at every angle (min 0.9996 at r 51) | ~r 52, then the collar or nothing, by angle |
| parent of 3bfce09 (r 42, reach 8) | r 42.30-42.50 | (537.323, 621.290) | 0.033 | r 44-51 | same |

No layer rectangle clips the ring: only two layers reach it (WBBACK and the speedo's WBDIAL), and the dial's black is
1.0 from r 41.5 to r 51 at all 360 degrees. The collar's clear disc (`SIGN_CLEAR`, `tools/overlay/plan_dials.py`) is
**centred elsewhere**: its 0.5 edge fits a circle at **(539.05, 622.20) r 45.86** (verified; H said (539, 622) r 46).
Its 4-px-texel feather reaches coverage 0.14 at r 41.5 and 0.20 at r 42 between 131 and 177 degrees (lower left).
On the tip that is under the dial's full black and moves the window edge by at most 0.03 px; on the parent it pulled
the edge in by 0.2 px there.

**The cause: BMW's sign is not concentric with our window, and since 3bfce09 our window is smaller than BMW's red ring,
so OUR circle became the ring's outer edge while BMW's white face (the ring's inner edge) sits off-centre.** The red
that shows on each ray runs from BMW's face edge to the nearer of BMW's ring edge and our window edge.

68.png is the bench over photo 08's rectified backdrop. In that rect BMW's face is centred at **(539.24, 621.21)**,
1.94 px right of our window (`signfit.py`; the bench's G20SIM drawing has the same offset, (539.3, 621.8)). Predicted
red width right / bottom / left / top **6.40 / 8.40 / 9.30 / 8.20 px**; measured on 68.png itself (circle fits to its
face edge and ring edge, at 1.13 screenshot px per panel px): **right 6.40, left 9.26**. **Verified.**

Red ring left visible, per backdrop or photo (px, right / bottom / left / top, and max/min ratio):

| BMW's sign as in | its centre | tip (r 40) | ratio | parent (r 42) | ratio | parent's dark gap |
|---|---|---|---|---|---|---|
| photo 08 (bench, 68.png) | 539.24, 621.21 | 6.40 / 8.40 / 9.30 / 8.20 | 1.50 | 8.40 / 9.65 / 9.30 / 8.80 | 1.15 | to 3.00 px |
| G20SIM (bench) | 539.3, 621.8 | 5.30 / 6.80 / 7.85 / 7.80 | 1.50 | 7.30 / 7.85 / 7.85 / 7.85 | 1.08 | to 2.95 px |
| photo 61 (R v1 rect) | 538.22, 621.58 | 7.70 / 8.35 / 9.55 / 8.90 | 1.25 | 9.70 / 10.20 / 10.15 / 9.75 | 1.06 | to 1.60 px |
| photo 62 | 538.20, 621.65 | 7.60 / 8.15 / 9.40 / 8.85 | 1.26 | | 1.06 | to 1.80 px |
| photo 63 | 537.91, 621.79 | 7.90 / 8.00 / 9.10 / 9.00 | 1.20 | | 1.04 | to 1.70 px |
| photo 64 | 537.27, 622.73 | 8.55 / 7.10 / 8.50 / 9.90 | 1.40 | 9.95 / 9.10 / 10.10 / 9.90 | 1.11 | to 2.10 px |
| photo 68 | 536.78, 622.35 | 9.00 / 7.80 / 8.30 / 9.35 | 1.24 | | 1.08 | to 2.90 px |
| mean of 61-64, 68 | 537.68, 622.02 | 8.25 / 7.90 / 9.00 / 9.35 | 1.21 | 9.55 / 9.90 / 9.95 / 9.60 | 1.05 | to 1.80 px |
| concentric (control) | 537.3, 621.3 | 8.60 all round | 1.00 | 9.75 all round | 1.00 | 0.85 px |

BMW's own ring: face edge r 31.7-32.0, outer edge r 41.05-41.99 on the new photos (rms 0.1-0.26 per fit). The new
photos' centres rest on package R's **provisional** rects (registration rms 0.5-0.7 px), so their spread (1.4 px in x,
1.1 px in y) is mostly registration: on the car the offset is about (+0.4, +0.7) px, **hypothesis** until ZL's
measurement on R v2.

**Does reverting 3bfce09 remove it? No.** It cuts the asymmetry (ratio 1.50 -> 1.15 on the bench's photo 08, 1.2-1.4
-> 1.04-1.11 on the new photos) but does not remove it, and it re-opens a see-through crescent between BMW's ring and
our black, up to 1.6-3.0 px wide, on the side away from the offset - the gap the whiskers came through. What removes
it is **concentricity**: with the window centred on BMW's measured centre the ring is uniform at either radius
(8.60 px at r 40, 9.75 px at r 42). `SIGN_CLEAR` should move to the same centre (two centres in two layers today).

## 2. The open box and the missing clock (69.png)

From the uniforms of the replayed state (all6WB, 6WB Comfort + G20, no check-control message ever read). **Verified**
(uniforms + the 69.png check above).

**The open box.** `own.info` is false: since fbad13a the info field is BMW's until the car's message has been read
(`_ccWired()`), and the bench (like a car whose `config.ccm` never arrives) has read none. With info BMW's:
- WBBACK `u_cc = [709, 598, 1243, 694]` (`CC_BOX`, rounded r 8 by `boxOut`) cuts a hole in the backdrop;
- `nav_bg` (FILL, `[690, 666, 1250, 712]`) gets `u_hole = [19, 0, 534, 46]`, i.e. panel `[709, 666, 1243, 712]`;
- together: one see-through box `[709, 598, 1243, 712]` (coverage < 0.02 over x 710-1242 for y 602-694, and x 710-1209 down to y 712, where the collar's side feather x 1210-1222 begins), with only
  two slivers of `nav_bg` left at x 690-709 and 1243-1250 (the black bar at the box's left in 69.png);
- `own.nav` stays true, so **our road label is still drawn inside BMW's open panel** (ink `[901, 685, 1020, 704]`).
The same uniforms come back in `msg-latched` (a message our fonts cannot draw). In allG20 the same `CC_BOX` hole is
open in every state where no message has been read (`unread` = `msg` byte for byte).

**The missing clock.** `_own('clock')` is `isNum(_tzMinutes())`: the `timeZone` setting no longer exists (retired),
`config.utcOffsetMinutes` is null, and `tzCar` is null because nothing has fed `KombiIF.timeDateUTC` (the bench feeds
it only on the `clock-plus2` scene; on the car it depends on that field arriving with a valid value, encoding still
unconfirmed, factor 15). So `own_clock` is not built (`widgets` has no `own_clock`) and its patch `[340, 662, 455, 704]`
is not sent (`patches.want` 3). BMW's clock area is see-through: coverage < 0.02 over x 336-514, y 668-704 in that
state (then the sign's black ring to x 561, then the belts, clear by design, to x 690). With a zone (`drive-clock`) the clock is built (ink `[349, 666, 448, 697]`) and the fourth patch is sent.

## 3. Per-state tables (6WB Comfort + G20)

6WB Sport + G20 has the **same coverage to 4e-5 in every state** (its colours differ); it is not offered any more
(`hud.js G20_OF`), so it was drawn through the bench's data-folder override (`states.py override()`).

Speedo `u_cut.z`: 1 = sign window open, 3 = closed. Disc = BMW's sign disc r 41.4 round (537.3, 621.3).

| mode | state | own (r c t n s i) | u_cc | nav_bg | patches | u_cut.z | opaque / semi / clear px | disc covered |
|---|---|---|---|---|---|---|---|---|
| allG20 | unread, msg, msg-long, latched x2 | none | CC_BOX | - | CC_TOP | 1 | 176101 / 37542 / 131957 | 4.4 % |
| allG20 | drive, drive-clock, park, limit-*, nopass | none | - | - | CC_TOP | 1 | 208390 / 41442 / 95768 | 4.4 % |
| allG20 | p-engine-off | none | - | - | CC_TOP | **3** | 213759 / 41013 / 90828 | **100 %** |
| all6WB | unread | r t n s | CC_BOX | hole 709-1243 | range, temp, CC_TOP | 3 | 198370 / 38732 / 108498 | 100 % |
| all6WB | drive, park, limit-*, nopass, p-engine-off | r t n s i | - | full | range, temp, CC_TOP | 3 | 253732 / 41591 / 50277 | 100 % |
| all6WB | drive-clock | all six | - | full | range, clock, temp, CC_TOP | 3 | 258538 / 42088 / 44974 | 100 % |
| all6WB | msg, msg-long | r t n s i | CC_SYM [700, 628, 757, 690] | full | range, temp, CC_TOP | 3 | 252026 / 41273 / 52301 | 100 % |
| all6WB | msg-latched | info latched | CC_BOX | hole | range, temp, CC_TOP | 3 | 197919 / 38169 / 109512 | 100 % |
| all6WB | road-latched-msg | nav latched | CC_SYM | **absent** | range, temp, CC_TOP | 3 | 228891 / 43467 / 73242 | 100 % |

Strip = 345 600 px. Sign states, the clock zone in allG20, and park vs drive change nothing in the strip.

Per-layer breakdown per state is in each `breakdown.json`. In short: WBBACK (collar u_t0 480 x 180 at 4 px a texel,
cover u_t1 736 x 64 at `[588, 598, 1324, 662]`, patches, u_cc), the speedo WBDIAL (cut at panel y 656 fading over
26 px, sign window), the tacho WBDIAL (cut only), the two mini dials, `nav_bg` (all6WB), our sign WBSIGN (above the
strip, `[305, 460, 519, 553]`), WBMSA (nothing in the strip), and the text sheets.

Vertical coverage profile where the cover ends (all6WB drive-clock; allG20 is the same above y 662):

| y | x 300 (under speedo) | x 900 (CC_TOP) | x 1600 (under tacho) |
|---|---|---|---|
| 648 | 1.000 | 1.000 | 1.000 |
| 652 | 0.914 | 0.996 | 0.914 |
| 656 | 0.409 | 0.723 | 0.409 |
| 658 | 0.124 | 0.500 | 0.124 |
| 660 | 0.053 (0.156 by the range patch) | 0.277 | 0.053 |
| 662 | patch / 0.000 | 0.097 | patch / 0.000 |
| 664 | | 0.004 | |
| 666 | | nav_bg 1.0 (all6WB) / 0 (allG20) | |

## 4. Defects found on our side (all verified on the replay)

1. **The y 652-666 band under the message is still open** (brief's earlier finding, re-measured on the tip): CC_TOP's
   13 px soft foot is 0.5 at y 658, 0.1 at 662, 0 at 664; `nav_bg` starts at 666. All6WB, every state with the bar.
2. **allG20, P with rpm < 150 (photo 63's state): BMW's whole sign is blacked out** (disc 100 % covered, 5389 px; the
   speedo's `u_cut.z` 1 -> 3 from `hud.js` `cut.cover === 'limit'`). BMW still draws its normal row and its sign
   there (package P, photo 63). **CLIP, 5389 px.**
3. **allG20, every state: the outer 0.9 px of BMW's red ring is clipped** (window 0.5 at r 40.5, BMW's ring to
   r 41.0-42.0): 4.4 % of the disc, ~236 px of coverage. By design of 3bfce09; it is what turns an off-centre
   window into a lopsided ring (section 1).
4. **All6WB road-latched-msg**: `nav_bg` is gone while our message text is still drawn and `u_cc` opens only the
   symbol column: our two lines over BMW's uncovered message band (the see-through component that holds it: 60726 px, box x 50-1215, y 627-720). Unchanged
   from the earlier audit's O-navfail.
5. **Safety footprint, dilated 3 px** (brief's SAFETY): CC_TOP's soft foot puts coverage up to **0.12** within 3 px
   above `bottom.belt_driver` (49 px) and up to **0.10** above `bottom.airbag` (100 px), rows y 662-664, every
   state with CC_TOP (both modes). Inside the undilated catalogue boxes our coverage is 0. Rear belts: 0.
6. **all6WB p-engine-off = drive**: our row stays drawn in P with the engine off (the brief's 1.6 wants BMW's row in
   standby; package P says that is VehicleCondition, not rpm). Measured, not judged here.
7. **The CC_BOX hole while nothing has been read** (section 2): in all6WB it opens BMW's panel under our road label;
   in allG20 it is open in every unread state, which opens x 1226-1243 where the catalogue puts BMW's mode label (the earlier audit's 18 px sliver; the catalogue box, not re-measured here).

Semi-transparent (0.02-0.98) regions at least 3 px across, all from WBBACK (no image layer, no FILL, no dial except
its cut fade): the map window's foot fade `[685, 540, 1235, 595]` (mean 0.45; `u_wbox`/`u_fade`, intended); the
collar's foot band under both dials (y 650-662, about 10 px, 0.5 at y 655.5) and its 16 px side feathers at
x 42-60, 1210-1222, 1474-1489, 1860-1878 (baked, intended as feathers); CC_TOP's foot (item 1, not intended). Whether
an intended feather sits over something of BMW's that must be hidden is the zone packages' diff.

## 5. Our row texts: boxes, anchors, widest strings (from the fonts' metrics, `widest.py`)

| widget | font | box | anchor | baseline y | widest | its ink x | patch |
|---|---|---|---|---|---|---|---|
| own_range | wb_row 43 | [139, 664, 249, 699] | right edge | 697 | "9999" | 155-249 | [132, 662, 334, 703] |
| own_range_u | wb_val 36 | [253, 668, 307, 700] | left edge | 697 | "km" | 253-302 | same |
| own_clock | wb_row 43 | [335, 664, 459, 699] | centre | 697 | "23:59" | 344-451 | [340, 662, 455, 704] |
| own_temp | wb_row 43 | [1505, 664, 1615, 699] | right edge | 697 | "+40.0" | 1510-1615 | [1498, 662, 1667, 705] |
| own_temp_u | wb_val 36 | [1619, 668, 1665, 700] | left edge | 697 | "°C" | 1619-1657 | same |
| nav | wb_cap 21 | [690, 682, 1230, 708] | centre | 700 | free text, cut with "..." | the box | nav_bg |
| cc_name / cc_desc | wb_cap 21 | [758, 627, 1178, 653] / [758, 671, 1178, 697] | centre | 645 / 689 | free text | the box | CC_TOP / nav_bg |

Every widest string fits its patch (clock: 4 px each side). wb_row's digits are tabular (advance 23).

## 6. Budgets

| layout, mode | layers (per connection) | assets | pixel memory | effect sources, bytes |
|---|---|---|---|---|
| Comfort + G20, allG20 | 15 (6 + 5 + 4) | 7 | 10.73 MiB | WBBACK 9030, WBDIAL 13234 (x2, one source), mini dial 7226 (x2), WBMSA 1703 |
| Comfort + G20, all6WB unread | 20 (7 + 7 + 6) | 9 | 12.03 MiB | + WBSIGN 3531, FILL 985 |
| Comfort + G20, all6WB info ours | 20 (7 + 7 + 6) | 9 | 13.22 MiB | same |
| Sport + G20, allG20 / all6WB | 14 / 18 | 6 / 8 | 2.54 / 4.92 MiB | WBBACK 8376, WBDIAL 6801, one more 1169 |

Peak over every switch of the strip's states, measured on the scene stream (`peak.py`, 16 ms granularity):
**13.22 MiB, 20 layers, 7 per connection**; turning "+ G20" off and on: 11.53 MiB, 21 layers. No refusal logged.

## 7. What only the car or another package can settle

- BMW's true sign centre on the car (ZL, on R v2): our window should move to it, and `SIGN_CLEAR` with it.
- Whether the collar's feathers and the y 650-662 foot band sit over BMW content that must be hidden (ZL/ZC/ZR diff).
- fp16: the replay is fp32 like the bench; the car's mediump is not modelled here.
