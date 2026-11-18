# CQ: the session protocol for the owner and the lead's runbook

Package CQ of `docs/AGENT-BRIEF-car-signals.md`. Branch `car/cq` (from `main` at c1f53f2). Nothing pushed, no version bumped, nothing in `apps/` changed. No agent touched the car. Labels as in the brief; everything about the car below is a hypothesis until the session.

## 0. What is delivered

| File | What |
|---|---|
| `docs/car/SESSION.uk.md` | For the owner, in Ukrainian: what to bring, safety rules, how the marks and sets work, how to photograph (mid-tones, whites clip, fixed exposure for the pairs), then **10 blocks, 106 marked steps**, each with what to press, how long to wait, what to photograph and the mark number; what to do when something goes wrong; after the session. |
| `docs/car/RUNBOOK.md` | For the lead: what we can and cannot do with the trip button (§0), the builds and their status, the order of installs, the decisions to take before the session (§1.4), the collections, the clock anchor, the per-step verify table, set switching (wait for the last `watch` line), the owner's slips with the marks, stop conditions, after the session (parser with the marker map, patches, what each answer unblocks, memory), pass 2 (the experiments that need builds), and the **tick-box checklist of all 91 register items**. |
| `design/car/session_plan.json` | The single source: blocks, steps (Ukrainian text, items, expected probe lines, step class, cluster state), and the coverage of every register item that is not an owner step. |
| `design/car/session_marks.json`, `design/car/markers.json` | Generated: mark number -> step, items, expected lines, sets, class; `markers.json` is in the shape CL's `parse_logs.py --markers` reads (classes bc-short, stalk-left, thumb-up, cluster-view, mode-switch, call-phone, src-carplay, ...; the key-finding steps repeated under Twin Dial / f30 carry `-twin` / `-f30`). |
| `tools/car/make_session.py` | Renders the step tables of SESSION.uk.md, the verify table and the checklist of RUNBOOK.md and both marker files from the plan; numbers the marks; `--check` fails when a document is stale, a register item is not covered, an expected line is not in CP's field table, or a step expects a field of a set its block does not switch on. |
| `tools/car/verify_steps.py` | For the lead between blocks: per marked step, OK / MISSING / SILENT for every expected line between its mark and the next (S6 lines' `since=M<n>` wins over position); `--shift M:K` for a mark pressed too often or an app restart; `--silent` for pairs accepted as not sent. |
| `tools/car/dry_run.js` | The bench dry run (§4). |
| `tools/car/test_session.py` | 13 tests: the documents are current, the marks are 1..N, the stalk block comes first after the safety checks and covers stock / Twin Dial / f30, never more than two sets per block, and verify_steps on synthetic logs (OK, missing, silent, `since=` against position, a gap in the marks, two runs, the wrong sets at a mark, a double press with `--shift`, a restart with a negative shift, no marks at all). |
| `docs/car/dry-run/` | The dry run's probe log (bench, invented values, numbers and lengths only), verify output, the parser's output. |
| `bake/work/car/pub/CQ/` | `marks.json`, `session_marks.json`, `markers.json`, `NOTE-FOR-CL-CP.md` (findings for those packages), `READY`. |

Commands: `python3 -I tools/car/make_session.py [--check]`, `python3 -I tools/car/test_session.py`, `node tools/car/dry_run.js [--until B6]` (in a checkout where `apps/signal_probe` and CL's `tools/car/parse_logs.py` are merged).

## 1. The order, and the owner's priority first

The lead's note of 2026-11-18 (the owner's priority): **the trip / on-board-computer button at the end of the turn-signal stalk** comes first. Block 1 follows block 0's safety checks directly and starts with the stalk: a rest window, then three short presses with a mark before each, the long press only on a page whose reset is acceptable (optional; it may reset the trip), the stalk's other switches one by one (so a bit private to the trip button can be told from the indicator bits), the thumbwheel without and with a BMW list, every other wheel button, the controller, the button with a message showing, the cluster view; then the stalk and the thumbwheel **again with Twin Dial on and again with f30_cluster on** (6WB Comfort with G20, so BMW's own elements show through), with the owner noting whether BMW's own page changes underneath. RUNBOOK §0 says plainly: **we can only observe the press** (a notifier field); BMW's own reaction cannot be suppressed, so a found bit adds our tab step to BMW's page change, never replaces it.

Block 1 runs with the ignition on and the engine off, so the engine stays cold for block 2 (the coolant verdict needs the day's cold start). The rest is ordered by the brief's rule, fewest installs and least driving: stalk and buttons (ignition) -> cold start (S2+S3) -> doors and messages (S1+S3) -> media (S4) -> phone (S5+S4) -> our apps parked: photos, the black box, the mattes, the lamp check (S1) -> a short guided drive (S7+S6) -> a drive with cruise and signs (S8+S9) -> restore. The whole plan needs **one install: signal_probe**; everything else runs on f30 0.7.20 and Twin Dial 0.1.0 as installed.

Sets follow CP's app (S1-S9, the checkbox labels of `apps/signal_probe`), never more than two at once (S6 alone for the stalk, the least load: 8 interfaces, 24 fields). Marks follow CP's menu: one row "Позначка N" that counts up by itself, so the owner checks the number on the row against the table before each step (SESSION §4 says what to do when they differ).

## 2. Time budget per block

Estimates (minutes at the car; nothing here has been timed on this car). The lead's checks (a quick collection and `verify_steps.py` after each block) add about 3 minutes per block, included in the total.

| Block | What | Min | Engine | Sets | Passenger |
|---|---|---|---|---|---|
| 0 | logs at arrival, safety checks, settings noted, stock cluster, test mark | 20 | off / ignition | - | no |
| 1 | **the trip button and every other button**, then Twin Dial, then f30 | 40 | ignition only | S6 | no |
| 2 | odometer, trip page, voltage, Driver Profiles look, cold start, COLD gone, voltage | 28 | start | S2+S3 | no |
| 3 | rest, each door, boot, bonnet, two doors, the door again | 20 | on | S1+S3 | no |
| 4 | FM, DAB, USB, Bluetooth, source cycle, CarPlay | 25 | on | S4 | no |
| 5 | phone: connect, ring (stock photo), answer, ring with Twin Dial (photo), unsaved, outgoing, menu, tray, media with Twin Dial, CarPlay calls | 35 | on | S5+S4 | no |
| 6 | stock photos; Twin Dial: baseline, safety, lamps, dial ends, band day / night, gears, modes (60 fps), message; f30: baseline, gears and modes (setting on / off, G20), message, box re-map if a box, mattes, lamp check; restore | 70 | on (one stop / start) | S1 | no |
| 7 | short guided drive | 35 | drive | S7+S6 | **yes** |
| 8 | tyre and service pages; signs (stock); cruise, limiter, acceleration, heading; signs with Twin Dial; tyres warm | 45 | drive | S8+S9 | **yes** |
| 9 | end mark, restore, final collection | 15 | on | - | no |
| | **Total** | **333 (about 5.5 h)** | | | |

**Recommendation: two sittings.** A = blocks 0-5 (about 2 h 50 min) on a morning after the car has stood for hours (the cold start happens once a day); B = blocks 6-9 (about 2 h 45 min) with the passenger, the same day or another (block 0's collection and safety check open sitting B too). If time is short, the order of value is: block 1 (the owner's priority), blocks 2-3 (trip, odometer, messages: three specifications wait on them), block 5 (the call photo is a safety question: does Twin Dial hide BMW's ringing pad), block 6's safety and box steps, then the rest.

## 3. What cannot be done in one session, and why

| What | Why | Where it goes |
|---|---|---|
| X2-X8, X10, X12 (Twin `mbCover` / `mbRebuild`, f30 `mbGap` / release / `sceneTex`, the map window, the 0.1.1 card and shaders, `gearCover`) | each needs a build installed, which is a write the owner approves, one install per variant; Twin Dial 0.1.1 is not built yet (SPEC-R3 phase B) | RUNBOOK §4, pass 2: builds 1-3 recommended (4 if 3 is clean), 5-10 only as the decision tables ask |
| L23 (perf.json), X14 (slot-row logging build, reseat flag) | writes into an app's data folder or a new build | pass 2 with the owner's approval (CA D6) |
| X15 (cluster-render configuration, E6-E12) | writes to cluster-render's configuration or service restarts; BR rates some as able to park the panel or restart the KOMBI | not in this plan |
| X19, X20 (Driver Profiles writes), X21, X22 (diagnostic and coding reads), F16 (driver recognition) | other kinds of work (CA D9) | separate sittings |
| P18, P19 (the black-box and f30's unwired signals) | CA's register puts them in sets S10 and S11, which CP's app does not have (S1-S9) | the lead decides (RUNBOOK §1.4 Q2); the steps that would answer them are already in the plan (B6 gears and modes, B1 indicators, B6 belts and lamps) |
| P20, P21 (events, the high-beam camera service) | events are declared only when the lead names one | the lead (CA D2, D4) |
| L20's change step | changing the car's speed-limit warning setting is a driver-assistance setting | read only what the logs hold |
| F15 (smooth needles in motion) | needs a drive with f30_cluster drawing; both drives run the stock cluster or Twin Dial | an f30 segment in block 8 if the owner wants it |
| Parts of F10, F11 (a negative temperature, a three-digit limit, both signs at once) | depend on the road and the season | photographed when they occur |
| The cold start (P6) | once per day | if sitting A misses it: the next cold morning, block 2 alone |
| Android Auto | the probe reads CarPlay's player | if the owner uses Android Auto, CP swaps the instance (CA D5) |
| **Suppressing BMW's reaction to the trip button** | not possible from an app: we can only observe the press | stated in RUNBOOK §0 and SESSION §1 |

## 4. The dry run on the bench

`tools/car/dry_run.js` builds `signal_probe` with the kit, runs it in the kit's stub head unit (`bench/run-app.js`, no cluster-render, no network) and replays **every block of the plan** (the parked blocks 0-6 the brief asks for, and the drive blocks 7-8 as injected values): it switches the block's sets with the app's own checkboxes as the HMI presses them, presses the app's "Позначка" row before every marked step (106 presses), and feeds every expected (item, field) with a value **generated from the catalogue's own type** (structs by their members, enums by an item name, every text member a canary word of varying length, lists of two; the stalk byte with one invented bit per switch: the trip button 0x10, the indicators 0x01 / 0x02, flash 0x08). One field is never fed (P13 `sw-fav`: "the car does not send it"). Summaries were shortened to +3 / +8 / +20 s (`config.probe.summaryS`) so they appear within the run; gaps and caps are the app's own.

Run on 2026-11-18 against CP's app as it stood in its worktree that afternoon (`signal_probe` 0.1.0, fmt 1, not yet committed by CP) and CL's working copy of the parser: **30 passed, 1 failed**.

| Check | Result |
|---|---|
| the app starts, never exits, no ERROR, no uncaught exception | ok |
| every set switch gives its `sets on=` line, and every interface its `watch … ok` line (no `error`) | ok, all 9 sets |
| 106 marks pressed, M1..M106 in the log in order | ok |
| no canary word anywhere in the app's output (every text member was a canary) | ok |
| the S6 summary ("have spoken") and the never-fed pair named silent | ok |
| `verify_steps.py`, strict: only the never-fed pair missing | ok (1 step: the FAV press) |
| `verify_steps.py` with that pair accepted as silent: every required pair of every marked step found, marks contiguous, one run, the right sets on at each mark | **ok: 106 steps, 0 missing** |
| CL's `parse_logs.py` on the dry run's session folder with `markers.json` | **failed**: it stops in its own `safe_value` on values it writes itself (`'0/8'`, `'de.bmw.body.Light'`, `'doors.bonnet'`) |

So the log carries what the step attribution needs for every step and the marks line up; whether the parser turns it into decisions could not be shown on CL's work-in-progress copy. When `car/cl` is merged, the lead re-runs `node tools/car/dry_run.js` (part 5 then checks that P13's answer is `stalk-bit` with the invented bit 4).

Findings of the dry run (in `bake/work/car/pub/CQ/NOTE-FOR-CL-CP.md` for those packages):

1. **A value that arrives before its interface's `watch … ok` line is lost.** The probe subscribes one interface at a time with a pause between them (S5+S4 is about 20 interfaces). The first dry run lost the first trip-button press and a tyre reading that way. The harness now waits for the last watch line, and RUNBOOK §2.4 tells the lead not to let the owner start a block before it.
2. **CP: `P8 active-source` logs only the text's length and whether it matches a `sources` entry.** Two source ids of the same length with no entry matched print the same line, so a source change can be folded away (seen until the dry run's lengths differed). Worth a look before the media block.
3. **CL: the privacy check flags CP's own fixed words** (`freq=other`, `heading=set`, `matches-source-entry=unknown`, instance names such as `AndroidAutoProjectedManagerInst1`) as free text or tokens, and the parser stops on its own evidence values (above).
4. **CL's `steps.py` maps the plan's old step ids** (before block 1 grew); `design/car/markers.json` is generated from the plan and should replace that table.

What the dry run cannot prove: anything about the car (which fields arrive, their values, the timing of the KOMBI, the subscription cost of 24-50 fields at once, the getters' answers: the bench has no getter, so every `ask` line says no answer); the owner's real pace (the bench presses a step every ~0.1-1 s); the photos.

## 5. Contradictions met, and how the plan settles them

| | A | B | The plan |
|---|---|---|---|
| Sets | CA's register: S1-S12, P1-P21 | CP's app: S1-S9, P1-P17 | follows the app; P18-P21 to the lead (RUNBOOK §1.4 Q2, Q3) |
| `requestDefaultSymbols` | the brief: never on the car | f30 0.7.18-0.7.20 calls it once per run (CA C3) | f30 runs as installed, no restart; the lead decides before any reinstall (Q4) |
| Engine state for the doors (P7) | PROBE-PROTOCOL: ignition on, engine off | the cold start must come before any engine run, and the stalk block must come first | doors with the engine running (block 3); the engine-off voltage is read in block 2 before the start |
| The step classes | CL's `steps.py` (its own table on old ids) | the plan | `markers.json` generated from the plan |

## 6. What the lead must decide

1. One sitting or two (recommended: two; §2).
2. S10 / S11 in the probe, events, the high-beam service (CA D2-D4).
3. Which pass-2 builds to make, and when (CA D7; RUNBOOK §4).
4. `requestDefaultSymbols` in the installed f30 (CA D1).
5. CarPlay or Android Auto (CA D5).
6. Re-run the dry run after merging `car/cp` and `car/cl`; the parser part is not proven yet.
