# Package D (round 2): check-control messages for Twin Dial

Branch `twin-dial/r2-d` (base `twin-dial/r2`). Spec: `docs/twin-dial/SPEC.md` §8, §6.1 (highlight), §14.4 (log); VG report §5; VF report §3.
Evidence words: **verified** = a test in this branch fails when the feature is broken; **hypothesis** = needs the car.

## 1. What was built

| Part | File | What |
|---|---|---|
| State machine, plate painter, helpers | `shared/twin_cc.js` (new) | `TwinCC` (none / window / ours, severity, the plate to show, D7 latch, latches, settle), `paintPlate`, `wrapHeadline`, `severityOf`, `symbolFor`, `nightRgb`, `mono` |
| Hooks | `shared/hud.js` (each marked `// twin_dial:`), `shared/layouts.js` (one type-table line) | see §3 |
| Test | `bench/test-twin-cc.js` | 149 checks, ~25 s, headless, no port |

Nothing here runs for f30_cluster: `hud.js` makes a `TwinCC` only when `config.ccActive` carries a boolean `strict`
(f30's does not), `twin_cc.js` is `require`d lazily inside that branch, and every hook is guarded by `this.twinMsg`.

## 2. The rule, and how the machine keeps it

States (`this.twinMsg.state`): `none` (the car says no message shows: bottom row), `window` (BMW's panel is see-through,
nothing of ours over it), `ours` (our plate is on the screen). A BMW warning is hidden only in `ours`, which is reached only when

1. the car's "shown now" (KombiIF `statusActiveCCMessage`; second witness Vehicle2 `statusDisplayedCCMessage`) names a number
   and ccList has an entry with that id **and a name** (stored entries are never drawn);
2. D7 has fallen: a "shown now" number has once matched a ccList entry, **and that message has ended** (see §6, decision 1);
3. no latch holds: a glyph our font lacks (until the message ends), a throw while painting (until the message ends; three in a
   run: until restart), our plate sheet refused (until the next rebuild);
4. the witnesses agree (both wired: both none, or both the same number; any disagreement is `window`, the safe side);
5. our plate for that exact message (id and words; the counter is not part of the key) was handed to the connection
   >= `CC_SETTLE_MS` (150 ms) ago, on a monotonic clock.

All eight keep-open conditions of SPEC §8.4 map to a reason string and a test (table in §4). `none` is reached only when the
witness says none (or, before any witness has spoken, the 0.7.20 heuristic says nothing shows).

### Order inside one turn (`_twinPush`)
Everything one signal event changes goes out as **one corked write**, in the order in which no step leaves BMW's panel covered
without our text for the shown message: (1) the plate for the message to show is painted (**in the signal handler's own turn**,
not a later tick), (2) the rows step aside, (3) the window flag / tab highlight (`twinCc` + `_twinSync()`), (4) a plate with
nothing to show is cleared, (5) the rows come back after the window has shut. The settle is the only thing the tick does
(`needsTick`): after >= 150 ms it shuts the window. *Hypothesis*: the service applies one corked write as one frame (the f30
engine relies on the same, 0.7.14); not measured on the car.

## 3. Hooks in `shared/hud.js`

* `IMAGE_TYPES.ccplate`; `layouts.js` TYPES `ccplate: ['font']`. The plate is an ordinary image widget (sheet-packed by the
  existing planner); `_create` gives it an empty buffer, `_updateOne` only repaints it through `_ccPush` when it went stale
  (counter, night).
* Constructor: `this.twinMsg` (the machine), `this.twinCc = { state, severity }` (**B's contract**, ENGINE-CONTRACT §2:
  severity `'red' | 'amber' | 'green' | 'grey' | null`), the `config.ccDisplayed` watcher (second witness; logs `displayed cc: number N`).
* `_ccPush` -> `_twinPush` (evaluate, then the five steps, skipped when nothing moved); `_ccOpen` returns the window flag;
  `_toggleOn` knows **`cc:rest`** (no message: bottom row), **`cc:ours`**, **`cc:window`**, **`cc:any`**;
  the rebuild decides the state *before* the layers are made (the new backdrop is born with the window open) and paints the plate at the end;
  a `refused` event on a sheet holding the plate latches "sheet refused"; `_tick` evaluates again while the settle is pending.
* For B: after assigning `this.twinCc` I call `this._twinSync()` **if it is defined** (otherwise nothing). Until `tdback` lands the
  test uses a stand-in backdrop: a `fill` whose hole opens on `cc:window` (the engine's existing `holeWhen` path).

## 4. Tests and what they prove (`node bench/test-twin-cc.js`: 149 passed)

**Part 1, the module alone (69 checks).** The symbol table equals VT's `message_symbols.json` `by_cc_id` entry for entry; generic
marker by colour; severity map; headline wrap (one line, two lines, "..." on line 2, 399 px with a counter, a word wider than a line);
the plate raster: opaque, the fallback polygon lies inside it with >= 1.5 px, no overlap with the belt group or the gear gap,
rule 4 px in the severity colour, symbol cell flat / grey gradient, black symbol on amber, first ink at x 783, baselines 680 or 656 / 703,
counter right-aligned at x 1224, night variant; the state machine with an injected clock (D7 episodes, `confirmNow`,
`strict: false`, no entry / empty name / glyph / throw / sheet, two witnesses, counter rules, settle at exactly 149 / 150 ms).

**Part 2, the real engine (kit build of a stand-in app, run in-process; 80 checks).** The engine's own clients keep every layer,
uniform and pixel they sent; after **every turn of the event loop in which anything was sent** the audit looks at BMW's panel
(bbox of `zc.panel` + 3 px, 3 px grid): while the car says a message shows or may show, BMW's panel may be covered **only if the
plate on the screen is, pixel for pixel, our plate for that message** (computed independently from the injected truth), and the bottom
row's ink is never in the panel while the window is open or the plate is up; no layer of ours reaches the belt group or the gear gap.

| VG §5.4 case | Check |
|---|---|
| 1 blind start | window open, plate empty, no row ink, nothing over the panel |
| 2 ccList, no active number | window (D7), never ours; heuristic expiry (900 ms in the test) returns the row; a red entry keeps the window |
| 3 N named | first match confirms D7 (log line) and stays BMW's; next message: window open **and** plate up in the arrival turn; window shut 150-ish ms after the plate went up |
| 4 no entry / empty name / Greek letter / injected throw | window, plate never up, latch holds while the message stays, falls when it ends; one throw does not end ours |
| 5 N -> M | window at once and the plate already says M; N -> unnamed: plate cleared in the same turn the window opens; counter "2/3" and its removal without reopening |
| 6 end | plate gone, window shut, row back in one turn |
| 7 sheet refused | the stand-in service refuses the 536 x 128 sheet at the next build: window open for every message; a layout without a plate widget: never closes; the next build retries |
| 8 layout switch, night | backdrop born with the window open; plate repainted; night plate; audited across both |
| 9 pixel audit | 57 frames audited, every kind of frame seen (ours / plate + open window / row alone / BMW alone); 0 violations |

Also: second witness (disagree -> window), log lines (`cc: id N colour C name len L shown-now S -> ours|window (reason)`, `cc: shown-now confirmed`,
`cc: plate latched ...`, `cc: plate sheet refused`, `active cc: no ccList entry for number N`), **no message text in the log**, service limits
(<= 8 layers per connection, pixel memory 0.7 MiB), B's `twinCc` / `_twinSync` contract.

**Mutants (the test fails when the feature is broken).** Four deliberate breaks each make the audit report violations:
the bottom row never steps aside; the window never opens; N's plate stays when M arrives; the plate is painted for the wrong message.

Flake check: 8 consecutive runs 147/147 after the timing fix (the audit's trace was keyed by millisecond; now by index and a monotonic clock).

### f30_cluster suites (must equal main)
`test-bottom-row` 254, `test-native-ui` 47, `test-strip-mask` 40, `test-fonts` 34, `test-probes` 25, `test-daynight` 24, `test-night` 48: all as on main, no change.

## 5. What is not proven

* No car. Everything about how KOMBI applies a corked write, how long a 274 KB sheet takes to be drawn, and what `statusActiveCCMessage` /
  `statusDisplayedCCMessage` really carry (P1) is hypothesis. 150 ms is f30's number.
* The audit's covering model is `fill`-hole + image alpha. B's real `tdback` (mask-sampled window, anti-aliased) is not in this branch;
  the lead should run `test-twin-cc.js` again after merging B and C (the stand-in layout stays valid), and E's pixel audit should cover the real layers.
* The stand-in font is f30's `wb_msg` (35 px), not Noto 42: wrap widths are checked, the 441 px / two-line look with Noto is A1's atlas.
* Pictograms: `paintIcon` + the `ICONS` table; a name missing from it falls back to the generic marker (A1's baked set is read the same way).

## 6. Decisions for the lead / owner

1. **The confirming message stays BMW's** (default). SPEC §8.4 says ours "until the car has once delivered a shown-now number that matched",
   SPEC §17.2 says "after the first confirmed shown-now, the *next* door message shows our plate". I implemented §17.2 (the message in which
   the match happened is BMW's to its end). `config.ccActive.confirmNow: true` makes it ours at once. Tests cover both.
2. **Disagreeing witnesses -> window.** If `statusDisplayedCCMessage` turns out never to return to 0 (or lags), the window would stay open and the
   bottom row would be gone until P1 says so. Safe but ugly; removing `config.ccDisplayed` from app.json disables the second witness.
3. **Severity colours** are B's black-floor-corrected codes (red 176 7 30, green 59 155 26), not SPEC §7.1's 176 10 37 / 60 155 34, so the plate cell
   and rule match tdback's highlight. Amber 240 170 10 and grey as in the SPEC. Night: red / amber .85, green .8, grey cell .55, rule .70 (amber has no SPEC value: hypothesis).
4. A one-line headline sits on baseline 680; with a counter and a headline wider than 399 px it moves to line 1 (656) so it cannot meet the counter.

## 7. What C and B must do (files they own)

* **C** (`app.json`, `main.js`, layout): add `twin_cc.js` to `shared`; `config.ccActive` = f30's plus `"strict": true`; `config.ccDisplayed` =
  `{ iface: "de.bmw.infotainment.vehicle.Vehicle2", field: "statusDisplayedCCMessage", numberPath: ["statusNumberCheckControlMessageDisplay"] }`
  (declare the field `rs`; `check_signals.py`); keep `config.ccList`, `config.ccFrames` (the counter), `config.ccm` null. Layout: bottom-row text widgets
  with `"toggle": "cc:rest"`; one `{ "type": "ccplate", "x": 694, "y": 592, "w": 536, "h": 128, "font": "<Noto 42 atlas>", "counterFont": "<Noto 29>", "conn": 2, "z": above the rows }`.
  The plate must be the last widget of its connection's z so it covers the row sheet.
* **B**: read `this.twinCc` (assigned before `_twinSync()` is called); the plate / rows are not tdback's.
* **Lead**: merge conflicts expected in `shared/hud.js` (the `// twin_dial:` blocks) and the `layouts.js` TYPES table.

## 8. How to run

`node bench/test-twin-cc.js` (builds `dist/twin_cc_test`, uses `apps/twin_cc_test` for the run and removes both). `TWIN_CC_TRACE=1` prints the frame trace.
