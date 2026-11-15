# Feature audit (branch `audit/features`, 2026-11-15)

The owner's request: "Audit the app feature by feature: what it actually supports today, what it draws wrong, and
what the car offers that we are not using." Lead item: the tachometer's **READY / OFF** behaviour at an auto
start/stop (MSA) stop.

**The car was offline for this work. Nothing was run on it, no SSH, no UDS.** Everything below comes from one of
four places, and every claim says which:

| Mark | Means |
|---|---|
| **code** | read in this repository at `audit/features` (from `main` c7b8097) |
| **bench** | measured on the Mac bench, port 8150, `node bench/server.js f30_cluster` |
| **catalogue** | the car's own SOME/IP catalogue, captured 2026-11-14 and kept out of git: `reference/car/2026-11-15/someip/` (`someip-interfaces.json`, 689 interfaces, 5100 members; `all-signals.tsv`) |
| **photo** | the reference pictures in `reference/` (third-party, git-ignored) |
| **hypothesis** | reasoned, not shown. Each one names the car check that settles it. |

Two other branches are working in the same files. **`feat/bottom-row` owns the speed-limit sign, the
check-control message and the bottom road label** (`config.limit`, `config.nopass`, `config.ccm`, their widgets and
a settings group); **`design/g20-spec` owns the stock-design measurements.** This audit names those gaps but does
not implement them. What this branch changed is listed in section 10 — three files, six hunks.

---

## 1. Start/stop, READY and OFF

### 1.1 What the stock cluster does

**photo.** `reference/6wb/05_comfort_tach-closeup.png` and `03_three-modes_photo_bimmerstop.png` (a real car, three
drive modes):

- The rev dial has two marks below the idle end: **READY** at the scale's zero, **OFF** about 20° further
  anticlockwise, at the end of a short thin arc.
- **Both labels are printed all the time.** READY is white, OFF is a dimmer grey, and they stay that way whatever
  the needle does: in photo 05 the needle rests on OFF and OFF is still the dim one. The needle, not the label,
  carries the state.
- **Comfort and Sport both have READY and OFF.** **Eco Pro does not** — its right dial is the
  CHARGE / POWER efficiency dial, with no rev scale.

What each position means (owner's brief, and BMW's 3-Series manual as quoted in `docs/CAR3-I-REPORT.md` §7):
**OFF** = ignition off / the car is not live. **READY** = the engine is stopped but the car is ready to drive —
which is what auto start/stop produces at a standstill.

### 1.2 What our app does today

**code**, `shared/hud.js` `_update`, the `dial` branch (before this branch's change):

```js
if (w.off && w.measure === 'rpm' && !(isNum(raw) && raw >= 150))
    v = this._raw('msa') === MSA_STATES.stopped ? 0 : -w.off / (w.sweep === undefined ? 270 : w.sweep);
```

- `w.off` is the layout's `"off"` parameter (`20.5`, degrees before the scale's start). It reaches the shader twice:
  as `u_zone.w` (`u_pre`, in radians, at layer creation) and through the value: `v` is set to `-off / sweep`
  = `-20.5 / 240.75` = **−0.085** of the sweep.
- In **WBDIAL** (`shared/shaders.js`) `u_pre` does two things: `float val = clamp(u_value, -u_pre / u_sweep, 1.0)`
  (so the needle can go below zero, but no further than the OFF mark), and, in the *unbaked* Comfort path only,
  it draws the thin arc back to the OFF mark and the OFF tick (lines 1257–1263). With `baked` on — the default,
  and what the car runs — that arc and tick come out of the `tacho` scene texture instead.
- `this._raw('msa')` is `MSA_STATES[this.msaState] || null`, and `this.msaState` is only ever set by
  `watchRaw(this.config.msa, ...)`. **`config.msa` was `null` in `apps/f30_cluster/app.json`, so nothing was
  subscribed and `msaState` stayed `null` for the whole life of the process.**

**So, on the car, the second branch always won.** The needle went to the OFF mark whenever rpm was below 150 or
not a number. The READY branch could not fire. **code.**

**bench, before the change.** `POST /signals {"mode":"manual","values":{"rpm":0,"msa":0}}` →
tacho `u_dyn = [-0.085, …]` (OFF). With `"msa":3` → `u_dyn = [0, …]` (READY). The READY path works — but only on
the bench, because `bench/run-app.js` installs a stand-in interface `bench.MSA` whenever `config.msa` is unnamed
(line 162). **That is why this was never caught here: the bench exercised a path the car could not reach.**

### 1.3 The three faults

1. **At an MSA stop the needle fell through READY to OFF.** rpm decays through the 120 ms filter to zero; the
   moment the filtered value crosses 150 the needle jumps from 0.02 of the sweep to −0.085 — about **25° in one
   step**, straight past READY. **code**, confirmed on the **bench**.
2. **The OFF state was not handled either — it was the only state.** Parked, driving with a dead rpm signal, and
   the first moments after a rebuild all give the same answer: OFF. There is no check that the car is live, and
   no staleness check on rpm: `car.js` keeps the last value in `live` for ever, so a signal that stops arriving
   leaves the needle wherever it was, while a signal that is *invalid* (`65535` → `null`) parks it at OFF even at
   speed. **code.**
3. **The READY and OFF labels are plain static text widgets** — `wb_comfort.json` / `wb_dials.json` ids `ready`
   (colour role `fg`) and `off` (role `dim`), no `toggle`, never repainted with state. **This is correct**: it is
   what the stock cluster does (§1.1, **photo**). Leave them alone.

Also found while looking (**code**):

4. **6WB Sport and 6WB Sport + G20 have no READY/OFF at all**: their tacho has no `"off"` parameter and the
   layouts have no `ready` / `off` text widgets, so at a stop the needle sits at bare zero with nothing to read.
   The stock Sport face does have both marks (**photo** 03, bottom panel). 6WB Eco Pro correctly has neither.
5. The **WBDIAL OFF arc and mark are only drawn by the `STYLE 0` (Comfort) branch**. Giving the Sport tacho an
   `"off"` would clamp the needle but draw no mark; the Sport face needs the arc added to the shader's
   `STYLE 1` path or baked into its texture. That is design work, not part of this fix.

### 1.4 The signals that settle it

All three are in the car's own catalogue, instance 1. **catalogue.**

| Interface / field | Flags | Member | Values |
|---|---|---|---|
| `de.bmw.infotainment.vehicle.CDS` `statusEngineStatus` | **rs** | `statusEngineRunDrive` | `MOTOR_AUS` 0, `MOTOR_STARTET` 1, `MOTOR_LAEUFT` 2, `SIGNAL_UNGUELTIG` 3 |
| `de.bmw.infrastructure.VehicleCondition` `VehicleCondition` | s | `statusConditionVehicle` | `PARKEN_BN_NIO` 1, `PARKEN_BN_IO` 2, `STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG` 3, `WOHNEN` 5, `PRUEFEN_ANALYSE_DIAGNOSE` 7, **`FAHRBEREITSCHAFT_HERSTELLEN` 8**, **`FAHREN` 10**, `FAHRBEREITSCHAFT_BEENDEN` 12, `SIGNAL_UNBEFUELLT` 15 |
| `de.bmw.infotainment.vehicle.Vehicle` `statusMotorStartAuto` | s | `statusConditionMSA` | `INITIALISIERUNG` 0, `FUNKTION_PASSIV` 1, `FUNKTION_AKTIV__MINUS__MOTOR_LAEUFT` 2, `MOTORSTOPP_BEABSICHTIGT` 3, `…_MIT_GAA` 4, `…_MIT_NUEN` 5, `MOTORSTOPP_IM_GANG` 7, **`MOTOR_AUS` 8**, `MOTORSTART_MIT_STARTSYSTEM` 9, `MOTORSTART_DURCH_VERBRENNUNGSENERGIE` 10, `FUNKTION_PASSIV_DURCH_BEDIENELEMENT` 12, `RESERVIERT` 13/14, `SIGNAL_UNBEFUELLT` 15 |

A fourth, the button only: `de.bmw.infotainment.vehicle.CDS2` `statusPushButtonMSA2` → `statusFunctionMSA`
(`MSA_DEAKTIVIERT` 0, `MSA_AKTIVIERT` 1, `SIGNAL_UNGUELTIG` 3), **rs**. Not used by the fix; see §5.3.

Three of the four interfaces (`CDS`, `CDS2`, `Vehicle`) were already declared under `signals`, so adding a field
costs nothing. `VehicleCondition` is new — and the **kit already knows it**: `kit/runtime/car.js` has a
`condition` group (line 150) that puts `data().condition`, with the comment "10 = FAHREN (drive-ready / READY,
also with the engine off on a hybrid". `shared/hud.js` simply never asked for that group. **code.**

### 1.5 The mapping

| Needle | When |
|---|---|
| **on the scale** | rpm ≥ 150 |
| **READY** (scale 0) | engine not turning *and* the car is live: `config.msa` says `stopped`, **or** `condition` is 8 or 10, **or** `statusEngineRunDrive` says `MOTOR_LAEUFT` while rpm is missing |
| **OFF** (−`off`°) | everything else: parked (`condition` 1/2/3), `WOHNEN` (5), diagnosis (7), or nothing known yet |

The last row keeps today's behaviour for the case the photos show: a lit cluster, ignition on, engine never
started, needle on OFF (**photo** 05). `WOHNEN` is terminal R / radio-on, so OFF is right there too.

The MSA icon's own state map (`config.msa.map`, raw `statusConditionMSA` → our four words):

| Raw | Ours | Icon |
|---|---|---|
| 0 `INITIALISIERUNG`, 13/14 `RESERVIERT`, 15 `SIGNAL_UNBEFUELLT` | `null` | hidden |
| 1 `FUNKTION_PASSIV` | `unavailable` | crossed out, dim (stop conditions not met) |
| 2 `…AKTIV_MOTOR_LAEUFT`, 9/10 `MOTORSTART_…` | `active` | hidden — the F30 shows nothing while MSA merely waits |
| 3, 4, 5, 7 `MOTORSTOPP_…`, 8 `MOTOR_AUS` | `stopped` | green Ⓐ, **and the needle at READY** |
| 12 `FUNKTION_PASSIV_DURCH_BEDIENELEMENT` | `off` | crossed out, bright (switched off with the button) |

Both the enum names and the wire numbers are in the map, because the SDK hands enums over either way
(`kit/runtime/car.js` says so for gears). **catalogue** for the values; **hypothesis** for which of the four words
each raw value deserves — the app logs `msa raw: <raw> -> "<word>"` once per new value, so one drive settles it.

### 1.6 What was implemented on this branch

Small and local, 6 hunks in 3 files (§10). **code + bench.**

- `apps/f30_cluster/app.json` `signals`: `CDS.statusEngineStatus` (`rs`), `Vehicle.statusMotorStartAuto` (`s`), and
  a new `de.bmw.infrastructure.VehicleCondition` with `VehicleCondition` (`s`).
- `apps/f30_cluster/app.json` `config.msa`: wired to `Vehicle.statusMotorStartAuto` with the map above (was `null`).
- `shared/hud.js`: `COND_READY` and `ENGINE_RUN` constants; a `CDS.statusEngineStatus` handler that keeps
  `this.engineRun` and logs each change (`engine: running (2)`); `'condition'` added to the `Car` groups; a new
  `_restFrac(w)` that returns the rest position; the one `dial` line now calls it.
- `bench/run-app.js`: the manual feed also sends `statusEngineStatus` and `VehicleCondition`, so the states can be
  driven from `POST /signals` (`engine`, `condition`).

**Verified on the bench (port 8150), tacho `u_dyn.x`:**

| Manual values | Expected | Measured |
|---|---|---|
| `rpm 0, engine 0, condition 2` (parked) | OFF | **−0.085** |
| `rpm 0, engine 0, condition 5` (WOHNEN) | OFF | **−0.085** |
| `rpm 0, engine 0, condition 10` (FAHREN) | READY | **0** |
| `rpm 0, engine 0, condition 2, msa 3` | READY | **0** |
| `rpm 3000, condition 10` | 0.4 of the sweep | **0.4** |

`u_msa` followed: 0 hidden, 1 hidden (active), 3 green. `bench/test-native-ui.js` on port 8151: **42 passed,
0 failed** (no regression). The app log showed `msa raw: 12 -> "off"`, `signal VehicleCondition subscribed`,
`engine: running (2)`.

### 1.7 What only the car can settle

1. **Does `statusConditionMSA` arrive at all?** It is flag `s` — a notifier with no getter, so the first value
   comes with the first change, not at subscribe. *Check:* start the car, stop at a light with MSA on, and grep
   the app log for `msa raw`. If nothing appears, the needle still goes to READY from `condition` alone, and only
   the green Ⓐ is missing.
2. **Is `condition` 10 (`FAHREN`) really on while the engine is stopped by MSA?** That is the premise of the
   `condition`-only path. *Check:* the same log run; add a one-line temporary log of `car.data().condition` if
   needed, or watch the needle: if it drops to OFF at a start/stop stop while `msa raw` never appears, the premise
   is wrong and the fix must rely on `statusConditionMSA` alone.
3. **Does `VehicleCondition` subscribe at all on the car?** It is a new interface in the ACL. *Check:* the log
   line `signal VehicleCondition subscribed` (or `… error: …`) at start-up.
4. **Is the OFF rest right before the engine is started?** *Check:* press start once without the brake
   (terminal R), look at the needle: it should sit on OFF, as in photo 05.

### 1.8 The auto start/stop icon (WBMSA)

**code.** `shaders.js WBMSA` (54 source lines, 5 uniforms, no sampler) draws a capital A inside a circular
arrow. `u_msa.x`: 0/1 hidden, 2 crossed out in `u_fg`, 3 green `u_on`, 4 crossed out in `u_dim`. It is one effect
layer, 44×44 px, in all five 6WB layouts: Comfort / Dials / Sport / Sport + G20 at (1373, 498), Eco Pro at
(1599, 498). It is driven by `_raw('msa')` only — so before this branch it was permanently hidden on the car.

**When it should show.** With the map in §1.5: nothing while MSA is armed and the engine runs (that is what the
F30 does); green while MSA has the engine stopped; crossed out while the driver has switched MSA off, or while
the stop conditions are not met.

**Does our drawing match the stock one?** **No, and probably it should not exist where it is.** **photo** 03
(bottom panel, Sport) shows the stock car putting an amber "Ⓐ OFF" lamp in **BMW's own telltale row across the
top of the cluster**, not inside the tacho. Our spot inside the tacho is an invention, and `docs/CAR3-I-REPORT.md`
§7 says so openly ("the symbol's spot is my choice"). Two consequences:

- `design/overlay/g20_comfort.json` has **no MSA element at all** (39 elements, none of them an Ⓐ). So we do not
  know whether BMW draws its own MSA lamp over, under or not at all while a custom theme is up. That is a
  catalogue gap, not just an app gap.
- *Car check:* with a 6WB theme on, press the MSA button off and photograph the whole panel. If BMW's amber
  "Ⓐ OFF" shows through, our sign is a duplicate: keep only the green `stopped` state (which BMW does **not**
  draw as a lamp) and drop the crossed-out states, or move ours to the stock spot once `design/g20-spec` has
  measured it.

---

## 2. Ranked gaps

Effort: **XS** under an hour, **S** a few hours, **M** a day, **L** more. "Signal" names what is still needed.

| # | What | State | Effort | Signal needed |
|---|---|---|---|---|
| 1 | **Rev needle fell through READY to OFF at every stop** (§1) | **was broken; fixed on this branch**, bench-verified, car-unverified | S, done | `CDS.statusEngineStatus`, `VehicleCondition`, `Vehicle.statusMotorStartAuto` — all in the catalogue |
| 2 | **The clock shows UTC.** `config.clock` is `null`, `timeZone` is `-9999` (Automatic) and the head unit has no `/etc/localtime` (CAR-SNAPSHOT §1), so `{{time}}` is UTC on the car | stubbed | XS | **`KombiIF.timeDateUTC`** (rs, already-subscribed interface): `.timeZonesOffsetAutomaticallyUTC` + `.offsetWintertimeSummertimeUTC`. Exactly `config.clock`'s `kind: "offset"` shape |
| 3 | **Instantaneous consumption is dead on the car.** `config.cons` is **not in `app.json` at all** (not even `null`), so `{{cons}}` is `--` and the 6WB Comfort tacho's EfficientDynamics arc (`fill.of: "cons"`) never lights | missing (no config key, no documented shape) | S | `KombiIF.statusConsumptionValueRegularA..C` (11 UInt16s) or `KombiIF.statusBordcomputerAverage.consumptionAverage1BC1` + its unit member. Needs one raw-value log to pick |
| 4 | **Four critical telltales may be hidden** — `tt.brake`, `tt.tpms`, `tt.abs`, `tt.dsc` sit under our opaque `wbback` in every 6WB layout and under `fill bg` in F30, relation **`unknown`, evidence `none`** in `design/overlay/g20_comfort.json`. The project rule is that BMW's warning lights must stay visible | **unresolved safety question** | S to decide, M to redraw | none — a photo settles it (`docs/OVERLAY-PHOTO-PROTOCOL.md` step 16). `plan.safe.json` already reveals every critical unknown |
| 5 | **The Waze map inside the theme can never turn on.** `hud.js` reads the setting `mapInTheme`, which does not exist in `app.json`; `settings.get` returns `undefined`, so `setting('mapUp')` is always false | dead feature, with live cost (a `Waze` object polls the status file every second) | XS (add the setting, or drop the code) | none |
| 6 | **The night look is computed from a hardcoded Kyiv location.** `nightDim auto` → `sun.isNight(now, config.location)` = 50.45, 30.52 | partial | XS | **`Vehicle.statusDayNightChangeOver`** (rs): `.dayNightChangeOver` TAG 1 / NACHT 2, plus `.destinationLCDLuminance` and `.dampingLCDLuminance` — the cluster's own target brightness |
| 7 | **6WB Sport / Sport + G20 have no READY / OFF**, unlike the stock Sport face | missing | S (layout) + S (shader: the OFF arc only exists in WBDIAL's `STYLE 0`) | none |
| 8 | **Speed-limit sign, no-overtaking sign, check-control message** — `config.limit` / `nopass` / `ccm` all `null` | stubbed; **owned by `feat/bottom-row`** | — | `dass…TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction`, `KombiIF.statusActiveCCMessage` (see §3.3) |
| 9 | **US units break the 6WB faces.** The speedo is `kmh: true` and every scale label (`spd0…spd13`), `speed_unit` "km/h", `range_in` "{{range}} km", `range_a1` "km", `cons_a1` "l/100 km" is a hardcoded metric string — but `{{speed}}` (6WB Sport's big readout) and `{{range}}` **do** convert with the `units` setting | inconsistent | M | none |
| 10 | **The odometer is already arriving and is thrown away.** `KombiIF.statusRangeTankStatus.mileageKilometre` is decoded by the car but our handler reads only `fluidLevelFuelTank` and `range`. The stock cluster shows "Total … km" in the bottom row | missing | XS | none — already subscribed |
| 11 | **Fuel reserve lamp.** The same struct's `statusFluidLevelFuelTankSpare` (AKTIV / NICHT_AKTIV) is ignored; our mini fuel dial has a red zone but no reserve warning | missing | XS | none — already subscribed |
| 12 | **The turn indicators are not drawn and may be hidden.** `CDS2.statusIndicate.statusIndicateDirection` (rs, already-declared interface) | missing | S | none — already declared |
| 13 | **Steering-wheel buttons are not read.** Nothing could change a theme without the centre screen | missing | M | `controlelements.SteeringWheelPushButton` (§6.2) |
| 14 | **The bord computer is ours, not the car's.** `{{avgSpeed}}` is our own integration from the app's start; the car has `KombiIF.statusBordcomputerAverage` (speed and consumption, with their units) and `statusBordcomputerTravelData` (hours, minutes, distance) | partial | S | `KombiIF.*` (§8) |
| 15 | **No check-control / belt / airbag redraw** — `bottom.belt_rear`, `bottom.airbag`, `assist.cc_panel` are `unknown` + `critical` and lie under our dials | unresolved | — | photo; the message itself is `feat/bottom-row`'s |
| 16 | **Drive mode arrives but changes are unproven.** `FES.statusFESVehicleDynamicSwitchHMI` delivered `COMFORT_PLUS` at subscribe; no mode change was made during the snapshot (CAR-SNAPSHOT §4). `config.drive` is the escape hatch and is `null` | partial | — | one drive, or `FesModeAvailability`, `Efficiencytainment.backchannelDrivingmodeDxp` |
| 17 | **Several engine features have no consumer in this app.** The 0-60 timer (`runs.js`), the G-meter, the shift verdict / badge tone, the readout slots (`sensors.js`), the warning flash (`warnOil` / `warnCoolant` / `warnBoost`), `hudTheme` / `dayTheme`, `hudX` / `hudY` / `hudScale` — all are live code with no layout or setting in `f30_cluster` | dead weight, not faults | — | none |

---

## 3. Signals: used versus available

### 3.1 What the app declares today

**code**, `apps/f30_cluster/app.json` `signals`, plus this branch's three additions (marked **new**). Every one was
checked against the catalogue by `tools/signals/catalog.py` during the car snapshot and came back "ok", all with
instance 1 (CAR-SNAPSHOT §4).

| Interface | Field | Flags | What we take from it |
|---|---|---|---|
| `vehicle.CDS` | `statusEngineSpeed2` | rs | rpm (kit) |
| | `statusEngineTemperature` | rs | coolant, oil (kit) |
| | `statusEngineStatus` **new** | rs | `statusEngineRunDrive` → `engineRun` |
| `vehicle.CDS2` | `statusLongitudinal/LateralAccelerationMassCenter` | rs | gLong, gLat (kit) — **no widget in this app uses them** |
| `vehicle.Vehicle2` | `statusCarSpeed2` | rs | speed (kit) |
| `drivingexcitement.FES` | `statusSwitchDriveDynamicSport2` | rs | `displayBoostPressure` → boost — **no widget uses it** |
| | `statusActualValueTorque2` | rs | torque → `{{torquePct}}`, Eco Pro's efficiency dial |
| | `statusFESVehicleDynamicSwitchHMI` | rs | the drive mode → the layout and `{{mode}}` |
| | `statusVehicleDynamicEngine` | rs | sport-display power / torque % |
| `infrastructure.VehicleInformation` | `statusGearboxDrive`, `DataPowerTrain2` | s | gear and selector → `{{gear}}`, `{{stage}}` |
| `infrastructure.VehicleCondition` **new** | `VehicleCondition` | s | `statusConditionVehicle` → `data().condition` |
| `KombiIF` | `statusRangeTankStatus` | rs | `fluidLevelFuelTank`, `range`. **`mileageKilometre` and `statusFluidLevelFuelTankSpare` are decoded by the car and dropped by us** |
| `vehicle.Vehicle` | `statusNewCurrentUnitsStatusExt` | rs | the car's pressure / temperature units (for TPMS) |
| | `statusMotorStartAuto` **new** | s | `statusConditionMSA` → `config.msa` |
| `misc.MDrive` | `dataDisplayGearbox` | s | S / M next to the gear |
| `vehicle.TPMS` | `statusTyrePressure`, `statusTyreTemperature` | rs, polled 10 s | `{{tyreP:*}}`, `{{tyreT:*}}` — **no widget in this app uses them** |
| `infrastructure.EnvironmentalInformation` | `ExteriorTemperature` | s | `{{ambient}}`, `{{ambient1}}` |
| `tasu.InternalTasu` | method + broadcast | — | the kit's diagnostic link (UDS for boost / intake / fuel / HV) |

### 3.2 The gap list, ranked

**catalogue.** Only fields that would change what the driver sees. "Cost" counts whether the interface is already
declared.

| Rank | Interface · field · member | Flags | What it would give us | Cost |
|---|---|---|---|---|
| 1 | `vehicle.CDS` · `statusEngineStatus` · `statusEngineRunDrive` | rs | engine running / starting / off — the READY/OFF decision, and "do not drop to OFF when rpm goes invalid" | **done** |
| 2 | `infrastructure.VehicleCondition` · `VehicleCondition` · `statusConditionVehicle` | s | the car's own terminal state; READY vs OFF; also "the theme should not draw at all while parked" | **done** |
| 3 | `vehicle.Vehicle` · `statusMotorStartAuto` · `statusConditionMSA` | s | the whole MSA state machine, for the Ⓐ sign | **done** |
| 4 | `KombiIF` · `timeDateUTC` · `timeZonesOffsetAutomaticallyUTC`, `offsetWintertimeSummertimeUTC` | rs | **the car's time zone** → our clock stops showing UTC | interface already declared; one `config.clock` line |
| 5 | `vehicle.Vehicle` · `statusDayNightChangeOver` · `dayNightChangeOver`, `destinationLCDLuminance`, `dampingLCDLuminance` | rs | BMW's own day/night and the cluster's target brightness instead of our sunrise maths from a hardcoded lat/lon | interface already declared |
| 6 | `KombiIF` · `statusRangeTankStatus` · `mileageKilometre`, `statusFluidLevelFuelTankSpare` | rs | the odometer ("Total … km", as the stock bottom row) and the fuel-reserve lamp | **already arriving** — 2 lines |
| 7 | `vehicle.CDS2` · `statusIndicate` · `statusIndicateDirection` | rs | turn indicators (critical-adjacent: we cover the whole panel) | interface already declared |
| 8 | `vehicle.CDS2` · `statusBeltContacts2`, `statusSeatOccupancy` | rs | belt warning of our own, for the `bottom.belt_rear` / `bottom.airbag` unknowns | interface already declared |
| 9 | `vehicle.Vehicle2` · `statusLightStatus` | rs | main beam, fog lights, position light, dipped beam — the lamps our background covers | interface already declared |
| 10 | `KombiIF` · `statusActiveCCMessage` · `numberDisplayControlCheckControlMessage` | rs | "a check-control message is showing" → `config.ccm` (**`feat/bottom-row`**) | interface already declared |
| 11 | `KombiIF` · `statusBordcomputerAverage`, `statusBordcomputerTravelData`, `statusBordcomputerTravelStart` | rs | the car's own trip computer instead of ours (§8) | interface already declared |
| 12 | `KombiIF` · `statusConsumptionValueRegularA..C`, `statusECORange`, `statusDrivingStyleDisplay` | rs | instantaneous consumption (the EfficientDynamics arc), the Eco Pro bonus range, the three Eco Pro driving-style bars | interface already declared |
| 13 | `dass…TrafficSignDisplayControl` · `displaySpeedLimitAndNoPassingRestriction` | s | the speed-limit and no-overtaking signs (**`feat/bottom-row`**) | new interface |
| 14 | `controlelements.SteeringWheelPushButton` · `statusSpecialFunctionButton`, `statusRotarySteps`, `statusRotaryPress`, `operationSteerWheelFAV` | rs | switch theme from the wheel (§6.2) | new interface |
| 15 | `KombiIF` · `statusKombiSelection` · `statusActivationInstrumentPackBC` | rs | which bord-computer page the cluster is on — the closest thing to the stalk button (§6.1) | interface already declared |
| 16 | `vehicle.Vehicle` · `displaycontrolEngineoil1..4` | s | engine-oil level / warning | interface already declared |
| 17 | `vehicle.Vehicle2` · `statusDimmer` | rs | the dimmer wheel position | interface already declared |
| 18 | `KombiIF` · `displayRangeElectricVehicle`, `statusConsumptionAverageElectricVehicle` | rs | electric range for a plug-in (we poll the SME over UDS for the SoC today) | interface already declared |

Nothing in the catalogue carries: the stalk BC button as a press (§6.1), a "theme is showing" acknowledgement, or
the cluster's composed frame.

### 3.3 Notes on three of them

- **The clock, `config.clock`.** `KombiIF.timeDateUTC` is an `rs` field of an interface we already subscribe, and
  its members line up one for one with `config.clock`'s documented `offset` shape:
  `{ iface: "de.bmw.infotainment.KombiIF", field: "timeDateUTC", kind: "offset",
  path: ["timeZonesOffsetAutomaticallyUTC"], factor: 15, dstPath: ["offsetWintertimeSummertimeUTC"],
  dstMinutes: 60 }`. **The `factor` is a guess** (the member is a UInt8, so it cannot be minutes; 15-minute or
  30-minute steps are the usual encodings, and `KombiIF.statusTimeDate.statusTimeZonesOffset` is the same width).
  The app already logs `clock raw: … -> …` once per new value, which settles the factor in one ignition cycle.
  **hypothesis + catalogue.**
- **The speed limit.** `displaySpeedLimitAndNoPassingRestriction` with `displaySpeedLimit`, `invalidFlag`,
  `displaySymbolStyle`, `displaySpeedLimitUnit` (`KM_H` / `MPH` / `NICHT_VERFUEGBAR`),
  `displayNoPassingRestriction`, `displaySpeedLimitWarning` — CAR-SNAPSHOT §4 already names it. **Left to
  `feat/bottom-row`.**
- **TPMS is polled every 10 s over SOME/IP** because the car never notifies it (`$pollMs: 10000`), and **no
  widget in any f30_cluster layout shows a tyre value**. That is four getter round-trips every ten seconds for
  nothing. Making the poll conditional on a shown widget (as `needsBoost` already does for the UDS reads) is an
  XS win. **code.**

---

## 4. Every drawn element, per layout

**code**, from `apps/f30_cluster/hud/layouts/*.json` read against `_update`. "live" = redrawn from a car signal,
"static" = painted once and never changed, "demo-only" = a value exists only while the demo drive runs, "dead" =
the source cannot produce a value on the car as the app is configured.

### 4.1 6WB Comfort (`wb_comfort`, 57 widgets, 21 layers on 3 connections)

| Widget(s) | Type | Fed by | State |
|---|---|---|---|
| `bg` | wbback | theme colours, `stockMap` hole, `cc:` patches | static shape, live only for the check-control window (dead, §4.7) |
| `speedo` | dial | `speed` | **live**; the bottom arc `fill.of: "fuel"` **live** |
| `tacho` | dial | `rpm`, `msa`, `condition` | **live**; its bottom arc `fill.of: "cons"` is **dead** (no `config.cons`) |
| `fuel`, `oilt` | dial | `fuel`, `oil` | **live** |
| `spd0…spd13`, `rpm1…rpm7`, `speed_unit`, `rpm_cap`, `fuel_full`, `fuel_zero`, `range_a0`, `range_a1`, `cons_a0`, `cons_a1`, `row_h0…row_h2` | text | — | **static**. All metric-only strings (§2 #9) |
| **`ready`, `off`** | text | — | **static — and correctly so** (§1.1) |
| `fuel_icon`, `oil_icon`, `range_icon` | icon | — | static; hidden by `toggle: "!baked"` with the default settings, i.e. **not drawn on the car** |
| `limit` | text `{{limit}}` | `config.limit` | **dead on the car** (demo shows 90). `feat/bottom-row` |
| `signs` | wbsign | `limit`, `limitEnd`, `limitUnknown`, `nopass` | **dead on the car**. `feat/bottom-row` |
| `range_in`, `range_v` | text `{{range}}` | `KombiIF` | **live** |
| `cons_v` | text `{{cons}}` | `config.cons` | **dead — the key is not in app.json** |
| `row_b0…row_b2`, `row_v0…row_v2` | text | `{{time}}`, `{{ambient1}}` | time **live but UTC** (§2 #2); temperature **live** |
| `mode` | text `{{mode}}` | FES drive mode | **live** (seen on the car as `COMFORT_PLUS`) |
| `gear`, `gear_l` | text | gearbox | **live** |
| `msa` | wbmsa | `config.msa` | **was dead; live after §1.6** |

### 4.2 6WB Dials + G20 (`wb_dials`, 46 widgets)

Same as Comfort, minus the EfficientDynamics / range arc labels, plus the own-row widgets `own_range`,
`own_range_u`, `own_range_icon`, `own_clock`, `own_temp`, `own_temp_u` (toggled by `ownRange` / `ownClock` /
`ownTemp`). All **live** except the clock's zone. `ready` / `off` / `msa` as Comfort. Its tacho has
`cut: { y: 656, fade: 26 }` (the open bottom) but **no `fill`**, so no consumption arc to be dead.

### 4.3 6WB Sport (`wb_sport`, 32) and 6WB Sport + G20 (`wb_sport_dials`, 33)

- `speedo` / `tacho` style `sport`; **no `off` parameter and no `ready` / `off` labels** (§1.3 #4).
- `speed` is a `gpu: true` atext (260×90) — **live**, one uniform message per change.
- Only `spd0` and `spd13` of the speed labels are kept (the Sport face has no intermediate numbers): **static**.
- `signs` + `limit`: **dead on the car**.
- `range_in` / `range_icon`: **live** but with the literal "km".
- `msa`: as Comfort.
- `mode`, `gear`, `gear_l`: **live**.
- Sport + G20 swaps the bottom row for the six `own_*` widgets.

### 4.4 6WB Eco Pro (`wb_eco`, 34)

- `tacho` is the efficiency dial: `measure: "signal"`, `signal: "torquePct"`, style `eff`. **live**, but it shows
  engine torque % where the stock Eco Pro dial shows CHARGE / POWER *and* the EfficientDynamics bonus-range arc.
  `KombiIF.statusECORange` / `statusECORangeWon` would give the real thing (§2 #12). `charge`, `power`, `effdyn`
  are **static** labels over it.
- `mode` has **no `modeLabel` toggle** here while Comfort / Dials / Sport do — an inconsistency, **code**.
- `range_icon` / `range_in` have **no `!baked` toggle** here while Comfort's do — the same kind of inconsistency.
- No `ready` / `off` — correct (**photo** 03, top panel).
- `msa` sits at (1599, 498), a different spot from the other four.

### 4.5 G20 Comfort (`g20_comfort`, 9 widgets)

The smallest layout, and the only one with **no full-screen background**: BMW's own cluster shows everywhere our
four dials are not. `speedo`, `tacho`, `fuel`, `oil` are `g20dial` effect layers (**live**); `rpm1` / `rpm2` are
static "1/min" / "x1000"; `mode1` / `mode2` are `{{g20mode1}}` / `{{g20mode2}}` (**live**, blank in plain
Comfort by design, car3 J); `gear` is `{{stage}}` (**live**). No READY/OFF, no MSA sign, no bottom row, no signs.

### 4.6 F30 basic (`f30`, 8 widgets)

`bg` is an opaque full-screen `fill` (so it hides everything of BMW's, including the four `unknown` critical
telltales). `revs` is a `shiftbar` (**live**, flashes at the redline). `speed` is a 700×192 `gpu` atext
(**live**; it was the 492 KB/s image writer before 0.7.14). `coolant` "WATER {{coolant}}" (**live**). `fuel` is a
`meter` (**live**). `badge` is `{{badge}}` from the `badge` setting (**static per setting**; default `none`, so
**nothing is drawn** unless the owner picks a model). `fuel_icon`, `speed_unit`: static.

### 4.7 Drawn but never updated — the full list

1. **`ready` and `off`** (Comfort, Dials) — static by design, matches stock. **Not a bug.**
2. **Every scale label and unit string** in the five 6WB layouts — static by design, but metric-only (§2 #9).
3. **`cons_v` / `cons_a0` / `cons_a1` and the tacho's EfficientDynamics arc** (Comfort) — **dead**: `config.cons`
   is absent from `app.json`, so `_raw('cons')` is `null` on the car and `7.4` in demo. **This is the one case
   where a readout is drawn, has a place in the baked texture, and can never move.**
4. **`limit` and `signs`** in Comfort / Dials / Sport / Sport + G20 — dead until `feat/bottom-row` lands.
5. **`wbback`'s check-control window and `cc:` patches** (`_wbCcSend`, `_wbPatchesSend`) — driven by
   `_raw('ccMsg')`, which is `null` while `config.ccm` is `null`, so the window never opens. `feat/bottom-row`.
6. **`msa`** in all five 6WB layouts — was permanently hidden; fixed on this branch.
7. **`fuel_icon` / `oil_icon` / `range_icon`** in Comfort and Dials carry `toggle: "!baked"` and `baked` defaults
   to true, so **they are never drawn on the car**. (The baked textures carry the same glyphs; this is deliberate,
   and `design/overlay/wb_comfort.json` marks them `drawn_on_car: false`.)
8. **`badge`** in F30 — blank with the default setting.

---

## 5. Telltales and icons

### 5.1 The rule and the evidence

The project rule: BMW's warning lights must still be visible with a theme on. The evidence base is
`design/overlay/g20_comfort.json` — 39 elements, each with a `relation` (`over` / `under` / `gone` / `unknown`)
and a `safety` (`critical` / `info` / `cosmetic`). **catalogue of the design, not of the car.**

Counts: `over` 4 (2 critical), `under` 20, `gone` 3, **`unknown` 12 — 8 of them `critical`, all with evidence
`none`.**

### 5.2 What our layers sit on

Computed here by intersecting every widget rect with every element bbox (script in the scratchpad; the
`structure` group and `panel.background` excluded). **code + the overlay catalogue.**

| Element | Relation / safety | Covered in |
|---|---|---|
| `tt.brake` `[25,214,85,255]` | unknown / **critical** | all five 6WB (`bg` 100 %, `speedo` 13 %), F30 (`bg` 100 %). Not in G20 Comfort's background, but `speedo` clips 15 % |
| `tt.tpms` `[24,267,77,314]` | unknown / **critical** | all five 6WB + F30 at 100 % (`bg`); G20 Comfort 2 % |
| `tt.abs` `[14,327,73,369]` | unknown / **critical** | all five 6WB + F30 at 100 %; **G20 Comfort: clear** |
| `tt.dsc` `[19,381,63,429]` | unknown / **critical** | all five 6WB + F30 at 100 %; G20 Comfort 2 % |
| `tt.steering` `[1847,265,1905,315]` | unknown / **critical** | all five 6WB + F30 at 100 %; **G20 Comfort: clear** |
| `bottom.belt_rear` `[503,679,576,715]` | unknown / **critical** | all five 6WB (`bg` + `speedo` 100 %) and F30; G20 Comfort clear |
| `bottom.airbag` `[635,665,679,715]` | unknown / **critical** | the same |
| `assist.cc_panel` `[712,601,1240,691]` | unknown / **critical** | all five 6WB (`bg` 100 %, `tacho` 13 %, the bottom-row texts 10–14 %) and F30 |
| `tt.parking_brake` `[1838,217,1900,260]` | **over** / critical | BMW draws it on top — `shared/visible.js PARK_LAMP` knows it and the layout check warns. Only our background is under it, which hides nothing. **OK** |
| `bottom.belt_driver` `[593,666,624,715]` | **over** / critical | the same (`visible.js BELT`). **OK** |
| `overlay.black_box` `[1420,320,1611,440]` | over / cosmetic | BMW's black rectangle over the rev dial's middle; `visible.js BLACK_BOX` warns. In F30 the `revs` shiftbar clips 12 % of it — cosmetic |
| `assist.gear` `[1398,668,1424,703]` | over / info | BMW's gear letter draws on top of our bottom row |

**The honest summary: the eight `critical` `unknown` elements are the one real safety gap, and it is a *question*,
not a proven fault.** If BMW keeps drawing them beneath a custom theme, our opaque `wbback` / `fill bg` hides all
eight in every layout except G20 Comfort (which has no background at all and is therefore the safest layout by
construction). `design/overlay/plan.safe.json` already reveals every critical unknown; nothing in the app reads a
plan yet. The resolution is a photo, not code: `docs/OVERLAY-PHOTO-PROTOCOL.md`.

### 5.3 Icons we draw ourselves

| Icon | Where | Driven by | Stock equivalent |
|---|---|---|---|
| Ⓐ auto start/stop (`wbmsa`) | all five 6WB | `config.msa` | BMW's own "Ⓐ OFF" lamp in the top telltale row (**photo** 03). Ours is in the tacho — our invention. §1.8 |
| speed-limit + no-overtaking signs (`wbsign`) | 4 of 5 6WB | `config.limit` / `nopass` | `assist.speed_limit`, relation `under`. `feat/bottom-row` |
| fuel pump, oil can (`icons.js`) | Comfort, Dials, Sport, Eco | — | baked into the textures with `baked` on |
| the mini dials' red / blue zones | all 6WB | `redFrom`, `coldTo` in the layout | stock has them too |
| the shift red on the tacho ring | all 6WB | `_shift().now` | stock: the red band only; the F30 has no shift light in Comfort |

---

## 6. Buttons and controls

### 6.1 The trip / BC button on the stalk

**What it does on the stock cluster:** a short press steps the bord-computer pages in the lower middle of the
cluster (trip distance, average consumption, average speed, range, the speed-limit memo); a long press resets the
page showing.

**Do we see it? No.** **catalogue + code.**

- `apps/f30_cluster/main.js` wires exactly two input sources: the native RHMI menu (`shared/menu.js`) and the
  drawn gallery (`shared/gallery.js`). Nothing else reaches the app.
- A search of all 5100 catalogue members for `lenkstock`, `stalk`, `wischer`, `blinker`, `BCTaste`, `resetBC`
  returns nothing. The only `…PushButton…` fields are the centre stack, the two CCUs, the touch command, the
  steering wheel, the DSC button and `statusPushButtonMSA2`. **The head unit does not see the stalk BC button as
  a press.**
- The closest thing is the cluster telling the head unit which pages are active:
  `KombiIF.statusKombiSelection.statusActivationInstrumentPackBC` (rs, a UInt32 bitfield) and
  `statusKombiSelectionAvailability.baseSetupInstrumentPackBC`. A change there after a stalk press would be an
  indirect signal. **hypothesis** — *check:* subscribe it, log the raw value, press the stalk button, read the log.
- The write direction exists and is the opposite of what we want: `KombiIF.operationBordcomputer` (rw) with
  `operationBC1` (reset average consumption / speed), `operationBC2` (START / STOP / RESET / automatic reset) and
  `operationLimit` — these are what iDrive's own trip-computer menu sends to the cluster. **Writing to the car is
  outside this project's rules.**

**What our themes should do when it is pressed.** With no press signal, nothing can be driven by it directly. The
honest options, in order:

1. **Follow the cluster instead of the button.** Watch `statusActivationInstrumentPackBC` and mirror the page the
   cluster is on into the bottom row of 6WB Dials + G20 (which is already ours when `ownRange` / `ownClock` /
   `ownTemp` say so). Effort S once the bitfield is decoded on the car; the decoding needs a log.
2. **Build our own pages and cycle them with a steering-wheel button** (§6.2) rather than the stalk.
3. **Do nothing and leave the bottom row to BMW** — which is what `ownRange: "bmw"` already does, and what the
   owner's car is set to today (CAR-SNAPSHOT §2: `ownRange`, `ownClock`, `ownTemp` all `bmw`).

### 6.2 The steering-wheel buttons

**catalogue.** `de.bmw.infotainment.controlelements.SteeringWheelPushButton`, service id 46341, instance 1, every
field **rs** (getter + notifier, so the current value arrives at subscribe):

| Field | Member | Values |
|---|---|---|
| `statusSpecialFunctionButton` | `operationPushButtonSpecialFunction` | `KEINE_AKTION` 0, `TASTER_GEDRUECKT` 1, `SIGNAL_UNGUELTIG` 3 |
| `statusSpecialFunctionButton2` | `operationPushButtonSpecialFunction2` | the same |
| `statusRotarySteps` | `operationStepsKnurlSteeringWheel` | UInt8 (a relative step counter) |
| `statusRotaryPress` | `operationPushButtonKnurlSteeringWheel` | `INIT__S__KEINE_BETAETIGUNG` 0, `RAENDELRAD_GEDRUECKT` 1 |
| `operationSteerWheelFAV` / `operationSteerWheelFC` | same name | `NICHT_GEDRUECKT` 0, `GEDRUECKT` 1, `BERUEHRT` 2 (touched — a capacitive button) |
| `statusSearchSwitch1` | `operationPushButtonAudioAutomaticTuningSteeringWheel` | skip left 1 / right 2 |
| `statusAudioVolumeButton`, `statusPTTButton1`, `statusTelephoneButton` | | volume, push-to-talk, phone |
| `requestSteerWheelFunctions` | **rw** | LEFT / RIGHT / OFF focus — **a write; out of scope** |
| `statusSteerWheelFCLED` | | the FC button's LED state (AUS / LINKS_EIN / RECHTS_EIN) |

**What we could drive with them.** Realistically one thing, and it is the thing the owner would use most:
**switch theme without the centre screen.** `statusSpecialFunctionButton` (the "star" / FAV button on cars that
have one) or `operationSteerWheelFAV` as a single "next theme" press; `statusRotarySteps` + `statusRotaryPress` as
a scroll-and-pick if a small on-cluster picker were ever drawn. A second use: cycle our own bottom-row pages
(§6.1 option 2). A third: reset the 0-60 timer or the trip without reaching for iDrive.

**The risks, and they are real.**

1. **These buttons are not ours.** FAV is the driver's favourite key and PTT is speech; stealing a press we only
   *observe* is impossible (we cannot suppress it), so every press would do both things — change our theme **and**
   fire BMW's own function. Only a button the car does nothing with is safe, and which that is differs per car.
   `statusSpecialFunctionButton2` is the usual candidate on cars with no second special function.
2. **A theme change is a full rebuild**: 1.0–6.2 MB of uploads and 20–130 ms of blocked event loop
   (`docs/PERF-AUDIT.md` §6). A button that is easy to hit repeatedly must be rate-limited (one change per
   second at the very least) or it will stall the needle.
3. **The KOMBI reset.** Until the 0.7.11 reset cause is understood (CAR-SNAPSHOT §0), anything that makes theme
   switching easier makes a reset loop easier too. The KOMBI guard (§7.6) helps but only after two strikes.
4. **`BERUEHRT` (touched) must be ignored** — a capacitive button reports a resting hand.
5. A press is a *level*, not an edge: the field says "pressed", so the app must edge-detect
   (`0 → 1` only) and ignore `SIGNAL_UNGUELTIG` 3.

**Recommendation:** worth doing, but behind a setting that is **off by default**, with the button choice as a
drop-down (`off` / FAV / special 1 / special 2 / rotary press), an edge detector, a 1 s rate limit, and a log line
per press so the owner can see which fields his car actually fills before anything is bound. Effort M. Nothing
implemented on this branch.

### 6.3 Anything else the driver can press

**catalogue + code.**

- **The drive-mode rocker (SPORT / COMFORT / ECO PRO).** Already our main input: `byMode` on, the layout follows
  `FES.statusFESVehicleDynamicSwitchHMI`. Changes were never observed on the car (CAR-SNAPSHOT §4) — **open**.
- **The MSA button.** `CDS2.statusPushButtonMSA2` (rs) — now meaningful for the Ⓐ sign's `off` state (§1.8). Not
  wired; `statusMotorStartAuto`'s value 12 already covers it.
- **The DSC button.** `drivingexcitement.Efficiencytainment.operationPushButtonDSC` (s) — a DSC-off telltale of
  our own would be possible.
- **The iDrive controller.** Reaches us only through the RHMI menu and the gallery (the kit's own path). The
  gallery's "Next theme" / "Done" bar buttons and card taps work with the Store's renderer; without it, taps do
  not reach the drawn gallery (UI-NATIVE §3). **code.**
- **The light switch, wiper stalk, centre-stack buttons** (`controlelements.CenterStack`,
  `body.drivinglight.LightswitchOperation`): visible in the catalogue, no use for a cluster theme.

---

## 7. Modes and states

| Feature | State | Detail |
|---|---|---|
| **Drive modes** | **partial** | `byMode` on by default; `_layoutName()` maps comfort/sport/eco to `inComfort` / `inSport` / `inEco`. `driveModeOf` knows COMFORT, COMFORT_PLUS, SPORT, SPORT_PLUS, ECO_PRO and the `_PLUS` / `INDIVIDUAL` variants; unknown values are logged and shown on the status row. **Verified arriving on the car at subscribe (COMFORT_PLUS); a change has never been seen.** `config.drive` is the escape hatch and is `null`. **code + CAR-SNAPSHOT.** |
| **Shift light** | **complete for what the layouts use** | `_tick` sets `this.flash` (8 Hz) from the redline, and `_shift().now` drives the tacho's `u_hot`. The `shiftbar` in F30 uses both. `shift_score.js` grades every shift and logs it, and `{{verdict}}` / `{{lastShift}}` / `{{shiftPrompt}}` exist — **no f30_cluster layout shows any of them.** The cold-engine rev guard (`coldGuard`) lowers the shift point below 80 °C oil; again only visible through tokens no layout uses. **code.** |
| **0–60 timer** | **complete but invisible** | `runs.js` runs on every tick with the car's own speed (never in demo), keeps the best per unit in `<data>/runs.json`, and feeds `{{run}}`, `{{runBest}}`, `{{runState}}`, `{{runLabel}}`, `{{boostPeak}}`. **No f30_cluster layout has any of those tokens.** It is dead weight here (it belongs to HUD Widgets' Drag theme). **code.** |
| **Demo mode** | **complete** | `demo` setting auto / on / off; `kit/runtime/sim.js` at 20 Hz; `car.js` switches on `carPresent()` after 5 s. Several `_raw` values have demo-only fallbacks: `limit` 90, `cons` 7.4, `nopass` 1, `fuel` 0.62, `range` 368, `ambient` 24, `intake` 31, `hvSoc` 64. **The status row says "demo data" whenever it is on**, so the owner is never misled. **code + bench.** |
| **Night colours** | **partial** | `nightDim` auto / always / off. Auto calls `sun.isNight(now, config.location)` — **and `config.location` is a hardcoded 50.45 / 30.52 (Kyiv)**. The sun maths uses absolute time, so the UTC-only head-unit clock does not break it, but the position does for anyone else. `_nightLive()` recolours in place when every layer can take new colours (no rebuild), checked once a minute. 0.7.11's GPU night looks were removed in 0.7.12 after the KOMBI resets. **The car already sends `Vehicle.statusDayNightChangeOver`** (§2 #6). **code.** |
| **KOMBI guard** | **complete, and the only thing standing between us and a reset loop** | `_kombiWatch`: a strike when the display service goes away within 8 s of our scene being shown; 2 strikes in 2 minutes turn the theme off and write `<data>/kombi-guard.json`; `_layoutName()` returns `'off'` while tripped; the status row explains; picking a theme clears it. Added in 0.7.13 because **cluster-render 0.5.12 removed its own guard** (CAR-SNAPSHOT §0.1). **code.** Untested on the car. |
| **Shared-screen handover** | **complete** | `screen.js`: both apps write `/dev/shm/bimmer-lab/<me>.json` every 2 s; a newer claim from the other app makes us yield, saved in `<data>/screen.json` so it survives a restart. Picking any of `hudLayout` / `inComfort` / `inSport` / `inEco` / `byMode` releases the yield, and the NOW row offers "press to take it back". **bench** (`test-native-ui.js` covers both directions, 42/42). |
| **Shift-light test** | complete | `testShift()` ramps the rpm every widget sees from 1500 past the shift point for ~4 s, only while the car stands. Reachable from the bench, **not from the native menu** — there is no row for it in `app.json screens`. **code.** |
| **Waze map in the theme** | **dead** | §2 #5. `config.waze` is present, a `Waze` object is constructed and polls `/run/waze-on-cluster/status.json` once a second, but `setting('mapUp')` reads `mapInTheme`, which is not a setting in this app, so the map never shows, the `mapUp` toggles never fire and the status row never says "Waze: …". **code.** |
| **BMW's map in 6WB Comfort** | complete | the separate `stockMap` setting cuts the `hole` in WBBACK. **code.** |
| **Smooth needles** | complete | 0.7.14, on by default; `docs/PERF-NEEDLE-REPORT.md`. The needle timer skips `dial` / `g20dial` widgets whose `measure` is rpm or speed and drives them at 30 Hz interpolated. **The §1 fix sits inside that path and was verified with it on** (the bench ran with `needleSmooth` at its default). |
| **Readout slots** | dead here | `slotSensor` / `setSlot` / `sensors.js` / `<data>/slots.json` all work; **no f30_cluster layout defines `slots`**. |
| **Warning flashes** | dead here | `_warning()` needs `warnOil` / `warnCoolant` / `warnBoost`; none is a setting in this app, so `_overLimit` always returns false. |
| **HUD placement** | dead here | `hudX` / `hudY` / `hudScale` are not settings in this app; `_place()` returns early. Correct — this is a panel app. |
| **Auto theme (`hudTheme` / `dayTheme`)** | dead here | every layout carries its own `theme`, so `_themeName()` returns it and never consults the settings. |

---

## 8. Bord computer data: ours versus the car's

**catalogue**, `de.bmw.infotainment.KombiIF` (service 46363, **already subscribed** for the fuel and range).

| The car's field | Members | What we do today | Verdict |
|---|---|---|---|
| `statusBordcomputerAverage` (rs) | `speedAverage1BC1`, `consumptionAverage1BC1`, `speedAverage2BC2`, `consumptionAverage2BC2`, `statusUnitOfMeasurementSpeedBC` (KM_H / MPH), `statusUnitOfMeasurementConsumptionBC` (l/100 km, km/l, mpg UK, mpg US) | `{{avgSpeed}}` = our own `_avgSpeed()`: km and ms accumulated in `_trip()` since **the app started with the car**, not since the driver's reset | **Replace ours.** The car's BC1/BC2 are what the driver reset and what the stock cluster shows; ours restarts whenever the app does and counts only "moving" time by its own rule. The two unit members also tell us the car's display units, better than our `units` setting |
| `statusBordcomputerTravelData` (rs) | `rideDurationHours`, `rideDurationMinutes`, `wayPassed` | `_trip()` keeps `tripKm` / `tripMs`, used only by `{{avgSpeed}}` | **Replace ours** for any "this trip" readout |
| `statusBordcomputerTravelStart` (rs) | `hourDepartureBC`, `minuteDepartureBC`, `dayDepartureBC`, `monthDepartureBC`, `yearDepartureBC` | nothing | **Add** if a "since …" line is ever drawn |
| `statusBordcomputerStatus2` (rs) | `statusBC2BN2020` (running / stopped), `statusResetBC2BN2020`, `statusLimitBN2020`, `warningLimitBN2020` (over / under the set limit), `boundaryLimitBN2020`, `statusUnitOfMeasurementSpeedSpeedometerBN2020` | nothing | **Add**: `boundaryLimitBN2020` + `warningLimitBN2020` are the driver's own speed-limit memo — a second, far simpler source for a limit sign than the camera field, and the warning state comes with it |
| `statusConsumptionValueRegularA/B/C` (rs) | `consumptionValueRegular1..11` | nothing; `{{cons}}` is dead | **Add** — the most likely source for the EfficientDynamics arc (§2 #3). Needs a raw log to learn which index is "now" |
| `statusConsumptionValueECOa/b/c` (rs) | `consumptionValueECO1..11` | nothing | same, for Eco Pro |
| `statusECORange`, `statusECORangeWon` (rs) | `displayRangeECO`, `displayRangeECOWon` | nothing | **Add** for 6WB Eco Pro — the bonus range is what the stock Eco Pro dial shows |
| `statusDrivingStyleDisplay` (rs) | `drivingBehaviourECOCategorie1..3` + a blink state each | nothing | **Add** for Eco Pro — the three driving-style bars (acceleration / braking / shifting), with BMW's own blink flag |
| `statusRangeTankStatus` (rs) | `fluidLevelFuelTank`, `range`, **`mileageKilometre`**, **`statusFluidLevelFuelTankSpare`**, left/right tank halves | we read the first two | **Add the other two** — §2 #10, #11. Zero signal cost |
| `timeDateUTC`, `statusTimeDate` (rs) | time, date and the time-zone offsets | our clock is UTC | **Add** — §2 #2 |
| `statusActiveCCMessage`, `statusMenuCCMessage`, `extendedCCMessage` (rs/rw) | message numbers and frames | nothing | `feat/bottom-row` |
| `dataInstrumentPack` (rs) | `engineTemperatureEvaluated` (COLD / OK / HOT / STRICHE / KEINE_ANZEIGE) | we show raw oil °C on a mini dial | **Add as a cross-check** — it is BMW's own verdict, and `STRICHE` ("dashes") tells us when the stock cluster would show "--" |

**The general rule this suggests:** where the car already computes a number the stock cluster shows, take the
car's. Ours should stay only for things the car does not have — the shift grading, the 0-60 timer and the G-meter.

---

## 9. The car checks, in one list

Nothing below writes to the car except where it says so.

| # | Question | Check |
|---|---|---|
| 1 | Does the needle rest at READY at a start/stop stop? | Drive, stop at a light with MSA armed, watch the tacho. Then `grep -E 'msa raw|engine:|signal VehicleCondition' <data>/f30_cluster.log` |
| 2 | Does `statusConditionMSA` arrive, and with which raw values? | the `msa raw: … -> …` lines across: a start/stop stop, the MSA button off, a cold engine |
| 3 | Is `condition` 10 while MSA has the engine off? | if the needle reaches READY with **no** `msa raw` line, yes |
| 4 | Does `VehicleCondition` subscribe? | the start-up line `signal VehicleCondition subscribed` |
| 5 | Does the needle rest at OFF before the engine is started? | press start once without the brake, look |
| 6 | Does BMW draw its own Ⓐ OFF lamp over our theme? | MSA button off, photograph the whole panel with a 6WB theme on |
| 7 | Are the four left telltales (brake, TPMS, ABS, DSC) visible under our theme? | `docs/OVERLAY-PHOTO-PROTOCOL.md` step 16 — the single most valuable photo in this list |
| 8 | What is `timeDateUTC`'s offset encoding? | wire `config.clock`, read `clock raw: … -> …` once |
| 9 | Which consumption field is the instantaneous one? | wire `config.cons` to `statusConsumptionValueRegularA`, read `consumption raw:` while driving |
| 10 | Does a drive-mode change arrive? | press SPORT, read the status row / `drive mode …` log line |
| 11 | Which steering-wheel buttons does this car fill? | subscribe the interface read-only and log every change for one drive |

---

## 10. What this branch changed

Branch `audit/features`, from `main` c7b8097. **No version bump, no push, no merge.** Six hunks in three files —
listed exactly, so `feat/bottom-row` can merge around them:

| File | Hunk | Conflict risk with `feat/bottom-row` |
|---|---|---|
| `apps/f30_cluster/app.json` | `signals` → `de.bmw.infotainment.vehicle.CDS`: one line, `"statusEngineStatus": "rs"` | low (they work in `config`, not `signals`) |
| | `signals` → `de.bmw.infotainment.vehicle.Vehicle`: one line `"statusMotorStartAuto": "s"` + a longer `_optional` note; and a **new** `de.bmw.infrastructure.VehicleCondition` block after it | low |
| | `config.msa`: `null` → the object in §1.5 | **none** — they own `config.limit`, `config.nopass`, `config.ccm`, not `config.msa` |
| `shared/hud.js` | two constants next to `MSA_STATES` (`COND_READY`, `ENGINE_RUN`); one field in the constructor (`this.engineRun`); one `extra` block for `CDS.statusEngineStatus`; `'condition'` added to the `new Car(...)` groups; the new `_restFrac(w)` before `_dialScale` | low — all of it is in the car-signal setup and the `dial` branch, none of it near the sign / message / bottom-row code |
| | the one line in `_update`'s `dial` branch now calls `_restFrac(w)` | low |
| `bench/run-app.js` | two `hu.feed` lines in the manual-signal timer (`statusEngineStatus`, `VehicleCondition`) | none (bench only) |

**`shared/shaders.js` was not touched.** The fix needed no shader change: WBDIAL already clamps to the OFF mark
and draws both positions. No look's compacted source length changed.

**Checks run:** `node --check` on both changed JS files; `python3 -c json.load` on `app.json`; the bench on port
8150 (build, 21 layers, 11.5 MiB, the five needle cases of §1.6); `bench/test-native-ui.js` on port 8151,
**42 passed, 0 failed**.

**Not implemented here, by choice:** the clock (`config.clock`), the consumption (`config.cons`), the odometer and
reserve flag, the day/night signal, the Sport READY/OFF marks, the steering-wheel buttons, and anything owned by
`feat/bottom-row`. Each has its signal named above; none of them is a one-line change plus a safe default the way
the start/stop fix was.
