# Overlay map: stock G20 cluster vs our 6WB theme (panel, Comfort)

These files describe, element by element, what BMW's stock G20 cluster draws on the 1920×720 panel and what our 6WB Comfort theme draws, so that a design can keep as many of BMW's own indicators as possible. They are meant to be read as-is by a design agent or a design tool. The constructor (`tools/overlay/constructor/`) is the human's tool for producing and checking `plan.json`.

All coordinates are **panel px**: x right, y down, 1920×720, the same as `shared/visible.js`. Boxes are `[x0, y0, x1, y1]` with exclusive right/bottom edges. Polygons are `[[x, y], ...]`, closed. One JSON Schema (`schema.json`) covers every file; each file's `kind` selects its definition. Validate with:

```sh
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with jsonschema --with pillow python tools/overlay/validate.py
```

| File | `kind` | What it is | Written by |
|---|---|---|---|
| `g20_comfort.json` | `g20-elements` | Every element the stock G20 Comfort cluster draws, with its relation to a custom theme | catalogue + relations (packages E, F) |
| `wb_comfort.json` | `wb-elements` | Every layer and live widget of our 6WB Comfort, with masks | `tools/overlay/export_wb.py` |
| `plan.json` / `plan.default.json` | `plan` | Decisions per G20 element, moves of our elements, the derived holes and keep-clear boxes, the conflicts at save time | the constructor |
| `constraints.json` | `constraints` | Platform limits, the hood line, what BMW draws over any theme | by hand, from `shared/visible.js` and measurements |
| `masks/<id>.png` | — | 1× alpha of our own layers, exactly the element's bbox | `export_wb.py` |
| `schematic/<id>.svg` | — | Our own simple redraw of a G20 element (no BMW artwork) | package E |
| `sample/` | — | Small hand-made data for developing the constructor | package A |

No photo pixels are stored here. The photos (`reference/g20/`) and their rectified versions (`bake/work/overlay/rect/`) are third-party evidence, git-ignored, and loaded only at run time by the constructor when present.

## 1. The four relations

Every G20 element has one `relation` to a custom theme on the panel:

| `relation` | Meaning | What a design does |
|---|---|---|
| `over` | BMW draws it **on top of** any custom theme. | Nothing hides it. Keep that area free of anything important. The decision is always `keep-clear`. |
| `under` | BMW still draws it while a custom theme is up, **beneath** the theme. | Choose: `cover` it (our opaque pixels hide it), `reveal` it (cut a see-through hole in our background, like the map hole), or `redraw` it ourselves. |
| `gone` | Only the stock theme draws it. With a custom theme connected it is not drawn at all. | `drop` it or `redraw` it ourselves. |
| `unknown` | The photos do not settle it. | Treat it as possibly `under`: do not rely on it being visible. A photo protocol step (in `docs/OVERLAY-REPORT.md`) settles it. |

`evidence` (`strong` / `medium` / `weak` / `none`) says how sure the relation is, and `relation_basis` lists the photos it rests on: for each, whether the element was `seen` at its spot, whether `our_pixels_opaque_there`, and whether the lamp was plausibly lit (`lit_expected`). `states` records each lamp's state per photo: a lamp that is not lit in a photo is **not** evidence that it is not drawn.

`safety` is `critical` (a warning the driver must see: brake, ABS, DSC, airbag, seat belts, tyre pressure, engine/check, oil, coolant, turn signals, high beam, parking brake), `info` or `cosmetic`. A `critical` element that is `under` or `gone` must end up `reveal`ed or `redraw`n; a plan that leaves one hidden is an error.

Groups: `telltale` (lamps), `bottom-row` (range, clock, temperature, belt/airbag lamps, message line), `map-nav` (map, route arrow, marks), `assist-message` (speed-limit sign, check-control panel, "i" markers, mode label, gear letter, digital speed and other non-lamp items), `structure` (the stock dials, as a ghost for context only), `overlay` (things BMW draws only while a custom theme is up, such as the black area).

## 2. Our elements

`wb_comfort.json` has one element per baked layer of `bake/work/P9/stack_comfort.json` (`source: "baked"`, id `C<n>.<layer>`) and one per live widget of `apps/f30_cluster/hud/layouts/wb_comfort.json` (`source: "live"`, id `w.<widget>`). `z` orders them (live widgets are layout z + 100: they sit above the baked scene). `mask` is the 1× alpha over exactly `bbox`; without a mask the bbox is the shape. `anchors` group elements so that a dial moves or scales about its centre (`speedo`, `tacho`, `mini.fuel`, `mini.oil`, `window`). `drawn_on_car: false` marks what the car does not draw with the default settings: a baked layer that is not packed into any scene texture (`C10.panel.background`: WBBACK draws the background itself; `C7.bar.range`), or a live widget toggled off by default (`toggle: "!baked"`). Such elements raise no conflicts. Baked layers and the live widget that draws them on the car (for example `C1.*` and `w.speedo`) describe the same pixels twice: the baked masks give the detailed shape, the widget the whole disc. The background element `w.bg` carries the existing see-through map hole (`hole.when: "stockMap"`, a user setting).

## 3. The plan and how conflicts are computed

`plan.json` stores, per G20 id, a `decision` (+ notes, + `redraw_at` for redraws); per 6WB element or anchor, a move (`dx`, `dy`, `scale` about the anchor centre, `hidden`, `z`, `opacity`); the derived `holes` (one per `reveal`: the element bbox plus `margin`, with a corner `radius`, editable) and `keep_clear` boxes (one per `over` element); and `conflicts` at save time. `based_on` holds the sha256 of the two element files it was made against.

**Default decisions** (what `plan.default.json` uses): `over` → `keep-clear`; `critical` and `under` → `reveal`; `critical` and `gone` → `redraw`; everything else → `cover`.

`settings.stockMap` records the "BMW's map in the middle" setting the conflicts were computed with.

**Shapes.** A G20 element's shape is its `poly` if present, otherwise its `bbox`. One of our elements' shape is its mask (a pixel counts when alpha ≥ 64/255) if present, otherwise its bbox, after the plan's transforms (anchor, then element). Hidden elements, `kind: "hole"` elements and `drawn_on_car: false` elements have no shape. Every background element (`kind: "background"`) has all the plan's holes cut out, and also every background's own `hole` (the WBBACK map hole) when `settings.stockMap` is on; a hole rect is rounded outward to whole px. Overlap is counted in whole panel pixels: a pixel counts when its centre (x + 0.5, y + 0.5) is inside both shapes; `overlap_pct` is the overlap as a % of the G20 element's area.

**Rules** (one conflict per G20/6WB pair and rule; `structure` elements are context only and raise none; the constructor's show/hide, lock and opacity are view-only — only the plan's `hidden` removes a shape):

| Severity | `rule` | When |
|---|---|---|
| error | `content-under-over` | an `over` element overlaps any of our elements |
| error | `critical-covered` | a `critical` element whose relation is `under` or `unknown` overlaps our element and its decision is neither `reveal` nor `redraw` |
| error | `gone-critical-not-redrawn` | a `critical` `gone` element whose decision is not `redraw` (`wb` is null) |
| warning | `hole-cuts-content` | a `reveal` hole overlaps one of our non-background elements (the hole would have to cut that content too) |
| warning | `redraw-not-placed` | decision `redraw` with no `redraw_at` (`wb` is null) |
| info | `under-covered` | a non-critical `under` element overlaps our element and its decision is not `reveal` |
| info | `unknown-covered` | a non-critical `unknown` element overlaps our element and its decision is not `reveal` (it may be `under`) |

## 4. Worked example: one telltale per relation

*(Filled in from the real catalogue by package G.)*

## 5. Platform facts

See `constraints.json`: at most 8 layers per connection and 4 connections; 16 MiB pixel memory service-wide (w·h·8 per image, shared with other apps); at most 16 assets per client and 32 in total; at most 32 uniforms per effect layer, and every `sampler2D` must have an asset bound or the car does not draw the layer; BMW draws the black area, the gear letter and the driver's belt lamp over us; the hood hides the panel above the `hood` polyline.
