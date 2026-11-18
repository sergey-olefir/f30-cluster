# CL: the tools, from logs to decisions (car-signals preparation)

Package CL of `docs/AGENT-BRIEF-car-signals.md`. Branch `car/cl`, from `main` (c1f53f2). No car was touched, no push, no version bump, nothing changed in
`apps/f30_cluster` or `apps/twin_dial`. Everything below was run on the Mac: the collector against a fake `ssh`, the parser on synthetic logs, on the
2026-11-15 material in `reference/car/2026-11-15/` (git-ignored) and on a log of CP's real probe app that CQ's bench dry run wrote.

Labels: **verified** (run here), **hypothesis** (needs the car), **not done**.

## 0. In short

1. **Four tools in `tools/car/`** (README there): `collect.sh` (read-only, prints every command first, refuses anything that is not a plain read), `parse_logs.py`
   (every decision table of the reports as code, fills `design/car/answers.json` for the 91 items of CA's register), `make_patches.py` (the exact `app.json`
   changes as diffs with the evidence beside each, never applied), `privacy_check.py` (scan and redact; also guards every derived file).
2. **47 tests, all passing** (`tools/car/test_car_tools.py`): every table on synthetic logs, including the MC trap and its mirror, canaries in every text member,
   the collector against a fake car, the patches on copies of both `app.json` files, and the real 2026-11-15 material.
3. **Run today on the 2026-11-15 material** (`design/car/answers.json`, every answer carries its date): 6 answered, 7 partial, 17 not yet, 25 no material,
   36 manual (photos). The old material answers L9 (partly), L10, L11, L12, L19, L24 and, from car_vitals' log, the tyre / boost / unit facts of P5, P6, P16
   (section 3). **It cannot answer L1 or L2**: the saved f30 logs are builds 0.7.10 to 0.7.12, which do not write the check-control lines.
4. The parser was also run on **a real log of the probe app** (CQ's bench dry run, `fmt=1`, invented values): 19 items answered, the stalk table found
   the planted bit from CQ's real marks, nothing crashed. It has not seen a real car log of Twin Dial, of the probe, or of f30 0.7.19+ because none exists
   (brief section 2).

## 1. What was built

| File | Role |
|---|---|
| `tools/car/collect.sh`, `collect_meta.py` | the collector; `session.json` (apps, versions, uids, the car's clock, file sizes) |
| `tools/car/car_logs.py`, `context.py`, `steps.py` | reading of the three log shapes (OAP app log, cluster-render's log, the journal copy), the probe's lines `fmt=1` (field lines, `mark M<n>`, `summary S<k> +<s>s`, `ask`), marks -> step -> class |
| `tools/car/tables_*.py`, `parse_logs.py` | the decision tables, the register, `answers.json` |
| `tools/car/make_patches.py` | diffs from answers (a byte-exact JSON text editor, no reformatting of `app.json`) |
| `tools/car/privacy_check.py`, `tables_base.py` | the privacy check; the evidence guard |
| `tools/car/test_car_tools.py`, `synth.py`, `fixtures/probe_bodies.json` | tests; synthetic logs; 129 probe-line bodies taken from the five branches' own `test-twin-probe.js` (the real formatters' output) |
| `design/car/answers.json` | the answers from the old material, dated, numbers only |

### The collector
* Reads only: `cat`, `ls`, `stat`, `tail -c N`, `date -u`, `uname -a`, `journalctl -u cluster-render --no-pager -o short-iso-precise --since "..."`, on paths under
  `/var` and `/run`. The one function that talks to the car (`rd`) refuses any other command and any shell metacharacter; the test fails if a command that
  is not on that list, or one containing `rm`, `kill`, `systemctl`, `mv`, `tee`, `>`, `|`, `;`, `touch`, `chmod`, `restart`, reaches the fake `ssh`.
* Finds each app's uid from every `oap_<uid>/source/package.json` (name, version): Twin Dial's and the probe's folders need no prior knowledge.
* Copies only the apps asked for (default `f30_cluster,twin_dial,signal_probe,car_vitals`; the test proves an app not asked for is not copied), their
  `settings.json`, cluster-render's log, journal, status text and version. `--dry-run` prints everything and runs nothing.
* Runs the privacy scan afterwards and writes redacted copies beside the originals. **verified** (fake car); **not done** on a real car.

### The parser and the tables
Each table cites its source in its module docstring. The code forms of the reports' tables:

| Table | Where | Notes |
|---|---|---|
| MC section 6, 13 rows, cases A1-A5, A8-A11, A15/16 | `tables_msg.l1_l2` | A hang is **a number other than 0 while the list is at rest for more than 1 s** (or still so at the end of the log, 30 s or more). Shorter is the order effect, counted separately. Recommended `release` set is built from the cases found (`deferValues [65535]`, `leftList`, `witness`, `ccm.clearIds [65535]`); `noneValues` stays `[0]` (MC F0 is unsafe) |
| L2: notifies / rests on 0, 65535 or the kept number / number equals a ccList id | `tables_msg.l1_l2` | measured one `ORDER_S` after the list returns to rest |
| P1 (D7), P2 (stored mark) | `tables_msg.probe_timeline`, `tables_probe.p1`, `p2` | the same engine on the probe's lines; `strict` can be lifted only when number = ccList id, it returns to 0 and no hang stretch exists (the owner's decision); P2 names a candidate and asks for the photo |
| MK: L4, P3, P4 | `tables_trip` | raw members from Twin Dial's three line shapes (0.1.0 `raw (P4)`, the MK build's `first at`, the probe's lines); factors from a reading, per counter; `bc`; departure zone; ResetLogic3; the distance / time cross-check computed from raw (it fixes the ratio of two factors, not their size) |
| SB 3.3 (the tab key) | `tables_probe.p13` | uses `up=` / `down=` of the stalk line and `since=M<n>`; a bit that moves in `bc-short` steps and in no other stalk step is the key; ambiguous or shared bits are refused; indirect key; spare button; thumbwheel free or owned by the cluster; the press while a message shows |
| SM, SP, SN, SV | `tables_probe.p8`, `p9`, `p11`, `p12`, `p14`, `p15`, `p16`, `p17` | title line by comparing a counted length, progress unit from the elapsed step per second, call states, duration in seconds, known / unknown contact, battery and signal range, `raw` against metres, sign values against readings, which field follows the set speed, tyre and boost scale from readings |
| the L-items | `tables_l`, `tables_l2`, `tables_render` | L3, L6, L7, L9, L13-L21, L24-L30; L10, L11, L12 from the renderer's journal |
| anything else in the register | `tables_l2.generic_p`, `parse_logs.manual` | P18-P21: arrives / silent / unseen per tag from CP's `probe_fields.json`; X and F items: `manual` |

Every table has the same three possible endings for a field the probe never heard: **not sent** (only when the `+120 s` summary names it silent, with the
minutes observed, the getter's outcome from the `ask` line and the session steps that expected it), **partial** (silent for under 2 minutes), **unseen**
(not in the build's table).

### Patches
`make_patches.py` writes `patches.md` (each patch: answer id, date, evidence, diff), `patches.json` and one `.diff` per patch. Keys covered: `config.tabKey`,
`config.trip.factors.*`, `config.trip.departureUtc`, `config.trip.verified`, `config.odometer.{order,factors,verified}`, `config.ccActive.release`,
`config.ccActive.noneValues`, `config.ccm.clearIds`, `config.ccDisplayed.use`, Twin Dial's `config.ccActive.strict`; advice (no diff, the shape does not exist yet)
for `config.cruise`, media, phone, tyres and the map window's presence rule. `diff` replaces a value in place, `insert` adds a key whose reader is on a branch
(`requires` names it: `twin-r3/sb` for `tabKey`). **verified** on copies of both `app.json` files (byte-exact: only the named lines change).

## 2. Evidence rules and privacy
* Evidence is **never a copy of a log line**. A shape is a template in this code with numbers filled in; every value that reaches a derived file passes
  `tables_base.safe_value`, which accepts numbers, booleans, enum names, our own fixed words, the probe's tags, scene ids and step ids, and **raises** on any
  other string. A table whose output is refused is reported (stderr and the item's `needs`) and the other answers are still written.
* `privacy_check.py --kind derived` re-checks the finished file (ASCII, length, no coordinate / VIN / phone / e-mail / MAC / IP / token); `parse_logs.py`
  refuses to write a file that fails it. For raw logs: non-Latin letters, the same patterns, and probe lines where a key that names a text or a `*-len` key
  carries letters.
* **verified:** a test plants `ZQXCANARY` in title / artist / name members and a phone number in probe-shaped lines and checks the answers file contains
  neither; the scan flags both lines; the 129 real formatter bodies give no false positive; the saved 2026-11-15 app and renderer logs scan clean.
* **Not covered, said plainly:** the scan can not find a name that is written as an enum-shaped word in a key we do not know to be free text. The protection
  there is structural (the probe's formatters log lengths; the evidence guard accepts only what the tables extract).

## 3. What the old material answers today (dated; `design/car/answers.json`)

| Item | Status | What it says | Date, material |
|---|---|---|---|
| **L12** | answered, arrives | cluster-render **0.5.12** (journal `start:` line and `component.json`), so ETC2 is available | 2026-11-14 |
| **L10** | answered, arrives | upload cap **5500 KB/s** (ceiling 5500, floor 2000), never seen below the ceiling in the saved material; the panel's scene "goes whole" **38** times, 5526 KB the median (5952 max), the map target's **24** times at 1275 KB; the map target writes about 287 000 KB a minute, the panel about 24 (median) to 1662 (max) | 2026-11-13..14 journal |
| **L11** | answered, arrives (f30's panel, not Twin Dial's) | while the panel scene 0x10004f8 was mapped in slot 0x203 (28 intervals, 6789 s), slot 0x100 held **our own map scene 0x10004f0 mapped for 3347 s**, **BMW's scene 0x1000300 mapped for 1489 s and unmapped for 1358 s**, nothing for 252 s. So a scene other than ours can be mapped in the map slot under our panel (hypothesis H-M is not refuted); it says nothing about when the box showed (no owner times in that material) | 2026-11-13..14 journal |
| **L9** | answered but not comparable | the saved starts are builds 0.7.10 to 0.7.12; they show **0 to 3** layout builds within 30 s (a 0 is a start whose log is cut), the first complete build 3.8 to 10.3 s after the start. The bench's 3 is for the engine since 0.7.19 (time-zone and ccList rebuilds), so this does not answer the question; a start of 0.7.20 and of Twin Dial does | 2026-11-14 |
| **L19** | answered | `COMFORT_PLUS` arrives (3 lines); `SIGNAL_UNBEFUELLT` and `INITIALISIERUNG` arrive at the start (3 lines each, "not recognised") | 2026-11-14 |
| **L24 / X10 (log side)** | answered / partial | one **cluster-render guard** line: panel 0x203 / 0x10004f8 disabled at strike 2, 2287 ms after mapping it (2026-11-14 19:07:13), "not asked for again until cluster-render's version changes"; 0.5.12 started 3 s later; 2 "display service not available" lines; no `kombi-guard.json` listed in the data folder; no abnormal app exit. Whether the cluster itself reset is the owner's observation | 2026-11-14 |
| **P5** | partial, arrives-other-app | the car's units, from car_vitals: pressure **BAR**, temperature **C**. The distance unit is not in any saved log | 2026-11-14 |
| **P6** | partial, arrives-other-app | engine temperatures arrive (car_vitals): raw 111..147 and 48..153; raw - 48 gives plausible degrees; the car's own verdict (COLD / OK / HOT) is not in that log | 2026-11-14 |
| **P16** | partial, arrives-other-app | tyre pressure raw **22..25** (with the invalid marker 65535 at start): factor **0.1** is the only one that puts it in 1.5-4 bar; target raw 22..27, target minus actual -1..+4 tenths; tyre temperature raw 40..49 (plausible as degrees); FES boost raw **0..11** with **255** meaning none, in four repeating ramps. Scales stay hypotheses until a reading of iDrive's tyre page / a gauge | 2026-11-14 |
| L29 | partial | `status.txt` asset rows: 8, 0 KB each (idle samples); the question needs a status sampled during a start | 2026-11-14 |
| X5 | partial | 62 "goes whole" events in the journal; the per-switch figure needs the session's marks | 2026-11-14 |

**Not answerable from the old material, and why:** L1, L2 (builds before 0.7.19 do not write `active cc:` / `check-control list:`); L3, L13-L18 (not in 0.7.10-0.7.12); L4-L8 (no Twin Dial log exists);
every probe item P1-P4, P7-P15, P17-P19 (no probe log exists). Each such item is `no-material` or `not-yet` with `needs` naming what is missing.

## 4. Tests (`tools/car/test_car_tools.py`, 47)
* **Parsing:** the three line shapes plus `+0000` journal timestamps; every fixture body parses and is clean of privacy false positives; CP's `fmt=1` lines (`up=`,
  `since=`, `mark M`, `summary S6 +30s`, `ask`).
* **Message machine:** A0 (both arrival orders: 2 order effects, **no hang**, no release), A1, A2 (rests on 65535, `noneValues` stays `[0]`), A3, A4 (control word
  taken from the log), a short tail is undetermined, A5 with the witness, A8-A11, the four views from `settings.json`, an old build is `no-material`.
* **Trip:** factors from a reading in the new and the 0.1.0 shapes, counter 2, a UTC departure (offset 120 -> `departureUtc`), a factor ten off, the cross-check
  without a reading (0.1 / 0.1 consistent, 0.001 / 10 not), silent sources with the getter outcomes, an invalid odometer.
* **Tab key:** the planted bit found from CQ-format marks; a bit shared with another stalk switch is refused; no marks says what is missing; a silent stalk is
  `not-sent` only after 2 minutes.
* **Other tables:** media title line and progress unit, phone states and duration, sign / cruise sources, guidance `raw` in metres, tyre and boost scale from a
  reading, clock / day-night / layout builds, the renderer's version, upload and slot tables.
* **Privacy, collector, patches, real material** as in sections 1 to 3.
* Run: `UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project python -I tools/car/test_car_tools.py` (about 6 s).

## 5. Assumptions and what is not proven
1. **The line shapes of f30 0.7.19+ and of Twin Dial 0.1.x are taken from the code** (`shared/hud.js`, `twin_cc.js`, `twin_tokens.js`), not from a car log: none is saved.
   A table that parses a changed line would find nothing and say `not-yet`, not a wrong answer; the first real log is the test.
2. **CP's `fmt=1` is read as published** (`bake/work/car/pub/CP/LOG-FORMAT.md`) and checked on CQ's bench log. That log has invented values and one timestamp for all lines
   (the bench's), so the time-window logic (`class_windows`) was tested on synthetic logs with real timestamps and the stalk table on the exact `since=M<n>` field.
3. **Marks restart at 1 in each run of the probe app** (CP). `Ctx` maps a mark number to its step without regard to the run: if the probe app restarts in the middle of a block,
   collect before it (the runbook should say so). `steps.STEP_CLASS` is the one table from CQ's step ids to the classes the tables use; steps not in it are `unlabelled`.
4. The journal copy is read as UTC (the head unit runs on UTC); `journalctl -o short-iso-precise` prints the car's local zone, which is UTC on this car (hypothesis).
5. Decisions that no log can make stay manual: X and F items, the photo of BMW's stored-message marker (P2), whether the window closed on the car (X7), the cluster's reset (X10).
6. Readings are typed by the lead (`readings.example.json`). A reading taken at a different moment from the log line it is compared with (the trip page after more driving)
   shows as "no factor matches"; set `at_marker` to the mark nearest the reading.

## 6. For CA, CP and CQ (found while building against their files)
* **CA:** the register's L13 has no `set`; P20 / P21 have no fields in CP's table (the generic table reports "no field yet"). `register.json` text carries
  non-ASCII (`blocks`); the parser copies it ASCII-only.
* **CP:** the format is complete for the tables. Two wishes, not blocking: the `ask` line is only written at `+120 s`, so a field silent for 30 s and asked later needs the
  `+120 s` summary in the log (the 2-minute rule relies on it); and `mark` lines carry `sets=`, which makes a restart visible only through `start`.
* **CQ:** `steps.STEP_CLASS` covers B1 (stalk and wheel), B2.2/3/9, B3.3/9/10, B4.12, B5.3/4/12/13, B6.9-15, B7.2; the steps of the Twin Dial and f30 repeats (B1.22+) get the
  tag suffix. Please keep step ids stable, or tell CL which ones change. The mark-to-class map for X5 needs a step whose class is `mode-switch` (B6.9, B6.12-14 are mapped).

## 7. What the lead must decide
1. Whether to run `collect.sh` with `--all-apps` at all (default copies four apps; other people's apps' logs are not needed by any table).
2. Where marks restart: collect after every block, as CP's `volume:` line and the runbook already say.
3. The owner's decisions the patches mark: Twin Dial's `ccActive.strict: false` (P1) and `ccDisplayed.use` / `release.witness` (L1 row 11), which `make_patches.py` proposes but never applies.
4. Whether L9's old numbers should be dropped from `answers.json` as not comparable (kept, with `matches_bench_3` null and the reason in `why`).

## 8. Files and commands
* Tools, tests, README: `tools/car/` (collect.sh, collect_meta.py, car_logs.py, context.py, steps.py, tables_base.py, tables_msg.py, tables_trip.py, tables_l.py, tables_l2.py,
  tables_probe.py, tables_render.py, tables_vitals.py, parse_logs.py, make_patches.py, privacy_check.py, synth.py, test_car_tools.py, readings.example.json, fixtures/probe_bodies.json).
* Data: `design/car/answers.json` (numbers only, dated). Scratch (not committed): `bake/work/car/CL/` (answers from CQ's dry-run log, patches of that run).
* Parse: `UV_CACHE_DIR=<main>/bake/work/.uvcache uv run -q --no-project python -I tools/car/parse_logs.py reference/car/<date>`.
