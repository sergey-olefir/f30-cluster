# Runbook for the lead: the car-signals session

For the lead. The owner works from `docs/car/SESSION.uk.md` (Ukrainian); this file is what you do before, during and after, plus the tick-box list of every register item. Labels as in the brief: **arrives**, **arrives-other-app**, **not sent**, **unseen**; every unit is a hypothesis until a reading is compared with something the car shows.

Two documents are generated from `design/car/session_plan.json` by `tools/car/make_session.py` (marks, the verify table and the checklist); do not edit those parts by hand, change the plan and run the tool (`--check` fails when they are stale).

## 0. What we can and cannot do with the trip button (the owner's priority)

The owner's first question is whether we can catch the press of the **trip / on-board-computer button at the end of the turn-signal stalk**. Plainly:

- **We can only OBSERVE the press.** The probe declares fields with a notifier (`s`) or a read-only getter (`r`, non-zero id). If the stalk byte (`body.Light.IndicatorSteeringColumn` / `…Complete`, member `operationColumnStalks`) carries that button, a press shows as a changed bit in a `probe: P13 stalk` line. A press that does not appear in any P13 or P11 line cannot be caught by an app on this car.
- **We cannot suppress or replace BMW's own reaction.** The press still steps the stock cluster's on-board-computer page underneath whatever we draw; there is no setter, no event swallowing, no key grab for a closed screen (SB §2.3: `controller.grab` works only while our screen is shown). Even with a confirmed bit, `config.tabKey` adds our tab step **in addition to** BMW's page change. Decision for the owner then: accept the double action, or use the setting (Tab = auto / 1 / 2 / 5) as the primary control and the key as an add-on.
- **Nothing is written, called or injected.** Every field is read-only (`tools/signals/check_signals.py` passes on the probe's manifest). We do not use `_broadcasts` (events) unless you name one.
- **What the session settles:** one long block (B1, first after the safety checks) with a mark before each press, under three cluster states: stock panel, Twin Dial, f30_cluster (G20 see-through, so BMW's own bottom row is visible). The decision table is SB §3.3, implemented by the parser (CL); every outcome has a `config.tabKey` value (or "no key; the setting only") written by `make_patches.py`.
- **A bit that moves on the BC press and on no other stalk step** is the key. A line that moves on any stalk movement (the indicator bits) is a mask problem, not a key.
- The long press (B1 step "long") is optional and may reset a trip page: the owner decides on the day.

## 1. Before the session

### 1.1 What must be on the car

| What | Needed for | Status on 2026-11-18 | Owner's approval |
|---|---|---|---|
| **signal_probe** (package CP: the app that draws nothing and only subscribes and logs) | every P item | not installed; built on `car/cp` | yes (an install writes to the car) |
| f30_cluster **0.7.20** (as installed) | X1, X11, F items, L1/L9/L14, B1 repeat | on the car | none |
| Twin Dial **0.1.0** (as installed) | X9, X11, F1-F3, B1 repeat, L4-L8 | on the car | none |
| cluster-render, client 0.5.12 or later | X5 (etc2) | last seen 0.5.12 on 2026-11-15; confirm at collection #0 (L12) | none |
| Twin Dial **0.1.1** with its experiment keys / the Діагностика menu | X6, X7, X8, X10, the tab key as built | **not built** (SPEC-R3 phase B) | yes |
| f30_cluster with `ccActive.release` and `mbGap` (one build) | X7, X3 | on `main`, off, version not bumped | yes |
| f30_cluster `sceneTex` r8, then etc2 | X5 | on `main`, off | yes (one install each) |
| Twin Dial `mbCover` clear / black / grey; `mbRebuild.onMode` | X2, X3, X4 | experiment files in `tools/research3/mb/exp/`, off | yes (one install each; only as the decision table asks) |

**The session as planned needs one install: signal_probe.** Everything the owner does in blocks 0-9 runs on the apps already on the car (f30 0.7.20, Twin Dial 0.1.0). The experiments that need a build are **pass 2** (section 4): they cannot ride on the probe session without several installs, each of which is a change to the car the owner must approve, so they are deliberately a separate sitting.

If Twin Dial 0.1.1 is ready before the session, install it **before** the probe (so the probe's `starts` line is in the log of the final apps) and treat its normal behaviour as a new baseline: SESSION's Twin Dial steps then show 0.1.1, not 0.1.0; X8 and X10 move from pass 2 into block 6 (a note in the log of what you installed).

### 1.2 Order of installs

1. Merge the four branches (`car/ca`, `car/cp`, `car/cl`, `car/cq`) into a working branch; run `node bench/test-signal-probe.js`, the f30 and twin suites, `python3 -I tools/car/make_session.py --check`.
2. Ask the owner to approve installing signal_probe; install it from the Store as in `docs/car/CP-REPORT.md` (the bench-built package; never a build made with the `BENCH_STUB` SDK).
3. Check the app's start line in its log (`/var/opt/public/oap/oap_<uid>/data/<loggingId>.log`; the uid is assigned at install, find it with `collect.sh`'s version/uid listing).
4. Dry-run the owner's menu once with a mark ("Позначка", mark 1): the marker line must be in the log (SESSION B0.6).

### 1.3 Preconditions to confirm

- The car is online, ssh read-only works (`tools/car/collect.sh` prints what it will run before running it).
- The owner knows who the passenger is for blocks 7-8.
- You have the owner's current settings (they are written down and photographed in block 0, but read `settings.json` at collection #0 too).
- Rules that always hold: never `kill` an OAP app process; only `systemctl restart oapcontroller`, only you, only with the owner's word; never a setter, never a method call with a side effect, never `KombiIF.standardCCMessage` / `extendedCCMessage`, never `A19B`, never a write to a driver-assistance setting, never `requestDefaultSymbols`.
- Privacy: collected logs contain numbers, enum names and lengths only; photos and the owner's paper notes are personal. The privacy check (`tools/car/privacy_check.py` or CL's equivalent) runs on everything before anything derived is committed.

## 2. During the session

### 2.1 Collections (read-only; `tools/car/collect.sh`)

The kit rotates every app log at **256 KB** (`signal_probe.log` and `.log.1`), and the probe writes up to 150 KB per 900 lines in a busy block, so **collect the probe's log after every block** (a quick `collect.sh` run is only reads), not only at the four full collections below. Two things overwrite history if you wait: the rotation, and a restart of the app (the marks start again at M1 per run, the `probe: start` line separates runs).

| # | When | Why | Which L items it answers |
|---|---|---|---|
| 0 | At arrival, before the owner changes anything (B0.1) | the history of 0.7.18-0.7.20 and of Twin Dial 0.1.0 as the car has it, and the versions and uids | L1-L5, L10-L15 |
| 1 | During the idle of the cold start (B2.6) | the fresh start's first-10-s lines, the day/night source | L9, L12, L15, L3 |
| 2 | End of block 6 (B6.16) | Twin Dial and f30 both run today; the door-message reaction, the upload accounting, the slot rows while Twin Dial's panel is up | L1, L8, L10, L11 |
| 3 | End of the session (B9.2) | the probe's complete log, Twin Dial's phone, media and sign lines | L6, L7, L14, everything else |

Each full collection goes to a new dated folder under `reference/car/` (git-ignored). Run the parser on each. After every block: collect, then `python3 -I tools/car/verify_steps.py <signal_probe.log> --block B<n>` (below) before you say "go on".

### 2.2 Clock anchor

The log's `t=` is seconds since the probe's start; the owner's paper has wall-clock times. At B0.6 (mark 1) write down the wall clock and the line's `t=`. The marks make the rest unambiguous; the anchor is only for the drives (blocks 7-8), where marks are pressed at stops and the passenger dictates the clock.

### 2.3 The verify table (what to see in the log before the owner moves on)

`python3 -I tools/car/verify_steps.py <signal_probe.log> --block B1` prints, per marked step, OK / MISSING / SILENT for every pair below (it reads `design/car/session_marks.json` and the probe's `mark M<n>` lines; the `since=M<n>+<ms>` tail of S6 lines names the mark exactly). Add `--silent P13:sw-fav` for a pair you have already accepted as silent. It exits 1 on a required pair that is missing. The marks are numbered per run of the app; if the log has two runs it says so.

Per marked step: between mark N and mark N+1 there must be a probe line for each pair listed; a missing pair means either the field is **not sent** (an answer, after the step was done correctly and the summary has run) or the step was done wrongly (ask the owner to repeat once). **Never ask for a repeat of a block that has already produced a "silent" summary**: silence after a correct step is the finding.

Cluster states in step order: `stock` = Twin Dial and f30 both Off; `twin` = Twin Dial on; `f30` = f30 6WB Comfort with G20.

<!-- BEGIN:verify -->
**Block 1: Кнопка бортового комп'ютера на важелі і решта кнопок** (sets S6)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 3 | B1.3 | stock | P13: stalk |
| 4 | B1.4 | stock | P13: stalk |
| 5 | B1.5 | stock | P13: stalk |
| 6 | B1.6 (optional) | stock | P13: stalk |
| 7 | B1.7 | stock | P13: stalk |
| 8 | B1.8 | stock | P13: stalk |
| 9 | B1.9 | stock | P13: stalk |
| 10 | B1.10 | stock | P13: stalk |
| 11 | B1.11 | stock | P13: stalk, P13: sw-wheel-steps |
| 12 | B1.12 | stock | P13: sw-wheel-steps |
| 13 | B1.13 | stock | P13: sw-fav |
| 14 | B1.14 (optional) | stock | P13: sw-special2 |
| 15 | B1.15 | stock | P13: sw-skip |
| 16 | B1.16 | stock | P13: sw-voice |
| 17 | B1.17 | stock | P13: sw-phone |
| 18 | B1.18 | stock | P13: sw-volume |
| 19 | B1.19 | stock | P13: controller |
| 20 | B1.20 | stock | P13: stalk |
| 21 | B1.21 | stock | P11: kombi-config |
| 22 | B1.22 | twin | P13: stalk |
| 23 | B1.23 | twin | P13: stalk |
| 24 | B1.24 | twin | P13: stalk |
| 25 | B1.25 | twin | P13: stalk |
| 26 | B1.26 | twin | P13: sw-wheel-steps |
| 27 | B1.27 | f30 | P13: stalk |
| 28 | B1.28 | f30 | P13: stalk |
| 29 | B1.29 | f30 | P13: stalk |
| 30 | B1.30 | f30 | P13: stalk |
| 31 | B1.31 | f30 | P13: sw-wheel-steps |

**Block 2: Холодний запуск двигуна** (sets S2, S3)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 32 | B2.2 | stock | P3: range-tank, P5: units |
| 33 | B2.3 | stock | P4: bc-average, P4: bc-travel |
| 34 | B2.4 | stock | P10: voltage-basic |
| 35 | B2.5 | stock | P6: coolant, P10: voltage-basic |
| 36 | B2.6 | stock | P6: engine-verdict |
| 37 | B2.7 | stock | P10: voltage-basic |
| 38 | B2.8 (optional) | stock | P5: units |
| 39 | B2.9 (optional) | stock | P4: bc-travel |

**Block 3: Двері, повідомлення, напруга** (sets S1, S3)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 40 | B3.2 | stock | P1: active-cc, P10: voltage-basic |
| 41 | B3.3 | stock | P7: doors, P1: active-cc, P1: ccList |
| 42 | B3.4 | stock | P7: doors |
| 43 | B3.5 | stock | P7: doors |
| 44 | B3.6 | stock | P7: doors |
| 45 | B3.7 | stock | P7: doors |
| 46 | B3.8 | stock | P7: lids |
| 47 | B3.9 | stock | P1: menu-cc, P1: active-cc |
| 48 | B3.10 | stock | P1: active-cc |

**Block 4: Радіо та медіа** (sets S4)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 49 | B4.2 | stock | P8: station, P8: active-source |
| 50 | B4.3 | stock | P8: station |
| 51 | B4.4 | stock | P8: media-menu |
| 52 | B4.5 (optional) | stock | P8: station |
| 53 | B4.6 | stock | P8: player-metadata, P8: active-source |
| 54 | B4.7 | stock | P8: track-progress |
| 55 | B4.8 | stock | P8: player-metadata |
| 56 | B4.9 | stock | P8: player-metadata |
| 57 | B4.10 | stock | P8: track-progress |
| 58 | B4.11 | stock | P8: active-source |
| 59 | B4.12 | stock | P8: player-metadata, P8: cp-player-state |

**Block 5: Телефон і дзвінки** (sets S5, S4)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 60 | B5.2 | stock | P9: phone-devices |
| 61 | B5.3 | stock | P9: call-state |
| 62 | B5.4 | stock | P9: call-state, P9: phone-call1-state |
| 63 | B5.5 | twin | P9: call-state |
| 64 | B5.6 | twin | P9: call-state, P9: phone-calllist |
| 65 | B5.7 | twin | P9: call-state |
| 66 | B5.8 | twin | P9: hmi-app |
| 67 | B5.9 (optional) | twin | P9: wca-front |
| 68 | B5.10 | twin | P8: player-metadata |
| 69 | B5.11 | twin | P9: phone-devices |
| 70 | B5.12 | twin | P9: call-state, P9: carplay-call |
| 71 | B5.13 | twin | P9: call-state |

**Block 6: Панель із застосунками BMW-стилю, стоїмо** (sets S1)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 72 | B6.2 | twin | P1: active-cc |
| 73 | B6.3 | twin | P1: active-cc |
| 80 | B6.10 | twin | P1: active-cc |
| 85 | B6.15 | f30 | P1: active-cc |

**Block 7: Коротка поїздка з навігацією** (sets S7, S6)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 87 | B7.2 | stock | P14: map-without-route, P11: kombi-config |
| 88 | B7.3 | stock | P12: guiding-state |
| 89 | B7.4 | stock | P12: next-intersection, P12: dart |
| 90 | B7.5 | stock | P12: dart |
| 91 | B7.6 | stock | P14: map-without-route |

**Block 8: Поїздка з круїз-контролем і дорожніми знаками** (sets S8, S9)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 92 | B8.2 | stock | P16: tyre-pressure |
| 93 | B8.3 | stock | P17: cbs-list |
| 94 | B8.4 | stock | P15: sign |
| 95 | B8.5 | stock | P15: longitudinal |
| 96 | B8.6 | stock | P16: sport-display |
| 97 | B8.7 | stock | P17: heading |
| 99 | B8.9 | stock | P16: tyre-pressure |
<!-- END:verify -->

### 2.4 Set switching

Sets are one checkbox each (`set1`..`set9`) on the probe's own centre screen, switched by the owner. After each switch the log must carry `probe: sets on=… changed=…` (CP); 30 s later the `summary S<n> +30s` lines (which fields spoke, which are silent, which providers are down) and at +120 s one `ask` per silent field (a read-only getter); do not let the owner start a block before you have seen it. Per block: B1 S6; B2 S2+S3; B3 S1+S3; B4 S4; B5 S5+S4; B6 S1; B7 S7+S6; B8 S8+S9. Never more than two sets at once (the load of 135 fields on about 45 interfaces is untested on this car). If the car stutters (cluster freezes, the platform restarts an app): stop, switch every set off, read the platform's lines, tell the owner.

### 2.5 Stop conditions

- BMW's belt lamp or door message is not shown in block 0 or at B6.3: the session ends, nothing from our apps is allowed to drive.
- The cluster resets (the KOMBI resets on too-big effect shaders; one look per layer source): note the step and the app, switch both apps Off.
- An OAP app exits twice: the platform uninstalls it (CP's no-uncaught-exception rule). If the probe disappears, reinstall is an owner decision.

## 3. After the session

1. Copy the final collection into `reference/car/<date>/`; run the privacy check; run the parser: `python3 -I tools/car/parse_logs.py <folder>` fills `design/car/answers.json`; run `make_patches.py` for the reviewable diffs of `app.json` (never applied automatically).
2. Review each answer with the owner against the photos and the paper: every unit is a hypothesis until the displayed number matches. Mark each answer with its date and evidence label.
3. Update `docs/twin-dial/SPEC-R3.md`: every **after probe** becomes verified, refuted or re-planned (table below).
4. Write the result into memory: one file per durable fact (for example "stalk button: caught / not caught, which bit", "statusActiveCCMessage rest value", "the tab key", "tyre scale"), with the evidence label and the date, plus an index line. State plainly what remains unseen.
5. Decide pass 2 (section 4) from the answers.

### 3.1 What each answer unblocks

| Answer | Unblocks | Where it lands |
|---|---|---|
| P13 stalk bit (SB §3.3 table), P11 indirect | the tab key | SPEC-R3 §3.4; `config.tabKey` in twin_dial; phase D |
| P1 / L2 / L8 shown-now = list id; rest value; second witness | D7 lifted, f30's release | SPEC-R3 §5.4; `config.ccActive.strict` / `noneValues` / `release`; SC; MC §6 table |
| P2 / L13 stored-message mark | the marker drawn | `config.ccMarker` |
| P3 / L5 odometer | factor, invalid value | `config.odometer` (MK) |
| P4 / L4 trip | factors, which counter is "since start", the departure time | `config.trip.factors` (MK); SPEC-R3 §4.1 |
| P5 units | none unless miles / °F | log |
| P6 coolant verdict | the bar's empty and hot points | `config.coolant` |
| P7 doors | the car picture | later round |
| P10 voltage | a battery readout | `config.battery` |
| P8 / L7 media | tab 3 M1 / M2 | SPEC-R3 §4.3; `config.media` (SM table) |
| P9 / L6 phone and the photos of the ringing pad (B5.3, B5.5) | tab 4, the call card, whether Twin Dial hides BMW's pop-up | SPEC-R3 §4.4 and §13 |
| P12 / P14 / L11 | guidance page, map presence rule | SPEC-R3 §4.5; `mapWindow` presence (SN) |
| P15 / L14 sign and cruise | the sign, the set speed and function | SPEC-R3 §8, §9; `config.sign`, `config.cruise` |
| P16 / P17 boost, tyres, oil, others | technical page, tyres | SPEC-R3 §4.1 (SV tables) |
| X1 (f30 byMode off, Twin baseline) | whether the black box follows the rebuild | research3 MB table 4.2; chooses which of E1-E4 to install in pass 2 |
| X9 pair | band level, night multipliers | SPEC rev 2 §7, §17.2 |
| X11 film | MP's predictions of the switch time | MP §8 |
| F1-F8 | see the checklist | per item |

## 4. Pass 2: the experiments that need a build

Each is an install the owner must approve and each is a separate step on the car. Order by cost and by what the earlier result decides:

| # | Build | Experiment | Photograph / read | Run only if |
|---|---|---|---|---|
| 1 | Twin Dial 0.1.1 normal | X10 (KOMBI accepts the round-3 shaders), X8 (150 ms; slow-motion of a message and of leaving tab 2), X6 (map window W1 / W2, `mapWindowForce`, `mapSlots` from its Діагностика menu) | MB / SN protocols | 0.1.1 exists |
| 2 | f30 with `ccActive.release` and `mbGap` | X7 (door message, second message, returning message), X3 (the box; the notch in Comfort's strip) | door message; the box after P-D-N-R-P and mode switches | X1 showed a box on f30, or L1 shows case A1-A5 |
| 3 | f30 `sceneTex: "r8"` | X5 look and "goes whole … KB" over three Sport to Comfort switches | dials close up | always (r8 needs no ETC2 support) |
| 4 | f30 `sceneTex: "etc2"` | X5 (does `etc2rgb` draw) | log: `asset … etc2rgb`; dials close up | L12 >= 0.5.12 and 3 looks right |
| 5-7 | Twin `mbCover` clear, black, grey | X2 (rectangle versus pixels) | the speedometer hub | X1 baseline on Twin Dial showed a box; stop at the first outcome that decides (MB §4.2) |
| 8 | Twin `mbRebuild.onMode` | X4 (rebuild brings the box) | the box | E2 / E3 gave no box |

State the number of installs to the owner before asking: the recommended pass 2 is builds 1-3 (and 4 if 3 is clean); 5-8 only as the decision table drives it.

## 5. The checklist of every register item

Tick when the answer has been read and recorded (answers.json carries the evidence; the tick is yours). Items not answerable in the session say why in the "Answered by" column: `pass 2` = needs a build; a "not in this session" reason = cannot be done.

<!-- BEGIN:checklist -->
| Done | Id | Kind | Question | Answered by | Decides |
|---|---|---|---|---|---|
| [ ] | L1 | L | Why f30's window over BMW's panel stays open (cases A1-A16) | collection #0; collection #2; B6.10 (mark 80); B6.11 (mark 81); B6.15 (mark 85) | which release setting |
| [ ] | L2 | L | Does statusActiveCCMessage notify; what it rests on; does its number equal the ccList id | collection #0 | D7; noneValues |
| [ ] | L3 | L | The clock fallback: statusShowTimeDate arrives and is local time | collection #0; collection #1 | 0.7.19 clock note |
| [ ] | L4 | L | Twin Dial's trip fields arrive; raw values against iDrive's trip page | collection #0; collection #2 | trip factors |
| [ ] | L5 | L | The odometer member arrives; factor 1 km; did the number show on 0.1.0 | collection #0; B6.2 (mark 72) | odometer |
| [ ] | L6 | L | aggregatedCallState arrives (Twin Dial's phone state line) | collection #3 | phone card |
| [ ] | L7 | L | HmiMediaState on HMI_CID arrives (Twin Dial's media lines) | collection #3; B5.10 (mark 68) | media tab |
| [ ] | L8 | L | Vehicle2.statusDisplayedCCMessage arrives and returns to 0 | collection #2 | second witness |
| [ ] | L9 | L | Layout builds in the first 10 s of both apps (the bench predicts 3) | collection #1 | start-up fix |
| [ ] | L10 | L | cluster-render's upload cap, per-minute KB, 'goes whole' lines | collection #0; collection #2 | cost of a switch |
| [ ] | L11 | L | Slot 0x100 rows while Twin Dial's panel 0x10004f8 in 0x203 is up | collection #2 | theory H-M |
| [ ] | L12 | L | cluster-render's version is at least 0.5.12 | collection #0 | ETC2 |
| [ ] | L13 | L | The 0.7.18 probes' results (ccListRiskClass, basicList) | collection #0 | stored-message mark |
| [ ] | L14 | L | f30's speed-limit sign lines: TrafficSignDisplayControl arrives | collection #0; collection #3 | sign |
| [ ] | L15 | L | day/night source: the car's value against the sun; the meaning of 0 | collection #0; collection #1 | day/night |
| [ ] | P1 | P | statusActiveCCMessage, statusDisplayedCCMessage, statusMenuCCMessage, ccList | B1.20 (mark 20); B3.2 (mark 40); B3.3 (mark 41); B3.9 (mark 47); B3.10 (mark 48); B6.10 (mark 80); B6.15 (mark 85) | shown now = list id; rest value; frame counter |
| [ ] | P2 | P | basicList, ccListRiskClass | B3.9 (mark 47) | stored-message mark; risk class |
| [ ] | P3 | P | odometer carriers | B2.2 (mark 32) | factor; invalid value |
| [ ] | P4 | P | trip computer fields | B2.3 (mark 33); B2.9 (mark 39) | factors; which computer is since start; departure |
| [ ] | P5 | P | units | B2.2 (mark 32); B2.8 (mark 38) | km / miles, C, bar |
| [ ] | P6 | P | engine temperature verdict and coolant | B2.5 (mark 35); B2.6 (mark 36) | the car's own coolant verdict |
| [ ] | P7 | P | doors, boot, bonnet, central locking | B3.2 (mark 40); B3.3 (mark 41); B3.4 (mark 42); B3.5 (mark 43); B3.6 (mark 44); B3.7 (mark 45); B3.8 (mark 46) | notifies at all; sends once at subscribe |
| [ ] | P8 | P | media state, sources, tuner, CarPlay player | B4.2 (mark 49); B4.3 (mark 50); B4.4 (mark 51); B4.5 (mark 52); B4.6 (mark 53); B4.7 (mark 54); B4.8 (mark 55); B4.9 (mark 56); B4.10 (mark 57); B4.11 (mark 58); B4.12 (mark 59); B5.10 (mark 68) | title line; progress; source icon kind |
| [ ] | P9 | P | phone: VoiceCall, manager, aggregator, device list, Telephone | B5.2 (mark 60); B5.3 (mark 61); B5.4 (mark 62); B5.5 (mark 63); B5.6 (mark 64); B5.7 (mark 65); B5.8 (mark 66); B5.9 (mark 67); B5.11 (mark 69); B5.12 (mark 70); B5.13 (mark 71) | call states; battery and signal; modem or phone |
| [ ] | P10 | P | voltage carriers | B2.4 (mark 34); B2.5 (mark 35); B2.7 (mark 37); B3.2 (mark 40) | a plausible 12-14.8 V |
| [ ] | P11 | P | HMI context, cluster selection and configuration | B1.21 (mark 21); B7.2 (mark 87) | the cluster's map-view setting; an indirect key |
| [ ] | P12 | P | navigation and guidance fields | B7.3 (mark 88); B7.4 (mark 89); B7.5 (mark 90) | manoeuvre kinds; distance unit |
| [ ] | P13 | P | steering-wheel buttons, turn-signal stalk, controller | B1.2 (mark 2); B1.3 (mark 3); B1.4 (mark 4); B1.5 (mark 5); B1.6 (mark 6); B1.7 (mark 7); B1.8 (mark 8); B1.9 (mark 9); B1.10 (mark 10); B1.11 (mark 11); B1.12 (mark 12); B1.13 (mark 13); B1.14 (mark 14); B1.15 (mark 15); B1.16 (mark 16); B1.17 (mark 17); B1.18 (mark 18); B1.19 (mark 19); B1.20 (mark 20); B1.22 (mark 22); B1.23 (mark 23); B1.24 (mark 24); B1.25 (mark 25); B1.26 (mark 26); B1.27 (mark 27); B1.28 (mark 28); B1.29 (mark 29); B1.30 (mark 30); B1.31 (mark 31) | the tab key (SB 3.3) |
| [ ] | P14 | P | map presence fields | B1.21 (mark 21); B7.2 (mark 87); B7.3 (mark 88); B7.6 (mark 91) | when BMW's map exists |
| [ ] | P15 | P | speed-limit sign, longitudinal assistance, HUD feed | B8.4 (mark 94); B8.5 (mark 95) | the sign arrives; set speed and active function |
| [ ] | P16 | P | boost, engine dynamics, oil, tyres | B8.2 (mark 92); B8.6 (mark 96); B8.9 (mark 99) | scales; whether the car notifies |
| [ ] | P17 | P | heading, altitude, service due | B8.3 (mark 93); B8.7 (mark 97) | whether they arrive |
| [ ] | X1 | X | f30 with 'Change with the drive mode' off | B6.8 (mark 78); B6.9 (mark 79); B6.11 (mark 81); B6.12 (mark 82); B6.13 (mark 83); B6.14 (mark 84) | whether the rebuild brings the black box |
| [ ] | X2 | X | Twin Dial with a clear layer over the gear letter (mbCover) | pass 2 (a build) | rectangle versus pixels |
| [ ] | X3 | X | f30 with the gap cut out of its layer rectangles (mbGap) | pass 2 (a build) | the fix |
| [ ] | X4 | X | forced rebuilds (mbRebuild) | pass 2 (a build) | theory (b) |
| [ ] | X5 | X | f30 textures sceneTex r8 then etc2 | pass 2 (a build) | picture quality; etc2rgb draws |
| [ ] | X6 | X | the map window W1 / W2, mapWindowForce, mapSlots | pass 2 (a build) | BMW's map shows through on the panel's own id |
| [ ] | X7 | X | f30's message release (config.ccActive.release) | pass 2 (a build) | the window closes, never over a listed message |
| [ ] | X8 | X | message timing: Twin Dial 0.1.1's card, slow-motion video | pass 2 (a build); B6.10 (mark 80) | 150 ms covers the upload |
| [ ] | X9 | X | band level and night palette: one fixed-exposure photo against the bench render | B6.6 (mark 76); B6.7 (mark 77) | the level; night multipliers |
| [ ] | X10 | X | the KOMBI accepts the round-3 shaders (0.1.1 installed) | pass 2 (a build); B8.8 (mark 98) | no reset; no missing layer |
| [ ] | X11 | X | switch-time film through a mode switch on each app | B6.9 (mark 79) | MP's predictions |
| [ ] | F1 | F | Is BMW's own speed-limit sign visible with Twin Dial up | B8.8 (mark 98) | SV covers it |
| [ ] | F2 | F | Side lamps and belt lamp with Twin Dial up (belt unbuckled, a door open) | B0.3; B6.2 (mark 72); B6.3 (mark 73); B6.4 (mark 74) | safety check before driving |
| [ ] | F3 | F | A close photo of a dial's lower ends | B6.5 (mark 75) | inner-ring finding |
| [ ] | F4 | F | Photo 16 of OVERLAY-PHOTO-PROTOCOL: which side lamps BMW draws over us | not in this session: needs the diag_overlay build (OVERLAY-PHOTO-PROTOCOL photo 16), which was never built; B6.4 (mark 74) | six of seven lamps unknown |
| [ ] | F5 | F | Does the HUD show the cruise set speed | B8.4 (mark 94); B8.5 (mark 95) | urgency of SPEC-R3 9 |
| [ ] | F6 | F | The stock cluster's own cruise and limiter display (Twin Dial off) | B8.4 (mark 94); B8.5 (mark 95) | model for our symbols |
| [ ] | F7 | F | The stock cluster's media line, phone list and call pop-up (Twin Dial off) | B4.2 (mark 49); B4.6 (mark 53); B4.12 (mark 59); B5.3 (mark 61); B5.5 (mark 63) | what the RIC services draw |
| [ ] | F8 | F | Ukrainian message names: the longest the car shows | B3.3 (mark 41) | the card's three lines |
<!-- END:checklist -->
