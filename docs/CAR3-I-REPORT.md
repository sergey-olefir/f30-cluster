# Car round 3, package I: signals, the catalogue, and the sign and status widgets

Branch `car3/i` (from `main` at `02fc0e5`). Brief: `docs/AGENT-BRIEF-car3.md` §1, §2, §5. A late addition from the lead: the drive-mode field.

## 1. Result

- **One read-only script fetches the car's catalogue once and ranks six topics:**
  - the drive mode;
  - the speed limit in force, including BMW's "---";
  - no overtaking;
  - auto start/stop (MSA);
  - the local time or time zone;
  - "a check-control message is showing".

  The script is `scripts/car_signals.sh`. It also checks every signal `app.json` declares today against the car's own catalogue: flag, getter, notifier, instance and member names. That check is how the missing drive mode gets diagnosed (§4).
- **The plumbing is ready for every field**, each in the shape the script prints. It stays inert while `config.*` is `null`. The car runs as before until the owner's output names a field.
- **The "---" sign.** A fourth sign state, `unknown`, drawn ours in WBSIGN. In "6WB Dials + G20" it closes the round window over BMW's sign, like the other states do.
- **The red over-limit wedge** was checked on the bench for every sign state in every 6WB layout (§6). It shows only in the `limit` state, which is correct. Sport and Eco Pro have no wedge and no sign at all; that is a finding, and nothing was changed there.
- **The auto start/stop sign.** It is ours, in 6WB style, in all five 6WB layouts: one small effect layer (WBMSA). While MSA has stopped the engine, the rev needle rests at READY, as on the F30. The sign stays hidden until `config.msa` is wired.
- **The clock.** It uses the car's time zone once `config.clock` is wired. The order is: the `timeZone` setting, then the car, then `config.utcOffsetMinutes`. "6WB Dials" `ownClock: auto` follows it, and the layout rebuilds once when the first time zone arrives.
- **Budgets.** +1 effect layer per 6WB layout. No pixel memory, texture or asset was added (§9).

## 2. What the owner runs (one line)

From the main checkout, once the lead has merged `car3/i`:

```sh
./scripts/car_signals.sh root@<car-ip>
```

Before the merge, run it from this branch's worktree. It writes to the same `reference/` folder through the symlink:

```sh
/Users/solefir/projects/f30-cluster/.claude/worktrees/agent-a9a16042ff21dd85b/scripts/car_signals.sh root@<car-ip>
```

**Read only.** Over SSH it runs `cat` and `grep` and nothing else:
1. `cat /etc/oap/someip/someip-interfaces.json` (the catalogue);
2. `cat /etc/localtime`;
3. `cat /etc/timezone` and `grep` for TZ lines.

Nothing on the car is written, started, stopped or killed. With a password login, ssh asks for it once per call (three times).

**What it leaves in `reference/`** (git-ignored, never commit):

| File | What it is |
|---|---|
| `someip-interfaces.json` | BMW's catalogue |
| `car-localtime.tzif` | the unit's time zone file; its last line names the rule, e.g. `UTC0` |
| `car-signals.txt` | the printed report |
| `car-signals.json` | every candidate in full |

**What to send back:** say that it ran, and paste the status line of the app's Settings tab on the centre screen (the drive-mode diagnosis, §4). `reference/car-signals.txt` lands in the main checkout's `reference/`, where the lead and the next agent can read it directly. If the run happened somewhere else, send that file.

`--file reference/someip-interfaces.json` re-ranks a saved copy without SSH. After wiring, `./scripts/car_signals.sh root@<car-ip> --log` also greps the app's log for every raw-value line: `speed limit raw`, `no-passing raw`, `msa raw`, `clock raw`, `check-control raw`, `drive mode`, and subscribe errors. `scripts/find_limit_signal.sh` (package E's name) now runs the same script.

### What it prints

1. **The catalogue's shape.** The top-level keys, one interface, one field, one struct and one enum datatype, and `instanceIDs`. The catalogue has never been seen by us, so the reader is lenient: maps or lists, other key spellings. When no interface can be read, it falls back to a plain name search over the whole file.
2. **The app's own `app.json` signals against the catalogue.** For each field:
   - `ok`, or `REFUSED: no getter` / `no notifier`;
   - its getter and notifier entries and its instance;
   - the member tree (enums with their items).

   If every line reads `no such interface`, the shape reader is wrong, and the shape lines in item 1 say how to fix it.
3. **Per topic, the ranked candidates.** Each line gives the score, interface and field (or event), flag `r` / `s` / `rs`, service, instance and type. The top three show their full member tree and enum items, and the others the matching paths. Then comes `-> best: config.<topic> = {...}`.
4. **A "ready to paste" block:** a `signals` object with the right flags, and one `config.<topic>` line per topic.

Ranking is by names. Interface, field, member, type and enum-item names are matched against each topic's words. These include BMW's own words from the ID4–6 car data service: `sliActualSpeedLimitInfo`, `trafficSignInfo`, `orNPITextMessage`, `controls.startStopStatus`, `vehicle.userTimeZone` and `vehicle.systemTime` ([IDriveConnectKit CDSProperty.kt](https://github.com/BimmerGestalt/IDriveConnectKit/blob/main/core/src/commonMain/kotlin/io/bimmergestalt/idriveconnectkit/CDSProperty.kt)). Also matched: `MSA`, `startStop`, `timeZone`, `utcOffset`, `checkControl`, `ccMessage`, `drivingExperience`, `FES`, and enum items that name two drive modes or more. A field without a notifier loses points, because it can only be polled.

## 3. How each field gets wired from the output

For every topic: add the interface under `signals` with the printed flag, and paste the `config.<topic>` line. Install through the Store: a change in `signals` changes the manifest, so `deploy.sh` is not enough. Then read the `--log` lines while driving and fill in the special values. Every new raw value is logged once, together with what it became.

| Topic | `config` key | Shape (`hud.js`) | What to calibrate from the log |
|---|---|---|---|
| Speed limit | `limit` | `{ iface, field, path, factor, unit \| unitPath+mph, invalid, unknown, end, map, statePath+stateMap }` | `invalid`: no sign at all. `unknown`: BMW shows "---". `end`: the derestriction sign. If the field carries a separate state member, `statePath` + `stateMap` (`unknown` / `none` / `end` / `limit`). |
| No overtaking | `nopass` | `{ iface, field, path, on }` | `on`: the raw values with BMW's no-overtaking sign. |
| Auto start/stop | `msa` | `{ iface, field, path, map: { raw: 'active'\|'off'\|'stopped'\|'unavailable'\|null } }` | The script pre-fills `map` from the enum item names (e.g. `ENGINE_STOPPED_BY_MSA` → `stopped`, `*_DEACTIVATED` → `off`, `*_NOT_AVAILABLE` → `unavailable`). Check it against the car: switch MSA off, stop at a light, start cold. |
| Time zone | `clock` | `{ kind: 'offset', path, factor (1 min, 60 h, 1/60 s), dstPath+dstMinutes, invalid }` or `{ kind: 'local', hourPath, minutePath }` | `clock raw: 120 -> 120` must give the local offset: +120 in Kyiv in winter (EET). If it is off by 60, set `dstPath`; if it is off by ×60, set `factor`. |
| Check control | `ccm` | `{ kind: 'list', path }` or `{ kind: 'flag', path, on \| off }` | `check-control raw: … -> true` while a message shows (open a door, photos 42 and 43). For package G: `hud._raw('ccMsg')` is 1 / 0 / null. |
| Drive mode | `drive` | `{ iface, field, path, map: { raw: 'COMFORT' \| 'SPORT_PLUS' \| … } }` | Only if FES does not work (§4). The value goes through the existing handler (`driveModeOf` / `driveVariantOf`), so how a layout is chosen does not change. |

The kit subscribes instance `"1"` (`kit/runtime/car.js`). A candidate whose instance differs needs an instance option in the kit (lead). An `event` candidate (a broadcast) needs `_broadcasts`, not a field flag (lead).

## 4. The drive mode: why it may be missing, and what to check

**How it is declared and read today:**
- `app.json`: `"de.bmw.infotainment.drivingexcitement.FES": { "statusFESVehicleDynamicSwitchHMI": "rs", … }`. It sits next to `statusSwitchDriveDynamicSport2`, `statusActualValueTorque2` and `statusVehicleDynamicEngine`, all `rs`, all on the same proxy at instance `"1"`.
- `hud.js` `_setupVehicleData` reads `v.actualValueModeDrivingExperience`. `driveModeOf` accepts:
  - wire numbers 1–10 (1–3 Sport, 4–6 Comfort and 10 Adaptive, 7–9 Eco Pro);
  - names beginning SPORT / ECO / EFFICIEN / COMFORT / ADAPTIVE.
- A value it does not know is logged once as `drive mode not recognised: <raw>`, and the Settings status line shows it. A missing member logs `undefined`.

**What the owner's report tells apart:**

| Seen | Meaning | Fix |
|---|---|---|
| The `app.json` check shows the FES field `REFUSED: no getter` | The flag is wrong for this car. | Use `"s"`. |
| The member tree has no `actualValueModeDrivingExperience` | The path is wrong on this car. | Use `config.drive` with the right path. |
| The FES field is fine, but the `drive` topic ranks another field higher, with an enum naming COMFORT / SPORT / ECO | The mode lives elsewhere on this car. | Use `config.drive` (+ `signals`). |
| A different `instanceIDs` entry for FES | The kit's instance `"1"` is wrong. | Lead: kit option. |

**On the car** (photos 33 and 41 show an empty mode label):
1. The Settings tab's status line says either "(drive mode not seen yet)" or "(drive mode not recognised: the car sends …)":
   - "not seen yet": nothing arrived (flag, instance or field);
   - "not recognised": the field arrives with an unexpected value or member, and that value is the answer.
2. `--log` shows `drive mode …` lines and any `signals de.bmw…` / `subscribe de.bmw…` errors.
3. Do other FES values arrive? The torque % and boost readouts in the M or Sport themes come from the same interface:
   - if they do, interface and instance are right;
   - if they do not, the whole FES proxy fails.

## 5. BMW's "---" sign, and when BMW shows it

What the photos show:
- **Photo 34** (10:42, parked): BMW's 50.
- **Photos 39, 40 and 41** (10:52–10:53, standing in D in Lviv, a different street): the empty sign. It is a red ring and a white disc with three short dark dashes, the dashes spanning about 0.4 of the sign. It shows with and without the map, and both in the stock look and through our window.
- In none of these photos does BMW show no sign at all.

**Decision.** BMW shows "---" while Speed Limit Info is **on** but knows no limit: no sign read since start or since a junction, and no map limit for the road. BMW's manuals list two separate messages, "No data on current speed limit available" and "Speed Limit Info not available". A G30 owner reports the dashes when the camera reads nothing. BMW shows **nothing** when the function is off in iDrive, unavailable (camera or fault), or not running yet. This is evidence plus reasoning, not proven on the car. The raw value will settle it: with `unknown` listed in `config.limit`, the log line `speed limit raw: X -> unknown` must appear exactly when BMW shows "---" in "G20 Comfort".

**Ours** (`WBSIGN u_show.x = 3`; `hud.js` `limitState: 'unknown'`, `_raw('limitUnknown')`):
- The baked layouts draw our limit sign texture with three dashes in the ink colour. The figure text is empty in this state.
- The drawn path does the same on the drawn sign.
- In "6WB Dials + G20" the round window over BMW's sign closes. Proof: `docs/car3/i/signs_wedge_states.png`, third column, and `wb_dials_unknown_full.png`, where BMW's simulated 50 is fully covered.

## 6. The red over-limit wedge, every state in every 6WB layout

Bench 8094, manual signals at 100 km/h, BMW's simulated sign at 50 underneath: `docs/car3/i/signs_wedge_states.png`.

| Layout | limit 80 | end | unknown "---" | none |
|---|---|---|---|---|
| 6WB Comfort | wedge 80→100 + sign 80 | end sign, no wedge | "---", no wedge | no sign, no wedge |
| 6WB Comfort + BMW map | the same | the same | the same | the same |
| 6WB Dials + G20 | the same, BMW's sign covered | the same, covered | the same, covered | black, covered (wired) |
| 6WB Sport | no wedge, no sign | — | — | — |
| 6WB Eco Pro | no wedge, no sign | — | — | — |

- The wedge needs a number, so `end`, `unknown` and `none` correctly draw none.
- **Sport and Eco Pro:** their dial styles draw no wedge (WBDIAL draws `u_over` only in the Comfort branch) and their layouts have no sign. A wedge against a limit the driver cannot see would be odd, so I left them as they are. If the owner wants a wedge there, WBDIAL's owner should add it.
- On the car the wedge appears only once `config.limit` is wired. Brief point 6 is expected until then.

## 7. The auto start/stop sign (WBMSA)

**Where.** On the F30, "the READY display in the tachometer signals that the Auto Start/Stop function is ready to start the engine automatically" (BMW 3 Series 2013 owner's manual, the MSA pages). In the 6WB photos, READY marks the scale's 0 and OFF lies below it. `reference/6wb` and `docs/BAKE-*.md` show no MSA symbol (no reference shot has MSA engaged), so the symbol's spot is my choice:
- **Comfort, Comfort + map, Dials:** in the tacho between READY / OFF and the gear tray, at (RV − 0.337 R, RV + 0.418 R) ≈ (1395, 520). That is clear of the needle at OFF (17 px) and at READY, and of the mode label and tray.
- **Sport, Eco Pro** (no READY mark): at the left end of the info row (700, 670).

**States** (`docs/car3/i/msa_states.png`, `wb_comfort_msa_stopped_full.png`):

| MSA state | Ours |
|---|---|
| none (`config.msa` unset, or an unmapped value) | hidden (today on the car) |
| active (armed, engine running) | hidden: the F30 shows nothing then |
| stopped by MSA | a green Ⓐ with a circular arrow, and **the rev needle at READY** instead of OFF |
| off (deactivated with the button) | Ⓐ crossed out, white |
| unavailable (stop conditions not met) | Ⓐ crossed out, grey (`dim`) |

**Drawing.** An A in a circular arrow (open at the bottom, its head at the lower left), stroked procedurally. The cross-out is a diagonal with a black gap either side, like the G20's "A START STOP". It is our own drawing. The layer is 44 × 44 px.

**Uniforms and night.** WBMSA has 5 uniforms (`u_size`, `u_msa`, `u_fg`, `u_dim`, `u_on`), all highp, with no sampler. Its lengths are ≤ 22 px, so it is fp16-safe. The whites follow the layout theme (`nightDim` too); the green is fixed, as BMW's lamps are.

**The needle.** `hud.js` dial update: `v = msa stopped ? 0 : OFF`.

**Bench.** Manual `msa` 0–4 (a page slider) feeds `config.msa`'s field, or the stand-in `bench.MSA`.

## 8. Clock and check control

**Clock.**
- `_tzMinutes()` gives the order: the `timeZone` setting (unless Automatic), then the car's (`config.clock`), then `config.utcOffsetMinutes`.
- `_now()` and `_own('clock')` use it. For package H: use `isNum(this._tzMinutes())` for "a time zone is known". 6WB Comfort's clock is then right with no setting, once wired.
- When the first time zone arrives or goes away, the layout rebuilds once, so "auto" can flip.
- Bench: POST `/signals` `{tzCar: 120}`. The log shows `clock raw: 120 -> 120`, and "6WB Dials" rebuilds with our clock.

**Check control.**
- `hud._raw('ccMsg')`. Bench: `{ccMsg: 1}` → `check-control raw: 1 -> true`.
- Nothing draws from it yet. That is package G's call.

## 9. Budgets

Measured on bench 8094. Pixel memory and assets are unchanged: WBMSA is an effect layer with no image or sampler.

| Layout | Layers before → after (per connection) | Pixel memory |
|---|---|---|
| 6WB Comfort | 19 (6+6+7) → 20 (7+6+7) | 11.3 of 16 MiB |
| 6WB Comfort + BMW map | 19 (6+6+7) → 20 (7+6+7) | 10.6 MiB |
| 6WB Dials + G20 | 18 (6+6+6) → 19 (7+6+6) | 11.1 MiB (11.3 while our clock shows) |
| 6WB Sport | 13 (7+2+4) → 14 (7+3+4) | 2.5 MiB |
| 6WB Eco Pro | 15 (7+6+2) → 16 (7+7+2) | 2.6 MiB |

- Every connection stays ≤ 8, and every layout ≤ 32 in total.
- Uniforms: WBSIGN still 7 (2 samplers, both bound); WBMSA 5.
- No scene texture was added. The "---" sign reuses `sign_limit`.

## 10. Files

| File | What changed |
|---|---|
| `scripts/car_signals.sh` | new: the one script |
| `scripts/find_limit_signal.sh` | now a wrapper that runs `car_signals.sh` |
| `tools/signals/catalog.py` | new: replaces `find_limit.py` |
| `shared/hud.js` | `car3 I` blocks: `limitOf` unknown / `statePath`; `msaOf` / `tzOf` / `ccOf`; the `config.msa` / `clock` / `ccm` / `drive` subscriptions; `_raw` limitUnknown / msa / ccMsg; `_tzMinutes`; the `wbmsa` widget; the needle at READY; the "---" state in the sign, wbback and the window cover |
| `shared/shaders.js` | WBSIGN "---"; new WBMSA |
| `shared/layouts.js` | the `wbmsa` type |
| `design/gen_6wb.py` | the marked `msa_sign()` helper and one call line in `comfort()`, `dials()` and `glowing()` |
| the five `wb_*.json` layouts | regenerated |
| `apps/f30_cluster/app.json` | `config.msa` / `clock` / `ccm` / `drive: null`, their shapes in `config._car3`, and `_limit` updated |
| `bench/run-app.js`, `bench/page.html`, `bench/README.md` | the stand-ins and manual values |
| `docs/car3/i/*` | proof images: our bench renders only |

## 11. What the owner must check on the car

1. Run the command in §2, then report that it ran and the Settings tab's status line. Nothing is written to the car.
2. **Drive mode:** read the status line as in §4. If it says "not recognised: X", send X.
3. After the lead wires the fields and the app is reinstalled through the Store, check each of these in "G20 Comfort" (BMW's sign visible) while driving:
   - `--log` shows `speed limit raw` for 50 / 80 / "---" / the end sign;
   - `msa raw` at a stop with MSA on, after pressing the MSA button, and with a cold engine;
   - `clock raw` equals the local offset (+120 in winter);
   - `check-control raw` turns true with a door open.
4. **6WB layouts:**
   - our "---" shows exactly when BMW's would;
   - the red wedge shows over the limit in the Comfort-style dials;
   - at an MSA stop the rev needle rests at READY and the green Ⓐ shows;
   - with MSA off, the crossed Ⓐ shows;
   - our clock reads local time without the `timeZone` setting.
5. Check that nothing of ours covers a telltale. The MSA sign sits inside our own tacho (1373–1417 × 498–542) or left of the Sport / Eco Pro info row (678–722 × 648–692). No BMW lamp lies there (`shared/visible.js`).

**Choices for the owner:**
- the MSA sign's spot and colours;
- whether Sport and Eco Pro should get a wedge too (§6);
- "6WB Dials" clock "auto" now follows the car's time zone (§8).
