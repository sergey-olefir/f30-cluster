# Car round 3, package H: 6WB Comfort and 6WB Comfort + BMW map on the car

Brief: `docs/AGENT-BRIEF-car3.md` §4. Branch `car3/h`. Bench shots and renders: `docs/car3/h/`.

## 1. How the photos were read

Each photo was registered to panel px on its own. The registration matched our static text (the 21 scale numbers, "km/h", "1/min x 1000", "READY", "OFF") from a bench render by NCC, then fitted a homography with RANSAC. The fit error was 1.1–1.9 panel px rms (26 points, about 2 photo px per panel px). The rectified photos and the scripts stay in the scratchpad. No photo pixels are committed. `docs/car3/h/` holds only bench renders, plus one smoothed profile model (§2).

**Photos 32, 33 and 35 are not 6WB Comfort. They show 6WB Dials + G20.** The registered photo 33 matches the `wb_dials` bench render on every point that tells the two layouts apart:

- our gear tray "P" sits in the lens under the tacho;
- both dials end in the faded cut at y 656, with no range arc and no consumption arc;
- the minis sit 20 px higher;
- BMW's middle (the car picture) and BMW's bottom row show round our dials, because `wb_dials` is see-through there.

6WB Comfort draws none of these. It has an opaque background, a floor or map window, our clock and temperature row, and the range and consumption arcs.

In photo 33, and again in 41, our drive-mode label above the tray is empty. `modeLabel` defaults to on, and a missing key still counts as on (`setting(k) !== false`). So the label's widget was drawn, and its text `{{mode}}` was empty. That means `driveMode` was null: the car had not delivered a drive mode we recognise.

While the drive mode is unknown, `hud.js _layoutName()` uses `hudLayout`, not `inComfort`. The gallery on the page then also writes `hudLayout` (`page.js lookKey`). So the car showed whatever `hudLayout` held, here 6WB Dials + G20, even though "In Comfort" said 6WB Comfort. This is likely why these photos were taken as "6WB Comfort". **For packages G and I and for the lead:** the FES drive-mode field does not seem to arrive on this car, or arrives late (see §5).

Photo 38 is the only Comfort photo (`wb_comfort_map`). Everything below comes from 38, with 41 as the reference for BMW's map.

## 2. The map cover (photo 38)

**What was wrong.** With a theme on, BMW draws a smaller map on the car than the stock G20 map the bench simulates (x 555–1395, y 155–612, from photos 08 and 09).

Photo 41 shows BMW's map with nothing of ours over the middle (6WB Dials). It is a box symmetric about x ~958 with its own edge fall-off of 30–50 px:

| Level of BMW's map | x | y |
|---|---|---|
| 10 % | 695–1216 | 137–592 |
| 50 % | 724–1192 | 162–575 |
| 75 % | 754–1173 | 187–564 |
| 90 % | 794–1150 | 208–458 |

Our 0.7.7 window was x 592–1328, y 158–600, with 40 px side fades and a 56 px foot fade. So BMW's whole edge fell inside the part of our window that lets the map through. Our layer passed 89 % of the map where BMW's map was under 60 %, and 65 % where it was under 30 %. At the top and bottom, where the dial rims curve away, BMW's box showed with its corners, and its bottom edge showed just above our foot line.

A model checks this: BMW's map profile from photo 41, times our 0.7.7 transmission, predicts the map's 50 % edges in photo 38 within about 5 px at the sides and 5–14 px at the top and bottom.

**The fix:**

- **A separate window while the map shows.** The `bg` widget gets new keys `mapWindow` [750, 180, 420, 384] (x 750–1170, y 180–564) and `mapFade` [120, 80, 80, 24] (top, sides, foot, rims). `hud.js` sends them as `u_wbox` / `u_fade` only while BMW's map shows (`stockMap` in `wb_comfort`, and always in `wb_comfort_map`). The floor (map off) keeps `window` / `fade`, so it is unchanged.
- **Our black is full at BMW's 75 % line.** All of BMW's own edge is under black. Where BMW's map is under 30 %, we pass nothing. Where it is under 60 %, we pass at most 7 %.
- **The map you see at full is the same size.** BMW's map is at 90 % only inside x 794–1150, y 208–458. Under the new window the map is at full over x 812–1110 at y 380 (803–1122 before) and y 265–458 (unchanged).
- **Round corners (WBBACK, map case only).** The edge fades no longer multiply, which kept square corners. In fade units, the bands now meet on circular arcs: `vis = veil(1 − length(q))`, with `q` the per-axis distance into the fade bands, each ≤ 1. That is fp16-safe. The map reads as a vignette, not a box.

**Proof:**

- `map_model_car.png`: BMW's map on the car (smoothed profile model from photo 41), what 0.7.7 lets through, and what lets through now.
- `map_before_after.png`: the bench middle before and after, gain ×2.
- `comfort_map.png`: 6WB Comfort + BMW map.
- `comfort_off.png`: 6WB Comfort with the map off, the floor unchanged.

The bench simulation's map is the larger stock one, so on the bench the visible edge is our fade alone. **For package J:** with a theme on, the simulation's `map.region` should be the smaller box above.

## 3. The clock

In both Comfort layouts, our clock now follows the same rule as 6WB Dials' `ownClock`. Its toggle is `own:clock`:

| `ownClock` | Our clock |
|---|---|
| `auto` (the default) | Ours only once a time zone is set (the `timeZone` setting or `config.utcOffsetMinutes`) |
| `ours` | Always ours |
| `bmw` | None |

**The choice for "otherwise": none, not BMW's.** BMW's clock sits at [340, 662, 455, 704], under our speed dial's range arc and its "450". A soft window there would cut the arc and stand a second font in it. `clock_options.png` shows (a) the choice and (b) a mock-up of the window, built from the bench's G20 simulation.

Without our clock, the temperature stands alone, centred at x 960 (`row_b2`). With a time zone set, the row is the clock at x 800 and the temperature at x 1010, as before (`comfort_timezone_set.png`).

When package I finds the car's time zone, `_own('clock')` turns on by itself, with no layout change.

To let one widget have two conditions, a toggle may now join parts with `&`: `"baked&own:clock"`, `"baked&!own:clock"`. This needed two small marked edits, both covered on the bench:

- `hud.js _toggleOn`;
- the layout check in `shared/layouts.js`. Without it, a layout with such a toggle is "unusable", and the car would show nothing.

`tools/overlay/export_wb.py` reads the new toggles too.

## 4. The temperature

`{{ambient}} °C` (whole degrees) is now `{{ambient1}} {{u:temp}}`: "+5.5 °C" in BMW's 0.5 °C steps, and whole °F with US units. The boxes are 170 px wide, enough for "-22.5 °C". This applies to the baked row and to the unbaked "Temp" column.

## 5. The rest of the photos

- **38, compared with the bench:**
  - BMW's gear letter "D" draws over our tacho's lower left. That is a safety item: BMW's, left alone.
  - The black box hides our tacho hub, as designed.
  - Nothing else stock peeks out. The faint lighter band above the middle and the grey glow at the panel's left edge sit where our layer is opaque black. I read them as glare on the glass and the LCD's backlight, not as drawing.
  - Our range arc, consumption arc, foot line and minis align with the bench within the registration error.
- **Without the black box** (photo 33, in Dials), our tacho hub draws whole and looks right. Nothing in Comfort is placed or cut to suit the box.
- **32, 33 and 35** are 6WB Dials + G20 (§1). The stock pieces they show belong to package G:
  - the hook stub "/" at about (735, 635);
  - a piece of BMW's bottom line at about x 500–575, y 648.
- **Startup layout (for the lead; not changed here).** If the car does not report a drive mode, Change-with-drive-mode never takes effect, and `hudLayout` decides. A small fix: while `byMode` is on and the drive mode is unknown, use `inComfort`, since the car starts in Comfort, both in `_layoutName` and in `page.js lookKey`. I left it out: it changes every layout's choice, and it should wait for package I's look at the FES field.

## 6. Budgets (bench 8093, `rm -rf dist bench/.data`)

| State | Layers | Assets | Pixel memory | WBBACK uniforms |
|---|---|---|---|---|
| `wb_comfort`, map off: before / after | 19 / 19 | 11 / 11 | 11.3 / 11.3 MiB | unchanged (no new uniform) |
| `wb_comfort_map`: before / after | 19 / 19 | 9 / 9 | 10.6 / 10.5 MiB | unchanged |

No texture was added. The hidden row widgets are not packed, because sheets take shown widgets only.

## 7. What the owner must check on the car

1. **The layout shown.** Open the Settings tab and read its status line. If it says "drive mode not seen yet", the theme comes from "Theme (when not by drive mode)", not from "In Comfort". Set both to the theme you want until the drive mode is wired.
2. **6WB Comfort + BMW map** (or 6WB Comfort with "BMW's map in the middle"): no edge, corner or line of BMW's map box should show anywhere. The map should fade into black on every side, with round corners. Take a photo like 38. If BMW ever draws the large stock map instead, our window still covers its edges, because it is smaller.
3. **The clock:** with "Time zone (clock)" on Automatic, no clock should show, and the temperature should stand alone in the middle. Set your time zone (+2:00 in winter): the clock should appear at the left and read the real time.
4. **The temperature** should read in 0.5 °C steps, the same as BMW's ("+5.5 °C").
5. **Photo 38 again with the map off:** the floor should look as before.
