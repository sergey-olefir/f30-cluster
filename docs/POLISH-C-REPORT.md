# Polish C: the G20 parts: black empty space, no photo artifacts

Brief: `docs/AGENT-BRIEF-polish.md` §5. Branch `polish/c`. Bench only, except for the re-baked "G20 Comfort" textures.

## 1. What changed

Every change is in a generator; the PNGs, the manifest and the app textures are regenerated from them.

| Part (`bench/g20/structure/`) | Before | After | Where |
|---|---|---|---|
| `bg.*` (panel background) | the photo's blue-grey, 15–55 levels, lighter blotches where the cabin light hit the glass | pure black | `render_soft.bg_layer` |
| `map_veil.*` | the same blue-grey, semi-transparent at the map's ends | black, same alpha (a fade to black) | `render_soft.veil_layer` |
| `speedo.glow.*`, `tacho.glow.*` | a grey-olive haze between the band and the frame (the camera's flare); row stripes and a dotted line at the top of the speedo; a box of glow past the band's bottom end, by the sign window | only the glow's own red-orange (each bin split into the glow's hue plus a neutral grey; the grey dropped); outliers rejected; 2-D fill; faded out past both band ends | `clean_soft.glow`, `render_soft.end_fade` |
| `speedo.wing.*`, `tacho.wing.*` | orange stripes in the lower third (the stock pointers' glow, in every photo); dark teal spots round the numerals (the phone's sharpening halos); diagonal creases from the band's corners; a teal-white patch mid-face in the day look (the sky on the glass, 09 and 14) | one cleaned table for both dials (their mean: the left/right cabin light averages out); the lower third continued from above; spots rejected; blurred inside the face (8 px); day face = night face × 1.20 (the measured brightness ratio) | `clean_soft.face`, `render_soft.dial_layers`, `render_soft.load_soft` |
| `fuel_mini.fill.*`, `oil_mini.fill.*` | an opaque blue-grey band between the outer frame and the inner line; opaque dark blocks inside the fill that hid the big dials' glow beside the minis | the fill starts at its inner line; where the photo showed the panel's black (its fitted background, per pixel) the fill is see-through; median + Gaussian along the frame | `minis.layers`, `clean_soft.lift`, `clean_soft.smooth_along` |
| `c.js` check-control panel | base `[9,12,22]` / day `[14,19,23]`; the fill's last stops faded into it | base black; the fill's top keeps its colour and its foot reaches black | `COL.*.ccBase`, `ccFill` |
| `*.frame.*`, `*.bottom_end.*` (the bottom line at the hooks; package B's item 11) | the line ran on into the hook with a bump where the two round ends overlapped | the slanted gap that 09, 14 and 16 show at each hook's foot. It is about 3 px wide, leaning 0.6 px right per px down on the speedo (mirrored on the tacho), measured on 09. The hook's traced rounded tip is replaced by a straight run, so the gap's cut makes the end. Bottom-line QC on 08: 0.615 / 8.60 → 0.616 / 8.40 | `render.bottom_gap`, `render.hook_path` (`part_bottom_line_hooks.png`) |

Kept as they were (content, no photo artifact found): the rest of the frames and ticks, the numerals, the rev band, the info lines, the minis' frames and icons, D's pointers, glow and map (its dark-grey ground is the map's own drawing, fading to black at its edges), C's telltales and texts.

Two generator bugs fixed on the way, both of which changed shipped PNGs on every build:
- **Numerals font.** `numerals.py` looked for the font in the git-ignored `bake/work/g20sim/FONT.json`. That file is gone, so a rebuild silently used Arimo instead of Roboto, and every numeral changed shape. It now falls back to the font recorded in `params/numerals.json`.
- **Dither seeds.** `build.py` seeded the dither with Python's `hash()`, which is salted per process. It now uses `zlib.crc32`. Unchanged layers rebuild byte-identical.

Sheets (our drawings only, each layer over black at its panel place):
- `docs/polish/c/part_*.png`: before and after, night and day, one sheet per changed part;
- `docs/polish/c/structure_night.jpg` and `structure_day.jpg`: every structure layer composed, before above after.

Bench shots: `docs/polish/c/bench_*.jpg` (§3).

## 2. QC

`tools/g20sim/qc_shots.sh qc` (port 8083), then `tools/g20sim/qc.py`. The QC now also reports the empty space in our own render: the background mask, max channel, 0–255.

| Shot | Before: median / p99 | After: median / p99 / px over 2 levels |
|---|---|---|
| stock, at rest, night | 22 / 51 | 0 / 1 / 0.2 % |
| stock, at rest, day | 29 / 103 | 0 / 0 / 0.1 % |
| G20 Comfort, 50 km/h | 22 / 51 | 0 / 0 / 0 % |

The pixels over 2 levels are the lit lamps' halos, anti-aliasing beside the check-control panel, and the speedo's "260", which reaches past the catalogue box. All of them are content.

**SSIM and ΔE against the photos fall by design.** The photos' lit-up black is exactly what the rule removes. On 08, compared with `docs/G20SIM-REPORT.md` §5:

| Group | Before | After |
|---|---|---|
| B background | 0.967 / 0.9 | 0.088 / 6.4 |
| B speedo face | 0.898 / 3.8 | 0.859 / 6.7 |
| B tacho face | 0.921 / 3.0 | 0.866 / 6.5 |
| B fuel mini | 0.760 / 6.3 | 0.381 / 9.3 |
| whole panel | 0.861 / 4.2 | 0.491 / 7.5 |

The rest of the table is in `bake/work/polish-c/E/qc/qc_table.json` (local). The faces lose little; the minis and the frames lose most, because their boxes are mostly the photo's lit black.

## 3. Bench

- `bench_stock_rest_{before,after}.jpg`: the simulation alone (layout `off`), start-up lamps, night.
- `bench_wb_dials_rest_{before,after}.jpg`, `bench_wb_dials_80_after.jpg`: `wb_dials` over the simulation. (The machine's load, average about 160, made headless Chrome time out on `wb_dials` a few times; the shots were retried with a longer wait.)
- `bench_g20c_50_{before,after}.jpg`: "G20 Comfort" at 50 km/h.

**`wb_dials`: what my change does to the seams.** Package B owns the seams; this part only covers what the simulation adds to them.
- **The dark square behind the right "i"** at (1256, 591), and **the dark ring round the 50 sign.** Both are the navy tint of `wb_dials`' **collar** (`apps/f30_cluster/hud/scene/collar.json`, B's), which was baked to match the simulation's old blue-grey background.
  - With the simulation now black, the collar's navy shows more, not less. See `bench_wb_dials_rest_after.jpg`:
    - round the "i";
    - left of it, from x 1150;
    - by the sign window;
    - in the two top corners, x 480–710 and x 1200–1420, y 40–170.
  - It goes away once B's collar is pure black (B's brief item 2). **Merge B's collar together with this branch.**
- **The small grey dash right of the message panel** (about x 1224–1240, y 640). It is the start of the stock tacho's bottom frame line, right of the check-control base. It is real on the car (08 and 16 show the line) and the simulation draws it on purpose. Category (c): B's call.
- **Package B's category (b) list** (`docs/POLISH-B-REPORT.md` §2 and §4):
  - item 10, the navy background: done (§1);
  - item 11, the gap at the hooks: done (§1);
  - the `inventory_parts.py` stop once B's collar no longer reads `bg.night.png`: `collar_recipe()` now accepts both recipes, and records a black collar as baked from `collar.dials.png` alone.

## 4. App: "G20 Comfort"

`tools/bake_g20.py` re-baked `g20_speedo`, `g20_tacho`, `g20_fuel_fill` and `g20_oil_fill`. `design/gen_g20.py` gave the same layout, and `design/g20_geo.json` is unchanged.

**Budgets: unchanged.**
- 7 assets, 7.91 MiB of pixel memory:

  | Texture | Size | Pixel memory |
  |---|---|---|
  | `g20_speedo` | 684×626 | 3.27 MiB |
  | `g20_tacho` | 684×623 | 3.25 MiB |
  | `g20_fuel`, `g20_fuel_fill` | 198×226 | 0.34 MiB each |
  | `g20_oil`, `g20_oil_fill` | 195×222 | 0.33 MiB each |
  | `g20_lut` | | 0.04 MiB |

- No shader or uniform change.

**Bench files:** `bench/g20/` went from 2.05 MB to 1.29 MB of structure PNGs (2.6 MB to 1.9 MB in all), because black compresses better.

## 5. Re-runs

| What | Result |
|---|---|
| `fit_soft.py 08 night`, `09 day` | new `params/soft_*.npz` |
| `build.py` | 42 PNGs, B's QC |
| `tools/g20sim/build_manifest.py` | 80 entries |
| `tools/bake_g20.py` | |
| `design/gen_g20.py` | |
| `tools/overlay/inventory_parts.py --no-measure` | `g20_parts.json`: alpha extents and notes of the changed parts; the catalogue is unchanged, so `link_parts` added nothing. The live parts were not re-measured, as D's code is unchanged. |

**Tooling (shared machines):** `tools/g20sim/shot.sh` takes `G20SIM_PROFILE`. `qc_shots.sh` and `pointer_sweep.sh` take `BENCH_PORT` and `G20SIM_OUT`, and `qc.py` takes `G20SIM_OUT`. The defaults are unchanged, so nobody has to post to 8078 or share a Chrome profile.

## 6. Open

1. **The wing faces' colour.** I took the mean of both dials. The speedo side is bluer in every photo and the tacho side warmer. I read that as cabin light, not as BMW's drawing. If BMW does draw them differently, the per-dial tables can come back.
2. **The day look.**
   - The faces are the night faces × 1.20, because the day photos show the sky's reflection.
   - The glow is still fitted to 09.
   - A day photo in shade would settle both.
3. **Where the faces lie under the pointers** (y > 415). They are continued from above, with weak evidence, as before. The band glow keeps its measured bottom, a thin line, because continuing the side's broad glow there was wrong.
4. **The minis' fill.** Its inner fade is still the photos' (no wider than 08 shows), and the oil range is still a guess.
5. **The QC against the photos is no longer a likeness score for the empty space.** A comparison against the photo minus its fitted black would measure the content alone; it is not built.
