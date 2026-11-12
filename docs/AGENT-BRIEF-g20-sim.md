# Brief: a live simulation of the stock G20 cluster under our theme, on the bench

Audience: a lead agent that splits the work between parallel sub-agents (§7). Read the whole brief first.
Project root: `/Users/solefir/projects/f30-cluster` (an MGU cluster theme app; GitHub `sergey-olefir/f30-cluster`).
Scope: **Comfort mode only**, the `panel` target (1920×720).

## 1. Goal

Our new layout "6WB Dials + G20" (`wb_dials`, see `docs/OVERLAY-PLAN-DIALS.md`) draws only four dials. Its background is see-through except a black "collar", and the big dials fade out at y 656. On the car, **BMW's own G20 cluster shows through everywhere else**: lamps, bottom row, speed-limit sign, map, and the stock dials' parts under our collar.

The bench shows none of that today. `bench/page.html` `drawStockCluster()` is a rough placeholder of two polylines and a blue box.

**The job:** build a **live simulation of the stock G20 Comfort cluster for the bench.** It is drawn under the theme's layers, and the parts BMW draws over a custom theme are drawn over them. With "backdrop" and "car view" on, the bench must look **the way the owner would see it on their own cluster.** That holds at rest and while driving the bench's demo, and it holds for `wb_dials`, `wb_comfort` and with the app off.

This simulation is **bench only.** Nothing from it goes into the app, the layouts or the car. On the car it would cover BMW's real lamps.

## 2. Hard rules

1. **Do not edit** the following. You may read them and run the bench.
   - `shared/`
   - `apps/`
   - `design/gen_6wb.py`
   - `kit/`
   - `tools/bake_scene.py`, `bake/src/P*`, `bake/src/C*`
2. **The only bench edits allowed** are the hook (§5) in `bench/page.html` and a static route in `bench/server.js` that serves `bench/g20/` (GET only, inside that folder, no `..`). Keep those edits small, marked and commented. Everything else is new files.
3. **Where new files go:**
   - The simulation: `bench/g20/` (JS, its assets, its manifest).
   - The bake code: `bake/src/G20/`.
   - Helper tools: `tools/g20sim/`.
   - Reports: `docs/`.
   - Scratch: `bake/work/g20sim/` (git-ignored).
4. **Git:**
   - Do not `git push`, and do not commit on `main`.
   - Each package commits to a local branch `g20sim/<package>`. The lead merges them locally.
5. **The photos are third-party evidence, not material** (`reference/`, `bake/work/` are git-ignored).
   - No photo pixels go into `bench/g20/`. Everything shipped there is our own drawing (procedural or hand-built raster/vector), fitted to the photos, as in the 6WB bake (`docs/AGENT-BRIEF-bake-6wb.md` §2.4).
   - No BMW fonts: use a free font with the closest metrics (Arimo, Inter, Barlow and the like) and say which one and why.
6. **No guessing.** Where the evidence is missing (a needle's travel, a lamp never seen lit, a state never photographed), write `evidence: weak|none` in the manifest and the report. Do not invent detail silently.
7. **Tooling:**
   - macOS has no `timeout` command.
   - Run Python as `UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python ...`.
   - For headless Chrome, add `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000 --window-size=1920,720`.
     - It sometimes hangs: run it in the background, poll for the file, then `pkill -f "Chrome.*headless"`.
   - Only one bench at a time (`node bench/server.js f30_cluster`, port 8078), and `rm -rf dist bench/.data` before each start.
   - Bench API:
     - POST `/drive {value: 4|1|7}` sets Comfort, Sport or Eco.
     - POST `/setting {key, value}` sets an app setting, for example `{"key":"inComfort","value":"wb_dials"}`.
     - POST `/signals {mode, values}` sets the signals.
8. **Size:** keep `bench/g20/` under 12 MB. It is in the repo but not in the app package.

## 3. What exists (start here)

- **The overlay map,** `design/overlay/` (read its `README.md` first):
  - `g20_comfort.json`: 38 G20 elements. Each has a polygon and bbox in panel px, colour, per-photo states, group (`telltale`, `bottom-row`, `assist-message`, `map-nav`, `structure`, `overlay`), `relation` to a custom theme (`over` / `under` / `gone` / `unknown`), evidence and safety.
  - `schematic/*.svg`: a first generic redraw of each element. Improve these; do not trust their detail.
  - `constraints.json`: HOOD, BLACK_BOX, BELT, PARK_LAMP.
- **Reports:** `docs/OVERLAY-REPORT.md` (the categories and how they were decided) and `docs/OVERLAY-PLAN-DIALS.md` (the `wb_dials` layout: cut y 656, the collar, the windows).
- **The photos rectified to panel px:** `bake/work/overlay/rect/08…14.png` with `H.json` (rms ~1 px), made by `tools/overlay/rectify.py`. The photos themselves are in `reference/g20/`:

  | Photo | What it shows | Use it for |
  |---|---|---|
  | **08** | Stock theme just after start-up, at night. Every lamp of the start-up check is lit, plus the map and the "ready to drive" check-control message. | Lamps lit; the stock layout with the app off |
  | **09** | Stock theme by day, with the map | Day colours; second positions |
  | **10** | Our transparent calibration grid over the stock theme | Panel coordinates; the theme-connected look |
  | **11, 12, 13** | Our opaque themes on the car | What BMW draws over us |
  | **14** | Our theme connected, but only our text drew | **BMW's alternate layout while a custom theme is connected**, seen whole. The mode label and the gear move to the bottom row, the black area appears, and there is no centre COMFORT PLUS. This is the master reference for the theme-connected state. |

- **The 6WB bake as a precedent:** `docs/AGENT-BRIEF-bake-6wb.md`, `docs/BAKE-REPORT.md`, `docs/BAKE-P0-*.md`. They cover the method (fit procedural drawings to rectified photos, QC by SSIM and ΔE on ROIs, keep albedo, glow and highlight as separate layers) and the tools (`bake/src/P*`). Reuse the method and helpers; do not edit those packages.
- **The bench page:**
  - It composites the app's layers on a 2D canvas (`frame()`), with `drawStockCluster()` underneath when the "backdrop" checkbox is on and `drawCarView()` (hood, black area, belt, (P)) on top.
  - Live values arrive as `m.t === 'values'` and are kept in `lastValues`: `rpm, speed (km/h), oil, coolant, boost, gear, gLong, gLat, fuelL, range, ambient`.
  - The drive mode is set by `/drive`.

## 4. What the simulation must show

Two **states**, chosen automatically:

- **Stock:** the app is stopped, or the layout is `off`. BMW's full stock Comfort layout, as in 08 and 09.
- **Theme connected:** any layout on. BMW's alternate layout, as in 14:
  - `gone` elements are not drawn (`assist.mode_label_centre`, `assist.gear_centre`, `structure.tacho_info_line`);
  - the black area is drawn;
  - the mode label and the gear are in the bottom row.

Under the theme's layers, the `under` and `unknown` elements:

| What | Live from |
|---|---|
| The stock speedo and tacho: frames, the red-orange inner glow, ticks, numerals 0…260 and 1…7, the rev band, the stock fuel and oil minis | Static |
| The stock speed pointer and rev pointer | `speed`, `rpm` |
| The fuel and oil-temperature mini needles | `fuelL` (65 L tank), `oil` |
| The digital speed "0 km/h" | `speed` |
| "1/min x1000", OFF, COLD | COLD from `oil` < 40 °C (`evidence: weak`, say so) |
| Bottom row: the range with its pump icon | `range` |
| Bottom row: the clock | Local time |
| Bottom row: the street name | A fixed string |
| Bottom row: the outside temperature | `ambient` |
| Bottom row: COMFORT PLUS / SPORT / ECO PRO | The drive mode |
| The speed-limit sign | A bench control: none or 30…130 |
| The check-control panel with its "i" | A bench control: none, or "ready to drive" as in 08 |
| The map region | **Our own synthetic street map** (procedural roads, never BMW's), with the red position arrow |
| Telltales: the left column (brake, TPMS, ABS, DSC), the right column (AUTO H, steering), check engine, DSC OFF, low beam, the belts and airbag group | A bench lamp panel (§5) |

Over the theme's layers, the `over` elements:
- the (P) parking-brake lamp;
- the driver's belt lamp;
- the bottom-row gear letter (P/R/N/D/S from `gear` and a bench control);
- the black area (theme-connected only; it takes over `drawCarView`'s black box when the simulation is on).

**Stock pointers in motion are not photographed** (risk 1 in `docs/OVERLAY-PLAN-DIALS.md`). Derive their travel from the scale geometry: on the G20 the pointer runs along the scale's polygon, not round a pivot, and its glow follows it.
- Mark this `evidence: weak`.
- Make the model's parameters easy to correct once the owner's photo at about 50 km/h and 2000 rpm arrives.
- Report where the pointers pass relative to y 656 and our collar.

Brightness, colour and glow must match 08 and 14 (night) and 09 (day) as well as the 6WB bake matched its references. Pick night as the default look and offer day as a toggle.

## 5. Interface (fixed, so the packages can run in parallel)

**`bench/g20/g20sim.js`** is a plain browser script (no build) that defines `window.G20Sim`:

```js
G20Sim.init(base)            // -> Promise; loads bench/g20/manifest.json and its assets from `base` ('/g20/')
G20Sim.drawUnder(ctx, s)     // ctx: the bench's 1920x720 2D context; draws everything BMW draws under a theme
G20Sim.drawOver(ctx, s)      // draws what BMW draws over a theme (after the app's layers)
G20Sim.lamps                 // [{ id, name, group }] from g20_comfort.json, for the bench's lamp panel
```

`s` (the state):

```js
{ themeConnected: bool, values: lastValues, drive: 'comfort'|'sport'|'eco',
  lamps: { [elementId]: bool }, limit: null|30..130, ccMessage: null|'ready', gearLetter: 'P'|'R'|'N'|'D'|'S',
  time: Date, day: bool }
```

**The hook in `bench/page.html`** (package A writes it):
- In `frame()`, when the backdrop is on and `view === 'panel'`, call `G20Sim.drawUnder` instead of `drawStockCluster()` (keep `drawStockCluster` as the fallback if `G20Sim` failed to load).
- After the layers and before `drawCarView()`, call `G20Sim.drawOver`.
- Add a small "G20" control group:
  - lamp presets: `start-up check` (everything lit in 08), `driving` (none), `custom`;
  - one checkbox per lamp;
  - the limit sign;
  - the check-control message;
  - the gear letter;
  - day / night.
- The URL flags `?g20=startup|driving` and `?day=1` set these at load time, for headless screenshots.
- Redraw on every `values` message (the pointers move).

**`bench/g20/manifest.json`** lists every asset (`id`, `file`, `x`, `y`, `scale`, `z`, `kind`: albedo | glow | highlight | icon | font, `evidence`, `sources`) in the same spirit as the 6WB `bake/manifest/*.json`.

## 6. Accuracy and QC

- **Geometry:** every element within 2 px of `g20_comfort.json` (or of a re-measurement on the rect photos, which you then report).
- **Look:** an A/B sheet per photo with SSIM and ΔE on ROIs, as in the 6WB bake's QC:
  - simulation (stock state, 08's lamps) vs rect 08;
  - simulation (theme connected, our `wb_comfort` text only) vs rect 14;
  - day vs rect 09.

  Report the numbers per element group, and say why wherever SSIM < 0.85.
- **The owner's question:** a headless bench screenshot of `wb_dials` over the simulation, at rest and at 50 km/h and 2000 rpm, with `start-up check` and with `driving`. Put them in `docs/g20sim/` and in the report. These are what the owner compares with their cluster.

## 7. Work packages and parallelism

```
A hook + stub ───────────────┐
B static bake (dials) ───────┼──> E assemble, QC, report
C icons + text ──────────────┤
D live model (pointers, map) ┘
```

**A, B, C and D run in parallel** from the start. E comes last.

- **A: hook, stub, controls.**
  - Write the hook and the controls (§5), the static route in `server.js`, and a stub `g20sim.js` that draws `g20_comfort.json`'s polygons in their colours. The stub already beats today's placeholder.
  - **Accept:** the bench runs with the stub; every control works; headless flags work.
- **B: static bake of the stock dials (`structure.*`).**
  - Frames, inner glows, ticks, numerals, the rev band and the minis, as albedo, glow and highlight layers fitted to rect 08 and 14 (night) and 09 (day).
  - Code in `bake/src/G20/`, output in `bench/g20/`.
  - **Accept:** the §6 numbers for the `structure` ROIs; the manifest.
- **C: icons and text.**
  - All telltales (lit and unlit look), the belts and airbag group, the pump icon, the sign, the check-control panel and "i", the bottom row's text styles (font, size, weight, colour, positions), the digital speed, the labels.
  - Start from `design/overlay/schematic/*.svg`, redrawn cleanly.
  - **Accept:** 2 px geometry; colours per state measured on 08 and 09.
- **D: the live model.**
  - Pointer travel along the stock scales (§4, weak) and the mini needles.
  - The synthetic map: procedural streets inside `map.region`, the arrow, a slow drift with `speed`.
  - The two states, and what moves where between them.
  - **Accept:** the pointers hit the numerals' positions at their values (0/100/200/260 km/h, 1…7 × 1000 rpm) within 2 px; the parameters live in one table.
- **E: assemble, QC, report (lead).**
  - Wire B, C and D into `g20sim.js` behind the §5 interface.
  - Run §6 and write `docs/G20SIM-REPORT.md`: what is drawn, the evidence per element, the QC numbers, the open points (stock pointers in motion; the night and day brightness of the LCD), and how to use the controls.

## 8. Assumptions (the owner may correct these)

- Comfort only. Sport and Eco Pro layouts of the G20 come later.
- The theme-connected layout is the one in photo 14 for every custom layout (`wb_dials`, `wb_comfort` and the rest).
- Lamp states are bench controls, not signals. The app does not read them, and the car's signals for them are not mapped.
