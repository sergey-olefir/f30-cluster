# Twin Dial probe: what the owner does at the car (P1 to P12)

Package F, round 2. SPEC section 17.1. The probe build of Twin Dial subscribes the fields VS listed (`design/twin-dial/vs/signals.json`,
`docs/twin-dial/VS-REPORT.md` section 5) **read only** and writes what the car says into the app's own log. This file is the
step-by-step for the owner: what to do for each item, which log lines to read, and how each result becomes a config value.

Status words as in the SPEC: **hypothesis** = not proven on the car. Everything about the car's behaviour below is a hypothesis
until the log says otherwise; the log lines shown are from the bench (invented values), not from the car.

## 0. Before the car

**Owner approval is needed when the car is online** (SPEC 17.1). The lead makes the probe build, you install it:

1. `python3 tools/twin-dial/probe_build.py on --version <the probe's version>` turns `apps/twin_dial/app.json` into the probe build
   (config.probe on, the extra read-only signals of `apps/twin_dial/probe/probe.json`, `twin_probe.js` in `shared`). It records what it
   added; `probe_build.py off` takes exactly that out again. `probe_build.py check` runs `tools/signals/check_signals.py` on both states.
2. Build and install as for any app (Store, `kit/tools/build.py twin_dial`). A new version number is probably needed for the Store to update an installed app (hypothesis; `--version` sets it).
3. f30_cluster off (how: SPEC 14.5); only one cluster app draws at a time (SPEC 14.5). The probe build still draws the dials
   as the normal build does; it only logs more. **Nothing is ever written to the car.** No message is sent, no symbol is requested,
   no setter exists in the declarations.
4. The log: `/var/opt/public/oap/oap_<uid>/data/twin_dial.log` (SPEC 14.4; `<uid>` is assigned at install, read it from the car,
   12211 is f30_cluster's). Every probe line contains `probe:`; to bring them back:

   ```
   grep ' probe: ' /var/opt/public/oap/oap_<uid>/data/twin_dial.log
   ```

**Safety.** The car is parked for every item except P12 (and P6's drive afterwards). Whoever operates the car's menus is not the
driver on the road. Nothing in this protocol needs a risky action: doors, boot, bonnet and the phone are the car's own, normal ones.

**Privacy.** The lines carry numbers, enum names and **lengths** of texts, never a text, never a coordinate, never a road name, never
a byte of a symbol. Two lines do carry your own numbers: the odometer (P3) and the trip's departure date and time (P4). Black those
out if you paste the lines anywhere public.

## 1. Reading a line

```
probe P3 range-tank #2 t=41.3: fuel=38 fuelL=255 fuelR=255 spare=NICHT_AKTIV range=412 mileage=48215
```

| Part | Meaning |
|---|---|
| `P3` | the probe item |
| `range-tank` | the field (the table in section 3 maps names to car fields) |
| `#2` | how many lines this field has made (a field is logged **once per change**, so `#1` is its first value) |
| `t=41.3` | seconds since the app started its probe (use it for timing: P6, P8, P9) |
| `name=value` | `-` = the car sent nothing for it; `?` = something of the wrong kind arrived (tell us); text is only ever `…-len=N` (its length) |
| `(+2 folded)` | the field changed faster than once a second; the last value is shown, 2 earlier ones were folded away |
| `(the last line for this field)` | the field hit its line limit (60, coolant 240); it will not log again this run |

Enums print as their **name** (`KILOMETER`) or, if the car's binding hands a number, as the number (`1`); both are fine, write down
which you see. Bit fields print as `N(0xH)`.

Other lines:

```
probe: twin_probe 1 on: 45 fields of P1..P12, read only; text only as lengths, never coordinates or bitmaps
probe: summary t=30: 14 of 45 fields have spoken: P1 active-cc(2 events, 2 lines), ...
probe: summary t=30: silent: P7 doors, P8 player-metadata, ...
```

The summary comes at 30 s, 2 min and 10 min after start. **A field that is in the "silent" list after you did its action did not
notify**: that is an answer too (the car has proven that a catalogue field may never be sent: `newCCMessage`). Also look for the
platform's own `signal <Interface> subscribed` / `signal <Interface> error: ...` lines, which say whether an interface could be
subscribed at all; an `error` line makes that interface's items silent.

## 2. Session plan (about 45 minutes, car parked, engine off to start)

Order that saves the most time: **P6 first** (it needs a cold engine), then the stationary items with the engine running, then P12.

1. P5 (read once), P3, P4 (compare with the car's own pages), P6 (cold start, then leave the engine running).
2. P1, P2 (door messages), P7 (doors, boot, bonnet).
3. P8 (media sources), P9 (a call), P11 (the stalk button and cluster views).
4. P10 (engine off, on).
5. P12 (a short guided drive; a passenger operates the navigation).

## 3. The items

### P1. Which message the cluster shows now (decides D7)

*Fields:* `P1 active-cc` (cluster: message shown now), `P1 displayed-cc` (second witness), `P1 menu-cc` (frame n of m and the numbers on
frame), `P1 ccList` (names only as lengths). *Why:* the strict rule D7 (SPEC 8.4) keeps BMW's panel visible until the car has once
delivered a "shown now" number that matches a ccList entry.

1. Engine on, ready. Wait until BMW's panel is back at rest.
2. Open the **driver's door**. BMW shows a message. Note the time. Leave the door open until BMW hides the message by itself (about 20 s).
3. Close the door. Open the **driver's door and a rear door together**: BMW may cycle two messages (frames 1/2, 2/2). Wait for a full cycle,
   close both.
4. Repeat step 2 once more (does the number come back the same?).

*Read:* while the message is on the cluster, `active-cc number=N` and `displayed-cc number=N` and the `ccList` line (`id=N`).

| Result | Meaning | Becomes |
|---|---|---|
| `active-cc number` equals the `id` of the matching `ccList` entry during the message, and returns to `0` when BMW hides it | the "shown now" hypothesis holds | the lead may set `config.ccActive.strict` to `false` (D7 lifted, **owner's decision**); until then it stays `true` |
| `displayed-cc number` equals it too | second witness confirmed | keep `ccDisplayed` as the cross-check |
| the numbers appear but never equal a ccList id | the numbering differs | keep `strict` true; send the two lines, the mapping is a new task |
| `active-cc` silent after the doors | field does not notify | keep `strict` true; the window is always open while a message may show |
| `menu-cc frameNumber/frames` follow the cycle (1/2, 2/2) | we can follow BMW's cycling | the counter "n/m" (SPEC 8.1) may be drawn |

### P2. The stored-message marker

*Fields:* `P2 basicList`, `P2 ccListRiskClass` (twin_dial does not use the old 0.7.18 probe handlers: the same fields are logged here).
*Why:* BMW draws a small marker at the right of its panel (SPEC 3.3 [1240, 588, 1288, 630]) when stored messages exist; we cover it
until a signal for it is confirmed.

1. First read f30_cluster's 2026-11-17 log, the `probe: basicList:` and `probe: ccListRiskClass:` lines (the 0.7.18 probe): the result
   was never recorded in the repo (VS-REPORT section 2, point 6).
2. In the probe build, repeat the door message of P1. Watch BMW's marker: photograph it (marker visible / not visible) at the time you read.

*Read:* the `basicList` entries `[id=.. reason=.. state=AKTIV|INAKTIV]` and the `ccListRiskClass` entries.

| Result | Becomes |
|---|---|
| an entry whose `state` switches `AKTIV` / `INAKTIV` exactly when BMW's marker appears / disappears | `config.ccMarker` (iface `CheckControlMaster`, field `basicList`, the `state` value that means stored): drawn in a later round, not round 2 |
| `reason=CCM_SHOWN_BY_IC` entries that stay while the message is only stored | same, with `reason` as the key |
| `ccListRiskClass` has `risk=RK..` that rises with severity | optional: severity from risk class instead of colour |
| nothing correlates with the marker | marker stays covered (D7) |

### P3. The odometer

*Fields:* `P3 range-tank` (first choice: `mileage=`), alternatives `P3 range-alt`, `P3 mileage-supreme`, `P3 mileage-secure`.

1. Ignition on. Write down the odometer as the **cluster** shows it (a photo of the cluster or iDrive's vehicle info page).
2. Read the first `P3 range-tank` line and the alternatives. Switch the engine off and on once more: does `mileage=` change shape (`-`, or a
   value like 16777215 for "invalid")?

| Result | Becomes |
|---|---|
| `mileage=N` equals the displayed km | `config.odometer.factors.rangeTank = 1` (the default), field `statusRangeTankStatus.mileageKilometre` |
| `mileage` = 10 x or 1/10 of the display | `config.odometer.factors.rangeTank` = 0.1 or 10 |
| `mileage=-` or constant 0 / 16777215 while an alternative matches | the normal build already falls back to the next carrier (`config.odometer.order`: rangeTank, supreme, range, secure; research3/MK); set that carrier's factor |
| an "invalid" value you saw at start (for example 16777215) | 0 and 16777215 or above are no value already (the bottom row shows "–") |
| `P3 mileage-secure manipulation=` not 0 | note it and send the line; it is not used by the app |

### P4. The trip computer

*Fields:* `P4 bc-average` (average speed and consumption, counters 1 and 2), `P4 bc-travel` (distance, time), `P4 bc-start` (departure),
`P4 bc-status2`, alternative `P4 bc-all3` (the newer trip structure), and since research3/MK the wide net `P4 bc-all1`, `bc-avgcons1`,
`bc-all2`, `bc-segment`, `lsc-cluster`. *Why:* since research3/MK the normal build shows the most likely factors by default and logs each
UNVERIFIED (docs/research3/MK-PROTOCOL.md is the five-minute check); the probe is for the case where the normal build's summary names
KombiIF and ResetLogic3 SILENT.

1. Open the car's own trip computer page in iDrive (and, if you can, the cluster's own trip page). Write down for **both** counters
   (the car's names are, for example, "since start" and "since refuelling"): average consumption, average speed, distance, driving
   time, and the departure time of the "since start" one. Do it parked, after a short drive of at least a few minutes.
2. Read `bc-average`, `bc-travel`, `bc-start`. If `bc-average` stays silent in the summary, read `bc-all3`.
3. Match the numbers. You will see integers; the display has decimals.

| Observation | Becomes |
|---|---|
| `cons1=68` and the display says 6.8 l/100 km | `config.trip.factors.cons = 0.1` (the default; `consUnit` says litres per 100 km: `VERBRAUCH_IN_L_S_100KM` / 1) |
| `speed1=41` and the display says 41 km/h | `config.trip.factors.speed = 1` (0.1, the default, if `speed1=412` for 41.2) |
| `way=124` and the display says 12.4 km | `config.trip.factors.way = 0.1` (the default; 1 if the display says 124) |
| `hours`, `minutes` match the driving time | plain, no factor |
| the counter whose departure (`hour`, `minute` in `bc-start`) equals the departure shown for "since start" | `config.trip.factors.bc` = 1 or 2 (the suffix 1 / 2 in `speed1` / `speed2`, `cons1` / `cons2`) |
| `speedUnit` / `consUnit` other than km/h and l/100 km | the app logs it and keeps km (SPEC 12); mph or mpg are a later variant |
| `65535` where no trip exists | the "none" value: the page shows "–" |

The numbers go into `config.trip.factors` (research3/MK: on by default, a key overrides its default), the counter into `config.trip.factors.bc`; no code changes. If
you reset the trip yourself on the car's own page (we never reset), watch `bc-travel` fall to `way=0` and `bc-start` change: that
proves which counter it was.

### P5. Units

*Fields:* `P5 units` (`mileage=KILOMETER` or `MEILEN`), `P5 external-display` (`tempUnit=C` / `F`, the cluster's outside temperature and
range). Read once after ignition on. Becomes: nothing if kilometres and Celsius; otherwise the log line proves a mph/mile variant is
needed (SPEC 12 keeps km and says so in the log). The `outside=` and `range=` values are raw numbers with no known scale (hypothesis): write down what the cluster
shows next to them, so the scale can be read off (send the pair).

### P6. Cold start to warm

*Fields:* `P6 engine-verdict` (the car's own verdict: `COLD`, `OK`, `HOT`, `STRICHE`), `P6 coolant` (raw 8-bit value and the temperature
computed as raw - 48 C; lines can come every few seconds).

1. A cold engine (parked for hours). Ignition on, **start the engine**, let it idle or drive gently for 10 to 15 minutes.
2. Read the `P6 coolant` lines and `P6 engine-verdict` lines. Note the `t=` of the verdict change `COLD` -> `OK` and the coolant
   temperature of the line just before and after.

| Result | Becomes |
|---|---|
| the verdict changes at a stable temperature (for example `COLD` until 50 C) | the bar's empty point (SPEC 5.2: 50 C -> empty) is replaced by that value; `config.coolant.coldC` |
| `OK` covers the normal range; `HOT` appears above X C | `config.coolant.hotC` (the red last segment, SPEC: 120 C by hypothesis) |
| the verdict is silent but the coolant raw value moves | keep the 50 to 130 C linear hypothesis |
| `engine-verdict` fires but the coolant value does not | the bar uses the verdict (four steps) instead |

### P7. Doors, boot, bonnet

*Fields:* `P7 doors` (four door switches, boot lid, bonnet, second flap; **notifier only**, nothing arrives until something changes),
`P7 lids` (bonnet, has a getter), `P7 zv-status` (central locking, boot lid unlocked).

1. Engine off, ignition on. Open and close **one at a time**: driver, front passenger, rear left, rear right, boot, bonnet (a passenger
   may do the bonnet). Wait 3 s between each.
2. Note after each action which `P7` line appeared.

*Read:* which line changes for which action, and which enum name means "open" (for example `FAT_IST_OFFEN`, `HK_IST_GESCHLOSSEN`).
*Becomes:* a table door -> field -> open-value for the later car picture (not drawn in round 2), and the answer to "does it send once at
subscribe" (a `#1` line at `t` of a few seconds with no action means yes; otherwise the picture starts "unknown", never "closed").

### P8. Media

*Fields:* `P8 player-metadata` (the two lines the head unit shows: types and **lengths**), `P8 active-source` (length, and which
`sources` entry it is), `P8 sources` (the list: `type=TUNER_FM`, `MEDIA_PLAYER`, ...).

1. Play in turn: **FM radio**, **USB**, **Bluetooth audio**, **CarPlay audio**. For each: let a station or track show its name
   (two lines in the car's media display) and note the **title's character count** by counting, and the second line's (artist or station).
2. Read `player-metadata`: `line1-type=` / `line2-type=` (`TITLE`, `ARTIST`, `ALBUM`) and `line1-len=` / `line2-len=`.

*Match by counting:* the line whose length equals the number of characters you counted is that text (we never log the text; count
letters, spaces and punctuation). Also read `active-is-entry=K` and the `type=` of `sources` entry `#K`: that is the source type (FM, USB, ...).

| Result | Becomes |
|---|---|
| `player-metadata` fires on every track change (`track=` changes) and one line is the title | `config.media.titleLine` = 1 or 2; the tab bar's media text (SPEC 6.1) is drawn from it, still never logged |
| `active-is-entry=K` is a number for each source | `config.media.sourceTypes` (`type` -> `td_radio` / `td_media` icon) |
| silent for CarPlay or Bluetooth | those sources show the icon only |
| `player-metadata` silent altogether | the media cell stays icon only (the SPEC's fallback) |

### P9. A call

*Fields:* `P9 call-state` (`DISCONNECTED`, `INCOMING`, `ACTIVE`, `DIALING`, `HELD`), `P9 carplay-call` (true or false when the call is on a
CarPlay phone).

1. Phone paired. Call the car from another phone; **do not answer**, wait for a few rings, hang up on the caller side.
2. Call again, **answer**, speak, then **hold**, then end it.
3. A call **out** from the car (dial a number you know).
4. If you use CarPlay, repeat step 2 on it.

*Read:* the sequence of `state=` with `t=`. *Becomes:* `config.phone.active = [names that mean "a call is on"]`; the phone tab's icon is
brighter then (SPEC 6.1). A call that never changes the line: the icon stays dim.

### P10. Voltage

*Fields:* `P10 voltage-basic` (`voltage=N`), `P10 voltage-hu` (the head unit's supply: `value=N`), `P10 battery-condition` (a charge condition
byte, not a voltage). Hypothesis: 0.01 to 0.05 V per bit (voltage-basic), millivolts (voltage-hu).

1. Ignition on, engine **off**: read the three lines. Then **start the engine**: read again. Switch off: read again.
2. If you can, read the battery voltage the car itself reports in a diagnostics page or from a meter at the socket: write it down per state.

| Result | Becomes |
|---|---|
| a value that scales to 12.0 to 12.8 V with the engine off and 13.8 to 14.8 V running | `config.battery = { field, factor }`; shown in a later round (not drawn in round 2) |
| `-` or no change at all | no battery readout |
| only `battery-condition` changes | it is a state, not a voltage: no number to draw |

### P11. The stalk button and the cluster view

*Fields:* `P11 ic-widget`, `ic-context` (the head unit's view), `ic-widget2`, `ic-context2`, and the cluster's own `P11 kombi-selection`,
`kombi-available`, `kombi-config`, `display-kombi`. *Why:* SPEC 6.2: a stalk-button signal would replace the `cycle` setting later.

1. Engine on. Press the **trip/BC button on the indicator stalk** once and wait 2 s; do it through **all pages** and back to the first, and
   write down the page the cluster shows after each press (1, 2, 3 ...).
2. In iDrive change the **instrument cluster view** (wherever the car offers it: for example Standard, calm, Individual, Sport), then the cluster map on/off.
3. Read every `P11` line with its `t=`; pair each with your press number.

| Result | Becomes |
|---|---|
| a field that changes on every press and cycles through a small set of values | the stalk signal: `config.page = { field, member }`, replaces `centre: cycle` in a later round |
| a field that changes only with the iDrive view (step 2) | the cluster view: note it; a later round may follow it |
| nothing moves | no signal; `centre` stays the setting |

### P12. A guided route

*Fields:* `P12 guiding-state` (`INACTIVE` / `CALCULATING_ROUTE` / `ACTIVE`), `P12 next-intersection` (how many text parts, only their
lengths, the spacer kinds, the distance as a number and unit, and `parse<=Xms`, the largest time spent making the line).

1. A **passenger** starts guidance to any destination 10 to 20 minutes away. Drive the first few turns.
2. Read the `next-intersection` lines as the turns approach: `raw=` should fall (the next manoeuvre's distance), `unit=` says metres or km,
   `distance-len=` is the length of the car's formatted distance text.

| Result | Becomes |
|---|---|
| `elements=3` with `[text len=..]` parts and `raw=` falling | the centre guidance page (later) can use road description, distance and unit |
| `parse<=` below 2 ms | the field is cheap enough to read in the tick; above 10 ms: parse it off the draw path |
| the line stays silent while `guiding-state=ACTIVE` | no manoeuvre field: no guidance page |
| the turn arrow | **not in this field** (its struct holds the road description, the service icons and the distance only): a direction field is still to be found |

Road names, street names and positions are never in the line (only counts and lengths).

## 4. Where each result goes (summary)

| Item | Config key (SPEC 14.2) | Set by |
|---|---|---|
| P1, D7 | `config.ccActive.strict` (true until the owner decides), `ccDisplayed` | owner decision, lead edits `app.json` |
| P2 | `config.ccMarker` (later round) | lead |
| P3 | `config.odometer = { factors: { rangeTank, supreme, range, secure }, order, verified }` (research3/MK) | lead |
| P4 | `config.trip = { factors: { bc, speed, cons, way, rl3: { speed, cons, way } }, order, departureUtc, verified }` (research3/MK) | lead |
| P5 | none (km and km/h; log proves) | none |
| P6 | `config.coolant = { coldC, hotC }` | lead / C |
| P7, P10, P11, P12 | notes for later rounds | none in round 2 |
| P8 | `config.media = { titleLine, sourceTypes }` | lead / C |
| P9 | `config.phone.active` | lead / C |

The keys are proposals (hypothesis): the app reads only what package C's tokens read. A result that needs a key the app does not read
yet is a one-line task for C, not a code change in the engine.

## 5. After the session

Bring back `grep ' probe: ' twin_dial.log` (black out the odometer and trip date if you like), plus one line per item with what you did
and saw on the cluster (the displayed numbers you compared with). Then `python3 tools/twin-dial/probe_build.py off` and rebuild: the
normal build declares only SPEC section 11 and has no `config.probe`. The probe build is **never** the one that stays in the car.

## 6. What the probe cannot do

It does not write, press, request or call anything; it does not read text; it does not know the car's numbering for messages (P1) or
units (P3 to P5) until you compare. It cannot tell a field the car never sends from a field that has had no event yet: the summary lines
and your actions decide. The Node the car runs is 8.16: `twin_probe.js` uses only what it has (the bench test checks the source), but it
has run on the bench's newer Node only: the first car run is its first on 8.16 (hypothesis).
