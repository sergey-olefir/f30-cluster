# Polish F: "6WB Dials + G20" bottom row ours, and the new settings (report)

Brief: `docs/AGENT-BRIEF-polish2.md` §1, §2 and §4. Branch: `polish/f` (local, not merged). Bench: port 8086, F's own Chrome profile (`bake/work/polish-f/chrome`, DevTools 9286). Shots: `docs/polish/f/`.

## 1. The settings

All of them are declared in `apps/f30_cluster/app.json` `settings`, labelled in English only, like the existing settings. They are listed on the centre screen's Settings tab (`main.js`) and read in `shared/hud.js`, in the blocks marked "package F".

| Setting | Options (**default**) | Layouts | How it applies |
|---|---|---|---|
| `wbFoot` | **`hair`** / `chrome` / `none` / `glass` | 6WB Comfort, 6WB Comfort + BMW map (the layouts that draw the 6WB window) | Live: only WBBACK's `u_foot` changes. A switch to or from `glass` rebuilds the layout, because `glass` samples the `bar` texture (+0.35 MiB). The layout's own `foot` is now only the fallback. |
| `dialShade` | `off` / `weak` (0.5, 12 px) / **`normal`** (0.8, 20 px, polish B's) / `strong` (0.95, 34 px) | 6WB Dials + G20 | Live: WBBACK's new `u_shade` (strength at the rim, falloff). The shade has moved out of the baked collar into the shader: no texture, and the collar is the same size as before. |
| `ownRange` | `bmw` / **`ours`** | 6WB Dials + G20 | Rebuild: our pump, range and "km" at BMW's place, over a black patch. |
| `ownClock` | **`auto`** / `bmw` / `ours` | 6WB Dials + G20 | Rebuild. `auto`: ours once a time zone is set (the `timeZone` setting, or `config.utcOffsetMinutes`), else BMW's. |
| `ownTemp` | `bmw` / **`ours`** | 6WB Dials + G20 | Rebuild: ours with BMW's 0.5 °C steps (new token `{{ambient1}}`: "+3.5"). |
| `modeLabel` | **on** / off | 6WB Dials + G20 | Rebuild: our `{{mode}}` (COMFORT, COMFORT PLUS, SPORT …) above the gear tray (D row 15). |
| `gearTray` | **`gear`** ("D4") / `letter` ("D") / `empty` | 6WB Dials + G20 | Rebuild: `{{gear}}` or `{{stage}}` in our tray (D row 17). |

**Why these defaults.**
- **Range and temperature: ours.** We read both signals (`KombiIF.statusRangeTankStatus`, `ExteriorTemperature`). The car's temperature carries 0.5 °C steps, so ours now shows them as BMW does.
- **Clock: `auto`.** This is the lead's view written into the setting. The head unit runs on UTC (photo 14 showed ours 2 h off), so the clock is ours only once a time zone is set; until then it is BMW's, which is always right. `bmw` and `ours` force it either way.
- **Mode label on, gear "D4".** These are D's recommended rows 15 and 17. The tray is drawn and empty today, which reads unfinished.

## 2. Our range, clock and temperature at BMW's places

- **Where.** At the catalogue boxes of `bottom.range`, `bottom.clock` and `bottom.temperature`, with our baseline on BMW's (y 697). Each item has a black patch under it: the catalogue box grown 4 px, with rounded corners and a 2 px soft edge. The patches are drawn by WBBACK (`u_pat`, an array of 4 vec4 rects). They are shown only while that item is ours (`"when": "own:<item>"`), so no texture and no layer is added.
- **Style.** Values are in the new `wb_row` font (Arimo Bold 44, digits `:+-.` only), whose caps are about 32 px, BMW's size. Units are in `wb_val` (Arimo Bold 36, which has "km" and "°C"). The pump is our `fuel` icon. No Latin-only atlas missed a glyph: `wb_val` and `wb_cap` already had "°", "C", "k", "m". `tools/bake_fonts.py` rebuilt only `wb_row`; every other font came out byte-identical.
- **D's notes.**
  - At night our whites dim (`nightDim`) and BMW's do not. With range and temperature ours and the clock BMW's (the default without a time zone), the row mixes about 150 (ours) and 255 (BMW's) whites at night: see `row.png`, night rows. With all three ours, the row is even.
  - Our 24-hour clock shows a leading zero ("09:22"); BMW's shows "9:05".
- **The new toggle** `own:range|clock|temp` (`hud.js _own`, `_toggleOn`) is allowed by `shared/layouts.js`'s toggle check.

## 3. The stock bottom lines, the hooks and the grey dash

**What is covered.** One full-size black coverage, `design/overlay/cover.dials.png`, made by `tools/overlay/plan_dials.py` (`bottom_cover`) and packed by `tools/bake_scene.py` as the scene texture `cover` (736 × 64 at x 588–1324, y 598–662, 0.36 MiB). WBBACK's collar path samples it (`u_t1` / `u_r1`, which that path did not use before). It covers:
- the straight lines from our dials' edges to the hooks, on both sides (inside our dials' circles, B's band already covered them);
- both hooks;
- the grey dash (x 1224–1239), which is the start of the right line.

polish B's `LINE_OPEN` is gone, so the collar no longer keeps off those lines.

**How the pixels were found.**
- Rectified photo 09 (no message) gives the line and hook pixels: luma above 60 in the two hook regions.
- Rectified photo 08 (a message shown, "press the brake") gives the pixels of BMW's message frame, its text and its left "i": luma above 100 inside x 696–1224, y 596–696, plus 2 px for their anti-aliased edge. The straight lines lie outside that box.
- The catalogue polygon of `assist.cc_panel` is a hull round the whole panel and holds the hooks, so it cannot separate them. The exact frame, text and "i" pixels do. `bottom.cc_info` agrees with the measured "i".
- Cover = the line and hook pixels grown 2 px, minus the frame / text / "i" pixels grown 3 px more (the margin), minus every other G20 item we show (catalogue polygons grown 3 px, as the collar's keep-out).

**Result** (printed by `plan_dials.py`; proof `docs/polish/f/hooks_keepout.png`, masks only):
- 2815 line, hook and dash pixels: **2723 covered, 92 left**.
- **The left hook shares pixels with the left "i".** On its way up, the hook runs through the spot where BMW draws the "i"'s dot while a message shows. 31 hook pixels lie on the dot's pixels and the other 61 lie within 3 px of them. So a 12 × 14 px stub of the left hook stays visible, at x 733–745, y 631–644. The rest of that hook is covered.
- The right hook, the dash and both straight lines are covered in full.
- **No frame, text or "i" pixel is under the cover.** The nearest cover pixel is 4.0 px (centre to centre) from the nearest frame / text / "i" pixel, including that pixel's anti-aliased edge.
- **While a message shows,** the cover lies on the panel's soft lit background (not on its frame, text or "i"). Photo 08 there has luma mean 28, max 60, against 9 outside the panel. So while a message shows, the covered hook shapes appear as darker hook-shaped marks in that glow. The bench shows this (`hooks_bench.png`, upper row). The outline, the text and the "i" stay whole. This is the price of taking the hooks away; it is the owner's call (§7).
- **The bench simulation** draws the hook tips about 2 px longer than the photos show. On the bench, two specks remain at the tips (x ≈ 752, y 610; x ≈ 1160, y 612). The car follows the photos.

**Safety items untouched.** Belts, airbag, the gear letter, the street name, the check-control panel's frame, text and "i", and the right "i" window: `plan_dials.py`'s table still shows 100 % visible for all of them except `assist.cc_panel`, which shows 96.3 %. That 3.7 % is the hooks inside its hull polygon, not frame, text or "i" pixels (see above). The cover spans x 588–1323, y 612–653 (BMW's bottom row starts at y 659), and the patches stay ≥ 30 px from the belts and the airbag.

## 4. Budgets ("6WB Dials + G20", bench 8086, `rm -rf dist bench/.data`)

| | Before (`main` 1779154) | After, defaults (clock BMW's) | After, all three ours | After, all BMW's | After, all BMW's, no label, empty tray |
|---|---|---|---|---|---|
| Widgets shown | 34 | 41 | 42 | 36 | 34 |
| Layers (per connection) | 16 (5 + 6 + 5) | 18 (6 + 6 + 6) | 18 (6 + 6 + 6) | 16 (5 + 6 + 5) | 16 (5 + 6 + 5) |
| Assets | 8 | 9 (+ `cover`) | 9 | 9 | 9 |
| Pixel memory | 10.1 MiB | 11.1 MiB | 11.3 MiB | 10.9 MiB | 10.5 MiB |
| WBBACK uniforms (collar path, samplers counted) | 16 | 20 (+ `u_shade`, `u_shadeKo`, `u_pat`, `u_r1`) | 20 | 20 | 20 |

- The other effect layers are unchanged (the wbdials have 19, WBSIGN 7). The Comfort path of WBBACK sends no new uniforms (19).
- The worst layout is still 6WB Comfort: 11.3 MiB, or 11.7 MiB with `wbFoot` = `glass` (the `bar` texture). Every connection stays at 8 layers or fewer. In "6WB Dials + G20", our pump icon sits on connection 0, so the range's sheet does not need a layer of its own.
- The collar texture is the same size (480 × 180). Only its content changed: no shade, no `LINE_OPEN`.
- A switch to "6WB Dials + G20" drops the other layouts' scene textures before `cover` is made: `_sceneNeeds` lists `cover` with the collar.

## 5. Proof (`docs/polish/f/`, bench renders over the G20 simulation, no photo pixels)

| File | What |
|---|---|
| `dials_default_{night,day}_{rest,80}.png` | The whole panel with the defaults: at rest (message, sign 50, P) and at 80 km/h (no message, D4). |
| `row.png`, `row_before.png` | The bottom row: all BMW's / the defaults / all ours, night and day, at rest and at 80 km/h; and `main` before. |
| `shade.png` | `dialShade` off / weak / normal / strong. |
| `tray.png` | `gearTray` gear / letter / empty, and `modeLabel` off. |
| `foot.png` | `wbFoot` hair / chrome / none / glass, in 6WB Comfort (floor) and + BMW map. |
| `hooks_keepout.png` | The hook and frame overlay: BMW's lines and hooks (photo 09), frame, text and "i" (photo 08), the 3 px margin, our cover, the pixels left. Masks only. |
| `hooks_bench.png` | The hook area on the bench, before and after, with and without the message. |

"Night" means the simulation's night look with our night colours; "day" means its day look with our day colours. The night colours were forced for these shots by a bench-only environment switch that is not committed. The same overlay over the photos themselves is `bake/work/polish-f/hooks_keepout_photo.png` (local, photo pixels).

## 6. `tools/overlay/headless.py`

It ran `pkill -f chrome-headless`, which kills every agent's headless Chrome. Now:
- it kills only the Chrome whose command line holds its own profile's exact `--user-data-dir` (matched literally, with an end anchor);
- the profile is `$OVERLAY_CHROME_PROFILE`, else `bake/work/overlay/chrome-headless-<checkout>`. `bake/work` is one folder shared by every worktree through the symlink, so each checkout needs its own profile.

Tested:
- `headless.py --plan design/overlay/plan.dials.json --no-shots` gave the same 47 conflicts as B.
- F's own Chrome on 9286 survived the run.

## 7. Open, and for the owner

1. **The hooks while a message shows.** Covering the hooks leaves darker hook shapes in the message panel's soft glow while a message shows (§3). The frame, the text and the "i" are untouched. The other choice is to keep the hooks. Look at `hooks_bench.png`, and at the car at start-up.
2. **The stub by the left "i".** 12 × 14 px of the left hook stays, because it lies on or within 3 px of the "i"'s dot. A smaller margin there would hide more of it and come closer to the "i".
3. **Bigger check-control symbols.** Only the "i" was measured (photo 08). A warning message with a larger symbol in the "i"'s place (an oil can, a thermometer) could reach the cover at the left hook's lower part (x 697–735, y 640–650). Check on the car with a real warning, or ask for a keep-out box round the symbol's place (which keeps more of the left hook).
4. **Defaults:** `ownClock` `auto` (ours once a time zone is set), range and temperature ours, mode label on, gear "D4", shade normal, foot hairline.
5. **Night brightness.** Our row dims at night, BMW's does not. With range and temperature ours and the clock BMW's, the row mixes the two. Pick: set a time zone (all ours), or all BMW's.
6. **The sign window (packages B and E).** While our limit is unknown, the round window shows BMW's stock line and a fragment of its speedo through it when BMW shows no sign (`dials_default_*_80.png`, x 500–580). It closes once E's limit signal is wired.
7. **Not seen on the car yet.** The 3 px margin rests on the photo rectification (rms 1.1 px on 08, 1.0 px on 09).
8. `tools/overlay/inventory_parts.py` `collar_recipe()` is still stale (B's note §4): it does not know the cover or the moved shade. Not touched.

## 8. Reproduce

```sh
export UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache
uv run -q --no-project --with numpy --with pillow python -I tools/overlay/plan_dials.py   # collar, cover, proof
(cd bake/src && ./P9/py.sh ../../tools/bake_scene.py)                                    # collar.json, cover.json
uv run -q --no-project --with pillow python -I tools/bake_fonts.py f30_cluster            # wb_row
python3 design/gen_6wb.py apps/f30_cluster/hud/layouts
```

`plan_dials.py` rewrites `design/overlay/plan.dials.json` without the conflicts; the plan itself did not change, so the committed file (B's, with its conflicts) was kept.
