# Car3 G: "6WB Dials + G20" on the car (report)

Brief: `docs/AGENT-BRIEF-car3.md` §1–§3. Branch: `car3/g` (local, not merged). Bench: port 8092, G's own Chrome profile (`bake/work/car3-g/chrome`, DevTools 9292). Proof: `docs/car3/g/` (bench renders and masks only, no photo pixels).

## 0. How the photos were read

Photos 34, 37, 41, 42 and 43 were registered to panel px from our own drawing. Our bench render was matched to each photo by NCC on several hundred patches of our numerals, ticks and labels. The fit is a homography plus a cubic correction for the lens and the curved glass. The residual is 0.4 to 0.65 photo px, about 0.2 panel px. Photo 36 is a close zoom and fits less well (2.5 photo px), so it was used only to look at. The rectified photos are in `bake/work/car3-g/r<n>_rect.png`, local only.

Photos 32, 33 and 35 are also "6WB Dials + G20" (package H, through the lead): our tray "P", the cut dial bottoms, the minis raised by 20 px.

## 1. "Our range, clock, temperature and mode label do not show"

### What the registered photos prove (41, also 34 and 43)

- **WBBACK draws.** The collar hides the stock dial frames, for example the stock "260" and "7". In 0.7.4 those stuck out past our dials (photo 16). In 0.7.7 they do not.
- **The sheet that holds our range is drawn, but our range is not in it.** On the bench, `own_range` and `own_range_u` share one image layer with the fuel mini's "1/1" and "0" (sheet at 36,582, 271×118, connection 2). In photo 41, "1/1" and "0" sit where the bench draws them, within 0.6 px. Our "km" in Arimo Bold is not there, and BMW's thin-font "432 km" shows unobstructed.
- **The tray sheet is drawn.** Our "D2" or "P" shows. The mode label is a member of that same sheet (with READY and OFF) and is empty. That is `{{mode}}` with no drive mode. Package H and the lead confirm that the car never delivered one.
- **No patch is drawn.** BMW's range and temperature are under our layers: photo 38 shows our Comfort window hiding them. So a drawn patch would have hidden them.

**Conclusion:** on the car the `own:range` and `own:temp` toggles were off when the layout was built. `hud.js _own()` read `ownRange` and `ownTemp` as something other than "ours". The empty mode label is a separate matter (no drive mode).

### What was ruled out on the bench

| Suspect | Result |
|---|---|
| 0.7.6-era settings without the new keys | Not it. A `settings.json` built from 0.7.6's schema (`bake/work/car3-g/settings_076*.json`) gives our row on start-up. The kit's `Settings` fills in every default before it reads the file, and `hud.js setting()` falls back to the default for any invalid value. |
| `u_pat` as a vec4[4] array | It cannot hide our text, which lives in other layers. Upstream cluster-render accepts typed array uniforms (`PROTOCOL.md` "Uniforms"; `graph_ramses19.cpp uniform_array`). It is replaced by plain vec4s anyway (§5). |
| `{{mode}}` empty | It explains only the mode label. Our row does not depend on the drive mode: with no `/drive` posted ("drive mode not seen yet"), the bench draws our range and temperature (`bake/work/car3-g/nodrive.png`). |
| Toggle / rebuild path | Works on start-up, on a layout change, on a settings change, and with or without a drive mode. Nothing in the own row depends on the drive mode or on a layout switch. |

**Only one state reproduces photo 41 exactly:** `ownRange` and `ownTemp` stored as `"bmw"`. See `docs/car3/g/repro_0.7.7_owned_bmw_80.png`, which is 0.7.7's code with those two values: BMW's pump-with-arrow row, no patches, and an empty mode label because there is no drive mode.

I could not find, from here, how those values got onto the car. The app writes a setting only on a tap: the page's Settings tab (`page.js`) or the HMI's "All settings" list (the kit's `wireSettings`). **This cause is a hypothesis, tested on the bench, not proven on the car.** The new log and status line (below) will show it on the first drive.

### The fix

- **The settings are reset once.** `app.json` gives `ownRange`, `ownClock`, `ownTemp`, `modeLabel`, `gearTray` and `dialShade` the kit's `"reset": 1`. On the first start of the next version, each goes back to its default once (ours / auto / ours / on / gear / normal). Later choices are kept. Tested on the bench: a `settings.json` with `"bmw"` comes up "ours", with `_reset_*: 1` marks written.
- **Diagnostics.** On every build of the layout the log gets one line: `layout "6WB Dials + G20": own row: range ours (ownRange "ours"), clock BMW's (ownClock "auto", no time zone), temp ours (ownTemp "ours"); mode label on, empty: no drive mode from the car (modeLabel true)`. The status line at the foot of the Settings tab ends with `; row: range ours, clock BMW's, temp ours`.
- **The mode label stays as it is.** It shows nothing while the car sends no drive mode. Package I owns that signal, and I did not change how layouts are chosen.

## 2. Stock pixels outside our drawing

| # | What (photos) | Whose | Done |
|---|---|---|---|
| 1 | White arc piece below OFF, "outside our bezel" (36, 41) | **Ours.** It is our own tacho bezel, continuing below the check-control "i" window and then fading. | WBDIAL, box window: our bezel ring is black below the window's top on its side of the dial, so the bezel ends at the window. `i_window_bezel.png`. The "i" / "⚠" window itself is unchanged (photo 43's "⚠" stays). |
| 2 | Stubs of BMW's bottom line at the foot of the sign window, both sides (37, 41, 42, 43) | BMW's | BMW's sign measured on 34, 37, 41, 42 and 43: centre (537.3, 621.3), red ring to r 41.5. Our window moves from (539, 622) r 44 soft 4 to (537.5, 621.5) r 42.5 soft 1. WBDIAL now draws an opaque black ring 8 px wide round the open window. The closed disc (our sign shown) is now opaque to the same 8 px. `sign_window.png`. |
| 3 | The left hook stub "/" at x 731–744, y 631–644 (34, 41, 33) | BMW's | It cannot be covered all the time. Photos 42 and 43 show that BMW's message symbols (heated wheel, open door) and photo 08's "i" dot draw on those very pixels. A fourth patch over it shows only while the car says no message shows (`"when": "cc:none"`, `this.ccShown === false`), and it follows that state live. Until package I wires the check-control signal the state is unknown, so the patch is off and the stub stays. `hook_stub.png` shows it with the state forced on a local bench build. |
| 4 | "Near the fuel gauge and the temperature" (34, 41) | BMW's bottom-row range (pump with an arrow) and temperature | These are the items that should be ours (§1). Nothing else stock lies within 60 px of either mini. The left and right ends of the LCD's lit black are the panel itself. |
| 5 | Map roads at the dials' inner edges (34, 36: the "[" shapes) | BMW's map | §3 |
| 6 | A piece of BMW's bottom line inside the sign window when BMW shows **no** sign (33, the bench at 80 km/h) | BMW's | Open. The window has to stay open while our limit field is unwired, and the line crosses the disc where BMW's sign draws, so it cannot be covered without hiding the sign. It goes once package I's "---" state or the limit field closes the window. |

All safety items are untouched: the belts, the airbag, the gear letter, the message panel's frame, text and symbol, the right "i" / "⚠", and the telltales. The map veil keeps 5 px off the message panel (it fades out over y 566–596; the panel starts at y 601) and stays off the right "i" (`SHADE_KO`). The bezel change and the sign ring are inside our dials.

**For packages C and J:** the simulation's sign sits at (535.7, 621.1) and is about 1.5 px bigger than the car's. The simulation also draws the hook tips about 2 px longer (F's note). Both leave specks on the bench that the car does not have.

## 3. The map's hard left and right edges

WBBACK's collar path now gives the map a soft window, the same veil curve as package A's in 6WB Comfort:

- The window is x 708–1198 and y 156–596. It was measured on photos 41 and 42: BMW's own map veil ends at about x 704 and x 1212, with its top at y 158.
- It fades to black over 48 px at the sides and 80 px at the top.
- Beside and above the window, between our dials and outside them, it is black.
- The black fades out over the 30 px above y 596.

It reuses the bg widget's `window` and `fade` keys, so existing code sends `u_wbox` and `u_fade` and no uniform is added. The collar path returns before package A's window code, so these keys mean nothing else here. `map_edges.png` shows the bench, and `map_veil_mask.png` shows the alpha with the measured box and the panel kept clear. On the car's own map (local check: photo 41 times the veil, `bake/work/car3-g/r41_veil_cmp.png`), both sides and the top now fade.

**For the lead (package H):** if H changes what `u_wbox` or `u_fade` mean in WBBACK, the collar block marked `// car3 G` reads them too.

## 4. The black box

Nothing of ours in this layout is placed or cut for it:

- Only `bg` (full screen) and the `tacho` layer overlap [1420, 320, 1611, 440], and the tacho draws its hub whole.
- The comment in `gen_6wb.py` about centring the rev dial on the box is the history of the G20 fit. It is not a cut.
- Photo 41 (no box) shows our hub complete.

## 5. Files and budgets

**Changed**, each in a block marked `car3 G`:

- `shared/shaders.js`
  - WBBACK: `u_pat0..3` in place of `u_pat[4]`, and the map veil.
  - WBDIAL: the bezel ends at the box window, the black ring round the open sign window, and the closed disc opaque to the same 8 px.
- `shared/hud.js`: `_wbPatchesSend` (plain vec4s, live for `cc:` patches), the `cc:none` toggle, `_ownNote`, the log line and the status suffix.
- `shared/layouts.js`: the toggle check accepts `cc:<x>`.
- `design/gen_6wb.py` (dials only): `SIGN_WIN` / `SIGN_SOFT`, `MAP_WIN` / `MAP_FADE`, `HOOK_STUB`. The layout `wb_dials.json` was regenerated.
- `apps/f30_cluster/app.json`: six `"reset": 1`.
- `tools/overlay/plan_dials.py`: `SIGN_WIN` updated. On a re-run the collar and the cover come out byte-identical. `docs/overlay/dials_scheme.png` was regenerated. `plan.dials.json` was kept, because the re-run drops its conflicts (as with F).

**Budgets** ("6WB Dials + G20", bench, defaults):

| | Before (main 02fc0e5) | After |
|---|---|---|
| Layers | 18 (6 + 6 + 6) | 18 (6 + 6 + 6) |
| Assets | 9 | 9 |
| Pixel memory | 11.1 MiB | 11.1 MiB |
| WBBACK uniforms sent (collar path, samplers counted) | 20 | 23 |
| WBBACK uniforms declared (vec4 slots) | 25 | 25 |
| WBDIAL uniforms | 20 | 20 |

There is no new texture and no re-bake. 6WB Comfort is unchanged.

## 6. What the owner checks on the car (version after 0.7.7, "6WB Dials + G20")

1. **Our row.**
   - Look at the bottom row. You should see our range with a plain pump and Arimo digits, and our temperature, at BMW's places, with no BMW item peeking out.
   - The Settings tab's last line should end `row: range ours, clock BMW's, temp ours`. The clock stays BMW's until a time zone is set.
   - If the line says "ours" but BMW's row shows, send the app log line that starts `own row:`. It is then a layer problem, not a setting.
   - If it says "BMW's" straight after installing, note what you tapped since.
2. **The mode label** stays empty until the car sends a drive mode. The status line also says "drive mode not seen yet".
3. **BMW's sign** ("---" or a limit): no grey line stubs beside its foot, and its red ring whole, not clipped.
4. **Below OFF:** no white arc piece. Open a door: the "⚠" by the tacho is whole.
5. **The map** (navigation on): soft left, right and top edges.
   - Show a message (heated wheel on/off): the message panel's frame and symbol must be unchanged and not darkened.
6. **The hook stub "/"** by the message panel still shows. It goes once package I wires the check-control signal.

## 7. Reproduce

```sh
python3 design/gen_6wb.py apps/f30_cluster/hud/layouts
rm -rf dist bench/.data && BENCH_PORT=8092 node bench/server.js f30_cluster        # BENCH_LIMIT=off: the sign window as on the car
# 0.7.6-era settings: put bake/work/car3-g/settings_076_dials.json in bench/.data/f30_cluster/settings.json before starting
```

The registration and the veil check are scratch scripts (`register.py`, `veil_sim.py`, `sheets.py` in the session scratchpad). Their inputs are photos, so their outputs stay local.
