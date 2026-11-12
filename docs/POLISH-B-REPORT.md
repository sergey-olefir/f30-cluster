# Polish B: "6WB Dials + G20" seams, our signs, the middle edges (report)

Brief: `docs/AGENT-BRIEF-polish.md` §4, with the lead's change to §4.3 (below). Branch: `polish/b` (local, not merged).

## 1. What changed

- **The collar is pure black and soft.** `tools/overlay/plan_dials.py` now writes `design/overlay/collar.dials.png` as the final soft coverage, and `tools/bake_scene.py` packs it black at quarter size (`collar.json`, 480 × 180, unchanged in size). WBBACK's collar path draws `vec4(0, 0, 0, a)`. The texture holds:
  - the collar over the stock dials: grown 6 px past the stock graphics, then blurred σ 4 px (it still covers every stock pixel it hid before);
  - a band under our dials' faded bottoms (y 626–656, inside the dial circles), so the dials fade into black rather than over the stock bottom line;
  - the shade at our dials' inner edges (0.8 at the rim, falling off over 20 px, between the dial centres, fading out at y 575–605): the map darkens toward our bezels;
  - a black patch over the bottom-row COMFORT PLUS (`assist.mode_label`), the lead's rect `[1226, 659, 1366, 716]` grown 5 px;
  - nothing on any G20 item we show, nor within 3 px of it (a keep-out). As the GPU samples it (quarter size, bilinear), the baked collar's alpha is at most 0.016 on every shown item: check-control panel 0.016, DSC 0.012, the "i" 0.004, all others 0. COMFORT PLUS is under alpha ≥ 0.92 everywhere (mean 0.999).
- **Our road signs.** `dials()` in `design/gen_6wb.py` adds the `signs` (wbsign: the baked `sign_limit` / `sign_nopass`) and `limit` (its figure) widgets under the speed hub, the same as 6WB Comfort's.
- **BMW's sign window is conditional** (the lead's change to §4.3). The speedo's `cut` gets `"cover": "limit"`:
  - while our limit is unknown, the round window at (539, 622) is open (r 44, soft to 48; it was r 46, hard) and BMW's sign shows, as before;
  - while our limit is known, the window closes: WBDIAL's new `u_cut.z = 3` keeps the disc opaque out to r 50, the dial fading into black there, which also covers BMW's sign below the cut (y 656–672). This is in the dial shader, not in the static collar, so it follows the switch. The collar keeps off r ≤ 46 round the sign, so the open window shows the sign clean (collar alpha ≤ 0.05 on its rim) and the closed disc meets the collar's band with no gap.
  - `hud.js` `_update` sets it from the limit (`_cutVec`, local to the wbdial code). The no-overtaking state alone does not close it: BMW's limit stays the only limit we show then.
  - `app.json` `config.limit` is null today, so **on the car the window stays open and our sign never shows** until that field is found.
- **Soft windows.** `u_cut.w` is the window's soft edge (px). The sign window and the "i" box (now `[1254, 589, 1272, 629]`, was `[1250, 585, 1276, 633]`) get 4 px. The window distances are taken on scaled vectors (fp16-safe); the old round window's `length(lp - centre)` was not.
- **The stock bottom line.** `LINE_OPEN` keeps the collar off the line between BMW's frame corners (the hooks) and our dials, on both sides. The line now runs from the hook to our dial's edge and on under it (into the band), instead of stopping as a stray dash.
- **The plan.** `plan.dials.json`: `assist.speed_limit` is `redraw` (at our sign, `[309, 464, 393, 549]`), `assist.mode_label` is `cover`, `C7.*`, `w.signs` and `w.limit` are kept. Conflicts (recomputed with the constructor): 47, the same 7 pre-existing errors (black box and gear "P" over our tacho); the three sign-window warnings are gone.

## 2. The seams

| # | Seam (screenshot 30, the bench, photo 16) | Class | What was done |
|---|---|---|---|
| 1 | The collar is a navy tint, so its shapes show (top inner corners of both dials, round the minis) | (a) ours | Pure black. Over the simulation's still-navy background the shapes now show as black; once package C's background is black they vanish. On the car (photo 16) the empty background is black. |
| 2 | The collar's hard, 4 px-stepped edge cuts the map's grey at the upper inner corners (photo 16 at x 700–780, y 140–200) | (a) ours, real on the car | Soft edge (σ 4 px) plus the shade |
| 3 | A dark square behind the right "i" (screenshot 30) | (a) ours, over (c) | Our hard box window showed a patch of the stock tacho face and the simulation's navy. Tighter (2 px round the glyph) with a 4 px soft edge. The face beneath is BMW's and stays (on the car too). |
| 4 | The collar hides about 21 % of that "i" | (a) ours | The keep-out: 0 % now (max alpha 0.004) |
| 5 | The round sign window: a navy disc and fragments of the stock speedo round BMW's sign, and a break in the stock bottom line there | (a) ours | Closed while our sign shows (BMW's covered, no break: the line goes under the disc as under the dial). While open (today on the car): r 44 with a 4 px soft edge, and the band hides the line right up to it. |
| 6 | The stock bottom line shows dimly through our dials' fading bottoms, broken at the sign | (a) ours | The black band under the fade: the dials fade into black, the line goes under them |
| 7 | The small grey dash right of the message panel | (c) real (photo 16 shows it), cut short by (a) our collar | The collar no longer stops the line there; it runs on to our tacho. Kept uncovered: it is inside the check-control area. |
| 8 | The curved hooks at the ends of BMW's bottom lines | (c) real (photo 16) | Kept uncovered: inside the check-control area |
| 9 | The map's straight sides end hard at our chrome bezels | (a) ours (the join) | The shade at our dials' inner edges |
| 10 | The simulation's empty background is navy, not black, so every black thing of ours shows as a shape | (b) simulation | For package C |
| 11 | The simulation draws the stock bottom line continuous at the hooks; photo 16 shows a small gap and step at each hook's foot | (b) simulation | For package C (minor) |
| 12 | COMFORT PLUS at the bottom row | lead's call (D) | Black patch in the collar |

## 3. Budgets ("6WB Dials + G20" on the bench)

| | Before | After |
|---|---|---|
| Layers | 14 (5 effects, 9 sheets), 5 + 5 + 4 on 3 connections | 16 (6 effects, 10 sheets), 5 + 6 + 5 |
| Assets | 6 | 8 (+ `sign_limit`, `sign_nopass`, 88 × 89 each) |
| Pixel memory | 10.0 MiB of 16 | 10.1 MiB of 16 |
| Uniforms | WBDIAL 20, WBBACK 16 | WBDIAL 20, WBBACK 16 (no new ones), WBSIGN 7 (the new layer) |
| Collar texture | 480 × 180 RGBA, 0.66 MiB | the same |

## 4. For package C

- The simulation's empty background (`bg.*.png`) is navy; the collar is now black, so its shapes show over it until that is black.
- At each hook's foot, photo 16 shows a small gap and step in the stock bottom line; the simulation draws it continuous.
- `tools/overlay/inventory_parts.py` `collar_recipe()` looks for `bench/g20/structure/bg.night.png` in `tools/bake_scene.py`'s collar recipe and stops when it is missing. The collar no longer uses it (black now), so a re-run of `inventory_parts.py` stops there until `collar_recipe()` is updated (the collar's `baked_from` becomes `collar.dials.png` alone; its description "grown 4 px, blurred 4 px, colour from bg.night" is out of date).

## 5. For the owner

- **The sign on the car.** Our sign shows only once `app.json` `config.limit` names the car's speed-limit field. Until then BMW's sign shows through its window, as before.
- **The shade** at our dials' inner edges (strength 0.8, 20 px): stronger, weaker or none (`SHADE_K`, `SHADE_L` in `plan_dials.py`).
- **The stock bottom line**: now visible from BMW's hooks to our dials. The other option is to hide it outside the check-control area, which leaves the hooks and the dash on their own.
- **The "i" window** is always open, since we do not know when BMW shows the "i". Without an "i" it shows a small soft patch of BMW's stock tacho face in our bezel (dark grey on the car, photos 14 and 16). Keep it, or close it and leave the "i" to package D's redraw decision.

The map's visible share between the dials drops from 65 % to 62 % (the shade counts as hidden where it is ≥ 0.5).

## 6. Proof

`docs/polish/b/` (bench renders: our drawing over the simulation; no photo pixels):
- `wb_dials_{rest,80kmh}_{before,after}.png`: before and after, at rest (`g20=startup`) and at 80 km/h (`g20=driving`, BMW sign 50), manual signals, so our limit is unknown and BMW's window is open (the car today);
- `wb_dials_{rest,80kmh}_after_our_sign.png`: the same with our limit known (90: a bench-only env switch, not committed), so our sign shows and BMW's is covered;
- `seams_{rest,80kmh}_before_open_closed.png`: crops of the seams, 2×: before | after, window open | after, our sign.

The simulation's background is still navy (package C), so every black part of the collar shows as a shape in these shots; over a black background (the car, and the simulation once C is done) it does not.

Demo mode (the only bench state with a limit) still hangs headless Chrome, hence the env switch.

## 7. The lead's change to §4.3 (2026-11-12)

The brief said to close BMW's sign window. The lead changed it after package D found `config.limit` and `config.nopass` null: the window stays open while our limit is unknown and closes while it is known, from `_update`, in the wbdial cut code; the cover below the cut follows the same switch (the dial's closed disc, not the static collar). Done as above. The no-overtaking state alone does not close the window. The hooks and the grey dash are kept uncovered (they are inside the check-control area). The COMFORT PLUS patch is in the collar texture, no new layer.

## 8. Reproduce

```sh
export UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache
uv run -q --no-project --with numpy --with pillow python -I tools/overlay/plan_dials.py   # plan, collar, scheme
(cd bake/src && ./P9/py.sh ../../tools/bake_scene.py)                                    # collar.json
python3 design/gen_6wb.py apps/f30_cluster/hud/layouts
python3 tools/overlay/headless.py --plan design/overlay/plan.dials.json --no-shots       # conflicts
```

`headless.py` kills every Chrome whose command line holds `chrome-headless`, which the other packages' runs share; the conflicts here were recomputed by the same page dump with this package's own Chrome profile.
