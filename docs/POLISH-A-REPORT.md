# Polish, package A: the middle window of 6WB Comfort and 6WB Comfort + BMW map

Brief: `docs/AGENT-BRIEF-polish.md` §3. Branch `polish/a`. Bench shots: `docs/polish/a/`.

## 1. What was wrong

The owner's screenshots 28 and 29 show it.

- **With BMW's map on** (`stockMap` in `wb_comfort`, and `wb_comfort_map`), our layer cut a hard rounded hole, x 668–1252, y 140–602, with a 1.5 px edge and a lit grey rim. The map's grey background (about 46, 46, 56) then showed as a flat box.
- **With the map off,** the window was already black, so it showed no box. But the floor's slab and its slanted sides ended hard against the dial rims.
- **The line at the foot** was the baked `infobar.line`, a grey glassy bar 584 px wide. With the map on, it sat right under the hole's lit rim, as a second grey line.

## 2. What changed

**The soft window.** WBBACK has new uniforms `u_wbox`, `u_fade` and `u_foot`. The layout's `bg` widget gets new keys `window`, `fade`, `foot` and `footLine`.

- `window` [592, 158, 736, 442] is the box between the dials: x 592–1328, y 158–600, symmetric about x 960. BMW's map spans x 592–1303 and y 161–612; the dials cover its sides.
- `fade` [150, 40, 56, 60] gives the soft edges in px: top, sides, foot, and the shade off the dials' rims.
- **Map on:** our layer stays opaque black, and its alpha falls toward the inside of the window.
  - At the top, sides and foot, it follows the stock G20 map veil's curve, `1 − (1 − d/F)²` (`docs/G20SIM-D-live.md` §7).
  - Near the dials' rims, it follows `smoothstep(0, 60, px outside the dial)`.

  So the map fades into black at the window's edges, with an inner shadow under both bezels. There is no edge line or rim. The window and horizon textures are not drawn then.
- **Map off:** the baked window, floor and horizon are multiplied by the side and rim shade. Their hard ends under the bezels now fade to black. The procedural (unbaked) window has the same shade and no longer has its lit rims.
- **Colour rule:** the shade only darkens. Empty space stays (0, 0, 0), and nothing lifts it.
- **Without a `window` key,** the old hard hole is used unchanged. `wb_dials`, Sport and Eco Pro are untouched: the collar path returns before any of this.

**The foot line, `foot`** at `footLine` [607, 650, 1270]. The ends tuck under the dials.

| `foot` | Look |
|---|---|
| `hair` (**default**) | A 2.4 px hairline (0.80, 0.85, 0.92) with a faint halo. It fades out over the outer 30 % at each end, like the 6WB's own info bar line (ref 17). |
| `chrome` | An 8 px rod with round caps. Its profile was sampled off our baked bezels: a bright upper lip, a dark groove and a dimmer lower ridge, brightest in the middle. |
| `none` | No line. The map, or the floor, fades to black above the foot over 56 px. |
| `glass` | The earlier baked line (texture `bar`), kept for comparison. |

To switch on the bench, edit `FOOT` in `design/gen_6wb.py` and run `python3 design/gen_6wb.py apps/f30_cluster/hud/layouts`. You can also edit `"foot"` in the layout JSON. The bench reloads either way.

**The bottom row** (the clock at y 662, the temperature, the range on the speed dial) is unchanged and clear of the line. The line sits at y 607, and the clock and temperature cells start at y 646.

**Fixed while testing:** the foot line's capsule length is computed on a clamped, scaled vector. The car's fp16 mediump would overflow a raw `length()` of the 600 px offsets. Its block also runs only within 12 px of the line.

## 3. Budgets (bench 8081, `rm -rf dist bench/.data`)

| State | Layers | Assets | Pixel memory | WBBACK uniforms |
|---|---|---|---|---|
| Before: all three states | 19 | 12 | 11.7 MiB | 16 |
| After: `wb_comfort`, map off | 19 | 11 | 11.3 MiB (no `bar` texture) | 19 |
| After: `wb_comfort`, map on | 19 | 9 | 10.6 MiB (no `window`, `horizon` or `bar`) | 19 |
| After: `wb_comfort_map` | 19 | 9 | 10.6 MiB | 19 |

`_sceneNeeds` and `_create` agree through `_wbUses()`. A switch to the map drops the window textures before anything new is made. Unused samplers get `_bindBlanks`' blank. With `foot: "glass"`, `bar` comes back (+0.35 MiB).

## 4. Proof (`docs/polish/a/`)

- `after.off.png`, `after.on.png`, `after.map.png`: full bench shots with the G20 backdrop (`?only=1&clean=1&car=0&backdrop=1&g20=startup`).
- `middle.{off,on,map}.png`: the middle before (top) and after (bottom).
- `foot_variants.png`: the four `foot` values, with the map and with the floor.
- `vs_owner_28.png`, `vs_owner_29.png`: the owner's screenshots beside the same region now.

The headless shots were taken over CDP with real waits. `tools/g20sim/shot.sh`'s `--virtual-time-budget` hung on `wb_comfort` with the map off; the bench page apparently keeps virtual time from advancing there.

## 5. For the other packages

- **B (the `wb_dials` middle edges):** for a matching look, use the same numbers (window x 592–1328, fade 150 / 40 / 56, a 60 px rim shade) and the veil curve. `u_wbox` and `u_fade` are not read on the collar path (`u_hasTex` 2), so B can reuse them there without a conflict with A's code.
- **C:** in `wb_dials`, the simulation's map shows hard vertical edges at about x 730 and 1225 and a top edge at about y 155 (`bake/work/polish-a/shots/check.dials.png`). In `wb_comfort`, our window hides them.

## 6. Open

- Not yet seen on the car. The fades are smooth alpha over BMW's map, which the bench composites exactly. On the car, the panel brightens dark tints, so the darkest part of the fade may look lighter than on the bench.
- The top fade (150 px) is longer than the stock veil (120 px). That was chosen by eye so the window's top does not read as an edge.
