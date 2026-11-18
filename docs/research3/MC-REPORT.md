# MC: why f30_cluster 0.7.20 leaves the window over BMW's message panel open

Research round 3, package MC. Branch `research3/mc`. The car was offline, so everything here was measured on the Mac.
This report covers four things:
- every path in 0.7.20 that leaves the window open after BMW's message has gone, and the log lines each path writes;
- how Twin Dial's message machine handles the same inputs;
- whether a car log from 2026-11-17 exists (it does not);
- a decision table for the lead's next log read, with the candidate fixes built on this branch and switched off.

Labels: **verified** means measured here. **hypothesis** means the car must answer it. **refuted** means the replay or
the bench rules it out.

## 0. In short

1. **Seven paths in 0.7.20 leave the window open for good after the message has gone. Three of them come from the
   new "shown now" field (`KombiIF.statusActiveCCMessage`).** (verified, replay and bench) The window stays open
   whenever that field holds a number that is not 0 and that no ccList entry carries:
   - the catalogue default **65535**, which the getter can return at start-up (A1) or the field can fall back to when
     a message ends (A2);
   - the **last number, kept** after the message has gone while the list goes back to rest (A3, A4).

   0.7.20 treats such a number as "a message with no entry: keep BMW's panel open". That is the safe choice, and in
   all of these cases it never closes. The other paths are:
   - a stored entry that the field stays on (A5);
   - a stored red entry while the field is silent (A8);
   - a list that `config.ccList` cannot read (A9);
   - the blind start (A10);
   - an unreadable `newCCMessage` getter answer (A11).

   The latches (`_rowFail`, a missing glyph, an unread name) **cannot** hold the window open by themselves: the window
   only follows "a message shows" (A12 and A13 refuted).
2. **Twin Dial's machine hangs in exactly the same cases A1–A4 and A15–A16.** (verified) Its strict D7 rule and its
   second witness only ever add "window". It has no rule that releases a number the list does not carry. If the owner
   has not seen Twin Dial's window hang, either no message came up while Twin Dial was running, or the field is not
   stuck the way A1–A4 need. Either way, Twin Dial's log can tell the two apart (§6).
3. **No car log from 2026-11-17 is saved on this Mac.** (verified, searched) So which case the car is in is still
   open. The decision table (§6) reads it from the numbers-only lines 0.7.20 already writes. The branch carries the
   fixes behind `config.ccActive.release` (absent means 0.7.20 exactly) and an f30 second witness behind
   `config.ccDisplayed` (null).

   The **recommended set** is `{"deferValues": [65535], "leftList": true}` plus `ccm.clearIds [65535]`. In the replay
   it closes A1, A2, A3, A4, A11, A15, A16, S1 and S2. It breaks **none** of the nine safety cases in any view: f30's
   three views plus Twin Dial (§5).

## 1. Method

- **The real engine's message code, in this process.** `tools/research3/mc/engine.js` does the following:
  1. It copies `shared/*.js` into a temp tree, using `bench/twin-harness.js`.
  2. It replaces the kit's `Car` with a stand-in that only keeps the handler table `extra`.
  3. It builds a HudApp from the app's real `app.json` config and calls the real `_setupVehicleData`.
  4. Every injected value then goes through the same handler a car notification would reach: `ccList`,
     `statusActiveCCMessage`, `newCCMessage`, `statusDisplayedCCMessage`, `statusMenuCCMessage`.
  5. The window is read after each step from the engine's own decision. In the opaque themes that is `_ccOpen`, which
     is u_cc. In the G20 files it is `_maskLanes`, the strip mask's `msg` hole lane, read against the real lane table
     in `hud/scene/strip_mask.json`. For Twin Dial it is `TwinCC.window`, using the engine's `_twinInputs`.
  6. The time is injected. The tick's message part, `_ccListEval` while the fallback still has an entry to expire,
     runs every 100 ms. Our line is "painted" and allowed to settle for 160 ms (more than `CC_SETTLE_MS`, 150) before
     each sample, so the sample is the steady state the driver would see.
- **Cases**: `tools/research3/mc/cases.js`, with 25 cases and four views (f30 opaque, f30 G20 with our row, f30 G20
  with BMW's row, Twin Dial). Each step of each case carries a ground truth: does BMW show a message or not?
  - **HANG**: BMW shows nothing and the window is open (or our text is drawn) at the end.
  - **UNSAFE**: BMW shows a message, the window is shut, and no text of ours covers it. This breaks the safety rule.
- **Cross-check on the real bench**: `tools/research3/mc/bench_check.js` runs on port 8304. It uses the built app in
  `dist/`, the kit's stubbed head unit and the fake cluster-render, with WBBACK u_cc read from `/probe` on the opaque
  Comfort. It ran three times with the same result each time:
  - A0 closes; A1 and A3 hang;
  - the log lines are word for word the same as the replay's (`design/research3/mc/bench-check.json`).
- **Repeatability**: the replay is deterministic. `cases.js` ran four times over the session with identical tables.
  `bench_check.js` ran three times with identical results.
- **What transfers to the car**: the decisions, the log lines and the order effects. What does not transfer: which of
  the cases the car is actually in, and the car's real values for 65535, the control word and the witness. The
  decision table (§6) exists to answer those.

## 2. Every state in which the window is open, and what closes it (0.7.20 code)

The window is `_ccOpen()`, at `shared/hud.js` around line 4108:

- **Opaque themes** (`wb_comfort`, `wb_sport`, `wb_eco`): open while `_cc() === true`, or while blind
  (`!_ccWired()`).
- **G20 files with our row**: open while `_cc() === true` and our text for the message has not settled.
- **G20 files with BMW's row** (the switch, standby, or a latch): open while `_cc() === true`.

`_cc()` is `ccShown`. `_ccMerge` sets it true when **either** source says a message shows: `ccmShown`
(newCCMessage) or `ccListShown` (from `_ccListEval`).

| # | Source of a "true" that never ends | Code | What would end it | Replay |
|---|---|---|---|---|
| P1 | Active number not in `noneValues` (default `[0]`) with no ccList entry. Examples: the catalogue default 65535 at the getter (A1) or after a message (A2); a number kept after the list went back to rest (A3, A4) | `_ccListEval` wired branch: `noMatch`, "shown, BMW's panel stays open" | Only a later notification with a number in `noneValues`, or the number's entry coming back | **HANG**, verified |
| P2 | Active number stays on a **listed** stored entry after BMW hid it (A5, the 987 pattern) | wired branch, entry found | A later number 0 | **HANG**, verified. In G20 with our row it is *our text* that hangs, not the window |
| P3 | Active field silent, and a stored entry whose colour is in `fallback.keepColors` (`["red"]`) stays listed (A8) | `_ccListEval` fallback, `keep` | The entry leaving the list | **HANG**, verified. A white entry closes after 20 s (A7, ok) |
| P4 | A ccList notification that `config.ccList` does not fit: `ccListAll` keeps the **previous** list (A9) | ccList handler: `if (fits)` | A list that fits | **HANG** with a red entry; a white one closes after 20 s |
| P5 | Blind: no ccList and no active field ever arrives (A10) | `_ccOpen`: opaque `!_ccWired()`, see-through blind clause | The first list that fits | **HANG**, verified |
| P6 | `newCCMessage` once delivers a struct with no name and an id or symbol that is not 0 (an unread getter answer such as id 65535), and is never notified again (A11) | `ccmUnread` → `ccmShown = true`; `_ccMerge` OR | A later newCCMessage, which this car never sends (the 0.7.19 log read, 2026-11-17) | **HANG**, verified. Twin Dial has no `ccm`, so it is ok there |
| P7 | The latches: `_rowFail` (glyph, unread name, throw) | `_rowWhy` / `_own`: the **row** only | — | **refuted** as a cause (A12, A13): the window shuts with `_cc()` |
| — | A resting entry whose id is not in `ignoreIds` (A14) | fallback | 20 s | open for 20 s, then shut |

Side finding (verified): `hud/fonts/wb_msg.json` has 85 glyphs above U+0400, including Cyrillic. A Ukrainian message
therefore does **not** latch the G20 row. Only text outside the font does, so case A12 uses Greek. The memory note
"fonts are Latin-only" is out of date for `wb_msg`.

## 3. The cases on 0.7.20 (replay; A0, A1 and A3 also on the bench)

Each cell gives the state at the end of the case, when BMW shows nothing. Full matrix: `design/research3/mc/matrix.json`.
Log lines per case: `design/research3/mc/logs-0.7.20.json`.

| Case | What the car does | f30 opaque | f30 G20, our row | f30 G20, BMW's row | Twin Dial |
|---|---|---|---|---|---|
| A0 / A0b | Door opens and shuts; active 0→15→0, list rest→[15]→rest (both orders) | ok | ok | ok | ok |
| **A1** | The getter answers the default `65535 / 4095 / 15/15`, then nothing | HANG window | HANG window | HANG window | HANG window |
| **A2** | A message, then active goes back to 65535 | HANG window | HANG window | HANG window | HANG window |
| **A3** | A message, then active is never notified again (stays 15); the list goes back to rest | HANG window | HANG window | HANG window | HANG window |
| **A4** | Like A3, but the control word changes (15, control 0) | HANG window | HANG window | HANG window | HANG window |
| A5 | 987 hidden by BMW after about 20 s, still listed, active stays 987 | HANG window | HANG our text | HANG window | HANG window |
| A5w | Like A5, and the witness `statusDisplayedCCMessage` goes to 0 | HANG window | HANG our text | HANG window | HANG window |
| A6 | Active silent; door opens and shuts | ok | ok | ok | ok |
| A7 | Active silent; stored white entry | ok (shut after 20 s) | ok | ok | ok |
| A8 | Active silent; stored **red** entry | HANG window | HANG our text | HANG window | HANG window |
| A9 | Active silent; red, then a list that does not fit | HANG window | HANG our text | HANG window | HANG window |
| A10 | Blind | HANG window | HANG window | HANG window | HANG window |
| A11 | newCCMessage getter: no name, id 65535 | HANG window | HANG window | HANG window | ok |
| A12 / A13 | Latch (Greek name / empty name); the message then ends properly | ok | ok | ok | ok |
| A14 | Resting entry id 1, active silent | ok (20 s) | ok | ok | ok |
| A15 | A1, with the witness saying 0 | HANG window | HANG window | HANG window | HANG window |
| A16 | A3, with the witness going back to 0 | HANG window | HANG window | HANG window | HANG window |
| A17 | 65535, with stored white 987 listed | HANG window | HANG window | HANG window | HANG window |
| S1–S5 | Safety cases (§5) | no UNSAFE | no UNSAFE | no UNSAFE | no UNSAFE |

The owner reports "the window, not our own text". That fits every case in the opaque themes (the "Comfort first"
layouts), and in the G20 files it fits every case except A5, A8 and A9. **Hypothesis**: the owner was in an opaque
theme, or in a G20 file with BMW's row (the default `bottomRow` is `allG20`). The car's
`oap_12211/data/settings.json` says which (`hudLayout`, `g20`, `bottomRow`).

## 4. Twin Dial's machine against f30's

Twin Dial uses the same inputs (`_twinInputs` from the same `_ccListEval` fields), with `strict: true` and
`ccDisplayed` wired.

- **Where they agree: A1–A4, A15, A16 and A17 hang in both.** Twin Dial's witness reads 65535 or a kept number as
  "shown, no ccList entry": `window`. A disagreement between two witnesses, for example active 65535 against
  displayed 0 (A15), is `window` as well (`_witness` → `conflict`). Neither machine has any rule that ends a number
  the list does not carry. **Which is right**: both are safe, and both are wrong about the hang.
- **Where they disagree:**
  - **A11**: Twin Dial has no `config.ccm`, so a stray newCCMessage cannot hold it open. f30 can.
  - **A5, A8 and A9 in the G20 views**: f30 draws our text over a panel BMW has emptied, the text hanging. Twin Dial
    shows the window instead, because D7 has not fallen or the heuristic's live list is used only for "may show".
  - **During the first matched message**: Twin Dial keeps the window open (D7: "ours from the next one"). f30 covers
    it with our text after 150 ms.
- **The order effect, in both apps**: if the list returns to rest before the active number goes to 0 (A0 on the
  bench, which feeds the list first), both log `active cc: no ccList entry for number 15` once, even though nothing
  is wrong. That line is written **once per number per run**. On its own it does not prove a hang (§6, row 4).
- The fixes on this branch act only on f30's path (`_ccListEval`). Twin Dial is checked to be unchanged by them
  (`test-cc-release.js`). Giving Twin Dial the same release would take one hook: `_twinInputs` would hand
  `act: null` while `_ccRelease` releases. That is the lead's decision.

## 5. The candidate fixes (on this branch, off in app.json)

`config.ccActive.release`, read by `shared/hud.js` `_ccRelease`. When it is absent, behaviour is exactly 0.7.20. It
names the conditions under which the "shown now" value counts as **no verdict**; the list then decides.
`then: "listed"` is the default: a message shows while ccList lists any entry outside `ignoreIds`, so a listed message
is never covered. `then: "heuristic"` uses 0.7.20's 20 s fallback instead. Every change of reason is logged once, as
numbers only: `active cc: released to the list (listed): <reason>` / `active cc: decides again`.

| Fix | Config | Closes | Safety (S1–S5, A0, A6, A7) | Risk |
|---|---|---|---|---|
| F0 | `noneValues: [0, 65535]` (config only, no code) | A1, A2, A15, A17 | **UNSAFE in S1 and S2**: a listed message, even a red one, is covered while the field sits on 65535 | Breaks the rule; **rejected** |
| F1 | `release.deferValues: [65535]` | A1, A2, A15, S1, S2 | none broken | 65535 being a real message number: ids seen so far are 0, 15, 40 and 987 |
| F1h | F1 + `then: "heuristic"` | as F1, plus A17 | **S1 broken after 20 s** (0.7.20's own fallback risk) | Not recommended |
| F2b | `release.leftList: true` | A3, A4, A16 | none broken, S5 included | "An entry that has left ccList is no longer shown". Seen for the door; hypothesis in general |
| F2 | `release.noEntryMs: 3000` | A1, A2, A3, A4 | **UNSAFE in S5**: a message the list never carries is covered after 3 s | Not recommended unless the car shows that every shown number is listed |
| F3 | `ccDisplayed {…, use: true}` + `release.witness: true` | A15, A16 | none broken | The witness being right when it says 0 (unseen on the car) |
| F3h | F3 + `then: "heuristic"` | as F3, plus A5w | none broken in the replay | The 20 s rule, as F1h |
| F4 | `release.deferControls: [<value>]` | A4 (with the value the car uses) | none broken; a number in `noneValues` is never deferred | The value is unknown (the log shows it, §6) |
| F5 | `ccm.clearIds: [65535]` (an existing key, config only) | A11 | none broken | — |
| **rec** | `release: {deferValues: [65535], leftList: true}`, `ccm.clearIds: [65535]`, `ccDisplayed {…, use: false}` (logged only) | A1, A2, A3, A4, A11, A15, A16, S1, S2 | **none broken in any view** | F1 + F2b + F5 |

f30 cells still hanging at the end, out of 75: 0.7.20 **45**; rec **18** (A5, A5w, A8, A9, A10 and A17 in three
views); rec-wh 12 but with 3 UNSAFE cells.

The remaining hangs under rec are of two kinds:
- the safe side: a listed stored entry with no witness to release it (A5, A8, A17);
- a different cause: a ccList config that does not fit (A9), or a subscription problem (A10).

Also on the branch:
- f30 watches `config.ccDisplayed` (null) when it is set, and logs `displayed cc: number N` once per change.
  `Vehicle2.statusDisplayedCCMessage "rs"` is now declared in f30's `signals` (getter 61, notifier 32829;
  `tools/signals/check_signals.py` passes; Twin Dial 0.1.0 already installs the same declaration). This **changes the
  generated interface config** of an f30 install from this branch. Nothing subscribes to it while `ccDisplayed` is
  null.

Tests: `bench/test-cc-release.js`, 57 checks in under 1 s. Against 0.7.20's `shared/hud.js`, 28 of them fail. Each fix
has a "hangs without, closes with" check and a safety sweep. F0 and F2 have checks that pin their unsafe case, so
nobody switches them on believing they are safe. Suites: see §8.

## 6. Decision table for the lead's next log read

Read `/var/opt/public/oap/oap_12211/data/f30_cluster.log` (and `.1`). Read it, do not copy it, and never take any
message text from it; the lines below carry numbers only. Useful filter:
`grep -E 'active cc:|check-control (list|message|frames):|displayed cc:|bottom row:|probe: ccList' f30_cluster.log`.
Also read `settings.json` (`hudLayout`, `g20`, `bottomRow`) to know which view the owner was in. Things to know when
reading:
- each line is written once per change, not periodically;
- `no ccList entry for number N` is written once per N per run;
- `check-control list:` stops after 40 distinct shapes, and `probe: ccList:` after 40 lines.

| # | If the log shows… | the cause is | the fix is |
|---|---|---|---|
| 1 | Near the start, `active cc: number 65535 control 4095 frame 15/15 utility …` and `no ccList entry for number 65535`, with no later `active cc: number 0` | **A1**: the getter returns the unfilled default (the window was open from start-up, not only after a message) | F1 `deferValues [65535]` (rec). Not F0 |
| 2 | `active cc: number N …` for a message, later `active cc: number 65535 …` and `check-control list: … listed none` | **A2** | F1 (rec) |
| 3 | `active cc: number N control C …` and then **no further `active cc:` line** after `check-control list: 0 messages … listed none` | **A3**: the number is kept after the end | F2b `leftList` (rec) |
| 4 | Like 3, but with `active cc: number N control C' …` (same N, new control) after the list went back to rest | **A4**: the control word says "gone" | F2b (rec), or F4 with `deferControls [C']`. Take C' from this line |
| 5 | `no ccList entry for number N`, **followed** by `active cc: number 0 …` within a second | **Not a hang**: list and number arrived in either order (A0) | none |
| 6 | `active cc: number 987 …` (or any listed id) stays, the list still lists it, and the owner saw the window open about 20 s after the message appeared | **A5**: the field is "last shown", not "shown now" | Turn on the witness (`ccDisplayed use: false`, already in rec) for one drive. If `displayed cc: number 0` comes at the right moment → F3 (`use: true`, `witness: true`). Closing A5 itself needs F3h's 20 s rule, which is the owner's call under the safety rule |
| 7 | **No `active cc:` line at all**, and `check-control list: … listed N red …` while BMW showed nothing | **A8**: field silent, a stored red entry kept by `keepColors` | Find out why the field is silent: `signal KombiIF error` in the log, or the getter failing. Until then the window open is the safe side; the only safe closer is a confirmed witness |
| 8 | `check-control list: … (not a list config.ccList fits)` | **A9**: the list shape changed | Fix `config.ccList` paths from `probe: ccList: …` (ids, colours, symbols) |
| 9 | **No `check-control list:` line at all** (and in G20: `bottom row: all BMW's - waiting for the car's check-control message to be read once`) | **A10**: blind | Check `signal KombiInterface_2 subscribed` / `error` (a subscription problem, not message logic) |
| 10 | `check-control message: no name, no description, … id 65535 …` and `bottom row: info is BMW's again (a check-control message arrived that app.json config.ccm cannot read …)` | **A11**: a stray newCCMessage getter answer | F5 `ccm.clearIds [65535]` (rec), or drop `config.ccm` (this car never sends it) |
| 11 | `displayed cc: number 0` while the active number is stuck (cases 1–4); this needs rec installed, which logs the witness | The witness is usable | F3 (`ccDisplayed.use: true`, `release.witness: true`) |
| 12 | `check-control frames: frame 15 of 15, 3 ids` | The KombiIF check-control fields carry their catalogue defaults (unfilled). This supports rows 1 and 2 | as rows 1 and 2 |
| 13 | `bottom row: the whole row is BMW's again until the app restarts - info: …` | A latch. **Not** the cause of an open window (A12, A13 refuted) | none for the window. The latch's own reason |

On Twin Dial's log, the same reading uses its lines
`cc: id N colour C name len L shown-now S → window (no ccList entry for number S)`. Rows 1–4 show up there as
`shown-now 65535` or a kept `shown-now N` with `window` while the list is at rest. If Twin Dial's log shows
`shown-now 0` at the same moments, then f30's case is not 1–4.

## 7. What the car must answer (hypotheses)

- **H1** (hypothesis): which value `statusActiveCCMessage` holds with no message showing — 0, 65535, or the last
  number — and whether the getter answers at start. Rows 1–4.
- **H2** (hypothesis): an entry leaving ccList means the message is no longer shown. Seen for the door (0.7.19's log);
  this is what F2b relies on.
- **H3** (hypothesis): 65535 is never a real message number. Ids seen so far: 0, 15, 40, 987.
- **H4** (hypothesis): `statusDisplayedCCMessage` goes to 0 when BMW hides a message, including a stored one (A5w). It
  has never been seen on the car (Twin Dial's probe P1).
- **H5** (hypothesis): which layout and `bottomRow` the owner was in when the window hung (`settings.json`).

## 8. Files, commands, results

- `shared/hud.js`: `_ccRelease`, `_ccWitness`, the release branch in `_ccListEval`, and the f30 `ccDisplayed`
  watcher. All are inert while `config.ccActive.release` is absent and `config.ccDisplayed` is null.
- `apps/f30_cluster/app.json`: `Vehicle2.statusDisplayedCCMessage "rs"` declared; `config.ccDisplayed: null`;
  `_release` / `_ccDisplayed` notes. No version bump.
- `tools/research3/mc/engine.js` (the in-process engine), `cases.js` (`node tools/research3/mc/cases.js
  [--fix <name>] [--logs] [--case <id>]`), `matrix.js` (writes `design/research3/mc/matrix.json` and
  `logs-0.7.20.json`), `bench_check.js` (`BENCH_PORT=8304 node tools/research3/mc/bench_check.js --json
  design/research3/mc/bench-check.json`).
- `bench/test-cc-release.js`: 57 passed. With 0.7.20's `hud.js` swapped in: 29 passed, 28 failed.
- The car log search for 2026-11-17 found nothing:
  - `bake/work/` was searched recursively for `active cc:` and `check-control list:`. The only hits were bench logs
    and reports.
  - `reference/car/` holds only 2026-11-15, and its three f30 logs (0.7.12) have 0 message lines.
  - `~/Downloads`, `~/Desktop`, `~/Documents` and `~/projects` (depth 7) hold no `f30_cluster*.log` or
    `twin_dial*.log` other than those, and the MP package's bench logs.
- Suites on this branch (`BENCH_PORT=8304`, one at a time, all green):
  - f30: test-bottom-row / native-ui / strip-mask / fonts / probes / daynight / night: **254 / 47 / 40 / 34 / 25 / 24 / 48 passed**, the same as on `main`.
  - Twin Dial: budget 75, layout 61, pages 100, cc 149, probe 110, fonts 219, bake 35, sim 39, all passed.
  - test-cc-release: 57 passed.
