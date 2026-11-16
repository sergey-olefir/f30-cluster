# Package P: pictograms and catalogues (strip work, 2026-11-16)

Branch `strip/P`, based on `integrate/bottom-row` (`3c8ef46`). Read-only for the app: nothing under `shared/`,
`apps/` or `design/gen_6wb.py` was changed.

Every claim below carries a mark. **Verified** means the source text, the car's interface catalogue or the
committed code says it, or one of the owner's photos shows it. **Hypothesis** means it is our inference.

---

## 1. BMW's marker, the message timings and standby

### 1.1 The marker right of the rail (`assist.info_tacho`)

| Claim | Status | Source |
|---|---|---|
| G-series clusters carry an indicator meaning "at least one Check Control message is **displayed or stored**" | **verified** (text) | BMW M3 Sedan (G80) owner's manual, edition X/20, Check Control, p. 154 ([manualslib](https://www.manualslib.com/manual/2017370/Bmw-M3-Sedan.html?page=154)). The same wording appears in the X1 manual, edition X/19 ([p. 123](https://www.manualslib.com/manual/3340313/Bmw-X1.html?page=123)), and in F-series manuals. The G80 uses the same Live Cockpit Professional generation as the G20. |
| The marker stays after the message is gone | **verified** (photos) | 62 has a message plus an "i" marker; 63 was taken about a minute later (by the photos' own clocks) and has no message but the same "i" marker. 66 has a door message plus a triangle marker; 67, from the same minute, has no message and the triangle. **This falsifies `docs/G20-DESIGN-SPEC.md` §5.6, which says the marker "appears with the message".** |
| The marker is that "displayed or stored" indicator | **hypothesis** (strong) | The manual's sentence and the photos agree, and the marker survives the message's auto-hide. No public text links the sentence to this exact slot. The manual pages show the symbol only as an image, which the text sources do not describe. |
| Its glyph is the class of the stored messages: "i" while only information-class messages are stored, a triangle once a warning-class one is | **hypothesis** | 62/63: the stored message is a ready-to-drive hint, and the marker is "i". 66/67: the stored message is a door-open warning, and the marker is a triangle. There is one example of each. Which glyph wins with both kinds stored, and whether a red message tints the triangle, is **not photographed**. |
| No marker means nothing is stored | **hypothesis** | 64, 61 and 68 have no marker and no message. |
| An alternative reading of the "i": "a notification is pending", gone after about 5 minutes | **hypothesis**, weak | A forum report about a different car (iDrive 8, G30) seen only through a search summary; the page itself could not be fetched ([bimmerforums.co.uk thread](https://www.bimmerforums.co.uk/threads/letter-%E2%80%9Ci%E2%80%9D-sometimes-displayed-at-bottom-right-of-instrument-cluster.597531/)). It does not fit 62→63 as well as the stored-message reading does. |
| Signals that could drive our own marker | **verified** (catalogue, names and types only) | `KombiInterface_2.ccList` (up to 42 entries, each with `cCIdentifer`, `cCShortName`, `cCListSymbolID`, `cCColor`). `KombiInterface_2.ccListRiskClass` (the same entries plus `CCRiskClassEnum` RK10…RK900). `CheckControlMaster.basicList` (up to 45 entries, `ccmId`, `reason` incl. `CCM_SHOWN_BY_IC`, `activeState` AKTIV/INAKTIV, timestamp). **Hypothesis:** the marker shows while `ccList` is non-empty and takes the class of its most severe element. One car log line with the `ccList` length and its colours, next to a photo, settles it. That is package X's item 6. |

**For package X, item 6.** No evidence yet that we can draw the marker ourselves. Until the `ccList` hypothesis is checked on the car, BMW's marker must stay visible in both modes, as the brief says.

### 1.2 How long a message stays, hides and returns

| Behaviour | Value | Status | Source |
|---|---|---|---|
| Temporary messages auto-hide, stay stored, and can be shown again | **approx. 20 s** | **verified** (text) | G80 manual X/20 p. 154; X1 X/19 p. 123 |
| Hiding a message by hand (stalk button) | hidden **approx. 8 s**, then shown again | **verified** (text) | same pages |
| Permanent messages | stay until the fault is fixed | **verified** (text) | G80 p. 154 |
| Several at once | "displayed consecutively"; **no dwell time is given** | **verified** (text), dwell **unknown** | G80 p. 154 |
| Some messages | shown again after drive-ready state is switched off | **verified** (text) | G80 p. 154 |
| Urgent messages | the long text goes to the Control Display automatically | **verified** (text) | X1 p. 123 |
| 62→63, 66→67 are consistent with the 20 s auto-hide | | **hypothesis** | one-minute clock resolution only |

**Compared with `app.json` `config.ccm._timings`.** `autoHideMs` 20000 and `reshowMs` 8000 match BMW's text, now
confirmed on a G-series manual (the note cites only the X1). `ccFrameDwellMs` 4000 is still a guess that no BMW
source supports. The car says which frame it is on (`statusMenuCCMessage`), so nothing needs it, as the note
says. One more catalogue fact (**verified**, names only): `standardCCMessage` / `extendedCCMessage` (setter-only,
head unit → KOMBI) carry `statusIndicateDirectionFrequency…` = `KEIN_BLINKEN` / `LANGSAMES_BLINKEN` /
`SCHNELLES_BLINKEN`. So BMW has slow and fast blink rates for check-control indications. **Hypothesis:** these
apply to the message's tell-tale. Rates unknown.

### 1.3 Standby: the brief's rule is falsified by photo 63

| Claim | Status | Source |
|---|---|---|
| BMW's vehicle states are idle, standby ("OFF is displayed in the instrument cluster") and drive-ready. Standby starts when a front door is opened from outside; idle follows after several minutes with no operation | **verified** (text) | BMW X4 (G02) manual, edition VI/21, p. 40 ([manualslib](https://www.manualslib.com/manual/2459717/Bmw-X4.html?page=40)) |
| The car reports this state on `de.bmw.infrastructure.VehicleCondition.VehicleCondition`: `StatusConditionVehicle` = PARKEN_BN_NIO 1, PARKEN_BN_IO 2, STANDFUNKTIONEN 3, **WOHNEN 5**, **PRUEFEN_ANALYSE_DIAGNOSE 7**, FAHRBEREITSCHAFT_HERSTELLEN 8, FAHREN 10, FAHRBEREITSCHAFT_BEENDEN 12 | **verified** (catalogue) | The app already subscribes to it (`app.json` signals; `shared/hud.js` `COND_READY`, `data().condition`) |
| **Photo 63 shows "OFF" at the tacho (P, engine off) with the NORMAL row**: sign 50, belts, clock, range, the "i" marker. Photo 65 shows "OFF" with the standby row (odometer centre, mode label in the row, no sign, no belts, no scales on the dials) | **verified** (photos) | 63, 65 |
| Photo 64 is a second counter-example: P, tacho at "0" (not "OFF"), and the normal row with the sign and one belt | **verified** (photo) | 64 |
| So "P and rpm 0" does not identify BMW's standby row. The brief's §1.6 ("Standby (P, engine off)") and the bench's definition ("stage P, rpm 0") would hand the row to BMW and draw the standby mask in 63's state, where BMW draws the normal row | **verified** (photo against code) | |
| `shared/hud.js` (the `cut.cover === 'limit'` block, "2026-11-14: closed too while the car stands in P with the engine off … BMW draws no sign then") closes the round window over BMW's sign whenever `stage === 'P' && rpm < 150`. In 63's state BMW **does** draw the sign, so in `allG20` that window would black out BMW's sign | **verified** (code), defect **hypothesis** until O / ZL render 63's state | `shared/hud.js` around line 4008 |
| 65 is `WOHNEN` (5: standby with the door opened, cluster in its reduced look), and 63 is `PRUEFEN_ANALYSE_DIAGNOSE` (7: Start pressed without the brake, which also fits the ready-to-drive hint in 62) | **hypothesis** | Enum names only. One log line of `condition` beside each state settles it. |

**Proposal for X / M / the lead:** drive the standby row and the standby mask channel from
`VehicleCondition == 5` (WOHNEN), not from stage and rpm. Keep the P + rpm 0 rule only as a fallback while the
condition is unknown.

---

## 2. The check-control catalogue (`design/strip/pictograms/cc_catalogue.json`)

**Coverage: 71 ids.** 9 are tied to G-series cars (G20 among the models) by BMW service bulletins on nhtsa.gov,
and 62 come from one community list compiled on E/F-series cars. 48 are marked safety-relevant (§`_safety` in the
file: brakes, steering, restraint, tyres losing pressure, engine stop, roll-away, red).

| What | Status |
|---|---|
| `cCIdentifier` / `ccmId` is BMW's CC-ID. Ids 42, 49, 213, 286, 415, 794, 953, 961 and 2152 are confirmed on G-series cars by BMW's own bulletins | **verified** (bulletins). Id 42 = brake system, yellow, continue with care: SIB 34 08 21 names the G20 explicitly |
| The CC-ID space is shared across BMW generations | **partly**. Id 42 kept its meaning, but **id 49 did not** (community: particulate filter; G-series bulletin: drivetrain / 48 V). The G-series id space runs past 999 (id 2152). **No community-list number is safe to trust on this car without a car log** |
| `cCSymbolID` → pictogram | **no public mapping exists** (searches for the field names return nothing). The catalogue declares it a bare UInt16 with no enum (**verified**) |
| The head unit can send the symbol as a bitmap: `cCMessageWithSymbol.cCSymbol` = `KISymbolStruct { symbolID, symbolFormat PNG\|JPEG\|RLE24\|RLE32, symbolData[0..65535] }`, and `requestDefaultSymbols(CC_LIST_SYMBOL …)` returns up to 32 | **verified** (catalogue). This is BMW artwork: never log, save, bake or commit it. Drawing it live from the car's own data is possible, but it is the owner's call and not ours to ship |
| Which ids are safety-critical | **our classification**, backed by UN R121 Table 1 ([MLIT copy](https://www.mlit.go.jp/jidosha/un/UN_R121.pdf)): seat belt item 21 red; brake system item 25 per R13/R13-H; engine malfunction item 30 yellow; low tyre pressure item 42a yellow |

**What settles the rest:** shared/hud.js already logs each new message's shape (lengths, colour, symbol, type).
Adding the **id** to that line (ids are not personal data) would give us (CC-ID, cCSymbolID, colour) triples from
the car, and the table could be checked against them. That is a one-token change for package X; this package does
not touch `hud.js`.

---

## 3. Our pictograms

All of them are drawn by us after the ISO 2575 / UN R121 shapes. The provenance and licence note sits beside the
files (`design/strip/pictograms/PROVENANCE.md`); the licence is MIT.

| Name | Use | Shape |
|---|---|---|
| `cc_warn` | variant A marker, warning | outline triangle, "!" |
| `cc_warn_solid` | the same for a red / yellow tint where an outline reads thin | filled triangle, "!" knocked out |
| `cc_info` | variant A marker, information; also a message symbol | lower-case "i" with a serif and a foot |
| `cc_dot` | variant A marker, neutral | a dot |
| `cc_door` | door open | car from above, front-left door swung out |
| `cc_brake` | brake system | "( ! )" in a circle (R121 item 25 shape) |
| `cc_tyre` | tyre pressure | tyre profile with "!", tread marks (R121 item 42a shape) |
| `cc_engine` | engine / drivetrain | engine block (R121 item 30 shape) |
| `cc_washer` | washer fluid | windscreen with a dashed jet |
| `cc_belt` | seat belt | seated person, diagonal belt (R121 item 21 shape) |

**Files.**
- `design/strip/pictograms/pictograms.js`: the source.
- `svg/<name>.svg`: one vector per pictogram.
- `baked/<name>_<w>x<h>.png`: white ink plus alpha. 35 files, with ink boxes in `baked/index.json`.
- `sheet.png`: review sheet.
- Tool: `tools/strip/P/bake_pictograms.js`.

**Sizes: provisional.** Packages T and ZR had published nothing under `bake/work/strip/pub/` when this was baked,
so the sizes are these:
- Markers at 30×36 (the stock marker slot ≈ [1252, 591, 1282, 627], spec §5.6), 28×28 and 32×32 (inline at our
  message cap 26.6 / road-label cap 30.9).
- Symbols at 41×53 (the stock symbol slot, spec §5.2) and 32×32.
- Every pictogram also at 128×128 for review.

`--sizes <json>` re-bakes at T / ZR's numbers in one command.

**How they drop in (item 5).** Today's icons are not image files. `shared/icons.js` holds distance functions in
a 0..1 box, `paintIcon(name, w, h, colour)` rasterises one with one-pixel anti-aliasing, and `shared/hud.js`
blits it for every layout widget of `"type": "icon"`. The generator writes those widgets with
`icon(id, name, cx, cy, conn, color, w, h)` in `design/gen_6wb.py`. `pictograms.js` exports `ICONS` with exactly
that contract. To ship:
1. Copy it to `shared/strip_icons.js`.
2. Add `Object.assign(ICONS, require('./strip_icons').ICONS);` to `shared/icons.js`.
3. Name `cc_warn`, `cc_info` etc. in an icon widget.

The bake tool already goes through `paintIcon` after that same `Object.assign`. A baked PNG is therefore
byte-for-byte what the cluster would draw, and colour comes from the widget (`fg`, or a severity role). The
pictograms cost no scene texture and no pixel memory beyond the icon layer's own image.

---

## 4. Our sign art against the rules and against BMW's ring

Tool `tools/strip/P/signs.js` → `design/strip/pictograms/signs/proportions.json` plus drawings at the stock size.

| Ratio | BMW stock (spec §4, **provisional** until ZL) | German VzKat Z 274 / 276 (**verified**, measured on the public-domain Commons SVGs) | Ours, baked `sign_limit` / `sign_nopass` (**verified**, measured) | Ours, shader fallback |
|---|---|---|---|---|
| outer radius | 41.1 px | 290 mm red + 10 mm light rim | 41.87 px | 38 px |
| ring / outer | **0.226** (ring 9.3 px) | **0.277** | **0.183** (ring 7.7 px) | 0.21 |
| figure height / white-field diameter | 0.415 | 0.601 | text widget (T) | — |
| two-digit width / white-field diameter | 0.547 | 0.742 | text widget (T) | — |
| no-overtaking car width / white-field radius | not photographed | 0.803 | 0.731 | — |
| car height / white-field radius | — | 0.612 | 0.555 | — |
| gap / white-field radius | — | 0.119 | 0.175 | — |
| left car / right car | — | red / black | red / near-black | red / dark |

Verdicts:
- **Our ring is thinner than BMW's**: 7.7 against 9.3 px at the same outer radius, 1.6 px short. BMW's is itself
  thinner than the road-sign rule (0.226 against 0.277). Where our sign stands in BMW's seat (`all6WB`), a ring of
  **9.3 px** matches the stock look. The Vienna Convention itself fixes no ratio; national catalogues do, and the
  German one is the reference used here. *Hypothesis:* the owner reads a thin ring as "not BMW's".
- **BMW's figure is small for a road sign.** It is 41 % of the white field's diameter, where VzKat uses 60 %.
  So the stock sign is a stylised cluster icon, not a scaled road sign. Copying VzKat proportions would make ours
  look wrong next to BMW's.
- **Our no-overtaking sign is within the rule.** Its cars are about 9 % smaller than VzKat's, the gap is wider,
  and the colours match (red left, dark right). BMW's version has never been photographed, so there is nothing to
  match yet.
- Our ring colour is `#D92B0A`-ish (0.85, 0.17, 0.04), more orange than both VzKat `#C1121C` and the spec's
  stock estimate `#E2232E`. **Hypothesis:** this is visible against BMW's sign in a side-by-side, and is worth a
  look by ZL with photometry.

---

## 5. What the owner must decide

1. Whether variant A's warning marker is the outline triangle (`cc_warn`, like BMW's marker in 66/67) or the
   filled one (`cc_warn_solid`).
2. Whether the neutral marker is a dot or nothing at all.
3. Whether our sign ring goes to BMW's 9.3 px (once ZL confirms it on 61–68).
4. Whether the car's own symbol bitmap (`KISymbolStruct`) may ever be drawn live. Our default: no, we draw ours.

## 6. Sources

- BMW M3 Sedan (G80) owner's manual, X/20, p. 153–154: https://www.manualslib.com/manual/2017370/Bmw-M3-Sedan.html?page=154
- BMW X1 owner's manual, X/19, p. 123: https://www.manualslib.com/manual/3340313/Bmw-X1.html?page=123
- BMW X4 owner's manual, VI/21, p. 40: https://www.manualslib.com/manual/2459717/Bmw-X4.html?page=40
- BMW service bulletins on nhtsa.gov: listed with each id in `cc_catalogue.json` `sources`
- UN Regulation No. 121, Table 1 (MLIT copy): https://www.mlit.go.jp/jidosha/un/UN_R121.pdf
- Zeichen 274-50 (Commons, PD): https://commons.wikimedia.org/wiki/File:Zeichen_274-50_-_Zulässige_Höchstgeschwindigkeit,_StVO_2017.svg
- Zeichen 276 (Commons, PD): https://commons.wikimedia.org/wiki/File:Zeichen_276_-_Überholverbot_für_Kraftfahrzeuge_aller_Art,_StVO_1992.svg
- Community CC-ID list: https://www.tepte.com/bmw-cc-id-codes-list-and-possible-causes-id68.article
