# Twin Dial engine contract (package B, round 2)

Owner: package B (`shared/shaders.js` `tdial` / `tdback`, `shared/hud.js` widget paths, `shared/layouts.js` type table,
`shared/hud_themes.js` theme `twin`). Authority: `docs/twin-dial/SPEC.md` (rev 2). Everyone else builds to this file.
Published 2026-11-17; later changes are **additive only** and are written in the changelog at the end.

Every number is a panel px (1920 x 720) unless it says "layer px" (panel px minus the widget's own x, y).

## 0. What is new

| Thing | Where | Who uses it |
|---|---|---|
| widget type `tdial` (effect layer, one per dial) | `shared/hud.js`, `shared/shaders.js` `tdial` | C writes it into `twin.json`; A2 supplies the face |
| widget type `tdback` (effect layer, three parts) | same, `tdback` | C; A2 supplies the mask |
| layout theme `"theme": "twin"` | `shared/hud_themes.js` | C (text colour roles), D (severity colours) |
| message state object `this.twinCc` | `shared/hud.js` | D writes it, B reads it |
| signal names `reserve`, `coolant` for `_raw()` | `shared/hud.js` | C's `app.json` must subscribe the fields |
| layout type table entries `tdial`, `tdback` | `shared/layouts.js` | everyone (a layout with them validates) |

`f30_cluster` is not touched: every new path is behind `w.type === 'tdial' | 'tdback'` or `this.twinLayout`
(true only when a shown widget has one of those types).

## 1. Layout file

`{ "schemaVersion": 2, "name": "twin", "theme": "twin", "widgets": [...] }`. Widgets use the usual `id, type, x, y, w, h,
class, z, conn, toggle`. Layer budget is the SPEC's (§13.2); the engine does not change it.

### 1.1 `tdial`

```json
{ "id": "dial_tach", "type": "tdial", "kind": "tach", "x": 70, "y": 90, "w": 620, "h": 570, "conn": 0,
  "centre": [380, 400], "R": 300,
  "face": { "tex": "face_tacho", "x": 72, "y": 90, "w": 616, "h": 560 },
  "sweep": 125, "scaleMax": 8000, "redline": "setting", "restDeg": -135,
  "shadow": true,
  "bar": { "y": 619, "x0": 254, "x1": 506, "h": 7.5, "segs": 5, "gap": 4,
           "signal": "fuel", "min": 0, "max": 1, "reserve": "reserve" } }
```

| Field | Meaning |
|---|---|
| `kind` | `"tach"` or `"speed"`. Picks the source (two compiled sources, `shaders.tdialFor(kind)`), the signal and the needle law |
| `x y w h` | the layer rect. **Tachometer [70, 90, 620, 570], speedometer [1230, 90, 620, 570]: bottom edge 660** (gear gap and belt group are never touched) |
| `centre`, `R` | dial centre in panel px, R in px (380,400 / 1540,400; 300) |
| `face` | `{ tex, x, y, w, h }`: scene texture name (`apps/twin_dial/hud/scene/<tex>.json`, R8) and the **panel-px box its pixels cover, 1:1** (616 x 560; the position is A2's: the dial centre must sit at the same place in the face as in the layout, the example is only an example). The box must lie inside the layer rect |
| `sweep` | degrees either side of 12 o'clock; 125 |
| `scaleMax` | tach only: rpm at +sweep, 8000 |
| `redline` | tach only: `"setting"` = the `redline` setting (`_redline()`, default 6500) or a number |
| `restDeg` | tach only: where the needle rests while the engine is off ("OFF" label); -135 |
| `shadow` | needle shadow (SPEC §4, hypothesis), default `true`; `false` drops it |
| `bar` | the fuel / coolant bar under the dial (below); optional |

**Signals read** (`this._raw(name)`): tach `rpm`; speed `speed` (km/h, the same value as the digital speed). Needle laws, in JS:

* tach: `deg = -sweep + 2 sweep * rpm / scaleMax`, clamped to [-sweep, +sweep]. No valid rpm (or < 150): the car's
  "ready" state (`_restFrac` logic: VehicleCondition 8/10, MSA stopped, engine running) -> `-sweep` (0 rpm), else `restDeg`.
* speed: piecewise, `step = sweep / 5`: `v <= 100: deg = -sweep + step * v / 20`, `v > 100: deg = step * (v - 100) / 40`
  (0 at -125, 100 at 0, 300 at +125), clamped to [-sweep, +sweep]; no value -> `-sweep`.
* The needles use the 0.7.14 smoothing path (`_isNeedle`), always on in twin_dial (`needleSmooth` is not offered there:
  with no such item the setting reads as on). Quantised to 0.02 degree before a uniform is sent.

**Face: what A2 must bake (the shader's reading of the R8 file).**
Value = **sRGB code of the intended grey (code / 255), day look, `bandGain` 1.0**, one byte, `1 = white`.
Not linear light: the dark band needs the code precision. Concretely:

* ink (white numerals, ticks, bezel, rim, labels, icons) = 255 (anti-aliased edges as usual);
* band: `Y = 0.010 exp(7.5 (rho - 0.60)) exp(-0.85 (cos theta - 1))` (linear), no tint (the shader adds the cool tint
  `(0.96, 1.0, 1.08)`), converted to sRGB code, over rho 0.580..0.893 and |theta| <= 144 deg;
* tick strip: rho 0.893..0.940, |theta| <= 144 deg, flat linear 0.25 (code ~137), ticks drawn white (255) over it;
* the near-black major lines across the band: code of (6/255) over rho 0.580..0.893 (they are *dark ink on the band*; keep them in the face);
* empty bar segments (code 46..50) and the bar end labels, unit labels, icons, "OFF": in the face as the mockup draws them;
* **no red anywhere, no wedge, no needle, no fill**: red is the shader's;
* everything outside the bezel is 0.

The shader separates "ink" from "band" by value (`ink = smoothstep(0.70, 0.85, code)`), so no band texel may exceed
code 0.70 x 255 = 178 at `bandGain` 1.0 (inside the sweep the band is <= 158, the lit ends past it reach 173; the strip is 137). Region
constants the shader uses (rho in R, theta in degrees clockwise from 12): bezel rho > 0.97; inner rim 0.52..0.57;
band and strip rho 0.580..0.940 with |theta| <= 144.5; tick zone 0.893..0.940; numerals/everything else "white". A2's
region JSON beside the face is informational (the shader does not read it) but must agree with these.

**Shader work, in the order it is done** (so A2 and E can reason about pixels): face sample -> linear light ->
band gain and cool tint on band/strip texels (not on ink) -> red wedge (tach) replaces the band under it, red ink
(ticks from the redline, numerals from the redline rounded up to a thousand) -> needle shadow on the band -> night
multiplier per material -> needle -> bar fill -> sRGB code. Alpha = 1 inside a disc of 1.0128 R (anti-aliased), 0 outside:
BMW's lamps 3.7 px outside the ring stay visible; the disc is opaque black where the face is black.

**`bar`**: `y` centre line (619), `x0`..`x1` (254..506 / 1394..1646), `h` thickness (7.5), `segs` 5, `gap` 4 px between segments (segment i spans `x0 + i (sw + gap) .. + sw` with `sw = (x1 - x0 - (segs - 1) gap) / segs`; the face's empty
segments are the same geometry, A2 draws them from the same numbers; a segment's height is `h`, centred on `y`), `signal` (`"fuel"` 0..1 = litres / `tankLitres`; `"coolant"` deg C), `min`, `max` map
the signal to a fill 0..1 (fuel 0..1, coolant 50..130), partial segments fill proportionally from the left. Fill colour
white; the **flagged segment is red**: tach `reserve: "reserve"` (signal `reserve` truthy -> segment 0), speed `hotAt: 120`
(signal >= 120 -> the last segment). No valid signal: fill 0, no red. The shader draws fills only (the empty segments are in the face).

### 1.2 `tdback`

```json
{ "id": "bg_l", "type": "tdback", "part": "L", "x": 0, "y": 0, "w": 1380, "h": 720, "conn": 0, "z": -1,
  "holes": [[497, 660, 688, 720], [..]],
  "tab": { "rect": [618, 127, 1302, 172], "seps": [744, 812, 1168, 1237], "rule": [171.2, 172.7],
           "ramp": [0.002, 0.16], "highlight": [744, 812] },
  "rules": [ { "x0": 741, "y0": 295.2, "x1": 1180, "y1": 296.7, "role": "rule" },
             { "x0": 629, "y0": 612.4, "x1": 1292, "y1": 614.6, "role": "rule",
               "ours": { "y0": 611, "y1": 615, "x1": 1291, "role": "severity" } } ],
  "panelMask": { "tex": "panel_mask", "x": 694, "y": 592, "w": 536, "h": 112 } }
```

| Part | Rect (C) | Carries |
|---|---|---|
| `"L"` | [0, 0, 1380, 720] | holes, tab bar, rules, fallback window (mask) |
| `"RT"` | [1380, 0, 1920, 660] | holes only |
| `"RB"` | [1460, 660, 1920, 720] | holes only |

* Opaque black everywhere except the holes and the window. `holes`: panel-px rects `[x0, y0, x1, y1]`, **at most 8 per layer**,
  only the ones that intersect the part's rect (C intersects them; the engine also ignores a rect that does not). Half-open,
  pixel-exact (anti-aliased only for fractional edges). Belt group [497, 660, 688, 720] is one of `L`'s. Lamp holes are
  `design/twin-dial/vg/layout.json` `keep_outs.telltales_holes.rects_plus_3px`.
* `tab`: `rect` (the bar), `seps` (the four x), `rule` = `[y0, y1]` of the white rule under the bar (spans `rect` x), `ramp` = `[top, bottom]`
  **linear light**, vertical, neutral, `highlight` = `[x0, x1]` of the warning cell (SPEC §6.1). Separators: black px column at `x`, then a grey (96/255) column at `x + 1`, full bar height. Paint order is the mockup's: ramp, highlight, separators, rule (the rule over the highlight takes the severity colour inside it).
* `rules[]` (at most 4): panel-px rect with fractional y (coverage anti-aliased), `role` `"rule"` (231) | `"tab"` (237) | `"severity"`. `ours` is the rect/role it takes **while `twinCc.state === 'ours'`** (omit a key to keep it). Only `L`.
* `panelMask` `{ tex, x, y, w, h }`: R8 scene texture at the panel-px box `x, y, w, h`, 1:1. **Byte 255 = see-through (BMW's panel shows), 0 = our black**, anti-aliased bytes in between. (If A2's bake is the other polarity, set `"maskKeep": true` in the widget: then 255 = keep our black, as the strip's msg lane.) It is sampled only while `twinCc.state === 'window'`.
* Colours are the SPEC's (§7.1); severity colours: red 176 7 30, amber 240 170 10, green 59 155 26, grey 231; all passed through the night multipliers by the engine.

## 2. Message state (D owns, B reads)

`this.twinCc = { state: 'none' | 'window' | 'ours', severity: 'red' | 'amber' | 'green' | 'grey' | null }` on the HudApp.
`severity` maps from ccList `cCColor`: RED -> red, YELLOW and ORANGE -> amber, GREEN -> green, WHITE and DEFAULT -> grey.

* `tdback.L` reads it: `window` opens the mask hole; `window` or `ours` (a message shows) lights the highlight cell in the severity colour and
  colours the rule under it; `ours` switches each rule with an `ours` entry to it. `none` or null severity: nothing.
* Absent object = `{ state: 'none', severity: null }`. B ships it as that default.
* **To change it, D assigns `this.twinCc` and calls `this._twinSync()`** (B's method: resends exactly the uniforms that
  depend on it, nothing if nothing changed, no layer is made again; safe to call from a signal handler). The 50 ms tick
  also calls it, so a missed call heals within a tick.
* The plate and the bottom-row sheet are D's `"cc:"` image layers; B does not draw them.

## 3. Settings, signals, night

Settings the engine reads (all optional, defaults in brackets): `redline` (6500), `nightLook` (`auto` | `on` | `off`; `auto`),
`bandGain` (1.0, 0.6..1.7). `redline` and `bandGain` change **in place** (uniforms, no rebuild); so does `nightLook` and the car's day/night.

Signals via `_raw()` (the app's `app.json` subscribes the fields; check_signals must pass):

| `_raw` name | Value | Source |
|---|---|---|
| `rpm`, `speed` | as f30_cluster | existing |
| `fuel` | 0..1 | `_tankLitres()`: `tankLitres` setting, else `config.tankLitres` (C sets 59) |
| `reserve` | 1 / 0 / null | **new:** `KombiIF.statusRangeTankStatus.statusFluidLevelFuelTankSpare` (1, `"AKTIV"`, `"ACTIVE"` = on; null = no value). The existing handler also reads it; f30_cluster ignores it |
| `coolant` | deg C or null | the kit's `car.data().coolant` (CDS.statusEngineTemperature), as f30_cluster's `{{coolant}}` |

**Night** (SPEC §7.2) is `this.nightOn` = `nightLook` setting (`on` -> true, `off` -> false, `auto` -> the car's day/night via
`_isNight()`, else the sun). It is applied as one transform: `tdial` gets per-material multipliers (uniforms `u_n0..u_n2`),
`tdback` gets night-multiplied colours computed in JS, the text sheets get `twinNightTheme(theme)` (each role colour
x its SPEC multiplier in linear light). No layer is rebuilt. By day all multipliers are 1.

**Theme `twin`** (roles for `text` widgets' `color`), day sRGB: `fg` 255,255,255; `dim` 227,227,227 (secondary text, units);
`hot` 218,13,43 (red); `ready` 59,155,26 (green); `amber` 240,170,10; `grey` 111,111,110; `rule` 231,231,231; `bg` 0,0,0; plus the
usual `line`, `track`, `accent` fall-backs. Night multipliers (linear light): fg .80, dim .75, hot .85, ready .75, amber .85, grey .55, rule .70.
Use `"theme": "twin"` in the layout.

## 4. Budget (what B tests, `bench/test-twin-budget.js`)

Per layer: `tdial` <= 8 KB after `compact()` (two sources, one per kind), `tdback` L <= 6 KB, RT/RB far smaller; <= 32 uniforms; every
`sampler2D` bound (face, mask; `_bindBlanks` covers the rest); `highp` for every px-scale length. Per connection <= 8 layers;
steady pixel memory <= 6 MiB, peak <= 8 MiB; no layer rect meets [1380, 660, 1460, 720].

## 5. Hooks other packages may need

* C: nothing in `shared/hud.js`; `layouts.js` already knows the two types. Text tokens are C's.
* D: `this.twinCc` + `this._twinSync()`; `twinNightTheme` is applied to `this.theme`, so the plate sheet's colours follow it.
* E: the layers appear on the bench as ordinary effect layers; scene textures are R8 assets (`face_tacho`, `face_speedo`, `panel_mask`).
* F: nothing.

## Changelog

* 2026-11-17 initial publication.
* 2026-11-17 (B, after A2 landed; no name or uniform changed): the real face boxes are tacho [72, 90, 688, 650] and speedo
  [1232, 90, 1848, 650] (dial centre at face px (308, 310)) and the mask box [694, 592, 1230, 704]; the ink threshold is
  `smoothstep(0.70, 0.85, code)` (A2: the lit ends past the sweep reach code 173); the READY multiplier is 0.75 (SPEC 7.2;
  the first text said 0.80); the engine's own fallback window (no mask in the layout) is A2's box. The face decode is
  compatible with `tools/twin-dial/face_shade.py` (tint, gain, wedge ink): the shader works in linear light and finds ink
  over the wedge by subtracting the band formula, A2's reference by a code threshold; the two agree to a few codes at ink edges.
* 2026-11-18 (B1, Twin Dial 0.1.1, SPEC-R3; additive except where it says "changed"):
  * **`tdial`**: the red wedge is gone (**changed**): the tachometer's red zone is an arc on the bezel (rho 0.990-1.010, sRGB (210, 20, 21) less the
    black floor) from the redline to `u_red.w`, now **143.6** (was the sweep, 125; hud.js `TW_ARC_END`); `u_red.x` is still 999 on the speedometer.
    New uniforms `u_lim` (marker deg; state 0 none / 1 limit / 2 conditional, hollow, strip not red / 3 hollow + red strip; warn; strip mode
    0 marker only / 1 L1 / 2 L2 / 3 L3) and `u_cru` (marker deg; state 0 / 1), both zeros on the tachometer; the engine reads `this.twinLim =
    { deg, state, warn }`, `this.twinCru = { deg, state }` and `config.limit.strip`, and `this._twinMarks()` resends them (nothing else).
    Band tint now 0.76 : 1 : 1.064 (**changed**), the tick strip has its own tint (from its sRGB (98, 109, 111)) and a bright line (115, 124, 126);
    the band, strip, rings and numeral shadow are the face's (re-baked, same names and size). The u_n2.x multiplier ("wedge") is unused; u_n2.y
    (green) now also dims the cruise marker, u_n1.w (red) the limit marker and the arc, u_n0.w (strip) the red strip. A red tick or numeral
    takes its antialiased edge earlier (no grey halo); the bezel is all ink. Size 5.7 KB after compact() (was 4.5).
  * **`tdback` part L**: the highlight cell is now the **selected tab**, filled in its own colour (**changed**; it was lit by the message's
    severity): `this.twinTab` (1..5, default 1) picks one of five cells cut by the separators; uniforms `u_hi` (x0, x1, on), `u_hiC` (the fill's
    colour in linear light, black floor out, night x 0.75), new `u_hiR` (the rule under that cell, a code); fill law colour x ramp(y) / 0.16;
    the ramp has the cool tint (0.96, 1.0, 1.08); separators: a 2 px dark column [x-1, x+1) and a 1 px light line [x+2, x+3), code 84; the tab
    rule is 3 px (`tab.rule` [170, 173]) in code 230 (was 237). `tab.highlight` is no longer read. The severity still drives `u_win` and the
    rules' `severity` role; never the fill. New `u_map` / `u_mapF`: the map window (a soft box in the background, hole fraction = the smallest of
    the four edge ramps, rounded corner), driven by `this.twinMap` (null | "W1" | "W2"). Size 2.7 KB (was 2.0).
  * **hud.js**: `TW_NIGHT.amber` and the amber text role 0.85 -> 0.80 (SPEC-R3 6); `TW_NIGHT.tab` 0.75.
  * **Faces** `face_tacho` / `face_speedo`: re-baked (look B, SD's numeral shadow, three rings ending at 143.0 / 143.6 / 143.55, thin rim, strip + line,
    major lines 0.010 R, the tachometer's unit at (0, +0.40) R); the regions JSON has `red_arc` instead of `wedge`, `strip`, `strip_line`,
    `major_lines`, `numeral_shadow`, `hub`. Same files, same 616 x 560 R8, same pixel memory.
