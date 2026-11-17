# R2-B: the engine (tdial, tdback, night) of Twin Dial

Branch `twin-dial/r2-b`, from `twin-dial/r2`. Contract: `docs/twin-dial/ENGINE-CONTRACT.md` (published first; one additive
changelog entry since, below). Authority: `docs/twin-dial/SPEC.md` rev 2.

## What was built

| File | What |
|---|---|
| `shared/shaders.js` | `TDIAL` (4461 B after `compact()`, one source for both gauges) and `TDBACK` (L 1995 B, RT = RB 537 B); exports `tdial`, `tdback`, `tdbackFor(part)` |
| `shared/hud.js` | widget paths `tdial` / `tdback` (create, update, scene needs, shader choice), needle laws, redline, bars, night, `twinCc` + `_twinSync()`, `reserve` signal; every hunk marked `twin_dial`, one block of methods before `testShift()` (so package F's hunk will not collide) |
| `shared/layouts.js` | type table entries `tdial`, `tdback` |
| `shared/hud_themes.js` | theme `twin` (SPEC 7.1 roles); the "every theme's `hot` is the shift red" line now keeps a theme's own `hot` (no other theme defines one: unchanged for them) |
| `bench/test-twin-budget.js` | the budget and behaviour test (75 checks) |
| `bench/twin-fixture.js` | throw-away bench tree with a stand-in app (the contract's layout built by hand, image place-holders the size of C's sheets), used by the test and by the render tool; faces from `$TWIN_FACES`, else `apps/twin_dial/hud/scene` once A2 is merged, else drawn stand-ins |
| `tools/twin-dial/engine_render.py` | takes the engine's real scene off a bench and replays it on the GPU (tools/strip/O/render.py): pictures of seven states |

### How the engine works (short)

* **tdial**: the baked R8 face (sRGB code of the grey) is decoded in linear light; the band/strip texels get the cool tint and
  `bandGain`, ink stays white (`smoothstep(0.70, 0.85, code)`); tach only: red numerals and ticks by angle thresholds, the
  red wedge (fill, 3 px outline, radial edges) replacing the band under it with the face's ink kept (found by subtracting the
  SPEC band formula); the needle (SPEC profile, white, no cap, no glow) with the optional shadow; the bar's fills (white, the
  flagged segment red); night = per-material multipliers (`u_n0..u_n2`, all 1 by day). Alpha 1 inside a disc of 1.0128 R (BMW's
  lamps outside stay visible), 0 outside. 11 uniforms.
* **tdback**: opaque black, up to 8 holes, and in part L the tab ramp, separators, highlight cell, rule, up to 4 rules, and the
  mask-sampled fallback window. Night is applied to its colours in JS (no night uniforms). 14 uniforms. With no mask in the layout,
  the window opens as A2's whole box (more of BMW's panel, never less).
* **hud.js**: needle angle in JS (tach linear, speed piecewise, rest on `-125` when ready / `-135` OFF), through the 0.7.14
  smoothing; `redline`, `bandGain`, `nightLook`, the car's day/night and `twinCc` all change uniforms in place.
  `this.nightOn` for a twin layout is the `nightLook` setting (on/off) else the car's day/night, else the sun.

## Evidence

`node bench/test-twin-budget.js`: **75 passed, 0 failed** (17 static + 58 on a bench of its own, with A2's real faces and mask via
`TWIN_FACES=bake/work/twin-dial/pub/R2/A2`; the same test passed 75/75 earlier with the stand-in faces). On the bench:

* layers per connection 5 / 3 / 2 (limit 8), 10 layers, steady pixel memory 4.31 MiB (limit 6), peak across four layout switches 4.31 MiB
  (limit 8; the bench's 16 MiB enforcement on), no refusal or shader error in the log;
* every sampler bound, <= 32 uniforms and binds a layer (the bench itself refuses past 32), no layer rect meets [1380, 660, 1460, 720],
  both dial layers end at y 660, the belt hole is in part L only;
* needle laws read off the engine's own uniforms: rpm 4000 -> 0 deg, 8000 -> 125, 1000 -> -93.75, 6500 -> 78.1, past the scale clamps;
  speed 20 -> -100, 100 -> 0, 200 -> 62.5, 300 and 340 -> 125; engine off ready -> -125, ignition off -> -135 (OFF);
* bars: fuel 30/59 -> 0.508, coolant 85 C -> 0.438, reserve on -> segment 0 red, coolant 125 C -> segment 4 red, off again -> none;
* redline 6500 / 6000 / 7000 and `bandGain` 1.4 change in place (same layers, no second "layout built" line in the log); night on/off
  likewise, multipliers equal SPEC 7.2, ramp at 0.55 of its linear light;
* message state: window opens the mask (mask bound, `u_win`), the highlight and rule colours per severity (red 176 7 30, amber, green, grey),
  `ours` swaps in the 4 px rule, a message while night comes dims the cell, the end restores everything.
The values come off the bench's `scene` (what the engine really sent), so a broken feature fails a check.

Pictures (git-ignored): `bake/work/twin-dial/r2/B/render/{day,day_redline,night,night_ours_amber,day_window_red,day_ours_green,off}.png`.
`day.png` against the mockup (`1_clock.png`), the two dial annuli rho 0.56..1.02 (sans the bar row): mean abs difference 2.0 / 2.7 codes,
p95 11 / 5 (what remains: the hub texts the mockup has and the stand-in text widgets lack, sub-pixel needle edges, the wedge fill
now (78, 0, 0) = the G20 black-floor-corrected code the palette gives, the mockup uses (78, 2, 11)).

f30_cluster suites: see the end of this file.

## Decisions and deviations

* Colours are the palette's G20-corrected codes (red 218 13 43, wedge fill 78 0 0, severity red 176 7 30), as SPEC 7.1 says; the mockup
  uses the uncorrected ones.
* Wedge ink is separated by subtracting the SPEC band formula in linear light; A2's `face_shade.py` uses a code threshold (t0 0.54 / 0.52).
  Same result to a few codes at ink edges; not pixel-compared against `face_shade.py` (not run).
* Tick red threshold is the redline minus 0.6 deg, numeral red threshold is half a step before the centre of the redline rounded up to 1000.
* Shader is one source for both gauges (the speedometer sends `u_red.x = 999`); no day/night in two looks.
* `reserve` is read from the existing `statusRangeTankStatus` handler (member `statusFluidLevelFuelTankSpare`, 1 / AKTIV = on, 3 = none).
  C's `app.json` already subscribes that struct; nothing else is needed.
* Contract change after publication (additive/values only, logged in the changelog): face box y 90, mask box 694,592, READY night 0.75.

## Not verified / open (all hypotheses until the car)

* Nothing ran on the car: the KOMBI's acceptance of the sources (4.4 KB and 2 KB are far under the 8 / 6 KB targets, and smaller than
  anything the 6WB path sends), straight vs premultiplied alpha at the disc's edge (the disc is opaque black inside so both agree),
  fp16 `mediump` (only if the GPU lacks `highp`; the shaders ask for `highp` and every length is normalised by R).
* Night multipliers, the needle shadow and the band tint level are the SPEC's hypotheses.
* The bench cannot show the plate/bottom-row stepping aside (package D); in the pictures the image place-holders of the fixture sit on top of
  the window.
* `twinCc` is a plain object plus `_twinSync()`; D may replace it with a getter as long as `_twinSync()` is still called.
* `nightLook` for a twin layout shares the key with f30_cluster's `nightLook` (plain / amber / ice / red): not a conflict while the two
  apps have separate settings, but an f30 value in a twin app reads as `auto`.
* Package F's hunk in `hud.js` is the lead's merge; mine are separate hunks (constructor fields, `_nightDim`, `_nightTheme`, `_nightLive`,
  the settings listener, `_isNeedle`, `_sceneNeeds`, shader choice, `_create`, `_updateOne`, one block of methods).

## How to run

```
node bench/test-twin-budget.js [--static] [--keep]          # port 8202
TWIN_FACES=<folder with face_tacho.json face_speedo.json panel_mask.json> node bench/test-twin-budget.js
UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/twin-dial/engine_render.py   # port 8212
```

## Changed outside my files

`shared/layouts.js` (two type entries), `shared/hud_themes.js` (theme `twin`, the `hot` line), both marked `twin_dial`. `apps/` and `tools/bake_fonts.py` untouched.

## f30_cluster suites (run one at a time, in this worktree, after the last code change)

`test-bottom-row` 254, `test-native-ui` 47, `test-strip-mask` 40, `test-fonts` 34, `test-probes` 25, `test-daynight` 24, `test-night` 48:
all passed, 0 failed, the same counts as on `main` (no change). `apps/f30_cluster/` and `apps/driver_profiles/` are untouched.
