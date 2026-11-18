# CP: one probe for everything, the app `signal_probe`

Package CP of `docs/AGENT-BRIEF-car-signals.md`. Branch `car/cp`, from `main` at c1f53f2. No car, no push, no version bump, no merge.
Nothing changed in `apps/f30_cluster`, `apps/twin_dial`, `shared/` or `kit/`. Twin Dial keeps its own probe and log lines (nothing removed).

Evidence labels as in the brief. Everything the probe reads is **unseen** on this car unless CA's register says an installed app
already shows it (`bake/work/car/pub/CA/register.json`, 23 of the first 140 fields). The catalogue gives structure and ids, never scaling.

## 0. In short

1. **`apps/signal_probe` v0.1.0** (id `signal_probe`, title "Signal Probe", `loggingId` `OASP`): a separate OAP app that draws nothing
   (no cluster-render, no layer, no canvas), only subscribes and logs. 160 fields on 62 interfaces, **eleven sets S1..S11**, each a checkbox
   in its centre-screen menu, **all off at the first start**; nothing is subscribed while a set is off. A "Позначка N" row writes a marker line.
2. **The five branches are unified** (`twin-r3/{sm,sp,sn,sv,sb}` on `main`'s probe): 140 fields (45 on main + 95), renumbered to the brief's P1..P17,
   plus CA's S10 (P18, 7 new fields + 8 shared) and S11 (P19, 9 fields) = **160**. Formatters, per-field gaps, caps, summaries at +30 s / +2 min /
   +10 min, one read-only getter ask for a silent field, a flood guard, privacy rules: all kept or tightened (section 4).
3. **The owner's priority, the trip button (lead's note of 2026-11-18):** set **S6 alone** (24 fields on 8 interfaces, the least load) logs
   `de.bmw.body.Light.IndicatorSteeringColumn` and `...Complete` as raw `operationColumnStalks` with decimal, hex, the **previous value and the bits
   that went up and down**, **gap 0 (no folding at all, tested: 60 changes in 60 ms give 60 lines)**, cap 300, next to the 11 steering-wheel buttons, the controller
   and the cluster-view fields. Every S6 line ends `tms=<ms since start> since=M<n>+<ms after the last mark>`.
4. **Findings that change other work** (section 5): `ResetLogic3.bcDataAll.bcData3` (and `ResetLogic`, `ResetLogic2` `bcData`) is an **array**, so
   `shared/twin_tokens.js` reads `undefined` from it, and so did main's probe and SV's / SN's tables for five other members. All fixed in the probe;
   the Twin Dial fallback is not (lead's call).
5. **Tests:** `bench/test-signal-probe.js` 138 ok / 0 failed (source rules, declarations, a value made from the catalogue's own types for every field
   under three canary sets, 160 exact lines, the engine, and the real app on the bench). `test-twin-probe.js` 115, `test-twin-trip.js` 82, `test-probes.js` 25 still pass.

## 1. What is in the branch

| Path | What |
|---|---|
| `apps/signal_probe/app.json` | the manifest: 62 interfaces (generated from `fields.js`, `tools/car/probe_fields.js sync`), 11 bool settings, the menu |
| `apps/signal_probe/fields.js` | **the one table**: set, item, tag, interface, field, flags, instance, gap, cap, formatter |
| `apps/signal_probe/format.js` | the formatters (numbers, enum names, lengths, known / present, bit changes, lists, unions) |
| `apps/signal_probe/probe.js` | the engine: sets, lazy hubs, once-per-change, gaps, caps, flood guard, marks, summaries, the getter ask |
| `apps/signal_probe/menu.js`, `main.js` | the native centre screen, start-up (a failed start logs and stays up) |
| `bench/test-signal-probe.js`, `bench/signal-probe-vectors.json` | the tests; one injected value and its exact line per field |
| `tools/car/probe_fields.js` | `sync` (app.json signals from the table), `check`, `export` (`design/car/probe_fields.json`) |
| `design/car/probe_fields.json` | the machine-readable field table with getter / notifier ids from the catalogue |
| `docs/car/CP-REPORT.md` | this file |
| published early: `bake/work/car/pub/CP/` | `LOG-FORMAT.md`, `probe_fields.json`, `READY` |

## 2. The sets

Numbering follows CA's register (S1..S12, P1..P21). S12 (provider checks and events: P20, P21) has **no fields**: events (`_broadcasts`) are not declared unless the lead names one (brief §1, CA decision D2 / D4).
"Interfaces" = proxies this set builds (interface x instance; a proxy is shared with every other set that needs the same interface).
"Worst log" = every field at its cap, an upper bound (about 2 MB for all sets at once); the real figure is a few hundred lines per block.

| Set | Key | Items | Fields | Interfaces | Mean line | Worst log | The owner does |
|---|---|---|---|---|---|---|---|
| S1 messages | `set1` | P1 P2 | 6 | 4 | 100 B | 59 KB | open a door, wait until BMW hides it, open two doors |
| S2 computer | `set2` | P3 P4 P5 P6 | 19 | 12 | 120 B | 144 KB | read the odometer and iDrive's trip page, reset a trip, cold start |
| S3 body | `set3` | P7 P10 | 6 | 6 | 93 B | 68 KB | each door, boot, bonnet; engine off / on |
| S4 media | `set4` | P8 | 13 | 5 | 121 B | 157 KB | FM, DAB, USB, Bluetooth, CarPlay; play, pause, skip, mute |
| S5 phone | `set5` | P9 | 37 | 15 | 77 B | 278 KB | connect, ring from a second phone, answer, hang up, miss a call, CarPlay |
| S6 view and key | `set6` | P11 P13 | 24 | 8 | 86 B | 478 KB | cluster view in iDrive; **the stalk's trip button**; wheel buttons; controller |
| S7 navigation | `set7` | P12 P14 | 16 (15 + kombi-config) | 6 | 107 B | 323 KB | a guided route; cluster view = map |
| S8 assistance | `set8` | P15 | 10 | 6 | 143 B | 279 KB | signs; cruise on / set / +/- / cancel / resume; limiter |
| S9 technical | `set9` | P16 P17 | 14 | 9 | 83 B | 169 KB | a drive under load; the tyre page |
| S10 black box | `set10` | P18 | 15 (7 + 8 shared) | 10 | 104 B | 197 KB | BS §5.3: gear changes, mode changes, map on / off, voice command, with the box showing |
| S11 unwired | `set11` | P19 | 9 | 3 | 96 B | 84 KB | indicators, belts, lights, dimmer, Eco Pro lines |

Differences from the brief's table and from CA's counts (all arithmetic, nothing dropped):

- P4 has 10 fields (ResetLogic has two); P5 has 3 (units-ext from SV's P14); P8 has 13; P9 has **37** (33 as CA counts, plus the four Telephone fields on instance 2); P13 16; P15 10; P16 9; P17 5.
- Guidance items follow CA: P12 = 13 fields (the four map-presence fields of SN moved there), P14 = `visualizationInKombiNonNaviEnabled`, `junction3dViewInKombiEnabled` and `KombiIF.statusConfigurationKombi5`.
- **S10 and S11 are CA's additions (decision D3 for the lead).** To drop either: delete its entries (and the `also: ['S10']` marks) from `fields.js`, then `node tools/car/probe_fields.js sync`; nothing else depends on them.
- `also: ['S10']`: eight fields of S6 / S7 (`kombi-selection`, `kombi-available`, `kombi-config`, `ic-context`, `ic-context2`, `display-kombi`, `map-without-route`, `junction-3d-in-kombi`) are read while either set is on; one subscription, one state (tested).

## 3. The field table

160 fields. Flags are the catalogue's: `r` only with a non-zero getter id, `s` with a notifier; none has a setter declared. "Getter / notifier" are the catalogue's ids.
Formatter: `cols` / `list` / `union` (named columns), `bits` (raw byte with its bit changes), or the formatter's name; `+mark` = the line carries `tms=` and `since=`.
The same table, machine-readable: `design/car/probe_fields.json`.

#### S1 messages (key `set1`, items P1 P2, 6 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P1 | `active-cc` | KombiIF . statusActiveCCMessage | 1 | rs | 1 / 32769 | cols | 500 | 100 |
| P1 | `displayed-cc` | Vehicle2 . statusDisplayedCCMessage | 1 | rs | 61 / 32829 | cols | 500 | 100 |
| P1 | `menu-cc` | KombiIF . statusMenuCCMessage | 1 | rs | 28 / 32796 | cols | 500 | 100 |
| P1 | `ccList` | KombiInterface_2 . ccList | 1 | rs | 7 / 32770 | list | 500 | 100 |
| P2 | `ccListRiskClass` | KombiInterface_2 . ccListRiskClass | 1 | rs | 16 / 32773 | list | 500 | 100 |
| P2 | `basicList` | CheckControlMaster . basicList | 1 | rs | 1 / 32769 | list | 500 | 100 |

#### S2 computer (key `set2`, items P3 P4 P5 P6, 19 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P3 | `range-tank` | KombiIF . statusRangeTankStatus | 1 | rs | 29 / 32797 | cols | 1000 | 60 |
| P3 | `range-alt` | VehicleInformation . Range | 1 | s | - / 32770 | cols | 1000 | 60 |
| P3 | `mileage-supreme` | MileageSupreme . mileageSupreme | 1 | rs | 1 / 32769 | cols | 1000 | 60 |
| P3 | `mileage-secure` | SecureMileage . mileage | 1 | rs | 1 / 32769 | cols | 1000 | 60 |
| P4 | `bc-average` | KombiIF . statusBordcomputerAverage | 1 | rs | 2 / 32770 | cols | 1000 | 60 |
| P4 | `bc-travel` | KombiIF . statusBordcomputerTravelData | 1 | rs | 5 / 32773 | cols | 1000 | 60 |
| P4 | `bc-start` | KombiIF . statusBordcomputerTravelStart | 1 | rs | 6 / 32774 | cols | 1000 | 60 |
| P4 | `bc-status2` | KombiIF . statusBordcomputerStatus2 | 1 | rs | 4 / 32772 | cols | 1000 | 60 |
| P4 | `bc-all3` | ResetLogic3 . bcDataAll | 1 | rs | 7 / 32775 | cols | 1000 | 60 |
| P4 | `bc-all1` | ResetLogic . bcDataAll | 1 | rs | 1 / 32769 | cols | 1000 | 60 |
| P4 | `bc-avgcons1` | ResetLogic . averageConsumption | 1 | rs | 7 / 32775 | cols | 1000 | 60 |
| P4 | `bc-all2` | ResetLogic2 . bcDataAll | 1 | rs | 1 / 32769 | cols | 1000 | 60 |
| P4 | `bc-segment` | BcPersonal . driveSegment | 1 | rs | 1 / 32769 | cols | 1000 | 60 |
| P4 | `lsc-cluster` | LSCDataSink . dataCombinedInstrumentCluster | 1 | s | - / 32772 | cols | 1000 | 60 |
| P5 | `units` | EnvironmentalInformation . UnitBN2020 | 1 | rs | 1 / 32770 | cols | 1000 | 60 |
| P5 | `external-display` | KombiIF . statusKombiExternalDisplay | 1 | rs | 48 / 32804 | cols | 1000 | 60 |
| P5 | `units-ext` | Vehicle . statusNewCurrentUnitsStatusExt | 1 | rs | 46 / 32814 | cols | 1000 | 60 |
| P6 | `engine-verdict` | KombiIF . dataInstrumentPack | 1 | rs | 57 / 32825 | cols | 1000 | 60 |
| P6 | `coolant` | CDS . statusEngineTemperature | 1 | rs | 27 / 32795 | temps | 5000 | 240 |

#### S3 body (key `set3`, items P7 P10, 6 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P7 | `doors` | DoorsWindowsRoofMirrors . CentralLockingSystemAndPanelStatus2 | 1 | s | - / 32774 | cols | 250 | 100 |
| P7 | `lids` | A4A . statusA4ALids | 1 | rs | 3 / 32771 | cols | 250 | 100 |
| P7 | `zv-status` | Vehicle2 . statusZVStatus | 1 | rs | 85 / 32853 | cols | 250 | 100 |
| P10 | `voltage-basic` | BasicDataSet . basicDataSet | 1 | s | - / 32769 | cols | 5000 | 240 |
| P10 | `voltage-hu` | LevelMonitor . systemVoltage | Inst1 | rs | 1 / 32769 | cols | 5000 | 240 |
| P10 | `battery-condition` | CDS . statusBattery2 | 1 | rs | 5 / 32773 | cols | 250 | 100 |

#### S4 media (key `set4`, items P8, 13 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P8 | `player-metadata` | HmiMediaState . playerMetadata | HMI_CID | rs | 2 / 32770 | cols | 1000 | 100 |
| P8 | `active-source` | MediaSource . activeSourceId | 1 | rs | 2 / 32770 | activeSource | 1000 | 100 |
| P8 | `sources` | MediaSource . sources | 1 | rs | 1 / 32769 | sources | 1000 | 100 |
| P8 | `track-progress` | HmiMediaState . trackProgress | HMI_CID | rs | 3 / 32771 | cols | 10000 | 120 |
| P8 | `main-menu-metadata` | HmiMediaState . mainMenuMetadata | HMI_CID | rs | 1 / 32769 | cols | 1000 | 100 |
| P8 | `media-menu` | HmiMediaState . menu | HMI_CID | rs | 6 / 32774 | mediaMenu | 1000 | 100 |
| P8 | `station` | TunerFmAmDab . currentStationFmDabAm | 1 | rs | 9 / 32777 | station | 5000 | 100 |
| P8 | `cp-player-state` | MediaPlayer . playerState | CarPlayMedia | rs | 1 / 32769 | enum | 1000 | 100 |
| P8 | `cp-item-time` | MediaPlayer . currentItemTime | CarPlayMedia | rs | 15 / 32783 | cols | 10000 | 120 |
| P8 | `cp-item-position` | MediaPlayer . currentItemPosition | CarPlayMedia | rs | 8 / 32776 | cols | 1000 | 100 |
| P8 | `cp-item-metadata` | MediaPlayer . currentItemMetadata | CarPlayMedia | rs | 10 / 32778 | metadata | 1000 | 100 |
| P8 | `cp-device` | MediaPlayer . deviceInfo | CarPlayMedia | rs | 19 / 32787 | cols | 1000 | 100 |
| P8 | `main-connections` | CommandControl . listOfMainConnections | 1 | rs | 22 / 32769 | list | 1000 | 100 |

#### S5 phone (key `set5`, items P9, 37 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P9 | `call-state` | ConnectivityAggregator . aggregatedCallState | 1 | rs | 1 / 32769 | enum | 500 | 100 |
| P9 | `carplay-call` | CarPlayManager . projectedTelephonyActive | CarPlayManagerInst1 | rs | 4 / 32772 | bool | 500 | 100 |
| P9 | `phone-call1-state` | VoiceCall . state | Call1 | rs | 6 / 32774 | enum | 500 | 100 |
| P9 | `phone-call1-duration` | VoiceCall . duration | Call1 | rs | 2 / 32770 | cols | 500 | 100 |
| P9 | `phone-call1-contact` | VoiceCall . contactID | Call1 | rs | 1 / 32769 | cols | 500 | 100 |
| P9 | `phone-call1-multiparty` | VoiceCall . multiparty | Call1 | rs | 4 / 32772 | bool | 500 | 100 |
| P9 | `phone-call1-modem` | VoiceCall . modem | Call1 | rs | 3 / 32771 | cols | 500 | 100 |
| P9 | `phone-call1-name` | VoiceCall . name | Call1 | rs | 24 / 32776 | cols | 500 | 100 |
| P9 | `phone-call1-number` | VoiceCall . number | Call1 | rs | 5 / 32773 | cols | 500 | 100 |
| P9 | `phone-call1-picture` | VoiceCall . pictureSource | Call1 | rs | 25 / 32777 | cols | 500 | 100 |
| P9 | `phone-mic-muted` | VoiceCallManager . micMuted | 1 | rs | 2 / 32770 | bool | 500 | 100 |
| P9 | `phone-hfp-blocked` | VoiceCallManager . hfpBlocked | 1 | rs | 21 / 32784 | bool | 500 | 100 |
| P9 | `phone-comm-blocked` | VoiceCallManager . communicationBlocked | 1 | rs | 19 / 32781 | bool | 500 | 100 |
| P9 | `phone-devices` | DevicePresentation . deviceList | 1 | rs | 1 / 32769 | devices | 500 | 100 |
| P9 | `phone-active-roles` | DevicePresentation . activeRoles | 1 | rs | 29 / 32782 | roles | 500 | 100 |
| P9 | `phone-calllist` | CallList . callItemList | 1 | rs | 1 / 32769 | calllist | 500 | 100 |
| P9 | `nad-call` | Telephone . callState | 1 | rs | 6 / 32774 | list | 500 | 100 |
| P9 | `nad-register` | Telephone . registerState | 1 | rs | 1 / 32769 | union | 500 | 100 |
| P9 | `nad-signal` | Telephone . signalQuality | 1 | rs | 4 / 32772 | union | 500 | 100 |
| P9 | `nad-operator` | Telephone . currentNetworkOperator | 1 | rs | 3 / 32771 | union | 500 | 100 |
| P9 | `telesync-call` | ConnTeleSync . callStatus | TelematicsCallStatusInst1 | rs | 1 / 32769 | enum | 500 | 100 |
| P9 | `telesync-gsm` | ConnTeleSync . gsmStrength | TelematicsCallStatusInst1 | rs | 3 / 32770 | cols | 500 | 100 |
| P9 | `telesync-register` | ConnTeleSync . registerState | TelematicsCallStatusInst1 | rs | 5 / 32772 | enum | 500 | 100 |
| P9 | `telesync-lock` | ConnTeleSync . lockState | TelematicsCallStatusInst1 | rs | 4 / 32771 | enum | 500 | 100 |
| P9 | `acm-phone` | ACM . phoneState | 1 | rs | 1 / 32769 | enum | 500 | 100 |
| P9 | `acm-data` | ACM . dataConnectionStatus | 1 | rs | 2 / 32770 | cols | 500 | 100 |
| P9 | `esim-status` | EsimProxy . status | EsimProxy_1 | rs | 1 / 32769 | enum | 500 | 100 |
| P9 | `esim-signal` | EsimProxy . signalStrength | EsimProxy_1 | rs | 7 / 32773 | cols | 500 | 100 |
| P9 | `esim-telephony` | EsimProxy . telephonyEnabled | EsimProxy_1 | rs | 8 / 32774 | bool | 500 | 100 |
| P9 | `audio-tel-mute` | AudioSystemInformation . muteTelState | 1 | rs | 1 / 32769 | cols | 500 | 100 |
| P9 | `wca-front` | WirelessChargingAdapter . wcaNfcFrontStatus | 1 | rs | 3 / 32771 | cols | 500 | 100 |
| P9 | `wca-body` | ComfortFunction . WCAStatus | 1 | rs | 7 / 32773 | cols | 500 | 100 |
| P9 | `hmi-app` | HMIContext . currentActiveApplication | HMI_CID | rs | 2 / 32770 | enum | 500 | 100 |
| P9 | `nad2-call` | Telephone . callState | 2 | rs | 6 / 32774 | list | 500 | 100 |
| P9 | `nad2-register` | Telephone . registerState | 2 | rs | 1 / 32769 | union | 500 | 100 |
| P9 | `nad2-signal` | Telephone . signalQuality | 2 | rs | 4 / 32772 | union | 500 | 100 |
| P9 | `nad2-operator` | Telephone . currentNetworkOperator | 2 | rs | 3 / 32771 | union | 500 | 100 |

#### S6 view and key (key `set6`, items P11 P13, 24 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P11 | `ic-widget` | HMIContext . currentICWidget | HMI_CID | rs | 9 / 32777 | hex +mark | 500 | 150 |
| P11 | `ic-context` | HMIContext . currentICGraphicalContext | HMI_CID | rs | 10 / 32778 | cols +mark (also S10) | 500 | 150 |
| P11 | `ic-widget2` | HMIContext2 . currentICWidget | 1 | rs | 8 / 32776 | cols +mark | 500 | 150 |
| P11 | `ic-context2` | HMIContext2 . currentICGraphicalContext | 1 | rs | 7 / 32775 | cols +mark (also S10) | 500 | 150 |
| P11 | `kombi-selection` | KombiIF . statusKombiSelection | 1 | rs | 47 / 32803 | cols +mark (also S10) | 500 | 150 |
| P11 | `kombi-available` | KombiIF . statusKombiSelectionAvailability | 1 | rs | 27 / 32795 | cols +mark (also S10) | 500 | 150 |
| P11 | `kombi-config` | KombiIF . statusConfigurationKombi5 | 1 | rs | 55 / 32823 | cols +mark (also S7,S10) | 500 | 150 |
| P11 | `display-kombi` | Vehicle2 . statusDisplayKombi | 1 | rs | 124 / 32892 | cols +mark (also S10) | 500 | 150 |
| P13 | `sw-special1` | SteeringWheelPushButton . statusSpecialFunctionButton | 1 | rs | 5 / 32773 | cols +mark | 0 | 300 |
| P13 | `sw-special2` | SteeringWheelPushButton . statusSpecialFunctionButton2 | 1 | rs | 6 / 32774 | cols +mark | 0 | 300 |
| P13 | `sw-fav` | SteeringWheelPushButton . operationSteerWheelFAV | 1 | rs | 9 / 32777 | cols +mark | 0 | 300 |
| P13 | `sw-fc` | SteeringWheelPushButton . operationSteerWheelFC | 1 | rs | 10 / 32778 | cols +mark | 0 | 300 |
| P13 | `sw-wheel-steps` | SteeringWheelPushButton . statusRotarySteps | 1 | rs | 7 / 32775 | cols +mark | 100 | 300 |
| P13 | `sw-wheel-press` | SteeringWheelPushButton . statusRotaryPress | 1 | rs | 8 / 32776 | cols +mark | 0 | 300 |
| P13 | `sw-skip` | SteeringWheelPushButton . statusSearchSwitch1 | 1 | rs | 3 / 32771 | cols +mark | 0 | 300 |
| P13 | `sw-volume` | SteeringWheelPushButton . statusAudioVolumeButton | 1 | rs | 2 / 32770 | cols +mark | 0 | 300 |
| P13 | `sw-voice` | SteeringWheelPushButton . statusPTTButton1 | 1 | rs | 4 / 32772 | cols +mark | 0 | 300 |
| P13 | `sw-phone` | SteeringWheelPushButton . statusTelephoneButton | 1 | rs | 1 / 32769 | cols +mark | 0 | 300 |
| P13 | `sw-fc-led` | SteeringWheelPushButton . statusSteerWheelFCLED | 1 | rs | 11 / 32779 | cols +mark | 0 | 300 |
| P13 | `stalk` | Light . IndicatorSteeringColumn | 1 | s | - / 32773 | bits +mark | 0 | 300 |
| P13 | `stalk-complete` | Light . IndicatorSteeringColumnComplete | 1 | s | - / 32776 | bits +mark | 0 | 300 |
| P13 | `controller` | FrontCCU . statusRotaryEncoderState | 1 | rs | 2 / 32770 | cols +mark | 0 | 300 |
| P13 | `controller-keys` | FrontCCU . statusPushButtonsState | 1 | rs | 1 / 32769 | cols +mark | 0 | 300 |
| P13 | `hmi-shortcut` | Lifecycle . entertainmentModeTrigger | Front | rs | 22 / 32774 | enum +mark | 0 | 300 |

#### S7 navigation (key `set7`, items P12 P14, 15 fields, 16 while on)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P12 | `guiding-state` | NavigationStatus . guidingState | 1 | rs | 2 / 32770 | enum | 1000 | 200 |
| P12 | `next-intersection` | Guidance . nextIntersection | Main_Instance | rs | 9 / 32777 | intersection | 2000 | 200 |
| P12 | `guidance-state` | Guidance . guidanceState | Main_Instance | rs | 2 / 32770 | enum | 1000 | 200 |
| P12 | `dart` | Guidance . conclusiveDart | Main_Instance | rs | 28 / 32790 | dart | 2000 | 200 |
| P12 | `lanes` | Guidance . currentLaneGuiding | Main_Instance | rs | 25 / 32787 | lanes | 2000 | 200 |
| P12 | `next-destination` | Guidance . nextDestinationInfo | Main_Instance | rs | 4 / 32772 | cols | 2000 | 200 |
| P12 | `road` | Guidance . currentRoad | Main_Instance | rs | 1 / 32769 | description | 2000 | 200 |
| P12 | `kombi-lanes` | LaneGuiding . laneGuiding | 1 | rs | 1 / 32769 | cols | 2000 | 200 |
| P12 | `kombi-lanes-ext` | LaneGuiding . extendedLaneGuiding | 1 | rs | 2 / 32770 | cols | 2000 | 200 |
| P12 | `on-guidable-road` | Guidance . isOnGuidableRoad | Main_Instance | rs | 24 / 32786 | bool | 1000 | 200 |
| P12 | `guiding-provider` | Guidance . guidingProvider | Main_Instance | rs | 27 / 32789 | enum | 1000 | 200 |
| P12 | `carplay-guidance` | CarPlayManager . projectedGuidanceActive | CarPlayManagerInst1 | rs | 2 / 32770 | bool | 1000 | 200 |
| P12 | `aa-guidance` | AndroidAutoProjectedManager . projectedGuidanceActive | AndroidAutoProjectedManagerInst1 | rs | 2 / 32770 | bool | 1000 | 200 |
| P14 | `map-without-route` | Guidance . visualizationInKombiNonNaviEnabled | Main_Instance | rs | 37 / 32795 | bool (also S10) | 1000 | 200 |
| P14 | `junction-3d-in-kombi` | Guidance . junction3dViewInKombiEnabled | Main_Instance | rs | 35 / 32794 | bool (also S10) | 1000 | 200 |

#### S8 assistance (key `set8`, items P15, 10 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P15 | `sign` | TrafficSignDisplayControl . displaySpeedLimitAndNoPassingRestriction | 1 | s | - / 32769 | cols | 1000 | 200 |
| P15 | `longitudinal` | TrafficSignDisplayControl . displayDriverAssistanceLongitudinal | 1 | s | - / 32772 | cols | 1000 | 200 |
| P15 | `foresight` | TrafficSignDisplayControl . displayForesight | 1 | s | - / 32770 | cols | 1000 | 200 |
| P15 | `ldm-guidance` | FASuS . displayDriverAssistenceSystemLongitudinalGuidance | 1 | s | - / 32770 | cols | 1000 | 200 |
| P15 | `next-limit` | FASuS . statusNextSpeedLimitRecognition | 1 | rs | 4 / 32772 | cols | 1000 | 200 |
| P15 | `no-passing` | FASuS . statusOvertakeRecognition | 1 | rs | 6 / 32774 | cols | 1000 | 200 |
| P15 | `hud-data` | DisplayDataServer . functionalLibraryData | 1 | rs | 1 / 32769 | cols | 1000 | 200 |
| P15 | `hud-data2` | DisplayDataServer2 . functionalLibraryData | 1 | rs | 1 / 32769 | cols | 1000 | 200 |
| P15 | `assist-avail` | MultimodalControlDriverAssistance . functionAvailabilityDriverAssistance | 1 | rs | 2 / 32769 | cols | 1000 | 200 |
| P15 | `front-vehicle` | GapVehicleAhead . DataFrontVehicle | 1 | s | - / 32770 | cols | 1000 | 200 |

#### S9 technical (key `set9`, items P16 P17, 14 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P16 | `tyre-pressure` | TPMS . statusTyrePressure | 1 | rs | 7 / 32775 | cols (poll 15 s) | 1000 | 60 |
| P16 | `tyre-temp` | TPMS . statusTyreTemperature | 1 | rs | 9 / 32777 | cols (poll 15 s) | 1000 | 60 |
| P16 | `tyre-target` | TPMS . statusTargetTyrePressure | 1 | rs | 1 / 32769 | cols (poll 15 s) | 1000 | 60 |
| P16 | `tyres-status` | TPMS . statusTyresStatus | 1 | rs | 10 / 32778 | cols (poll 15 s) | 1000 | 60 |
| P16 | `oil-level` | Vehicle2 . statusOilDipstick2 | 1 | rs | 47 / 32815 | cols | 1000 | 200 |
| P16 | `oil-temp2` | CDS2 . statusInjectionVolume | 1 | rs | 40 / 32808 | cols | 1000 | 200 |
| P16 | `sport-display` | FES . statusSwitchDriveDynamicSport2 | 1 | rs | 39 / 32807 | cols | 1000 | 200 |
| P16 | `power-torque` | FES . statusVehicleDynamicEngine | 1 | rs | 3 / 32771 | cols | 1000 | 200 |
| P16 | `engine-max` | FES . statusVehicleDynamicEngineMaxValue | 1 | rs | 40 / 32808 | cols | 1000 | 200 |
| P17 | `cons-now` | ResetLogic . currentConsumption | 1 | rs | 5 / 32773 | cols | 5000 | 200 |
| P17 | `cons-history` | ConsumptionHistory3 . consumptionHistoryFull | 1 | rs | 5 / 32773 | cols | 5000 | 60 |
| P17 | `heading` | Positioning . currentLocation | Main_Instance | rs | 1 / 32769 | cols | 1000 | 200 |
| P17 | `gps-ext` | GPSData . GPSPositionExtendedCAN | 1 | rs | 2 / 32772 | cols | 1000 | 200 |
| P17 | `cbs-list` | KombiInterface_2 . cbsDataServiceList | 1 | rs | 8 / 32771 | cbs | 1000 | 200 |

#### S10 black box (key `set10`, items P18, 7 fields, 15 while on)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P18 | `kombi-basic` | KombiIF . basicConfigKombi | 1 | rs | 53 / 32821 | cols | 500 | 100 |
| P18 | `welcome-animation` | KombiIF . statusWelcomeAnimation | 1 | rs | 32 / 32800 | cols | 500 | 100 |
| P18 | `gearbox-secure` | Powertrain . dataDisplayGearboxSecure | 1 | s | - / 32775 | cols | 500 | 100 |
| P18 | `dialog-state` | Dialog . dialogState | HMISpeechHU | rs | 22 / 32779 | enum | 500 | 100 |
| P18 | `gearbox-status` | VehicleInformation . statusGearboxDrive | 1 | s | - / 32776 | cols | 500 | 100 |
| P18 | `gearbox-display` | MDrive . dataDisplayGearbox | 1 | s | - / 32785 | cols | 500 | 100 |
| P18 | `fes-switch` | FES . statusFESVehicleDynamicSwitchHMI | 1 | rs | 37 / 32805 | cols | 500 | 100 |

#### S11 unwired (key `set11`, items P19, 9 fields)

| Item | Tag | Interface . field | Inst | Flags | Getter / notifier | Formatter | Gap ms | Cap |
|---|---|---|---|---|---|---|---|---|
| P19 | `indicate` | CDS2 . statusIndicate | 1 | rs | 39 / 32807 | cols | 500 | 100 |
| P19 | `belts` | CDS2 . statusBeltContacts2 | 1 | rs | 5 / 32773 | cols | 500 | 100 |
| P19 | `seats` | CDS2 . statusSeatOccupancy | 1 | rs | 57 / 32825 | cols | 500 | 100 |
| P19 | `lights` | Vehicle2 . statusLightStatus | 1 | rs | 43 / 32811 | cols | 500 | 100 |
| P19 | `dimmer` | Vehicle2 . statusDimmer | 1 | rs | 20 / 32788 | cols | 500 | 100 |
| P19 | `cons-regular` | KombiIF . statusConsumptionValueRegularA | 1 | rs | 12 / 32780 | cols | 5000 | 100 |
| P19 | `cons-eco` | KombiIF . statusConsumptionValueECOa | 1 | rs | 9 / 32777 | cols | 5000 | 100 |
| P19 | `eco-range` | KombiIF . statusECORange | 1 | rs | 18 / 32786 | cols | 5000 | 100 |
| P19 | `driving-style` | KombiIF . statusDrivingStyleDisplay | 1 | rs | 17 / 32785 | cols | 500 | 100 |

## 4. The unification and the privacy decisions

Rules kept from every package: per-field minimum gap (`gapMs`, last value wins, `(+k folded)`), per-field line cap (`(the last line for this field)`), summaries naming silent fields
at +30 s / +120 s / +600 s **per set** (counted from the moment the set is switched on), one read-only getter ask for each silent `r` field at the +120 s summary
(`signals.get` only; the answer goes through the field's handler, so it is also a normal line), the P8 source match without a source id, intersection parse time, canary tests in every text member.
Added: a flood guard (at most 40 lines per second; held lines go out at the next tick, the urgent S6 fields bypass it), a volume line every 150 KB, per-hub subscription time (`probe: watch <Iface>[<inst>] ... ok <ms>ms`).

Tightened or corrected against the five branches (each is in `format.js` / `fields.js` and tested):

| Where | Branch behaviour | Probe |
|---|---|---|
| bearing | `Positioning.currentLocation.heading`, `GPSData...statusHeadingGPSCAN` printed as numbers (SV P15) | `heading=set` only (brief: never a bearing) |
| GPS height | rounded to 100 raw units (kept), GPS speed printed | height kept as `1200~` (brief P17 lists altitude); the speed member dropped (changes every second, adds nothing) |
| HUD feed | `speed.kmH` printed | dropped (changes every second; the set speed and the symbols stay) |
| device identity | `deviceList[].uniqueID`, `MediaPlayer.deviceInfo.deviceId` printed (SP, SM) | list position `#0`, and `device=known` |
| contact | `contactID` as `known=true` | `contact=known` / `unknown` (same rule, one kind) |
| call list | counts and first / last type (SP) | kept as counts only (numbers); **flagged for the lead**: the brief says "never a call list"; counts are not the list, but `phone-calllist` can be removed with its one table line |
| alive / CRC counters | n/a | the gearbox display's `cRC_` / `aLIV_` members are not printed (they change every cycle) |
| Telephone | `shape=member` hack on a field that is a list | `callState` is a list (`entries=N [...]`), the other three are single unions; both instances (see section 6) |
| enum names | capitals + digits | plus a leading `_` (`_1_P_GANG`, FASuS `_80`); a name that is not an identifier prints `?`; all enum names reachable from the table conform (checked) |

Privacy is tested three ways: (a) 160 exact lines from injected values with a canary in every text member; (b) a value **made from the catalogue's own types** for every field, three times
(mixed-case canary, ALL-CAPS canary, another enum pick): no canary reaches a line, no `?` (a column whose kind the catalogue does not have), no `-` (a path that does not exist);
(c) hostile values (null, strings, arrays, buffers, `NaN`, 5000-element arrays) through every handler: nothing throws, no text appears.
Never in a line: a title, station, contact or device name, a number, a road, a coordinate, a bearing, a VIN, a modem identity, a key, a token, a picture byte, a frequency (only `fm-range` / `am-range` / `dab-range`).
The interface identifiers in `fields.js` contain the maker's domain because the catalogue's names do; no maker's name is written in any prose of the app, no home path anywhere (tested).

## 5. Findings: where the branches' tables were wrong about the catalogue (and one latent bug in Twin Dial)

The catalogue-typed test (section 4 (b)) found, by making values from the catalogue's types, that these paths could never have matched a real value. All are fixed in the probe.

1. **`ResetLogic3.bcDataAll.bcData3` is an array** (one entry per reset option: STARTOFDRIVING, LONGTERM, ...), likewise `ResetLogic.bcData` and `ResetLogic2.bcData`. Main's probe columns (`['bcData3','resetOption']` ...) read `undefined` and would have logged `-` for every member. The probe logs `trips=N [option=... tripDay=... ] [...]`: **this also answers MK's "which computer is 'since start'"**, because every entry names its reset option.
   **Latent bug in Twin Dial 0.1.0 and main: `shared/twin_tokens.js` (rl3 source, line ~149) does `member(v, 'bcData3')` and then `member(d, 'resetOption')` on the array**, so the ResetLogic3 fallback for the trip page can never produce a value even if the field arrives. KombiIF is first in `config.trip.order`, so nothing shows now; the fallback is dead code until fixed (take the entry whose `resetOption` is wanted). Not changed here (`shared/` is the lead's).
2. **`Telephone.callState` is an array of unions**; SP's `shape=member|flat` formatter would have printed `-` for everything on an array. `registerState`, `signalQuality`, `currentNetworkOperator` are single unions.
3. **`KombiInterface_2.cbsDataServiceList` is an array of unions of two structs**; SV's paths (`['cBSDataServiceWithSymbolID','cBSDataService',...]`) applied to the array. New formatter `cbs` (service name, way and date as lengths).
4. **`ConsumptionHistory3.consumptionHistoryTable` is an array** (SV read `bar`, `bars`, `barValue`, `barType` from it as a struct). Now `bars=N [...]`.
5. **Struct inheritance (`extends`)**: `ArrivalTime.time` (ClockTimeSeconds) inherits `hour` / `minute` / `invalid` from ClockTimeMinutes; the old walker ignored `extends`, the new one follows it. (SN's ETA columns were right; the test that proved it was not.)
6. `ConnTeleSync` / `EsimProxy` / `Guidance` / `CarPlayManager` / `Lifecycle` instances are named, not numbers; every instance in the table is checked against the catalogue's `instanceIDs`.
7. The generator prints `Default value (15) is not an enum item` for `MileageSupreme.qualifierMileageSupreme` and makes a default, as it did for `Pia.PIATransaction` in Driver Profiles (which installed). Not fatal here; see risk R2.

## 6. Interfaces with several instances

A manifest declares one `_instances` per interface. `"*"` means every instance of the interface (MainApp's generator turns it into the whole range; Driver Profiles uses it for `UserAccount`, with *arrives* evidence on the car).
The probe subscribes exactly the instances the table names, one proxy each.

| Interface | Instances in the catalogue | Read on | Why | A second instance would be worth ... |
|---|---|---|---|---|
| `Telephone` | 1, 2 | **1 and 2** (`nad-*`, `nad2-*`), manifest `"*"` | the brief asks for both: is the car's own modem (silent during a phone call) one of them? | no second app needed: `"*"` covers both |
| `HmiMediaState`, `HMIContext` | HMI_CID, HMI_FoMo_Left, HMI_FoMo_Right | HMI_CID | the centre display's state; Fo-Mo are the rear screens | rear screens: not for this car's questions |
| `HMIContext2` | 1, 2, 3 | 1 | SB / VS read the cluster's widget on instance 1 | **S10 asks which of HMIContext / HMIContext2 is served**: if `ic-widget2` stays silent, try 2 and 3 (one-line change in `fields.js`, a `"*"` manifest) |
| `MediaPlayer` | 54 (CarPlayMedia 10, ExternalDeviceUsbFrontA 2, ExternalDeviceBtA 4, ...) | CarPlayMedia | SM: the CarPlay process runs on the car; USB and Bluetooth reach the cluster's media line through `HmiMediaState` | the USB / Bluetooth player instances (`ExternalDeviceUsbFrontA`, `ExternalDeviceBtA`) if the title is not enough: add three table lines (`instance:` set), manifest becomes `"*"`; the ACL grows by the 54 ids |
| `VoiceCall` | Call1..Call9 | Call1 | the first call; a waiting call is Call2 | Call2 for a second call (call waiting): add the same eight table lines with `instance: 'Call2'` |
| `GPSData` | 1, DeadReckoning_internal | 1 | SV | no |
| `Guidance`, `Positioning`, `LevelMonitor`, `Lifecycle`, `CarPlayManager`, `AndroidAutoProjectedManager`, `ConnTeleSync`, `EsimProxy`, `Dialog` | one named instance each (128 / 1) | that instance | the only one | no |

The brief's "a second instance doubles what an app can read" is true only for fixed instances; with `"*"` one app reaches all of them, at the price of a bigger ACL (R3). **No second app is needed for any instance question the brief asks.**

## 7. Load: what the kit and the platform do with 62 declared interfaces

Measured on the Mac with the firmware's own generator (`kit/tools/oapgen/gen.js` with MainApp's `AppManagement.js` copied once from the car into a scratch folder, not in git; the catalogue of 2026-11-15; user id 12211):

| Manifest | Interface configs generated | Their size | `acl.json` | Generation time (Mac) | `.mgu` |
|---|---|---|---|---|---|
| **signal_probe** (62 interfaces + the platform's 22) | 84 | 357 KB | 9.8 KB, 82 requests | 0.14 to 0.20 s | 832 KiB |
| f30_cluster 0.7.20 (installs fine) | 41 | 168 KB | 4.7 KB | | |
| driver_profiles 0.2.2 (installs fine) | 31 | 140 KB | 3.7 KB | | |

- **At start with all sets off (the default): no proxy is built.** The only cost is the declared configs on disk (2x f30's) and loading five small modules; the app subscribes nothing until a checkbox is pressed. This is the answer to "idle handlers on 62 interfaces": they do not exist. (Declarations are static; subscriptions are not.)
- A set switched on builds its interfaces **one at a time with a 120 ms pause** (`config.probe.hubPauseMs`) through the kit's own `nativeTick` chain; each subscription's time is logged (`probe: watch Light[1] set=S6 fields=2 ok 140ms`), so the first session measures the real cost per interface. All eleven sets together are 63 proxies (about 8 s of pauses before any native time).
- **A set switched off stops logging at once but its proxies stay until the app restarts.** The probe never calls a proxy's `shutdown()`: no code in this repository has ever done it on the car, and an exit here counts as a crash (the platform wipes an app's data at the first unexpected exit and uninstalls it at the second). The checkbox state is saved, so a restart of the app (the lead, with the owner's word, `systemctl restart oapcontroller`) brings back only the sets that are on. Consequence for the session: switch sets on cumulatively and in the order of the blocks; S6 alone first for the trip button.
- Notification volume is bounded by gaps and caps (the table), a 40 lines per second guard, and the kit's log, which rotates at 256 KB keeping one older file: **collect after every block** (the probe says so in the log at every 150 KB).
- **Not measurable on the bench** (the first session at the car measures them, and the log carries the numbers): memory per proxy and the app's total against its limit (`memoryThresholdKB` 192 MB, `cpuLimit` 60), CPU while 60 interfaces notify, whether MainApp's install accepts 84 configs (f30 41, Driver Profiles 31 install; the largest known success), SOME/IP subscription time per interface.
- **One manifest or three?** Recommended: **one app.** A single app with lazy subscription costs nothing idle and one install; three apps (`signal_probe_a/b/c`) would triple the installs, the uids, the loggingIds and the log files the collector reads, and would not lower the load while a set is on (the load is the set, not the app). The alternative if the first install fails (UPDATE_FAILED, the Store shows nothing more) or memory is the problem: split by block, mechanically (copy the app folder, filter `TABLE` by set, change `id`, `title`, `loggingId`, run `probe_fields.js sync`): **a** = S1 S2 S3 S6 S10 S11 (parked: 31 interfaces), **b** = S4 S5 (media, phone: 20), **c** = S7 S8 S9 (drive: 21). Not built; it is a two-minute change, and the table is the single source.

Risks (the lead's, before the install):
- **R1** install: `check_signals.py` passes on every declaration and the generator ran on the whole manifest; what the car's MainApp does with 84 configs is unknown. Fallback: the split above, or drop S10 / S11 (D3).
- **R2** the `MileageSupreme` default warning (section 5.7): precedent `Pia.PIATransaction`, which installed. Fallback: delete the one table line `mileage-supreme` and sync.
- **R3** `"*"` for `Telephone` widens the ACL by instance 2 only (the catalogue has two instances).
- **R4** a subscription that raises inside the native binding is not catchable in JS; the kit's chain serialises every native call as `signals.js` documents, and the probe adds nothing new at that level (`watch`, `on`, `get` only).
- **R5** `signals.on` is used for a field added to a proxy that already exists (a second set needing the same interface): it is `p.subscribe`, the call `watch` itself makes for every field, but this late use has no car precedent; the bench cannot show it. Mitigation: turn on a set whose interfaces are not yet built first (S6 before S10), or restart the app between blocks.
- Node 8.16 itself was not run (`.cache/node8` is not on the Mac and a download was refused); the check is a source scan for every syntax Node 8 lacks (no `?.`, `??`, spread, optional catch binding, `flat`, `Object.entries` / `values`, `padStart`), the files use only what Node 8 has, and the bench ran the build on Node 22. The lead should run `node bench/test-signal-probe.js` once with `.cache/node8` present if it can.

## 8. The log format (fmt=1)

Full text: `bake/work/car/pub/CP/LOG-FORMAT.md` (published early for CL and CQ). In short, every line starts with the kit's `<ISO time> <LEVEL> ` and then `probe: `:

```
probe: start signal_probe v=0.1.0 fmt=1 sets=S6 fields=24 of 160          first line of every run
probe: sets on=S4+S6 changed=+S4 fields=37                                a set was switched
probe: watch Light[1] set=S6 fields=2 ok 140ms                            an interface was subscribed (error: <text> when not)
probe: mark M2 t=85.9 tms=85894 sets=S6                                   the menu row "Позначка N"
probe: P13 stalk #3 t=88.1: stalks=64(0x40) prev=0 up=0x40 down=0x0 tms=88104 since=M2+2210
probe: P3 range-tank #2 t=41.3: fuel=38 ... mileage=48215
probe: summary S6 +30s: 5 of 24 fields have spoken: ...  |  silent: ...  |  providers: up=7 down=1 ...
probe: ask P13 sw-fav (silent at +120s): answered (object)
probe: volume: 150 KB in 900 lines since start: collect the logs
```

Marks are numbered from 1 per run (a restart starts again; the `start` line separates runs). Body conventions: `k=v` pairs; `-` absent; `?` unexpected kind; `entries=N [..]` lists (24 entries, then `+N more`); `trips=N`, `bars=N` for the nested arrays; lengths as `name-len=`.
Log location on the car: `/var/opt/public/oap/oap_<uid>/data/signal_probe.log` (+ `.log.1`) with `settings.json` beside it (`set1`..`set11`); the uid is assigned at install.

## 9. Installing it from the Store, and running a block

1. Add the repository as a source in the MGU Store as for the other apps (the app builds on the head unit from source: `apps/signal_probe`, `mguHmi` ID7); it appears as "Signal Probe" under Apps. It can stay installed beside f30_cluster and Twin Dial and runs with either or with BMW's own cluster; it uses no cluster-render connection.
2. Open it: the status line, "Позначка 1", and eleven checkboxes (S1..S11), all off. Press the sets of the block (for the trip button: **S6 only**). The first line of the log says which are on.
3. At each step of the protocol press "Позначка N" (the number is on the row) and note it; the log has the marker with the time, and every S6 line the time since it.
4. Never operate the menu while moving. The lead collects the logs after each block (`signal_probe.log` and `.log.1`).

The trip-button procedure (SB §3.2, with CQ's session text): S6 only; mark; one short press of the stalk's on-board-computer button; mark; another; three presses; thumbwheel up / down / press; each wheel button once; the controller. In the log a press is one `P13 stalk` (or `stalk-complete`) line with `up=0x..`, and its release `down=0x..`, `since=M<n>+<ms>` after the mark. A long press may reset a trip page: skip it or pick a page whose reset is acceptable.

## 10. Tests

`node bench/test-signal-probe.js` (port 8502): **138 passed, 0 failed.**

1. source: no setter, method call, `proxy()`, `requestDefaultSymbols`, `standardCCMessage`, `extendedCCMessage`, `newCCMessage`, `A19B`; draws nothing; Node 8 syntax only; no home path.
2. declarations: `app.json` equals what the table needs; only r / s; r iff a non-zero getter id, s iff a notifier, instances in the catalogue, `check_signals.py` passes; the export is current; 160 unique tags; P1..P19 and S1..S11 present; S6 alone = 24 fields on 8 interfaces; only `Telephone` on two instances.
3. 160 fields x 3 value sets made from the catalogue's types; every column's kind against the catalogue (481 columns).
4. 160 exact lines (canaries in every text member).
5. engine: once per change, gaps and `(+k folded)`, caps, flood guard, lazy subscription, shared interfaces (`on()` + one `get`), S10 sharing, off sets silent, marks, stalk bits and time after the mark, summaries, the one ask (and no ask for a notifier-only field), TPMS polling, Telephone on both instances, throwing and hostile values, the volume line, a log that throws, no signals object.
6. bench: the real app built by the kit and run in the stubbed head unit: starts with sets=none; a checkbox press subscribes S6's 8 interfaces; the mark row works and the menu shows the next number; an injected stalk byte is logged with its time after the mark; a field of an off set logs nothing; the choice survives a restart; the app never exits.

Other suites run unchanged on this branch: `test-twin-probe.js`, `test-twin-trip.js`, `test-probes.js` (the rest see the lead's note in the final message).

## 11. What the lead decides

1. **D3 (CA): keep S10 and S11?** They are in; both can be dropped by deleting their table lines.
2. **Merging `twin-r3/{sm,sp,sn,sv,sb}`:** their edits to `shared/twin_probe.js`, `apps/twin_dial/probe/*` and `bench/test-twin-probe.js` conflict with each other and are superseded by this app (their reports, design data and non-probe code are not). Merge them without those four paths (take main's) unless Twin Dial's own probe build is still wanted; the fixes of section 5 are in `signal_probe` only.
3. **The dead rl3 fallback in `shared/twin_tokens.js`** (section 5.1): fix before relying on ResetLogic3.
4. **`phone-calllist`** (counts of the call list): keep or remove (section 4).
5. **One app or three** (section 7): one recommended; the split is mechanical.
6. **`MediaPlayer` / `VoiceCall` extra instances** (section 6) if the title or a waiting call is wanted.
7. **S12** (events): nothing declared until a named event is approved.
