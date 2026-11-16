# Bottom row: who draws the sign, the message and the road label

Branch `feat/bottom-row`. **No car was touched: bench only** (port 8140). No version bump, no push, no merge.

The 6WB themes leave three places see-through so BMW's own cluster draws them: the speed-limit sign, the
check-control (info) message and the bottom-centre road label. This package wires the car's own signals behind all
three and makes each one a **choice** — BMW's or ours — with "BMW's" (exactly today's behaviour) as the default. The
faithful G20-styled drawing lands on top of this afterwards (`docs/G20-DESIGN-SPEC.md`, `docs/ROAD-SHIELDS.md`);
what is here is a plain placeholder in our own fonts at the stock positions.

## 1. What is wired

Every interface, field, member and enum below was read out of the car's own catalogue
(`reference/car/2026-11-15/someip/someip-interfaces.json`, git-ignored) and checked member by member. Nothing is
guessed except where this document says so.

| What | Interface and field | Flag | Instance |
|---|---|---|---|
| Speed limit + no overtaking | `de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction` | `s` | 1 |
| Next limit ahead | `de.bmw.infotainment.fasus.FASuS.statusNextSpeedLimitRecognition` | `rs` | 1 |
| Info message | `de.bmw.infotainment.KombiInterface_2.newCCMessage`, `ccList`, method `requestCCMessage` | `rs` | 1 |
| Road label | `de.bmw.infotainment.navigation.guiding.Guidance.currentRoad`, `isOnGuidableRoad` | `rs` | **`Main_Instance` (128)** |
| Position and guidance | `de.bmw.infotainment.navigation.navigationstatus.NavigationStatus.currentLocation`, `guidingState`, `nextDestinationInfo` | `rs` | 1 |
| The car's own clock | `de.bmw.infotainment.KombiIF.timeDateUTC`, `statusTimeDate` | `rs` | 1 |
| Which message frame of how many | `de.bmw.infotainment.KombiIF.statusMenuCCMessage` | `rs` | 1 |
| The driver's speed-limit settings | `de.bmw.dass.settingsdriverassistancefunctions.SettingsDriverAssistanceFunctions.settingSpeedLimitInfoWarning`, `settingSpeedLimitWarningSecondLevel`, `settingSpeedLimitInfoPresentation`, `settingOffsetSpeed`, `settingOffsetSpeedSlow`, `settingOffsetSpeedSlowActivation` | **`rs`** (the car offers `rws`) | 1 |

**The driver's settings are declared read-only on purpose.** All six are writable on the car. `app.json` declares them
`rs`, so the installer's generated interface config has no setter and the app cannot write a driver-assistance
setting even by mistake. Changing one would be a car write, and none is approved.

Corrections to the brief, from the catalogue:

- the check-control union's **members** are `cCMessageStruct` and `cCMessageWithSymbol` (the type names are
  `CCMessageStruct` / `CCMessageWithSymbolStruct`); the symbol variant carries the message at
  `cCMessageWithSymbol.cCMessage`;
- `ccList` is an **array** (up to 42) of `CCListElementUnion`, member `cCListElement`, with `cCShortName` and
  `cCColor` — this is what the car cycles when several messages are on at once;
- `Guidance` is **not instance 1**: the catalogue's `instanceIDs` give it `Main_Instance` = 128. The kit subscribed
  `"1"` for every interface, so `kit/runtime/car.js` gained a per-interface `$instance` (below). Without it
  `currentRoad` would simply never arrive;
- `requestDefaultSymbols` is not on `KombiInterface_2` on this firmware; `requestCCMessage` is, and is declared;
- `nextDestinationInfo` is `{ travelTime (s), estimatedArrivalTime (a struct whose seconds member is spelled
  `secound`), formattedDistance { distance (text), unit (enum), rawDistance } }`;
- `currentLocation.address` has `street`, `houseNumber`, `junction`, `district`, `city`, `region`, `country`,
  `postalCode`, `countryCode`, `regionCode`, and the Japanese `chome` / `banchi` / `go`, each an
  `OptionalString { valid, text }`.

### The shapes in `app.json`

Nothing is hard-coded. Each signal is a shape under `config`, in the same style as the existing `config.limit` /
`config.ccm`, parsed by a pure function in `shared/hud.js` that never throws:

| Config | Parser | Notes |
|---|---|---|
| `config.sign` | `signOf()` | the whole struct: value, unit, warning level, supplemental, symbol style, no-passing and its remaining distance |
| `config.ccm` (new kind `"message"`) | `ccMsgOf()` | the union's roots, name, description, colour, symbol, id, type. The older kinds `list` / `flag` (car3 I) still work |
| `config.ccList` | inline | the list the car cycles |
| `config.ccFrames` | inline | which frame of how many the car is showing |
| `config.sla` | inline | the driver's own speed-limit settings, read only |
| `config.road`, `config.onRoad` | `roadOf()` | the array of text / spacer / icon elements, joined into one line |
| `config.nav` | inline | guiding state, next destination, position |
| `config.clock` | `tzOf()` (car3 I, extended with `offsetBy` and `confirm`) | the car's own time-zone offset |

**Every new raw value is logged once, as a shape.** `sign:`, `check-control message:`, `check-control list:`,
`road label:`, `navigation:`, `position:`, `clock:`. The lines carry types, lengths and enum values — never the
message text, never the road name, never coordinates, never an address. The scripted test fails if any of the fake
content ever reaches the log.

## 2. The settings

> **Superseded on 2026-11-15 (`docs/ONE-SWITCH-DONE.md`).** The seven keys in the table below are gone: one choice,
> `bottomRow` (`allG20` / `all6WB`), now decides the whole row, and the settings a car had saved are folded into it
> once at startup. Everything else in this section — what each element is, where it is drawn, the fall-back — still
> holds; only the keys changed.

The owner's three existing rows and three new ones are now one group, **"Who draws this"**, plus a row that puts all
six back at once. The kit had no settings group, so a small general one was added (section 6).

| Key | Label | Type | Default | Note |
|---|---|---|---|---|
| `ownRange` | Range (+ G20 themes) | bmw / ours | **ours** | unchanged |
| `ownClock` | Clock (+ G20 themes) | auto / bmw / ours | **auto** | unchanged |
| `ownTemp` | Outside temp (+ G20 themes) | bmw / ours | **ours** | unchanged |
| `ownNav` | Navigation label (+ G20 themes) | bmw / ours | **bmw** | new |
| `ownSign` | Speed-limit sign (+ G20 themes) | bmw / ours | **bmw** | new |
| `ownInfo` | Info message (+ G20 themes) | bmw / ours | **bmw** | new |
| `ownAll` | Put the six rows above back to BMW's | keep / all six: BMW's | **keep** | new, springs back to "keep" |
| `limitArc` | Red arc over the speed limit | auto / on / off | **auto** | new, outside the group (§5) |

The three new rows stay on "BMW's" until the owner has seen them on the car. No existing key or value was renamed,
so a car that already has `ownRange` / `ownClock` / `ownTemp` set keeps them.

On the settings screen the group reads as a block: a non-focusable heading row, the six rows, the "put them back"
row, then a second heading ("Our own extras") so the group's end is unambiguous and the arc is plainly outside it.

`ownAll` = "All six: BMW's" sets the six and then puts itself back to "keep", with a single rebuild. It is the one
way out on the road without hunting through rows.

## 3. The switching

"BMW's" means what happens today: our layer stays transparent there and the stock cluster shows through. "Ours"
means we draw it. The three new rows act in the two themes where BMW's own bottom row is visible — **6WB Dials +
G20** and **6WB Sport + G20**. In 6WB Comfort / Sport / Eco Pro our backdrop covers those places anyway, so our
sign is always ours there and the rows have nothing to switch (the settings say "+ G20 themes", as the existing
ones do).

- **The sign.** Our `wbsign` layer and its figure carry `"toggle": "own:sign"`, so on "BMW's" they are not even
  built, and the round window in the speedometer's rim (`WBDIAL u_cut` mode 1) stays open over BMW's own sign. On
  "ours" the window closes (mode 3) and our sign is the only one. It goes **inside the speedometer, below the needle
  hub**, where the bench already puts it. The window also closes while the car stands in P with the engine off, as
  before (BMW draws no sign on its standby screen).
- **The info message: a split, and that is the point.** On "ours" the car keeps drawing the graphic and its
  animation in its own column, and we draw only the text. `wbback` gained `ccSym` next to the existing `cc` box:
  `cc` is BMW's whole message panel (x 709–1243), `ccSym` is only the symbol column (x 709–790, around the stock
  `bottom.cc_info` "i" at x 736–753 with room for the wider symbols). `_wbCcSend()` opens `cc` on "BMW's" and
  `ccSym` on "ours", so BMW's symbol area stays see-through either way and our `cc_name` / `cc_desc` texts sit
  beside it.
  **2026-11-16: the field is ours only once the car's message has been READ** (`_ccWired()`: one notification from
  `config.ccm` carried a name, a description, a symbol, an id or a type — a struct whose paths fit the car carries
  its id and type even with no message on). Until then we are blind: we never learn when the cluster writes in that
  panel, our own text is empty, and the panel was being half covered — our black patch to y 665 and the road bar
  from y 666 left only a 14 px band of BMW's own message, which is the sliced message the owner photographed on
  2026-11-16. Blind now means the field reads as BMW's (`_own`) and the panel is left see-through (`_ccOpen()`,
  the toggle `cc:open`, in the see-through layouts only — in the opaque themes a window there would be a hole in
  the theme). It is a wait, not a latch: the first readable message makes the field ours with no restart.
- **The road label.** On "ours" a black bar (a `fill` widget, x 690–1250, y 666–712) covers BMW's street line and
  our `{{road}}` text draws on it, wider than BMW's own 331 px field so a long name is not shrunk. The bar starts at
  x 690 so the rear-belt, driver-belt and airbag lamps (which end at x 679) are **never** covered. While a message
  shows and the info field is BMW's, a hole in the bar opens over the panel so BMW's own message text is not
  blacked out; our road text steps aside while a message shows, as the stock cluster does.
- **Colour: white only for now.** `cCColor` is read and recorded; every message is drawn in the theme's normal
  foreground. The severity colours are one line away (`colorBy: "cc"` on the `cc_name` text), and `_ccRole()`
  already dims a colour at night instead of recolouring it, the way the 6WB shaders treat `WBSIGN`.
- **Several messages at once: the car's own frame counter.** The stock cluster cycles numbered frames, and
  `KombiIF.statusMenuCCMessage` says which frame of how many, with the ids of up to three messages. Ours follows
  that counter and matches by id, and **runs no timer of its own**: without the counter the newest message simply
  stays. Guessing the car's rhythm would look worse than not cycling.
- **States, not animations.** No flash, no derestriction transition, no timed effect anywhere in this package: a
  sign changes from one value to the next and a message appears and disappears. The timings the design spec guessed
  (`config.sign.changeFlashMs`, `flashPeriodMs`, `config.ccm.ccFrameDwellMs`, and BMW's manual's `autoHideMs` /
  `reshowMs`) are carried in `config`, marked, and nothing acts on them, so animation can be added later without
  touching the drawing.
- **The end of a limit.** There is no "hide the sign" state: the end-of-limit state is shown as a state, and the
  next limit replaces it. `config.sign.holdMs` keeps the last sign on while the car briefly says nothing.
- **mph.** The unit is read and recorded (`{{limitUnit}}`, the `sign:` log line) and changes nothing on screen: the
  sign stays the round one with the number, in every country.
- **Too long to fit.** A road name or message wider than its box is cut with "...", not clipped mid-letter. How the
  stock cluster truncates was never photographed, so this is a guess (§12).

### The automatic way back

Both levels the owner asked for:

- **manual:** the "BMW's" value of every row is that same path, and it is the default for the three new rows.
- **automatic:** an element whose signal is not named in `app.json`, whose drawing throws, **or whose text our font
  cannot draw**, gives itself back to the car — `_rowFail()` sets a flag, `_own()` then reports "BMW's" whatever the
  setting says, the window opens, the warning `bottom row: <element> is BMW's again (<why>)` is logged once and the
  status line follows. `_rowCheck()` runs at every rebuild; `_update()` wraps every widget of the three new
  elements in its own try/catch, so a bad value can never take the tick (or the app) down.

  The font case matters on this car: the owner's cluster is in **Ukrainian**, and the only 6WB font with letters in
  it (`wb_cap`, an Arimo subset) has no Cyrillic. Picking "ours" for the navigation label or the info message there
  will hand it straight back with
  `bottom row: nav is BMW's again (the font "wb_cap" has no glyph for 9 characters of the car's text)` — which is
  the right outcome until the drawing package bakes the measured font, and tells the owner exactly why.

## 4. The seam for the faithful drawing

Everything the design agents replace is in one block, marked **THE SEAM** in the source:

Where the spec measured a number, this package already uses it: the street label is centred on **x 960.5** with
baseline **y 700.5**, the message text on **x 967.5** with the two-line baselines **645.8 / 690.2**, and the
symbol slot is sized from the measured one (right edge 752.9, centre y 658.7, up to 41.3 px wide). What is still
placeholder is the typeface, the weights, and the rail.

| Where | What is there now | What replaces it |
|---|---|---|
| `design/gen_6wb.py`, between `# --- bottom row ... ---` and `# --- end bottom row ---` (the constants `CC_SYM`, `CC_TEXT_C`, `CC_TEXT_W`, `CC_LINE_Y`, `NAV_BAR`, `NAV_HOLE`, `NAV_CX`, `NAV_BASE`, `NAV_W`, and the three builders `road_signs()`, `nav_row()`, `cc_row()`) | the measured positions, drawn in `wb_cap` | the measured typeface and weights (Roboto, width axis 87.5; the street in Light against the values' Medium), and the shields. Regenerate with `python3 design/gen_6wb.py apps/f30_cluster/hud/layouts` |
| **the rail** | not drawn, and not exposed | The check-control field is a 4.9 px rail at y 604.8 (x 749–1176, tapering to points at 702,621 and 1221,621), not a box. `WBBACK u_cc` is **one** vec4, so only one area of BMW's panel can be opened and this package opened the symbol slot; the rail stays under our black band. Either draw the rail ourselves from those numbers, or add a second box uniform — which is a shader change this package was not allowed to make |
| `shared/hud.js` `_signShow()` + `config.sign.holdMs` / `changeFlashMs` / `flashPeriodMs` | the end-of-limit **state**, no animation | the derestriction animation, once there is a video to measure |
| `shared/hud.js` `_ccRole()` + `colorBy: "cc"` on `cc_name` | white only; `cCColor` read and recorded | the severity colours |
| `config.road.spacerMap`, `roadOf()`'s icon handling | an icon contributes its own text (`A 9`) | the road shields (`docs/ROAD-SHIELDS.md`); the icon's `iconHandle` is a navigation resource we cannot resolve, so a shield has to be drawn by us |
| the fonts | `wb_cap` (Arimo 26) — the **only** 6WB font with letters in it; `wb_val` and `wb_row` are digits and units | the G20's own font and size. **`wb_cap` has no accented letters**: a street with ä, ö, é or Cyrillic loses those characters until `tools/bake_fonts.py` bakes a wider subset, which costs glyph-atlas pixel memory (8.2 MiB of the 16 MiB is atlases already) |

Nothing outside those places needs to change: the data, the settings, the switching and the fallback are done.

## 5. The red arc on the speed scale, and the shader

The arc now runs **from the speed limit to the end of the scale** (it used to run from the limit to the needle, and
had no setting).

**When it is drawn is the car's decision, not ours.** The stock cluster has an "Excess speed display" of its own
(the G20 manual), and the signals for it are on the car, so the verdict comes from there:

- `displaySpeedLimitWarning` in the traffic-sign struct is the car's own "the driver is over", at two levels;
- `SettingsDriverAssistanceFunctions.settingSpeedLimitInfoWarning` is **the field taken as "the excess-speed
  display is on"** (`value` = `ACTIVATED`), with `settingSpeedLimitWarningSecondLevel` for level 2;
- the driver's tolerance (`settingOffsetSpeed`, `settingOffsetSpeedSlow`) is honoured without us ever reading it,
  because the car applies it before raising the warning.

`limitArc`:

| Value | What it does |
|---|---|
| **auto** (default) | the arc is on while the car warns, and only if the driver has that warning switched on in the car's own menu. A car that says nothing about the setting counts as on. |
| on | ignore the car's menu and draw whenever our own speed is past the sign (what 0.7.14 did) |
| off | never |

**No shader change was needed.** `WBDIAL` already draws a band between `u_dyn.y` and `u_dyn.z`; the engine now sends
`z = 1` (the scale's end) instead of the needle's position. That is one changed literal in `shared/hud.js`.

Compacted source length per look, exactly as `shaders.js styled()` / `compact()` hands it to the KOMBI
(`shaders.wbdialFor`, `shaders.wbbackFor`), measured on the base commit `c7b8097` and on this branch:

| Shader | Before | After |
|---|---|---|
| WBDIAL 0 comfort | 12 403 B / 252 lines | **12 403 B / 252 lines** |
| WBDIAL 1 sport | 6 544 B / 163 lines | **6 544 B / 163 lines** |
| WBDIAL 2 eco | 6 360 B / 161 lines | **6 360 B / 161 lines** |
| WBDIAL 3 mini | 6 969 B / 172 lines | **6 969 B / 172 lines** |
| WBDIAL 4 eff | 6 236 B / 158 lines | **6 236 B / 158 lines** |
| WBBACK 0 comfort | 8 785 B / 191 lines | **8 785 B / 191 lines** |
| WBBACK 1–4 | 8 131 B / 176 lines | **8 131 B / 176 lines** |
| WBSIGN | 3 252 B / 80 lines | **3 252 B / 80 lines** |
| WBMSA | 1 703 B / 43 lines | **1 703 B / 43 lines** |

Byte-for-byte identical; `shared/shaders.js` is untouched on this branch. No new uniform was added to any layer, so
the 32-per-layer cap is as far away as it was. Given what 0.7.11 did to the KOMBI
(`docs/CAR-SNAPSHOT-2026-11-15.md` §0), that seemed the right way to spend the one shader change this package was
allowed.

## 6. Kit changes (small and general)

- `kit/runtime/car.js`: a per-interface **`$instance`** in the `extra` map, next to the existing `$pollMs`. Without
  it no navigation field can ever be read, because `Guidance` is `Main_Instance`, not 1.
- `kit/tools/build.py`: a setting may carry **`"group": "<heading>"`**. `settings_items()` puts a non-focusable
  header row (`LT_Label_Header_1Row`, the widget BMW's own lists use) above the first setting of each run of that
  group. Settings without a group follow as before. `kit/tools/localize.py` translates the heading.
- `kit/runtime/sheet.js`: the drawn settings sheet does the same — a `kind: 'head'` row with no box and no tap
  target, which the controller steps over.
- `shared/hud.js`: `_hole()` accepts a live toggle expression (`"cc:open&!own:info"`), and a `fill` widget with one
  resends `u_hole` when it changes.

## 7. Layers, memory, and what nothing changed

With every new setting at its default, **nothing is added at all**: the new widgets carry `own:*` toggles, so they
are not built. With all three set to "ours", 6WB Dials + G20 goes from 17 layers (7 + 5 + 5) to **20 (7 + 7 + 6)**:
one new effect layer (the road label's bar) and two more image sheets, 13.2 MiB of the 16 MiB of pixel memory. The
bar is on connection 1, not 0, because connection 0 already carries 7 of its 8 layers in these themes. The test
asserts that no layer or pixel-memory refusal appears in any theme.

## 8. The bench fakes, and how to drive them

The car has no stand-in for any of these signals, so `bench/fake-signs.js` feeds them as **raw SOME/IP values
through the very shapes `app.json` names** — the app's own parsers run exactly as they do on the car. A map
corrected for the car is therefore also what the bench feeds.

```sh
BENCH_PORT=8140 node bench/server.js f30_cluster      # then open http://localhost:8140
curl -s localhost:8140/fake -d '{"scene":"limit-80-rain"}'
curl -s localhost:8140/fake -d '{"sign":{"state":"limit","value":120,"unit":"kmh","warn":2,"np":"truck","npM":800}}'
curl -s localhost:8140/fake -d '{"cc":{"name":"Engine malfunction","desc":"Drive on with care.","color":"red","symbol":12,"variant":"symbol"}}'
curl -s localhost:8140/fake -d '{"road":{"parts":[["icon","A 9"],["spacer","SMALL"],["text","Nuernberg"]]}}'
curl -s localhost:8140/fake -d '{"nav":{"state":"on","dist":"12","unit":"km","etaH":14,"etaM":35,"mins":18}}'
curl -s localhost:8140/fake -d '{"clock":{"minutes":120,"dst":false}}'
```

The page has a button per scene under **Bottom row (sign, message, road)**; `GET /probe` reports `signs`: what the
fakes fed, what the parsers made of it, which of our widgets are built, and which elements fell back.

Scenes: `limit-50`, `limit-80-rain`, `limit-130-warn1`, `limit-30-warn2-school`, `limit-55-mph`, `limit-end`,
`limit-unknown`, `limit-none`, `limit-invalid`, `nopass-car`, `nopass-truck`, `cc-red`, `cc-yellow`, `cc-green`,
`cc-orange`, `cc-white`, `cc-long`, `cc-three`, `cc-frame-2`, `cc-clear`, `road-street`, `road-shield`,
`road-guiding`, `road-none`, `clock-plus2`, `clock-none`, `clear`.

The driver's own speed-limit settings and the message frame counter are fed the same way:

```sh
curl -s localhost:8140/fake -d '{"sla":{"warn":"on","warn2":"off","show":"on","offset":3}}'
curl -s localhost:8140/fake -d '{"ccFrame":{"frame":2,"of":3,"ids":[101,102,103]}}'
```

Note: once `config.sign` names the car's own field, the old `bench.SpeedLimit` stand-in is **not** installed — the
real shape is wired, and the manual slider no longer sets the sign.

## 9. Test results

`node bench/test-bottom-row.js` (port 8140, its own data folder, the kit's own build):

```
69 passed, 0 failed
privacy: no road name, message text or coordinate in the log
```

It covers: the defaults (all three BMW's, no widget of ours built); the limit in every state (number, end, unknown,
none, invalid, both warning levels, km/h and mph); **all 15** supplemental values and **all 9** no-passing values;
the message in every colour, a 146-character one through the union's symbol member, and clearing; the road label as
a plain street, as a shield and number, and with guidance (distance, arrival time, spacers); the switching both ways
for all three; that nothing cycles without the car's frame counter and that frames 2 and 3 of 3 show the car's own
second and third message; the red arc following the car's warning, the driver's own menu setting, and both
overrides; `ownAll` putting all six back; the car's clock parsed but not used while unconfirmed; a street name the
font cannot draw handing the element back to BMW with the reason in the log; every layout still building with no
refusal; and that the app never exits.

Run it with nothing else on port 8140: another bench holding the port silently answers the test instead.

### Screenshots and pixel-compare

Every 6WB layout plus `g20_comfort` and `f30`, shot headless at 1920×720 with the same fixed manual signals, on the
base commit run as the car runs (`BENCH_LIMIT=off`) and on this branch with the defaults:

```
f30.png            identical
g20_comfort.png    identical
wb_comfort.png     identical
wb_dials.png       identical
wb_eco.png         identical
wb_sport.png       identical
wb_sport_dials.png identical
```

Nothing changes while every new setting is on "BMW's".

(The bench's own stand-in makes the comparison look different if it is left on: `BENCH_LIMIT` unset used to feed a
limit through `bench.SpeedLimit`, which drew our sign on the bench although the car never would. That stand-in is
gone now that the real field is named, which is why the comparison is run the way the car runs.)

## 10. What must be checked on the car

Nothing here has been seen on a car. In rough order:

1. **Do the signals arrive at all?** Look for `sign:`, `check-control message:`, `road label:`, `navigation:`,
   `position:` in the app log. `Guidance` is the one most likely to be silent — it is the only interface on
   instance `Main_Instance`, and the kit has never subscribed a non-1 instance before.
2. **The raw encodings, from those same lines.** Three are reasoning, not proof:
   - `displaySpeedLimit` 0 = end of all restrictions, 254 / 255 = no limit known. Taken from the car's own FASuS
     `NextClassLimitSpeed` enum, which spells those values out; `displaySpeedLimit` itself is a bare `UInt8`.
   - the unit `NICHT_VERFUEGBAR` is treated as BMW's empty sign "---".
   - `invalidFlag` ≠ 0 means nothing is known.
3. **The car's clock.** `config.clock.confirm` is **false**: the car's offset is parsed and logged
   (`clock: the car's offset would be N minutes`) but not used, so a wrong guess cannot put a wrong time on the
   cluster behind a black patch over BMW's correct one. Read that line once, set `factor` / `offsetBy` so N is the
   real offset, then set `confirm: true`. Only then does the manual `timeZone` setting become unnecessary.
4. **Two things change on the car even with every new row on "BMW's"**, because the signals behind them were never
   wired before:
   - the info window now opens when a message shows, so BMW's own message is visible through our theme. That is
     what `cc` was built for in car3 G; it has simply never had a signal;
   - the red arc appears on the speedometer while **the car's own excess-speed warning** is raised and the driver
     has it switched on. `limitArc` = off turns it off; = on ignores the car's menu.
   Worth checking in the car's own menu first whether the stock "Excess speed display" is on: if it is, the stock
   cluster marks the limit on its own scale too, and "matching the stock look" means something different.
5. **The split.** With the info field on "ours", BMW's symbol and its animation must still be visible in their
   column and our text beside them. `ccSym` (x 709–790) is sized from the stock `bottom.cc_info` box plus room; a
   wider stock symbol would need it widened.
6. **Safety lamps.** With the navigation label on "ours", the belt and airbag lamps (x 503–679) must still be fully
   visible: our bar starts at x 690.
7. **Layers.** With all three on "ours", confirm the rebuild line still says 8 or fewer layers per connection.
8. **The KOMBI.** No shader changed, so the 2026-11-14 reset should not be in play — but the 6WB themes are still
   the ones that caused it, and this package does not address that.

## 11. Open decisions for the owner

- `limitArc` defaults to **auto** — the car's own verdict and the driver's own menu setting. It is still new
  behaviour on the car, because there was never a limit to compare against.
- The road label is drawn only in the two "+ G20" themes. In 6WB Comfort / Sport / Eco Pro our own foot row already
  fills that line; whether a road label belongs there too is a design question.
- `config.clock.confirm` is false (above): one log line from the car turns the car's clock on.
- The rail under the check-control message (§4) needs either a second see-through box in `WBBACK` (a shader change)
  or for us to draw it. Neither was in this package's scope.

## 12. Guesses, and the photo that would settle each one

Where something was unknown, a sensible value was picked, marked in the code and listed here (the owner,
2026-11-15). None of these blocks anything.

| Guess | Where | What settles it |
|---|---|---|
| `displaySpeedLimit` 0 = end of all restrictions, 254 / 255 = no limit known | `config.sign.end` / `.unknown` | the `sign:` log line on the car, next to what the cluster shows |
| unit `NICHT_VERFUEGBAR` means BMW's empty sign "---" | `config.sign.noUnit` | the same line |
| `invalidFlag` ≠ 0 means nothing is known | `config.sign.invalidPath` | the same line |
| the car's time-zone offset is in 15-minute steps from UTC | `config.clock.factor` / `offsetBy` | one `clock:` line (and `confirm` keeps it harmless until then) |
| the message's name goes on the first measured line and its description on the second | `design/gen_6wb.py cc_row()` | a photo of a two-line message where the two lines are a wrapped sentence rather than name + description |
| a long name or message is cut with "..." | `shared/hud.js _fitText()` | a photo of the stock cluster with a street name too long for its field (spec §8) |
| the symbol slot is 700–757 × 628–690 | `CC_SYM` | a photo of the widest stock symbol (spec §8: only the "i", a door and a heated wheel were ever shot) |
| the no-passing sign keeps the place it has had since package E (beside the limit sign, inside the speedometer) | `road_signs()` | a photo of the stock cluster showing both signs at once (spec §8) |
| the end-of-limit and the greyed "unsure" symbols are whatever `WBSIGN` already draws for states 2 and 3 | `shared/shaders.js` | a photo of each (spec §8) |
| a three-digit limit and any supplementary plate fit the sign as it is | `WBSIGN` | a photo of each (spec §8) |
