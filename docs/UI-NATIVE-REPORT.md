# UI-NATIVE: the centre screen as BMW's own menu

Package N, 2026-11-14, branch `ui/native` (from `main` 8fe3c81). The owner asked for the app's centre screen to use
BMW's default elements as much as possible, the Themes and Settings tabs first.

**Status:** built and tested on the bench only. Nothing here has been seen on the car yet. The kit generates the
native screens and the HMI draws them, so only the car can show how they look. The check list for the car is in
section 6.

## 1. The screen tree, before and after

**Before (0.7.10)**, two states:

```
MAIN      canvas  LT_State_Laptimer   one drawn page (shared/page.js, 772 lines):
                                       Themes tab (hero picture, "Change with the drive mode", Comfort / Sport /
                                       Eco Pro cells, gallery of 8 pictures), Settings tab (20 drawn rows)
          bar     BTN_SETTINGS "All settings"  ->  the kit's drawn settings sheet (on the renderer), else SETTINGS
SETTINGS  list    LT_State_Wide       the kit's native settings list (every setting), rarely seen on this car
```

**After**, two states. The entry state is native, and the drawn screen holds only the pictures:

```
MAIN  "F30 Cluster"   menu   LT_State_Wide                      (entry point; the kit's settings live here)
  NOW_GFX        label     LT_Label_1Graphic_Scalable   picture of the theme showing (888x333 PNG)
  NOW            button    LT_Button_2Row_2Text         "6WB Comfort" / "white dials, picked by Comfort"
                                                        press: opens the gallery (or takes the screen back, see 4)
  SET_BYMODE     checkBox  LT_CheckBox_1Row             Change with the drive mode
  SET_HUDLAYOUT  dropDownMenu (no template)             Theme (10 rows)
  SET_INCOMFORT  dropDownMenu                           In Comfort (8 rows)   } hidden while the checkbox is off
  SET_INSPORT    dropDownMenu                           In Sport              } (config.menu.hideModeRows)
  SET_INECO      dropDownMenu                           In Eco Pro            }
  STATUS         label     LT_Label_1Row                "On: 6WB Comfort" / "Off: ..." / "Problem: ..."
  STATUS2        label     LT_Label_1Row                drive mode seen or not, HUD turned off, layers waiting, own row
  BTN_GALLERY    button    LT_Button_1Row               Theme gallery  ->  GALLERY
  SET_BAKED ... SET_DEMO   checkBox / dropDownMenu      the other 21 settings, in app.json order
  REPO_CREDITS   button    LT_Button_2Row_2Text         (the kit's credit row, always last of the settings)
  STATUS_LOG     label     LT_Label_1Row                "Engine: " + hud.js's whole status line
GALLERY "Theme gallery"  canvas  LT_State_Laptimer   (ParentState MAIN)
  GALLERY_GFX    label     LT_Label_1Graphic_Scalable   the drawn gallery: 8 cards, 4 x 2 (shared/gallery.js)
  BTN_NEXT_THEME button    LT_Button_1Row_Laptimer      Next theme
  BTN_GALLERY_DONE button  LT_Button_1Row_Laptimer      Done
```

Compared with Doom's main menu (upstream `apps/doom/app.json`, built here with our `build_ui`), MAIN has the same
state, groups and row templates. It adds two things Doom's menu does not have: a graphic row
(`LT_Label_1Graphic_Scalable` inside an `LT_State_Wide`) and a pressable two-row button as a menu item. Doom uses
`LT_Button_2Row_2Text` only for its credit row.

```
Doom MAIN: button LT_Button_1Row x2, label LT_Label_1Row, checkBox, dropDownMenu x6, button LT_Button_2Row_2Text, title
F30  MAIN: label LT_Label_1Graphic_Scalable, button LT_Button_2Row_2Text, checkBox, dropDownMenu x4, label LT_Label_1Row x2,
           button LT_Button_1Row, (checkBox / dropDownMenu) x21, button LT_Button_2Row_2Text, label LT_Label_1Row, title
```

The string bundle has 561 strings, under the kit's 1024 limit.

## 2. Every native widget used

"In the kit" means the kit's own apps use it on cars: upstream Doom's main menu ("Apps > Doom opens the main menu
(Play / Continue, New game, settings)"), and the native settings screen every kit app gets. None of these has been
seen on this car (our app always showed its drawn page or the drawn settings sheet).

| Row | Type / template | Status |
|---|---|---|
| MAIN state | `state` `LT_State_Wide` | in the kit (Doom's menu, every settings screen) |
| SET_* booleans (6) | `checkBox` `LT_CheckBox_1Row` | in the kit (Doom, settings screens) |
| SET_* choices / numbers (20) | `dropDownMenu`, no template (rows `ItemText`, `HeaderText`, `SelectedItem`) | in the kit (Doom, settings screens) |
| STATUS, STATUS2, STATUS_LOG | `label` `LT_Label_1Row` | in the kit (Doom's `MENU_INFO`) |
| BTN_GALLERY | `button` `LT_Button_1Row` | in the kit (Doom's Play / New game) |
| NOW | `button` `LT_Button_2Row_2Text`, cells `Text1stRow` / `Text2ndRow` | in the kit as the credit row of every settings list; **as a pressable menu row, new** |
| NOW_GFX | `label` `LT_Label_1Graphic_Scalable`, cell `Graphic` (Asset) | in the kit only inside `LT_State_Laptimer` (every canvas screen); **inside `LT_State_Wide`, new and unverified** |
| Hiding the three drive-mode rows | property `Visible` (2) on a `dropDownMenu`, runtime `setProperty` | in the SDK and the kit's `ui.visible`; **no kit app uses it on a list row: unverified** |
| GALLERY state | `state` `LT_State_Laptimer` + graphic + bar buttons `LT_Button_1Row_Laptimer` | the same as the old MAIN: verified on this car |

The picture in NOW_GFX goes the same way as a canvas screen's picture without the renderer: `ui.image` with a
`canvas.js` Canvas, written to `rhmiData/resources`, then a resource handle, then `setValue(0, 'Graphic', handle,
'Asset')`. The kit has no other way to push a picture into a row. The previews (`hud/previews/*.json`, `big` 888x333)
feed it directly: `previews.pixels()` inflates one, `menu.js` draws it on a Canvas and pushes it once per theme change.

## 3. What could not be done natively, and why

- **Several theme pictures.** An `LT_Button_1Row_1IconLeft` (kit kind `iconbutton`) has an icon cell, but the kit
  never names that cell or puts anything in it, and no kit app uses it. A list of graphic rows (one per theme) would
  mean 7 more unverified graphic rows and 7 PNG pushes. So the gallery stays drawn: a canvas screen GALLERY behind one
  native button ("Theme gallery"). It is page.js's gallery cut down to that one job (`shared/gallery.js`, 136 lines).
  On the Store's renderer a tap or a controller press on a card shows that theme. Without the renderer the HMI shows
  the gallery as a picture and taps do not reach it, so the bar gets a **Next theme** button (and **Done**).
- **The "Turn HUD Widgets off?" question.** RHMI has pop-ups (`popUp` containers), but the local kit's `build.py`
  cannot generate one, and nothing in the kit opens one or reads its answer. There is also no drop-down event before
  the value changes, so there is nothing to ask before. **Chosen behaviour:** a theme picked anywhere (a drop-down, the
  checkbox, the gallery) takes the shared screen when the cluster then draws a theme (`screen.claim()`; HUD Widgets
  steps aside on its next read, within about 2 s). STATUS2 then says "HUD Widgets turned off: the cluster theme has
  the screen" for 5 minutes. Picking "Off" takes nothing. While HUD Widgets has the screen, the NOW row says "Off: HUD
  Widgets has the screen. Press to take it back", and a press takes it back. The engine already ended its stepping
  aside on any of these settings (`hud.js`). Without the claim, both apps would have drawn.
- **A "Theme" label that changes with the checkbox.** The drawn page said "Theme" or "Otherwise". A drop-down's
  `HeaderText` is static in the kit (only `SelectedItem` is written at run time), so it is always "Theme". STATUS2 and
  the NOW row say when Theme is the one showing ("Drive mode not seen yet: Theme shows").
- **Status row order.** The owner's order was: theme row, checkbox, drop-downs, status, settings. The kit put a menu's
  items before all settings, so this needed a small kit change (below). Now the order is exactly that.
- **The "All settings" bar button** is gone: the settings are on MAIN itself, as in Doom.

### The kit change (kit/tools/build.py, marked "bimmer-lab addition")

- In a `menu` with `"settings": true`, an item `["setting", key]` puts that setting's native row among the items, and
  `["settings"]` puts the remaining settings there. Without these items the settings follow the items, as before, so
  Doom-style menus build as they did. Used elsewhere, both stop the build with a message.
- A `tworow` item now gets `LT_Button_2Row_2Text`'s own cells (`Text1stRow`, `Text2ndRow`). Before, it got `Text`.

## 4. Other changes

- **`shared/page.js` retired.** `ls apps` shows only `f30_cluster`, and grep finds no other user. Its "both apps" HUD
  tabs (Readouts, Position, Map, Badge, Alerts, G-meter, Colours) belonged to HUD Widgets, which lives elsewhere with
  its own copy. `previews.js` gained `pixels()`. Comments in `screen.js` and `tools/previews.py` now say menu.js.
  `hud.js` still mentions page.js in comments. I did not touch it (the engine).
- **Labels shortened** (app.json). Examples: "Theme (when not by drive mode)" became "Theme", "Change with SPORT /
  COMFORT / ECO PRO" became "Change with the drive mode", "Dials / Sport + G20: shade at the dials' inner edges"
  became "Dial edge shade (+ G20 themes)", "6WB window: line at its foot" became "Map window foot (6WB)", "BMW's map
  in the middle (Comfort)" became "BMW map in 6WB Comfort". The ownClock option "Ours once the time zone is set, else
  BMW's" became "Auto (ours if time zone set)".
- **Time zone rows** now read "Automatic", "UTC-5", "UTC+5:30" and so on (`labels`). Before, they read -9999,
  -300, 330. "Shift light before redline" 0 reads "At the redline".
- **Localisation:** `localize.py` looks each English string up in `kit/runtime/locales/<lang>.json` and keeps the
  English when it finds none. This app builds English only (`mgu-repo.json`), so nothing breaks. A ru or zh-CN build
  would show the new labels in English until someone adds them to those catalogues. Text written at run time keeps to
  ASCII where it can: non-ASCII goes through the kit's 256 dynamic string slots, one per row.
- **Crash safety.** Every menu and gallery handler runs inside `guard()` and logs instead of throwing. `ui.*` calls
  already catch inside the kit. `main.js` starts the menu and the gallery each in its own try, so a failure there
  leaves the cluster drawing and the kit's settings rows working.

## 5. Testing done (bench, Mac, Node 22: the car's Node 8 is not installed here)

- `python3 kit/tools/build.py f30_cluster` passes: 2 screens, states `{'MAIN': 1, 'GALLERY': 38}`. I read the
  generated `application.xml` and `uiDescription.json` and diffed them against Doom's (section 1).
- **`node bench/test-native-ui.js`: 42 passed, 0 failed.** It starts `bench/server.js` with its own data and
  shared-screen folders and presses the components the way the HMI does (new `POST /click`, `POST /hmi`, `GET /probe`
  on the bench). It checks:
  - MAIN is the entry, and NOW, the picture (888x333) and the three status rows are written;
  - the kit wires the checkbox and the drop-downs;
  - Comfort shows In Comfort;
  - the In Comfort drop-down rebuilds the layout, and NOW and the picture follow;
  - the checkbox switches to Theme and hides the three rows;
  - **every layout of the Theme drop-down builds** (off, wb_comfort, wb_dials, g20_comfort, wb_sport,
    wb_sport_dials, wb_eco, f30, grid, mapcal) with nothing refused;
  - the HUD Widgets hand-over works both ways, including the press on NOW;
  - the gallery opens, Next theme sets and shows the next theme, and Done and the back arrow close it;
  - bad drop-down rows and unknown components are ignored, and the app never exits.
- Bench smoke test (`rm -rf dist bench/.data && BENCH_PORT=8098 node bench/server.js f30_cluster`): it builds, runs
  and draws 6WB Comfort with 21 layers and 11.5 MiB. The warnings are the usual layout-overlap ones.
- `kit/tools/emu.js f30_cluster` starts. Its page lists a menu screen ("the HMI's own menu screen, not drawn here")
  and offers "Open GALLERY". It does not draw native rows. The gallery picture was checked in the software path (PNG).

## 6. What the owner must check on the car

Install from the branch as usual (the Store builds it). Then:

1. **The tile opens the menu.** Apps > F30 Cluster shows a BMW-style list titled "F30 Cluster". *If it opens blank, or
   not at all:* take `oap_*/data/f30_cluster.log` (look for `screen resources`, `open entry state`, `SDK_`) and go
   back to 0.7.10.
2. **The picture row (NOW_GFX), the riskiest part.** Look at the top row: the theme's picture, about 888x333 or scaled
   to the row. *If it is empty, tiny or breaks the list:* remove `["graphic", "NOW_GFX"]` from `screens[0].items` in
   app.json and reinstall. The code skips a missing row. If the log shows `INVALID_VALUE` on `createResourceHandles`,
   remove it too. The kit saw that error when a canvas screen got `updateResources` before its first picture, and
   this row may hit the same thing. Then check that the gallery's pictures still show.
3. **The NOW row.** Two lines: the theme's name, then the tag and "picked by Comfort" (or "same in every drive
   mode"). Press it: the gallery opens. *If the second line is missing:* the template may not take `Text2ndRow` from a
   menu row. The fix is a small change: make the item `["button", "NOW", ...]`, and have `menu.js` write one line with `text` instead of two with `cells`.
4. **Checkbox and drop-downs.** Untick "Change with the drive mode": In Comfort, In Sport and In Eco Pro should
   disappear, and STATUS2 should say "Same theme in every drive mode". Tick it again and they come back. *If they do not
   disappear:* that is harmless. *If they disappear and do not come back* (also after leaving and reopening the
   screen): set `config.menu.hideModeRows` to `false` and reinstall. Open "Theme": 10 rows. Pick one and the cluster
   changes within a second.
5. **Status rows.** STATUS reads "On: 6WB Comfort" (or "Off: ..."). STATUS2 shows the drive mode: drive in
   Comfort, then press SPORT, and it should follow. If it says "Drive mode not seen yet", that is the FES question from
   CAR3-H. STATUS_LOG, at the very bottom, is the engine's full line (for photos when something is off). Long lines are
   cut by the HMI. That is expected.
6. **The HUD hand-over.** With HUD Widgets showing a layout, pick a cluster theme here. Within about 2 s the HUD
   layout goes away, the cluster theme shows, and STATUS2 says "HUD Widgets turned off ...". Pick a layout in HUD
   Widgets: the cluster goes off, and NOW says "Press to take it back". Press it, and the cluster theme comes back.
7. **Gallery.** "Theme gallery": 8 cards with pictures, the one showing outlined in blue. Tap a card: that theme
   shows (in the drive mode the car is in, when it changes with it). Turn and press with the controller: the same.
   "Next theme" steps, and "Done" or back returns to the menu.
8. **The rest of the settings**, a few of them: Time zone reads "UTC+2" and so on, Badge has 58 rows and scrolls,
   and Demo data works.

The fallback for anything that renders badly is a one-line app.json change (2 or 4), or 0.7.10.

## 7. Open choices for the owner

- **Keep the picture row** (step 2) or drop it for a plain text row. The gallery has every picture either way.
- **Should the checkbox claim the screen?** Today, ticking or unticking "Change with the drive mode" also takes the
  screen from HUD Widgets when a theme then shows. Without that, both apps would draw. The alternative is to say "HUD
  Widgets is on" in STATUS2 and take nothing until a theme is picked.
- **A real pop-up** for "Turn HUD Widgets off?" would need the kit to generate and open an RHMI `popUp`. Upstream has
  no example. It is possible, but it is kit work and needs testing on the car first.
- **Calibration layouts** (Calibration grid, Map calibration) are still in the Theme drop-down, as before. They could
  move to a hidden setting.
- **Translations**: the new labels are English only (section 4).

## Files

- `apps/f30_cluster/app.json`: the MAIN menu, GALLERY, labels, `config.menu`. `apps/f30_cluster/main.js`.
- `shared/menu.js` (new), `shared/gallery.js` (new), `shared/previews.js` (`pixels()`), `shared/page.js` (deleted).
- `kit/tools/build.py`: `["setting", key]`, `["settings"]`, `tworow` cells.
- `bench/server.js`, `bench/run-app.js`: `/click`, `/hmi`, `/probe`, `BENCH_DATA_DIR`, `BENCH_IMAGE_DIR`.
  `bench/test-native-ui.js` (new).
