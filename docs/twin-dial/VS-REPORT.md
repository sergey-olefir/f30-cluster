# Package VS: signals for the Twin Dial content

Branch `twin-dial/vs` from `main` (`95892f5`). No car, no push, no app code. Sources: the car's catalogue
(`reference/car/2026-11-15/someip/someip-interfaces.json`, git-ignored), the 2026-11-15 snapshot logs (ours and
other apps'), `apps/f30_cluster/app.json` and its notes, commits 0.7.18–0.7.20, and the owner's car log of
2026-11-17 as recorded in those commits.

Tools (tracked): `tools/twin-dial/vs/survey.py` expands any list of fields (ids, flags, struct member by member,
enum items) and searches the whole catalogue by topic; `tools/twin-dial/vs/fields.json` is the list used here.
Its output (BMW names, so git-ignored) is in `bake/work/twin-dial/vs/` (`fields.txt`, `search.txt`).
The proposed `signals` block is `design/twin-dial/vs/signals.json`.

**Evidence labels.** *arrives* = seen on this car in a log; *not sent* = proven silent on this car;
*unseen* = in the catalogue, never subscribed by any app on this car, so unknown (the car has proven that a
catalogue field may never be sent: `newCCMessage`). Scaling: **verified** only where an app on this car decodes
it to plausible values; otherwise **hypothesis**. The catalogue carries no scaling at all.

## 1. The field table

Service ids: KombiIF 46363, KombiInterface_2 45073, CDS 46355, Vehicle 46352, Vehicle2 46361, all instance 1
unless stated. g = getter id, n = notifier id. No field below has a zero getter unless flagged.

| Content | Interface . field → member(s) | g / n | Flags | Scaling | On this car |
|---|---|---|---|---|---|
| Fuel bar | KombiIF.statusRangeTankStatus → `fluidLevelFuelTank` (UInt8), `statusFluidLevelFuelTankSpare` (reserve enum) | 29 / 32797 | rs | litres, 255 = none (verified, f30_cluster) ; reserve: AKTIV=1 | **arrives** (fuel, range) |
| Range | same → `range` (UInt16) | 29 / 32797 | rs | km, 4095 = none (verified) | **arrives** |
| **Odometer** | same → `mileageKilometre` (UInt32) | 29 / 32797 | rs | 1 km/bit (hypothesis); invalid probably 0xFFFFFF | struct arrives, **member never read** |
| Odometer (alt.) | VehicleInformation.Range → `mileageKilometre` | – / 32770 | s | as above | unseen |
| Odometer (alt.) | MileageSupreme.mileageSupreme (svc 4125), SecureMileage.mileage (svc 4138) | 1 / 32769 | rs | km (hypothesis) | unseen |
| Units | EnvironmentalInformation.UnitBN2020 → `unitOfMeasurementMileage` KILOMETER=1 / MEILEN=2 | 1 / 32770 | rs | enum | unseen |
| Coolant bar | CDS.statusEngineTemperature → `temperatureEngineDrive` (oil: `…OilDrive`) | 27 / 32795 | rs | raw − 48 °C, 255 = none (verified: raw 126 → 78 °C) | **arrives** |
| Coolant verdict | KombiIF.dataInstrumentPack → `engineTemperatureEvaluated` KEINE_ANZEIGE 0, COLD 1, OK 2, HOT 3, STRICHE 4, 15 unfilled | 57 / 32825 | rs | enum | unseen |
| Trip: averages | KombiIF.statusBordcomputerAverage → `speedAverage1BC1`, `consumptionAverage1BC1`, `…2BC2` (UInt16), units `statusUnitOfMeasurementSpeedBC` (KM_S_H__KM 1, MPH__MLS 2), `…ConsumptionBC` (l/100 km 1, mpg UK 2, mpg US 3, km/l 4) | 2 / 32770 | rs | **hypothesis** 0.1 km/h and 0.1 l/100 km per bit; 0xFFFF = none | unseen |
| Trip: distance, time | KombiIF.statusBordcomputerTravelData → `wayPassed` (UInt16), `rideDurationHours` (UInt16), `rideDurationMinutes` (UInt8) | 5 / 32773 | rs | wayPassed 1 km or 0.1 km (hypothesis); h / min plain | unseen |
| Trip: departure | KombiIF.statusBordcomputerTravelStart → hour, minute, day, month, `yearDepartureBC` (UInt16) | 6 / 32774 | rs | plain (hypothesis) | unseen |
| Trip: BC2 state, limit memo | KombiIF.statusBordcomputerStatus2 → `statusBC2BN2020` (running / stopped), `boundaryLimitBN2020`, `warningLimitBN2020` | 4 / 32772 | rs | enums; limit km/h (hypothesis) | unseen |
| Trip (newer, alt.) | ResetLogic3.bcDataAll (svc 45134) → `bcData3`: speedAverage, consumption *Scale/*Digit pairs, `dateTimeTrip`, `counterDistance` (UInt32), units | 7 / 32775 | rs | value = Digit with Scale (hypothesis) | unseen |
| Date | KombiIF.statusShowTimeDate → `displayDateDay`, `displayDateWeekDay` (MONTAG 1 … SONNTAG 7, 15 invalid), `displayDateMonth`, `displayDateYear` (UInt16), + hour/minute/second | 30 / 32798 | rs | plain; 255 = none | brief §2: known; repo has no log line (0.7.19 note says unconfirmed) |
| Date (UTC) | KombiIF.timeDateUTC → `dateDayUTC`, `dateMonthUTC`, `dateYearUTC` (UInt8) … | 64 / 32832 | rs | year + 2000 (hypothesis) | **arrives**; status "offsets not available" |
| Doors, lids | DoorsWindowsRoofMirrors.CentralLockingSystemAndPanelStatus2 (svc 21808) → `statusDoorSwitchDRD/PSD/DRDR/PSDR` (0 closed, 1 open, 2 implausible, 3 invalid), `statusContactBootLid`, `statusContactBonnet`, `statusContactBootLid2` | – / 32774 | **s only** | enums | unseen |
| Doors (older twin) | same interface, CentralLockingSystemAndPanelStatus | – / 32769 | s only | enums | unseen (not declared: Status2 is a superset) |
| Bonnet | A4A.statusA4ALids → `statusContactBonnet` | 3 / 32771 | rs | enum | unseen |
| Locking | Vehicle2.statusZVStatus → `statusCentralLockingSystem`, boot-lid unlocked | 85 / 32853 | rs | raw byte + enum | unseen |
| Media title | HmiMediaState.playerMetadata (svc 45181, **instance HMI_CID = 1**) → `firstLineText`/`secondLineText` (UTF-16) with `…LineType` ARTIST 1 / ALBUM 2 / TITLE 3, `sink` FRONT 0 | 2 / 32770 | rs | text | unseen |
| Media source | MediaSource.activeSourceId (UTF-16), MediaSource.sources (`displayText`, `playerType` TUNER_FM 1 … MEDIA_PLAYER 8, DYNAMIC 9) (svc 45249) | 2, 1 / 32770, 32769 | rs | text, enum | unseen |
| Phone | ConnectivityAggregator.aggregatedCallState (svc 45131) DISCONNECTED 0, INCOMING 1, ACTIVE 2, DIALING 3, HELD 4 | 1 / 32769 | rs | enum | unseen |
| Phone (alt.) | Telephone.callState (instances 1, 2; union with state ACTIVE 0 … WAITING 5); CarPlayManager.projectedTelephonyActive (instance 128) | 6 / 32774; 4 / 32772 | rs | | unseen |
| Battery | CDS.statusBattery2 → `conditionBatteryChargingCondition` (UInt8) | 5 / 32773 | rs | **not a voltage**; meaning unknown | unseen |
| Battery voltage | analytics.BasicDataSet.basicDataSet → `statusVoltageIntelligentBoardnetSensor` (UInt16) | – / 32769 | s only | unknown (hypothesis 0.01–0.05 V/bit) | unseen (car_vitals subscribes the interface; never logged it) |
| HU supply voltage | Harman LevelMonitor.systemVoltage (instance Inst1 = 128) → `value` Int16 | 1 / 32769 | rs | mV (hypothesis); the head unit's own supply, not the battery's | unseen |
| Messages: list | KombiInterface_2.ccList → union `cCListElement` {`cCIdentifer` UInt16, `cCShortName` UTF-16, `cCListSymbolID`, `cCColor` DEFAULT 0 RED 1 YELLOW 2 GREEN 3 ORANGE 4 WHITE 5, `cCIndentation`, `ricResourceID`} | 7 / 32770 | rs | | **arrives** (2026-11-17): resting id 0 GREEN symbol 6; door id 15 WHITE symbol 2; **holds stored messages too** (id 987 stayed after BMW hid it) |
| Messages: risk class | KombiInterface_2.ccListRiskClass → same + `cCRiskClass` RK10…RK900 | 16 / 32773 | rs | | 0.7.18 log probe; result not recorded in the repo |
| Messages: push | KombiInterface_2.newCCMessage | 6 / 32769 | rs | | **not sent** (silent 25 min with messages) — do not rely on it |
| Messages: shown now | KombiIF.statusActiveCCMessage → `numberDisplayControlCheckControlMessage` (UInt16), `displayControlCheckControlMessage`, `numberFrame…`/`frame…` (UInt8), `utilityData…` (UInt32) | 1 / 32769 | rs | number = ccList id (hypothesis) | declared in 0.7.20, **not yet seen** |
| Messages: frames | KombiIF.statusMenuCCMessage → `numberFrame…Scroll`, `quantityFrame…Scroll`, `numberCheckControlMessage1/2/3` | 28 / 32796 | rs | | declared since the bottom row; **no log line seen** |
| Messages: displayed (2nd witness) | Vehicle2.statusDisplayedCCMessage → `statusNumberCheckControlMessageDisplay` (UInt16) | 61 / 32829 | rs | | unseen |
| Messages: stored / active | CheckControlMaster.basicList (svc 46412) → `ccmId`, `reason` (CCM_SHOWN_BY_IC 3 …), `activeState` AKTIV 0 / INAKTIV 1, timestamps | 1 / 32769 | rs | | 0.7.18 log probe; result not recorded in the repo |
| Cluster view | HMIContext.currentICWidget (svc 45112, **instance HMI_CID**) UInt32; currentICGraphicalContext {focusIndex, listIndex, visibleContext} | 9 / 32777; 10 / 32778 | rs | raw | unseen |
| Cluster view (alt.) | HMIContext2.currentICWidget (svc 45220, instance 1) {StateID, AppletID} | 8 / 32776 | rs | raw | unseen |
| Cluster pages | KombiIF.statusKombiSelection → `statusActivationInstrumentPackBC` (UInt32 bitfield), `…Content`, preselect; statusKombiSelectionAvailability; statusConfigurationKombi5 (incl. `statusNavigationDisplayType` off / board / map / surroundings, `statusDZMorPowermeterDisplay`) | 47, 27, 55 | rs | bitfields, enums | unseen |
| M view | Vehicle2.statusDisplayKombi → STANDARD 1 / M_VIEW 2 / M_VIEW_PLUS 3 | 124 / 32892 | rs | | unseen (not declared) |
| Guidance arrow | Guidance.nextIntersection (instance Main_Instance) → road description, `distance` {text, unit, rawDistance} | 9 / 32777 | rs | | unseen (currentRoad / guidingState arrive in f30_cluster) |

**Zero getters / setters met on the way (never "r", never declared):** body.AntiTheft.statusDwa (getter **0**,
setter 1, notifier 32769) — and every write field of KombiIF: `standardCCMessage` (setter 34), `extendedCCMessage`
(33), `operationBordcomputer` (35), `kombiSelection` (44), `operationConfigKombi` (51), `timeDate` (37),
`operationTimeDateUTC` (52), `terminCBS` (38). All have getter 0.

## 2. The message signals in detail (decision 6)

What is known on this car (from 0.7.18–0.7.20 commit notes, the owner's log of 2026-11-17):

1. `newCCMessage` never fires. **Verified** (25 min, a door message shown).
2. `ccList` is live and carries name, colour, symbol id. It also keeps **stored** messages (id 987, the
   ready-to-drive message, stayed after BMW hid it ~20 s later). So ccList alone cannot say "shown now".
   **Verified.** The resting entry is id 0 (GREEN, symbol 6). **Verified once.**
3. `statusActiveCCMessage` is the cluster's "message shown now" — **hypothesis**, wired in 0.7.20 and logged
   ("active cc: number N control C frame F/G utility U"), not yet seen. Its number is assumed to be the ccList id.
4. Second witness, never subscribed yet: `Vehicle2.statusDisplayedCCMessage` (one UInt16 "message number on
   display"). Declaring it costs one field and gives the fallback rule a cross-check: our text may cover BMW's panel
   only if the shown number has a ccList entry with a name we can draw.
5. `statusMenuCCMessage` (frame n of m, up to three numbers) would let ours cycle in step with BMW's; no value seen.
6. `CheckControlMaster.basicList.activeState` and `ccListRiskClass` are the candidates for BMW's stored-message
   marker; both were in 0.7.18's log probe but the result is not recorded in the repo — the lead or the owner
   should read those lines from the 2026-11-17 log before anything draws a marker.

Rule for twin_dial (unchanged from the strip round): BMW's panel stays open until **the shown number** (3, or 4 as
a fallback) maps to a ccList entry whose name was drawn by us at least `CC_SETTLE_MS` ago; any number with no
entry, an empty name, a glyph we lack or no "shown" signal at all keeps it open.

## 3. Which view the driver picked (stalk BC button)

Nothing in the catalogue is the button itself (FEATURE-AUDIT §6.1). Candidates, all **unseen**: the HMI's
`HMIContext.currentICWidget` / `currentICGraphicalContext` (and `HMIContext2` twins) — they describe what the
**head unit** puts into the cluster, which may not move on a stalk press at all; and the cluster's own
`statusKombiSelection.statusActivationInstrumentPackBC` bitfield. Only a probe can tell: log the raw values,
press the BC button through every page, compare. Until then the centre panels need a setting or an automatic rule.

## 4. The `signals` block

`design/twin-dial/vs/signals.json` (19 interfaces): everything f30_cluster reads today that the new cluster still
needs (speed, rpm, temperatures, gear, drive mode, condition, day/night, MSA, ambient, fuel/range, clocks, messages,
road and guidance) plus the new content above. Every member is read-only; notes in `_carried` / `_new` keys.
Not carried over: the speed-limit sign and the driver-assistance settings, the TASU/UDS block, the G-meter fields,
`newCCMessage`, `requestDefaultSymbols` — add them back if VG's layout uses them.

**check_signals result** (`python3 tools/signals/check_signals.py <catalogue> bake/work/twin-dial/vs/app.json`):
105 lines `ok`, 0 `FAIL`, "all declarations pass", exit 0. Every "r" has a non-zero getter id; the three
notifier-only fields (CentralLockingSystemAndPanelStatus2, VehicleInformation.Range, the gear pair) are "s".

Privacy: media text, call state and road names are read but must never be logged except as lengths / enums.

## 5. Probe first (a log-only build on the car, before any of it is drawn)

Each: subscribe read-only, log the raw struct once per change (numbers only, lengths for text), do the action.

| # | Field | What to do | What decides |
|---|---|---|---|
| P1 | KombiIF.statusActiveCCMessage + Vehicle2.statusDisplayedCCMessage + statusMenuCCMessage | open a door, wait till BMW hides it, open two | numbers equal the ccList id while shown, return to 0 when hidden |
| P2 | CheckControlMaster.basicList, ccListRiskClass | same; read 0.7.18's existing lines first | which one marks stored messages |
| P3 | KombiIF.statusRangeTankStatus.mileageKilometre | compare with the cluster's odometer | factor 1 km, invalid value |
| P4 | statusBordcomputerAverage / TravelData / TravelStart / Status2, ResetLogic3.bcDataAll | compare with the iDrive trip page; reset trip | factors (0.1?), which BC1/BC2 is "since start" |
| P5 | UnitBN2020, statusKombiExternalDisplay | read once | units |
| P6 | dataInstrumentPack | cold start to warm | COLD → OK timing |
| P7 | CentralLockingSystemAndPanelStatus2, statusA4ALids, statusZVStatus | open each door, boot, bonnet | does it notify at all; does it send once at subscribe |
| P8 | HmiMediaState.playerMetadata (HMI_CID), MediaSource | FM, USB/BT, CarPlay | does it fire, which line is the title |
| P9 | ConnectivityAggregator.aggregatedCallState | ring the car | state sequence |
| P10 | BasicDataSet (voltage member only), LevelMonitor.systemVoltage, CDS.statusBattery2 | engine off / on | is there a plausible 12–14.8 V |
| P11 | HMIContext / HMIContext2 currentICWidget, statusKombiSelection | press the stalk BC button through all pages; change the cluster view in iDrive | does anything move |
| P12 | Guidance.nextIntersection | a guided route | distance, direction, parse time |

Already arriving and safe to draw from: fuel, range, coolant, the clock / date via timeDateUTC, ccList (names,
colours, ids, with the stored-message caveat).
