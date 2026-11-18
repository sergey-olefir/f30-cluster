# CF1: "shown now" from Vehicle2.statusDisplayedCCMessage (Twin Dial and f30_cluster)

Package CF1 of the car-fix round (docs/AGENT-BRIEF-car-fix.md §2). Branch `car-fix/1` from `twin-b/integrate` (b10b8e4).
Nothing pushed, no version changed. Every shared-file hunk is marked `// car-fix CF1:`.

Labels: **car** = seen on the owner's car on 2026-11-18. **verified** = measured here (replay, bench, suites).
**hypothesis** = only the car can answer it.

## 0. In short

1. **The "shown now" number now comes from `Vehicle2.statusDisplayedCCMessage`** (`config.ccDisplayed`), in both apps. The switch is
   `config.ccActive.source: "displayed"`. `KombiIF.statusActiveCCMessage` stays declared, subscribed and logged.
   It is marked `dead: true`, so it decides nothing.
2. **The rule** (one implementation in `shared/hud.js`, used by f30's `_ccListEval` and by Twin Dial's `_twinInputs` → `TwinCC`):

   | displayed says | verdict | BMW's panel |
   |---|---|---|
   | 0 (`noneValues`) | nothing shown; listed entries are stored ones (Twin Dial: rows on tab 2) | may be covered |
   | N, with a ccList entry | that entry | covered only after our text for it has been on screen 150 ms |
   | N, with no ccList entry | shown, no text of ours; Twin Dial pulls **no** tab (`unlistedPullsTab` false) | open |
   | 65535 (`unknownValues`) | unknown | open; Twin Dial pulls no tab unless the list holds a message |
   | not yet spoken | 0.7.20's path; with `dead` this is the list's fallback | as before |
   | a number that disagrees with a moving active number | disagreement | open |

3. **The stuck window is gone** (verified). Active 65535 forever, displayed 0 and the list at rest now shut the window in every
   view: f30 opaque, f30 G20 with our row, f30 G20 with BMW's row, and Twin Dial. Before CF1 the same inputs hang in all four;
   the test pins both outcomes.
4. **Twin Dial: D7 falls on the first match, and that message may be ours** (`confirmNow: true`). After the first match our card
   covers BMW's panel, once it has been on screen 150 ms. The numbering is car-verified on four ids.
5. **Every other keep-open condition and the 150 ms rules are unchanged.** The release heuristics are untouched. They act only on
   the active number, so on this car they are obsolete (§5).

## 1. What the car showed (numbers only)

Source: `reference/car/2026-11-18-collect1/apps/twin_dial/twin_dial.log.1` (Twin Dial 0.1.1 lines `displayed cc:`,
`check-control list:`, `cc:`) and the brief's §0.

- **Active**: `active cc: number 65535 control 4095 frame 15/15 utility 16777215` at every start, and never another number.
  The machine then logged `the two "shown now" witnesses disagree` for the rest of the run: 0.1.1's window was stuck.
- **Door (15)**: ccList `listed 15 white` at 17:13:42.043, then `displayed cc: number 15` at .080. The list went back to rest at
  43.621, then `displayed cc: number 0` at .778. In the session at 09:43:10 the gap was 52 ms on show; the list emptied at
  11.910 and displayed went 15 → 285 at 12.063, then 0.
- **The same match for 14, 19 and 2255**: the list carries id N, then displayed N follows within 30–60 ms.
- **285, 926, 927 and 184**: displayed for about 6 s each, with **no ccList entry**. These are BMW messages that ccList never
  carries (MC's case S5 is real). 285 also showed while 2255 was listed.
- **At start**: displayed 0 arrives first (the getter), then active 65535.
- **At the end of a drive**: `displayed cc: number 65535` (17:15:20, 08:00:01, 13:15:50, 14:19:35).

## 2. Code

**`shared/hud.js`** (marked hunks):

- **`_ccDispSource()`**: true when `ccActive.source === "displayed"` and `config.ccDisplayed` names the field.
- **`_ccActWitness()`**: whether the active number is a witness. With source displayed: never with `dead: true`. Otherwise only
  once it has **changed** in this run to a number outside `deadValues` (default `[65535]`), and not while it reads one.
  This covers the brief's "65535 or never changes" rule.
- **`_ccActDecides()`**: 0.7.20's path takes the active number, unless the source is displayed and `dead` is true.
  `_ccRelease` bails out the same way.
- **`_ccDeadValues()`**: the active numbers that are no witness.
- **`_ccListEval`**: a new first branch, used while displayed is the source and has spoken (the table in §0). Each reason is
  logged once: `displayed cc: no ccList entry for number N - shown, BMW's panel stays open`,
  `displayed cc: number 65535 is unknown (...)`, `displayed cc: the active number A disagrees with D ...`.
  0.7.20's path follows unchanged, apart from the dead-active guard.
- **The active handler**: it tracks the first number and whether the number has moved, and logs
  `active cc: wired - not the "shown now" source (config.ccActive.source displayed, dead)`.
- **Both displayed watchers**: the f30 one and Twin Dial's re-run `_ccListEval` when displayed is the source. f30's watcher
  rebuilds when displayed is the first thing to end the blind case. `_ccWired()` counts displayed as read.
- **`_twinInputs`**: hands the machine the active number only while `_ccActWitness()` is true. It never releases displayed, and
  adds `prefer: "displayed"` and `unknownValues`.

**`shared/twin_cc.js`**:

- **`_witness`** takes the displayed number when told to prefer it.
- **`TwinCC.update`** has an "unknown" branch: window, reason `the "shown now" number is unknown (65535)`, and a severity taken
  only from the listed entries. A resting list therefore pulls no tab, by B2's convention that a window with no severity is not
  a message.

**`apps/twin_dial/app.json`**: `ccActive` gains `source: "displayed"`, `dead: true`, `unknownValues: [65535]`,
`confirmNow: true` and the `_carfix` note. `ccDisplayed` was already set.

**`apps/f30_cluster/app.json`**:

- `ccActive` gains `source`, `dead` and `unknownValues`, plus `_carfix`.
- **`ccDisplayed` is ON now**: it was `null`, and is now the Vehicle2 field with no `use` flag. The signal was already declared
  `"rs"` (getter 61); `check_signals.py` passes for all three apps.
- **Діагностика**: research3/MC's `diagDisplayed` (Off / Log only / Use it) is **replaced** by `diagShownNow` ("'Shown now'
  source"). Its default "Displayed (car-verified)" is `app.json` as shipped; "Active (0.7.20)" writes
  `ccActive.source: "active"` and gives back 0.7.20's path in place.

  Why it is replaced, not left as it was: the witness that `diagDisplayed` switched on **is** the source now. Its "log" option
  would do nothing, and "use" (the witness releasing through `release.witness`) is superseded. What is worth keeping is a way
  back if the displayed rule ever misbehaves on a car.

**`bench/run-app.js`**: the probe reports `cc.displayed`, `cc.source` and `cc.activeWitness`.

**`bench/fake-signs.js`**:

- A `ccDisplayed` feed.
- The car's scenes: `car-start`, `car-rest`, `car-door`, `car-door-closing`, `car-door-closed`, `car-285`, `car-stored`.
- The `active-*` scenes feed the same number to displayed too, so `tools/research3/mb/trace.py` and `mp/measure.js` keep meaning
  "a message" / "no message".

**`tools/research3/mc/cases.js`**:

- `runCase(..., base)`: `"legacy"` (the default) strips CF1's keys, so MC's documented matrix still reproduces; `"shipped"` uses
  `app.json` as it is.
- The car's cases **K0–K9** and **L1–L3**, from §1, with a ground truth per step.
- Fixes `cf1-live` (`dead: false`) and `cf1-rel` (the Діагностика release on).

## 3. Tests (each suite run alone, port 8911)

| suite | before | after | what CF1 added / changed |
|---|---|---|---|
| `cc-release` | 57 | 75 | §"car-fix CF1": K0–K9 in all four views on the shipped config with no unsafe or hanging step (40 runs). K4 (the stuck window) **hangs on the pre-CF1 config in every view** and is shut now. Exact per-step traces for K0, K1, K2, K3, K7 and K8. The log lines. The live-active cases L1–L3. The release changes nothing step for step. MC's old sections run on the legacy base (one check reworded: `ccDisplayed` is on now). |
| `twin-cc` | 249 (main 149) | 266 (256 + case 12, the follow-up) | Engine with the per-frame pixel audit (V1–V5). **2e/2f** the car's start: active 65535 + displayed 65535 = window, tab 1, no pull; displayed 0 = none with active still 65535. **3a** the door: list 15 + displayed 15 in one turn, the card on the sheet in that turn, ours after the settle (confirmNow). **3b** the car's close: list at rest → window in that turn ("no ccList entry for number 15"), displayed 0 0.7 s later → none, tab 1. **8a** rewritten: a moving active number ignored with `dead`, a witness with `dead: false` (disagree → window, agree → ours). **10** (the narrowed release) runs with `source: "active"`, because it is an active-number rule. The stand-in now takes Twin Dial's own `ccActive` / `ccDisplayed`; `feedAct` feeds displayed. |
| `bottom-row` | 254 | 272 | f30 on the bench. **Opaque** (wb_comfort): start 65535 open; `car-rest` shuts with active still 65535 and our row ink back; door open with no ink of ours in the panel; closing (list at rest, displayed 15) still open; displayed 0 shuts; 285 open; stored 987 with displayed 0 stays shut; the log lines. **all6WB**: start open; displayed 0 covered; the door: our line, BMW's panel open on every probe until ours is on screen; `clean()` audit 0 violations; closing opens with our line empty; 0 covers again; 285 open with the audit at 0 violations. The fix/active-cc no-entry log check reads displayed's line. |
| `diag` | 98 | 100 | `diagShownNow` writes only `ccActive.source` and goes back to `app.json`'s value; `diagDisplayed` is gone; the native row `SET_DIAGSHOWNNOW`; on the bench it applies in place with no layer dropped. |

**Do the tests fail when the feature is broken?**

- **The source switch ignored**: `cc-release` K4, `twin-cc` 2f and `bottom-row` "stuck window is gone" fail; each pins the hang
  the pre-CF1 config produces.
- **65535 read as "none"**: K0 / K7 become UNSAFE, and 2e and the bench start check fail.
- **The active number taken as a witness**: 2f fails ("disagree" → window).
- **confirmNow off**: 3a fails.

The full run is in §6.

## 4. Decisions (and why)

1. **`dead: true` in both `app.json` files, plus a rule for other cars.** Without `dead`, the active number is a witness only
   once it has **changed** to a number outside `deadValues`. A field that sits on 65535, or on any single value, for the whole
   run is no witness. On a car where it works, a disagreement with displayed opens BMW's panel, which is the safe side.
2. **65535 on displayed = unknown → window**, as the brief says. Twin Dial takes no severity for it (no tab pull) unless the list
   holds a message.
3. **Before displayed has spoken**, 0.7.20's path decides; with `dead` that is the list's 20 s fallback, as when active is
   silent. On the car, displayed's getter answers before active's (§1), so this lasts milliseconds. Taking "no value" as
   "window" for good would have kept a car without the field stuck open.
4. **Twin Dial `confirmNow: true`.** The brief: "after the first match our card covers BMW's panel". SPEC-R3 5.4.6 says D7 holds
   "until the car has once delivered a 'shown now' number that matched a listed entry". The numbering is car-verified (14, 15,
   19, 2255). The hard rule still holds: our card for that exact message must be on screen ≥ 150 ms. `false` gives back
   "ours from the next one" (one key).
5. **The message's end opens BMW's panel for 0.15–0.7 s.** The car empties the list before displayed goes 0. "Displayed N with
   no entry" is a keep-open condition, so the window opens for that gap. On Twin Dial the card is held 150 ms by the open
   settle, then the pointer page shows until displayed 0 sends tab 2 back. This is the safe side and was not changed.
   **Hypothesis**: BMW's panel is still showing or animating the closing message then. A cached copy of the card could replace
   the pointer page in that gap (the window stays open either way); not done, as it is beyond this package.
6. **f30's opaque themes** behave as before for a shown message: BMW's panel is open while displayed names one, because the
   opaque themes never draw our text over it. What changed is that they now **shut** when displayed says 0, even with active
   65535 and stored entries listed.

## 5. What becomes obsolete

- **`config.ccActive.release`** (research3/MC; B3's narrowed `leftList: "kept"`; Діагностика "Release a stuck check-control
  message" / "Закривати повідомлення, що застрягло" in both apps). It acts on the active number only: once displayed has spoken
  it is not consulted, and with `dead` not even before. It still works under f30's `diagShownNow = active` (or `source:
  "active"`); test-twin-cc case 10 and test-cc-release's MC sections keep it covered there. Candidates to drop later: the
  Діагностика row (both apps), `_ccRelease`'s `leftList` / `deferValues` / `witness` / `noEntryMs`.
- **research3/MC's f30 witness**: the `ccDisplayed.use` + `release.witness` pair, and `_ccWitness`. It still works with source
  active; superseded.
- **f30 `diagDisplayed`**: replaced, as described in §2. A saved `log` / `use` value on the car is no option of the new key and is
  ignored.
- **Twin Dial's two-witness conflict**: it now matters only where the active number moves (`dead: false`).
- **D7's "ours from the next one"**: superseded by `confirmNow: true`.
- **MC-REPORT §6 rows 1–4 and 11, and §7 H1, H3, H4**: answered by the car. Active sits on 65535 (row 1 / A1). Displayed goes to
  0 when BMW hides a message (H4, at least for the door, 14, 19, 2255 and the unlisted ones). 65535 was never a message number,
  only "unknown" (H3).
- **The 20 s fallback (`ccActive.fallback`)**: still in place, but only for the moments before displayed's first number.
- **SPEC-R3 5.6 "unproven until the car: what 'shown now' carries (probe P1)"**: proven. The spec text is the lead's to update.

## 6. Full run

`RUN_ALL_PORT=8911 sh tools/twin-dial/run_all_tests.sh` on the CF1 tree (every suite alone, one after the other; load average
about 10 from other work on the Mac):

```
bottom-row 272 · cc-release 75 · daynight 24 · diag 100 · driver-profiles 105 · fonts 34 · mb-exp 46 · native-ui 47 · night 48 ·
probes 25 · scene-tex 54 · strip-mask 40 · twin-bake 37 · twin-budget 95 · twin-cc 256 · twin-centre 163 · twin-fonts 327 ·
twin-layout 106 · twin-limit 152 · twin-pages 100 · twin-probe 115 · twin-sim 39 · twin-tabs 199 · twin-trip 89 ·
check_signals ok (f30_cluster, driver_profiles, twin_dial) · bake-py 85
24 suites, 2548 passed, 0 failed - ALL GREEN
```

Changed by CF1 against `twin-b/integrate`: bottom-row 254 → 272, cc-release 57 → 75, twin-cc 249 → 256, diag 98 → 100. Every other
count is integrate's. Not in the suites: `tools/research3/mc/bench_check.js` (MC's bench cross-check) builds the shipped f30, so
its A1 / A3 "hang" now closes - it documents 0.7.20, not this build.

## 7. Open (for the car)

- **The window during each message's end** (decision 5): it opens for 0.15–0.7 s. Watch the owner's view of it on the next drive.
- **The unlisted numbers** (285, 926, 927, 184, about 6 s each, several per drive): BMW's panel opens. Follow-up (the lead):
  they pull **no** tab and show no pointer page by themselves - `config.ccActive.unlistedPullsTab` false (Twin Dial `app.json`;
  `TwinCC.unlisted` gates TwinCentre's `#nodraw` pull). Only a number matching a list entry, or 65535 with a message in the list,
  pulls tab 2; an unlisted number during a period that already pulled tab 2 shows the pointer page there. true gives back SPEC-R3
  5.1's pull. test-twin-cc case 12 (a-d, audited) checks both ways: 256 -> 266.
- **Whether displayed ever stays on N after BMW has hidden a stored message** (MC's A5 on displayed): the probe saw 0 every time.
