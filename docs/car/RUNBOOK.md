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

If Twin Dial 0.1.1 is ready before the session, install it **before** the probe (so the probe's `probe: start` line follows the final apps) and treat its normal behaviour as a new baseline: SESSION's Twin Dial steps then show 0.1.1, not 0.1.0; X8 and X10 move from pass 2 into block 6 (a note in the log of what you installed).

### 1.2 Order of installs

1. Merge the four branches (`car/ca`, `car/cp`, `car/cl`, `car/cq`) into a working branch; run `node bench/test-signal-probe.js`, the f30 and twin suites, `python3 -I tools/car/make_session.py --check`.
2. Ask the owner to approve installing signal_probe; install it from the Store as in `docs/car/CP-REPORT.md` (the bench-built package; never a build made with the `BENCH_STUB` SDK).
3. Check the app's start line (`probe: start signal_probe v=… fmt=1 sets=none …`) in `/var/opt/public/oap/oap_<uid>/data/signal_probe.log` (loggingId OASP; the uid is assigned at install: `collect.sh` lists the versions and uids). `settings.json` beside it holds `set1`..`set9`.
4. Dry-run the owner's menu once with a mark ("Позначка", mark 1): the marker line must be in the log (SESSION B0.6).

### 1.3 Preconditions to confirm

- The car is online, ssh read-only works (`tools/car/collect.sh` prints what it will run before running it).
- The owner knows who the passenger is for blocks 7-8.
- You have the owner's current settings (they are written down and photographed in block 0, but read `settings.json` at collection #0 too).
- Rules that always hold: never `kill` an OAP app process; only `systemctl restart oapcontroller`, only you, only with the owner's word; never a setter, never a method call with a side effect, never `KombiIF.standardCCMessage` / `extendedCCMessage`, never `A19B`, never a write to a driver-assistance setting, never `requestDefaultSymbols`.
- Privacy: collected logs contain numbers, enum names and lengths only; photos and the owner's paper notes are personal. The privacy check (`tools/car/privacy_check.py` or CL's equivalent) runs on everything before anything derived is committed.

### 1.4 Decisions to take before the session

| # | Decision | Default in this plan | Source |
|---|---|---|---|
| Q1 | One sitting or two. The plan is about 5.5 h with the lead's checks (CQ-REPORT §2). | **Two sittings**: A = blocks 0-5 on a cold morning (about 3 h; the cold start of block 2 happens once a day); B = blocks 6-9 (about 2.75 h, with the passenger). Block 0's collection and safety check open each sitting. | CQ |
| Q2 | Sets S10 (black-box signals, P18) and S11 (f30's unwired signals, P19): in CA's register as a proposal (D3); CP's app now has them (S1-S11). | Used: block 6 runs S10+S11 (the gear and mode switches, belts, lamps, MSA; the messages of that block come from the apps' own logs), block 7 runs S7+S11 (consumption and the Eco Pro bonus while driving). | CA D3, CP |
| Q3 | Events (`_broadcasts`, P21) and the high-beam camera service (P20). | None declared. | CA D2, D4 |
| Q4 | f30_cluster 0.7.18-0.7.20 already calls `requestDefaultSymbols` once per run (an earlier approved log-only probe), which the brief forbids. The session runs f30 in B0, B1 and B6 but restarts no app, so the call is not repeated during the session unless the car restarts the app. | Run f30 as installed; decide before any f30 reinstall (`config.legacyProbes`). | CA C3, D1 |
| Q5 | CarPlay or Android Auto (the probe reads `MediaPlayer` on `CarPlayMedia`). | CarPlay (SESSION B4, B5). | CA D5 |
| Q6 | Which builds exist before the session (Twin Dial 0.1.1, f30 with keys). | None: pass 2. | CA D7 |
| Q7 | Changing the car's speed-limit warning setting for L20. | Not done (a driver-assistance setting); L20 is read from whatever the logs hold. | CQ |
| Q8 | The long press of the trip button (B1). | The owner's call on the day; optional in the table. | the owner |

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

Every log line starts with the kit's ISO time stamp (UTC: the head unit runs on UTC), and the probe's lines carry `t=` (seconds since the probe started) and, for S6, `tms=` and `since=M<n>+<ms>`. The owner's paper and the passenger's voice notes use the car's displayed clock (local time). At B0.6 (mark 1) note the car's displayed clock against the line's time stamp once: that offset turns every voice note of blocks 7-8 (marks only at stops) into a log time.

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
| 11 | B1.11 | stock | P13: sw-wheel-steps |
| 12 | B1.12 | stock | P13: sw-wheel-steps |
| 13 | B1.13 | stock | P13: sw-wheel-steps |
| 14 | B1.14 | stock | P13: sw-wheel-steps |
| 15 | B1.15 | stock | P13: sw-fav |
| 16 | B1.16 (optional) | stock | P13: sw-special1 |
| 17 | B1.17 (optional) | stock | P13: sw-special2 |
| 18 | B1.18 | stock | P13: sw-skip |
| 19 | B1.19 | stock | P13: sw-voice |
| 20 | B1.20 | stock | P13: sw-phone |
| 21 | B1.21 | stock | P13: sw-volume |
| 22 | B1.22 | stock | P13: controller |
| 23 | B1.23 | stock | P13: stalk |
| 24 | B1.24 | stock | P11: kombi-config |
| 25 | B1.25 | twin | P13: stalk |
| 26 | B1.26 | twin | P13: stalk |
| 27 | B1.27 | twin | P13: stalk |
| 28 | B1.28 | twin | P13: stalk |
| 29 | B1.29 | twin | P13: sw-wheel-steps |
| 30 | B1.30 | f30 | P13: stalk |
| 31 | B1.31 | f30 | P13: stalk |
| 32 | B1.32 | f30 | P13: stalk |
| 33 | B1.33 | f30 | P13: stalk |
| 34 | B1.34 | f30 | P13: sw-wheel-steps |

**Block 2: Холодний запуск двигуна** (sets S2, S3)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 35 | B2.2 | stock | P3: range-tank, P5: units |
| 36 | B2.3 | stock | P4: bc-average, P4: bc-travel |
| 37 | B2.4 | stock | P10: voltage-basic |
| 39 | B2.6 | stock | P6: coolant, P10: voltage-basic |
| 40 | B2.7 | stock | P6: engine-verdict |
| 41 | B2.8 | stock | P10: voltage-basic |
| 42 | B2.9 (optional) | stock | P5: units |
| 43 | B2.10 (optional) | stock | P4: bc-travel |

**Block 3: Двері, повідомлення, напруга** (sets S1, S3)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 44 | B3.2 | stock | P1: active-cc, P10: voltage-basic |
| 45 | B3.3 | stock | P7: doors, P1: active-cc, P1: ccList |
| 46 | B3.4 | stock | P7: doors |
| 47 | B3.5 | stock | P7: doors |
| 48 | B3.6 | stock | P7: doors |
| 49 | B3.7 | stock | P7: doors |
| 50 | B3.8 | stock | P7: lids |
| 51 | B3.9 | stock | P1: menu-cc, P1: active-cc |
| 52 | B3.10 | stock | P1: active-cc |

**Block 4: Радіо та медіа** (sets S4)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 53 | B4.2 | stock | P8: station, P8: active-source |
| 54 | B4.3 | stock | P8: station |
| 55 | B4.4 | stock | P8: media-menu |
| 56 | B4.5 (optional) | stock | P8: station |
| 57 | B4.6 | stock | P8: player-metadata, P8: active-source |
| 58 | B4.7 | stock | P8: track-progress |
| 59 | B4.8 | stock | P8: player-metadata |
| 60 | B4.9 | stock | P8: player-metadata |
| 61 | B4.10 | stock | P8: track-progress |
| 62 | B4.11 | stock | P8: active-source |
| 63 | B4.12 | stock | P8: player-metadata, P8: cp-player-state |

**Block 5: Телефон і дзвінки** (sets S5, S4)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 64 | B5.2 | stock | P9: phone-devices |
| 65 | B5.3 | stock | P9: call-state |
| 66 | B5.4 | stock | P9: call-state, P9: phone-call1-state |
| 67 | B5.5 | twin | P9: call-state |
| 68 | B5.6 | twin | P9: call-state, P9: phone-calllist |
| 69 | B5.7 | twin | P9: call-state |
| 70 | B5.8 | twin | P9: hmi-app |
| 71 | B5.9 (optional) | twin | P9: wca-front |
| 72 | B5.10 | twin | P8: player-metadata |
| 73 | B5.11 | twin | P9: phone-devices |
| 74 | B5.12 | twin | P9: call-state, P9: carplay-call |
| 75 | B5.13 | twin | P9: call-state |

**Block 6: Панель із застосунками BMW-стилю, стоїмо** (sets S10, S11)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 78 | B6.4 | twin | P19: belts |
| 79 | B6.5 | twin | P19: lights, P19: indicate |
| 83 | B6.9 | twin | P18: gearbox-display |
| 84 | B6.10 | twin | P18: fes-switch |
| 87 | B6.13 | f30 | P18: fes-switch |
| 88 | B6.14 | f30 | P18: fes-switch |
| 89 | B6.15 | f30 | P18: fes-switch |
| 92 | B6.18 | f30 | P19: belts |

**Block 7: Коротка поїздка з навігацією** (sets S7, S11)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 95 | B7.2 | stock | P14: map-without-route |
| 96 | B7.3 | stock | P12: guiding-state |
| 97 | B7.4 | stock | P12: next-intersection, P12: dart, P19: cons-regular |
| 98 | B7.5 | stock | P12: dart |
| 99 | B7.6 | stock | P14: map-without-route |

**Block 8: Поїздка з круїз-контролем і дорожніми знаками** (sets S8, S9)

| Mark | Step | Cluster | The probe must log (item: field tag) |
|---|---|---|---|
| 100 | B8.2 | stock | P16: tyre-pressure |
| 101 | B8.3 | stock | P17: cbs-list |
| 102 | B8.4 | stock | P15: sign |
| 103 | B8.5 | stock | P15: longitudinal, P16: sport-display, P17: heading |
| 105 | B8.7 | stock | P16: tyre-pressure |
<!-- END:verify -->

### 2.4 Set switching

Sets are one checkbox each (`set1`..`set11`) on the probe's own centre screen, switched by the owner. After each switch the log must carry `probe: sets on=… changed=…` (CP); 30 s later the `summary S<n> +30s` lines (which fields spoke, which are silent, which providers are down) and at +120 s one `ask` per silent field (a read-only getter); do not let the owner start a block before you have seen it **and** the last `probe: watch <Interface>[<instance>] set=S<n> … ok` line of the new sets (the probe subscribes one interface at a time with a pause between them; S5+S4 is about 20 interfaces, S6 eight). A value the car sends before its interface's watch line is lost; on the bench dry run exactly that cost a step (`docs/car/CQ-REPORT.md` §4). A `watch … error: …` line means that interface's items are silent this session: note it, go on. Per block: B1 S6; B2 S2+S3; B3 S1+S3; B4 S4; B5 S5+S4; B6 S10+S11; B7 S7+S11; B8 S8+S9. Never more than two sets at once (the load of 135 fields on about 45 interfaces is untested on this car). If the car stutters (cluster freezes, the platform restarts an app): stop, switch every set off, read the platform's lines, tell the owner.

### 2.5 The owner's slips with the marks

The mark row counts up by itself ("Позначка N" shows the next number). The owner compares it with the table before each step:
- a mark forgotten earlier: the owner presses until the numbers match (the empty marks are harmless: their windows hold nothing);
- one press too many: the counter runs ahead. The owner writes it down and tells you; read the log with `verify_steps.py --shift M:K` (K extra presses from mark M on) and hand the parser a marker map shifted the same way (regenerate `design/car/markers.json` locally is NOT the fix: edit a copy, never the plan);
- the app restarted (a second `probe: start` line): marks start again at M1 and the sets come back from `settings.json`. The owner goes on with the plan's next step regardless of the number on the row; you note the offset (plan number minus the row's number, say 49) and read the last run with `verify_steps.py --shift 1:-49` (it checks the last run of the log; the earlier run is read on its own the same way).

### 2.6 Stop conditions

- BMW's belt lamp or door message is not shown in block 0 or at B6.3: the session ends, nothing from our apps is allowed to drive.
- The cluster resets (the KOMBI resets on too-big effect shaders; one look per layer source): note the step and the app, switch both apps Off.
- An OAP app exits twice: the platform uninstalls it (CP's no-uncaught-exception rule). If the probe disappears, reinstall is an owner decision.

## 3. After the session

1. Copy the final collection into `reference/car/<date>/`; run the privacy check; run the parser with the session's marker map: `python3 -I tools/car/parse_logs.py <folder> --markers design/car/markers.json` fills `design/car/answers.json` (the marker map is generated from the plan; without it the step-based tables, the tab key first, cannot attribute a bit to a press); run `make_patches.py` for the reviewable diffs of `app.json` (never applied automatically).
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
| X13 / L27 (only if a box shows) | whether a re-map clears the box; the slot rows at that moment | research3 MB, boxes BR (E0-E2) |
| X16 / F4 (mattes, the lamp check) | what BMW draws over an opaque panel; which side lamps are over us | `design/overlay` relations (OVERLAY-PHOTO-PROTOCOL), SPEC rev 2 §15 |
| X17 | whether the HMI honours Visible on list rows | f30's menu (`hideModeRows`, `hideRowUnlessG20`) |
| X18 | Driver Profiles' read-only screen is right | DRIVER-PROFILES-APP §6 |
| L17-L29 | f30's MSA, vehicle condition, drive modes, road label, boost over UDS, KOMBI resets, ccList pairs, message timing, slot rows, status socket, dropped uploads | per CA's register `blocks` |
| F1-F17 | see the checklist | per item |

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
| 9 | f30 with `gearCover` (D10) | X12 (our letter over BMW's place, the gap closed) | the box | only with the black-box experiments |
| 10 | f30 / Twin slot-row logging build; `car3k.json` reseat flag | X14 (BR E3-E5) | the box; the slot rows | the owner approves a data-file write |
| - | `perf.json {"log": true}` in an app's data folder | L23 (notification rates, flush times, CPU) | the `perf:` lines after a drive | the owner approves the write |

Not in any pass of this plan (each a different kind of work): X15 (cluster-render configuration writes and restarts, BR E6-E12), X19-X20 (Driver Profiles writes), X21-X22 (diagnostic and coding reads), F16 (the owner's own HMI steps for driver recognition).

State the number of installs to the owner before asking: the recommended pass 2 is builds 1-3 (and 4 if 3 is clean); 5-8 only as the decision table drives it.

## 5. The checklist of every register item

Tick when the answer has been read and recorded (answers.json carries the evidence; the tick is yours). Items not answerable in the session say why in the "Answered by" column: `pass 2` = needs a build; a "not in this session" reason = cannot be done.

<!-- BEGIN:checklist -->
| Done | Id | Kind | Question | Answered by | Decides |
|---|---|---|---|---|---|
| [ ] | L1 | L | Why f30's window over BMW's panel stays open | collection #0; collection #2; B6.11 (mark 85); B6.12 (mark 86); B6.16 (mark 90) | which config.ccActive.release set (deferValues / leftList / witness) and ccm.clearIds to ship; whether the owner's hang was in an opaque theme or a G20 file with BMW's row (H5) |
| [ ] | L2 | L | Does statusActiveCCMessage notify, and what does it rest on | collection #0 | Twin Dial D7 (lift strict); noneValues; MC H1; SPEC-R3 §5.4 'shown now' |
| [ ] | L3 | L | The clock's fallback: statusShowTimeDate | collection #0; collection #1 | whether config.clockLocal stays the clock's source (the owner retired the manual timeZone setting) |
| [ ] | L4 | L | Twin Dial's trip fields | collection #0; collection #2 | MK §7 step 1: install MK build 1 or the probe build; trip.factors (bc, speed 0.1, cons 0.1, way 0.1), departureUtc, the ResetLogic3 fallback |
| [ ] | L5 | L | The odometer member | collection #0; B6.3 (mark 77) | config.odometer.factors.rangeTank (1), the verified flag; whether SecureMileage / MileageSupreme / VehicleInformation.Range carriers are needed |
| [ ] | L6 | L | Phone state | collection #3 | r3/SP A1 (tab icon lit in a call + call card) |
| [ ] | L7 | L | Media | collection #3; B5.10 (mark 72) | r3/SM: tab 3 text and M1/M2 |
| [ ] | L8 | L | The second witness | collection #2 | MC H4 and F3 (witness release); D7 |
| [ ] | L9 | L | Layout builds at start | collection #1 | whether the start-up fix (hold the first build until zone and ccList have answered, MP §7.4) is worth it |
| [ ] | L10 | L | Upload accounting | collection #0; collection #2 | MP's 1.0-2.8 s incomplete screen back to Comfort; MT residency |
| [ ] | L11 | L | The map slot under our panel | collection #2 | H-M weakened or not; the presence rule S1 of the map window (SN §2.3) |
| [ ] | L12 | L | cluster-render's version | answered before the session (CA register); confirm at collection #0 | the ETC2 prototype (X5) |
| [ ] | L13 | L | The 0.7.18 probes' results | collection #0 | config.ccMarker (BMW's stored-message marker 'i' / triangle); risk class as a sort key; the id-to-symbol table of design/twin-dial/vt/message_symbols.json |
| [ ] | L14 | L | The speed-limit sign in f30 | collection #0; collection #3 | config.sign values (end, unknown, noUnit, invalidPath); SPEC-R3 §8 (the sign restored in Twin Dial) |
| [ ] | L15 | L | Day/night | collection #0; collection #1 | config.dayNight.map['0'] ('keep'); the night multipliers' trigger |
| [ ] | L16 | L | The clock's PRIMARY source: timeDateUTC offsets | answered before the session (CA register) | the clock source order |
| [ ] | L17 | L | Auto start/stop (statusConditionMSA) and READY/OFF | collection #3; only if f30_cluster's handlers log with Theme Off (check at collection #0); else a drive with f30 drawing; B8.5 (mark 103) | whether the READY rest and the green (A) icon work (FEATURE-AUDIT gap 1: 'car-unverified'); msa.map |
| [ ] | L18 | L | Vehicle condition values (standby row, P with engine off) | collection #1; collection #3 | the COND_STANDBY constant of the bottom row; the standby look |
| [ ] | L19 | L | Drive mode changes | collection #2; B6.9 (mark 83); B6.10 (mark 84); B6.13 (mark 87); B6.14 (mark 88); B6.15 (mark 89) | byMode theme switching; the config.drive escape hatch; the MB X1 baseline |
| [ ] | L20 | L | The driver's speed-limit settings (notifier-only) | collection #0; not the change step: changing the car's limit-warning setting is a driver-assistance setting (the lead decides) | config.sla (the red arc follows the car's excess-speed display) |
| [ ] | L21 | L | Road label, navigation state, position | collection #3; B7.4 (mark 97) | calibration of config.road / config.nav (config._bottomRow.calibrate) |
| [ ] | L22 | L | Boost and intake air over UDS 0x22 (DME) | collection #2; only if f30 showed a boost readout | config.dme candidates |
| [ ] | L23 | L | Notification rates and CPU (opt-in perf log) | pass 2 (a build); needs the owner's approval: perf.json is a write in the app's data folder (CA D6) | the CPU factor (bench x 5-12); the needle-smoothness cause |
| [ ] | L24 | L | KOMBI resets and the guard since 0.7.16 | collection #0; collection #3 | whether the shader-size fix of 0.7.13 holds with the night looks back (uniforms 29 of 32, WBDIAL STYLE 0 13 232 chars) |
| [ ] | L25 | L | ccList pairs (id, symbol id, colour) for Twin Dial's symbol table | collection #0; collection #3 | Twin Dial's pictogram per message |
| [ ] | L26 | L | Message auto-hide and re-show timing | collection #2 | config.ccm autoHideMs / reshowMs; the fallback heuristic (20 s) |
| [ ] | L27 | L | Black-box slot rows at the moment the box shows (BR E0) | collection #2; B6.9 (mark 83); B6.10 (mark 84); B6.13 (mark 87); B6.14 (mark 88); B6.15 (mark 89); B6.17 (mark 91) | H1 (speech-dialog id) against 'the box is not the id'; links BR's slot work to the box |
| [ ] | L28 | L | Does the cluster-render status socket return status.txt's text? | collection #2 | mapWindow presence rule S1 against S2+S3 |
| [ ] | L29 | L | Does cluster-render upload a layer that was dropped before its upload finished? | collection #1 | MP §8 item 5 |
| [ ] | L30 | L | Is newCCMessage ever sent? | answered before the session (CA register) | config.ccm as a source |
| [ ] | L31 | L | Why did the Store update to 0.7.16 fail? | answered before the session (CA register) | the 'r' flag rule |
| [ ] | P1 | P | Which message the cluster shows now | B1.23 (mark 23); B3.2 (mark 44); B3.3 (mark 45); B3.9 (mark 51); B3.10 (mark 52); B6.11 (mark 85); B6.16 (mark 90) | 'shown now' = the list id; the rest value; the frame counter; D7 lift (config.ccActive.strict false = the owner's decision); f30 release |
| [ ] | P2 | P | The stored-message marker, risk class | B3.9 (mark 51) | config.ccMarker (iface CheckControlMaster, field basicList, the state value that means stored); optional severity from the risk class |
| [ ] | P3 | P | Odometer carriers | B2.2 (mark 35) | config.odometer.factors / order; whether the three extra carriers are needed |
| [ ] | P4 | P | The trip computer | B2.3 (mark 36); B2.10 (mark 43) | config.trip.factors (bc, speed, cons, way, rl3), departureUtc, order, verified |
| [ ] | P5 | P | Units | B2.2 (mark 35); B2.9 (mark 42) | the mph / mile variant is or is not needed; temperature and pressure units |
| [ ] | P6 | P | Coolant verdict | B2.6 (mark 39); B2.7 (mark 40) | config.coolant.coldC / hotC (bar empty point, red segment) |
| [ ] | P7 | P | Doors, boot, bonnet, central locking | B3.2 (mark 44); B3.3 (mark 45); B3.4 (mark 46); B3.5 (mark 47); B3.6 (mark 48); B3.7 (mark 49); B3.8 (mark 50) | the table door -> field -> open-value; whether the car picture (SV V2) is possible |
| [ ] | P8 | P | Media and radio | B4.2 (mark 53); B4.3 (mark 54); B4.4 (mark 55); B4.5 (mark 56); B4.6 (mark 57); B4.7 (mark 58); B4.8 (mark 59); B4.9 (mark 60); B4.10 (mark 61); B4.11 (mark 62); B4.12 (mark 63); B5.10 (mark 72) | config.media.titleLine / sourceTypes; M1 / M2 / M3; tab 3 text; the progress unit (10000 -> ms) |
| [ ] | P9 | P | Phone | B5.2 (mark 64); B5.3 (mark 65); B5.4 (mark 66); B5.5 (mark 67); B5.6 (mark 68); B5.7 (mark 69); B5.8 (mark 70); B5.9 (mark 71); B5.11 (mark 73); B5.12 (mark 74); B5.13 (mark 75) | A1 (tab icon lit + call card with our own timer); the name setting; signal bars; whether Twin Dial hides BMW's call pop-up (raises the card's priority); a missed-call count |
| [ ] | P10 | P | Battery voltage | B2.4 (mark 37); B2.6 (mark 39); B2.8 (mark 41); B3.2 (mark 44) | config.battery = {field, factor}; whether a battery readout exists |
| [ ] | P11 | P | The cluster's view and the map-view setting | B1.24 (mark 24) | the cluster's map-view setting (S2 of the map window's presence rule); an indirect tab key; which of HMIContext / HMIContext2 this car serves |
| [ ] | P12 | P | Guidance manoeuvres | B7.3 (mark 96); B7.4 (mark 97); B7.5 (mark 98) | the arrow and distance of the guidance page; lane row; rawDistance metres; phone guidance |
| [ ] | P13 | P | The tab key: stalk, wheel and controller buttons | B1.2 (mark 2); B1.3 (mark 3); B1.4 (mark 4); B1.5 (mark 5); B1.6 (mark 6); B1.7 (mark 7); B1.8 (mark 8); B1.9 (mark 9); B1.10 (mark 10); B1.11 (mark 11); B1.12 (mark 12); B1.13 (mark 13); B1.14 (mark 14); B1.15 (mark 15); B1.16 (mark 16); B1.17 (mark 17); B1.18 (mark 18); B1.19 (mark 19); B1.20 (mark 20); B1.21 (mark 21); B1.22 (mark 22); B1.23 (mark 23); B1.25 (mark 25); B1.26 (mark 26); B1.27 (mark 27); B1.28 (mark 28); B1.29 (mark 29); B1.30 (mark 30); B1.31 (mark 31); B1.32 (mark 32); B1.33 (mark 33); B1.34 (mark 34) | config.tabKey (SB §3.3 decision table: which bit moved on which step); the scroll key; or the setting-only fallback |
| [ ] | P14 | P | When does BMW's map exist in the cluster? | B1.24 (mark 24); B7.2 (mark 95); B7.3 (mark 96); B7.6 (mark 99) | the map window's presence rule S3 |
| [ ] | P15 | P | The sign, cruise control and the speed limiter | B8.4 (mark 102); B8.5 (mark 103) | the sign's values; the set speed and function (cruise symbol, green marker); whether any carrier exists |
| [ ] | P16 | P | Technical rows: boost, engine dynamics, oil, tyres | B8.2 (mark 100); B8.5 (mark 103); B8.7 (mark 105) | the technical page's rows and scales (SPEC-R3 §4.1); the tyre page; whether the TPMS poll is needed only while the page shows |
| [ ] | P17 | P | Other signals: consumption, heading, position extras, service due | B8.3 (mark 101); B8.5 (mark 103) | V4 consumption, V6 heading, V8 service due |
| [ ] | P18 | P | Black-box signals (the KOMBI's display state) | B6.9 (mark 83); B6.10 (mark 84); B6.13 (mark 87); B6.14 (mark 88); B6.15 (mark 89) | H-G (gear indicator fallback), H-M (BMW's map), H1 (speech layout), 'a HmiMain3D cluster screen' as the trigger; which of HMIContext / HMIContext2 is served |
| [ ] | P19 | P | f30's unwired signals (indicators, belts, lights, consumption, Eco Pro, oil, dimmer) | B6.4 (mark 78); B6.5 (mark 79); B6.18 (mark 92); B7.4 (mark 97) | the READY/belt/indicator redraws that the overlay catalogue calls unresolved; config.cons; the Eco Pro dial fills |
| [ ] | P20 | P | Does the automatic-high-beam camera function have a live provider? | lead decision (CA D4): a read-only subscribe attempt; no field to read | whether the high-beam assistant research can proceed (the rest is coding + an FSC licence, not signals) |
| [ ] | P21 | P | Events (_broadcasts) that would answer questions | lead decision (CA D2): named _broadcasts only; none declared | each: mute mark (SM §7.3), the tab key's second route (SB §6d), the map / roadbook switch (SN), call-start witnesses (SP §10) |
| [ ] | X1 | X | f30 with 'Change with the drive mode' off | B6.9 (mark 83); B6.10 (mark 84); B6.12 (mark 86); B6.13 (mark 87); B6.14 (mark 88); B6.15 (mark 89) | whether (b) 'the rebuild' is needed for the box (MB §4.2); MB step 2 (does a theme change clear it, does P -> D -> P) |
| [ ] | X2 | X | Twin Dial with a clear layer over the gear letter | pass 2 (a build) | a1 (rectangle: only geometry helps) against a2 (pixels: black under the letter suffices, one rectangle would do) |
| [ ] | X3 | X | f30 with the gap cut out of its layer rectangles | pass 2 (a build) | 'cause found: our cover of the letter' (MB §4.2) and the look of the 80 x 60 window |
| [ ] | X4 | X | Forced rebuilds | pass 2 (a build) | theory (b) 'our scene changing' and a fix in the rebuild |
| [ ] | X5 | X | f30 scene textures: r8 and etc2 | pass 2 (a build) | the faces' format; whether unsampled assets ride along on each 'goes whole' (residency) |
| [ ] | X6 | X | The map window (BMW's map through our centre) | pass 2 (a build) | W1 against W2; the presence rule (S1 slot rows / S2 view setting / S3 map-without-route / guiding); the fallback page's content |
| [ ] | X7 | X | f30's message release | pass 2 (a build) | the window closes and never covers a listed message |
| [ ] | X8 | X | Message timing in Twin Dial's card | pass 2 (a build); B6.11 (mark 85) | CC_SETTLE_MS; the connection plan of SPEC-R3 §5.5 |
| [ ] | X9 | X | The band's level and the night palette | B6.7 (mark 81); B6.8 (mark 82) | config bandGain; SPEC rev 2 §7.2 / SPEC-R3 §6 night values |
| [ ] | X10 | X | The KOMBI accepts the round-3 shaders | pass 2 (a build); B8.6 (mark 104) | the shader budget (tdial <= 8 KB, tdback <= 6 KB; the KOMBI reset seen above ~26.7 k chars) |
| [ ] | X11 | X | Switch-time film | B6.10 (mark 84) | MP's predictions; whether the no-rebuild redesign (MP §7.1-7.2) is worth it |
| [ ] | X12 | X | Deferred experiment D10: covering BMW's gear letter (gearCover) | pass 2 (a build) | D10 |
| [ ] | X13 | X | Black box: re-mapping by hand and Waze's HUD map (BR E1, E2) | B6.17 (mark 91) | cheap remedies; the E5 'reseat on gear' idea |
| [ ] | X14 | X | Black box: slot-row logging build and reseat flag (BR E3-E5) | pass 2 (a build); needs the owner's approval: a build and a data-file write (CA D6) | the box's trigger; remedy E5 |
| [ ] | X15 | X | Black box: cluster-render configuration experiments (BR E6-E12) | not in this session: writes to cluster-render's configuration or a service restart (BR E6-E12) | only after X1-X4, X13, X14 and L27 point somewhere |
| [ ] | X16 | X | The diagnostic matte themes (what BMW draws over a theme) | B6.18 (mark 92); B6.19 (mark 93) | the 9 'unknown' elements of design/overlay/g20_comfort.json: tt.brake, tt.tpms, tt.abs, tt.dsc, tt.steering, tt.auto_h, bottom.belt_rear, bottom.airbag, assist.off |
| [ ] | X17 | X | The Visible property on the centre screen's rows | B6.14 (mark 88); B6.15 (mark 89) | config.menu.hideModeRows / hideRowUnlessG20 stay or go |
| [ ] | X18 | X | Driver Profiles: the read-only checks | B2.5 (mark 38) | Driver Profiles 0.2.2 is verified |
| [ ] | X19 | X | Driver Profiles: the write tests | not in this session: Driver Profiles write tests (CA D9), a separate sitting with the owner's approval | whether the app can manage profiles |
| [ ] | X20 | X | Driver Profiles: the avatar's three unknowns | not in this session: Driver Profiles avatar (CA D9), a write | config.avatarMaxKB; whether the avatar feature is useful |
| [ ] | X21 | X | High-beam assistant: diagnostic reads | not in this session: a diagnostic FA / FSC read, not an OAP read (CA) | whether the automatic high beam is a coding + FSC job |
| [ ] | X22 | X | Cluster coding read: GLOBAL_LAYOUT_VARIANTE | not in this session: an E-Sys / BimmerCode coding read (CA) | whether coding can remove the box |
| [ ] | F1 | F | Is BMW's own speed-limit sign visible anywhere with Twin Dial up? | B8.6 (mark 104) | urgency of SPEC-R3 §8 (the driver has no limit on the cluster with Twin Dial up) |
| [ ] | F2 | F | Side lamps and the belt lamp with Twin Dial up (the safety check before driving) | B0.3; B6.3 (mark 77); B6.4 (mark 78); B6.5 (mark 79) | Twin Dial may be driven with |
| [ ] | F3 | F | A close photo of a dial's lower ends | B6.6 (mark 80) | the inner ring's end angle (SPEC-R3 §2.1) |
| [ ] | F4 | F | Which side lamps BMW draws over us ('photo 16') | B6.5 (mark 79); B6.18 (mark 92); B6.19 (mark 93) | holes vs redraws for the critical lamps; plan.safe.json |
| [ ] | F5 | F | Does the HUD show the cruise set speed? | B8.4 (mark 102); B8.5 (mark 103) | how urgent SPEC-R3 §9 is |
| [ ] | F6 | F | The stock cluster's cruise and limiter display (Twin Dial off) | B8.4 (mark 102); B8.5 (mark 103) | our symbols and states (SPEC-R3 §9) |
| [ ] | F7 | F | The stock cluster's media line, phone list and call pop-up (Twin Dial off) | B4.2 (mark 53); B4.6 (mark 57); B4.12 (mark 63); B5.3 (mark 65); B5.5 (mark 67) | the shapes of tab 3 / tab 4 pages |
| [ ] | F8 | F | Ukrainian message names: the longest the car shows | B3.3 (mark 45) | the card's 3-line headline fit |
| [ ] | F9 | F | Baseline photos of what is installed now | B6.3 (mark 77); B6.12 (mark 86) | the reference that every later experiment is compared with |
| [ ] | F10 | F | Stock G20 photo gaps (the G20 simulation's open points) | B6.2 (mark 76); B7.4 (mark 97); B8.4 (mark 102) | weak / none entries of the G20 simulation and the strip measurements |
| [ ] | F11 | F | Bottom-row guesses (BOTTOM-ROW-PACKAGE §12) | B8.4 (mark 102) | road_signs() placement, _fitText, WBSIGN states |
| [ ] | F12 | F | Bake open questions that a car photo settles (BAKE-REPORT §5 [C]) | B6.2 (mark 76) | 6WB bake parameters |
| [ ] | F13 | F | Pre-0.7.12 owner checks never reported back | B6.12 (mark 86) | close or re-open each |
| [ ] | F14 | F | Which facelift layout is the car's own (Twin Dial geometry) | B6.2 (mark 76) | Twin Dial's dial geometry certainty below 0.01 R |
| [ ] | F15 | F | Smooth needles on the car | not in this session: needs a drive with f30_cluster drawing (both drives run the stock cluster or Twin Dial); add an f30 segment to block 8 if the owner wants | PERF-NEEDLE verified on the car |
| [ ] | F16 | F | Digital Key: driver recognition for a local profile | not in this session: the owner's own HMI steps for driver recognition (CA D9) | key -> profile linking |
| [ ] | F17 | F | Black box in Sport and Eco Pro; the stalk and headlights (photos) | B6.2 (mark 76); B6.9 (mark 83); B6.10 (mark 84); B6.13 (mark 87); B6.14 (mark 88); B6.15 (mark 89) | the box rectangle (C1); HIGH-BEAM questions 5-6 |
<!-- END:checklist -->
