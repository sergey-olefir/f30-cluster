# B7 — the integration layer of Twin Dial 0.1.1 (report)

Package B7 of `docs/AGENT-BRIEF-twin-build-r3.md`: the Діагностика menu, the research3 keys as settings for both cluster
apps, the start-up fix of research3/MP, the full-suite runner, and the merge of B1–B6. Branches: **`twin-b/b7`** (the package
alone, from `main`) and **`twin-b/integrate`** (every package merged, the merge candidate). Worktrees
`.claude/worktrees/b3-b7` and `.claude/worktrees/b3-int`. Nothing pushed, no version changed. The merge itself, every
conflict and every integration fix are in `docs/twin-dial/R3B-INTEGRATION.md`.

Nothing here has run on a car. "Verified" = a test on the Mac bench (Node 22; the car runs Node 8.16: the new file is checked
for Node 8 syntax, not run on Node 8).

## 1. What was built

### 1.1 The Діагностика menu (both apps)

- **`shared/diag_settings.js`** (new; packed by both apps). `Diag`: app.json `config.diag.settings` maps each diagnostics
  setting to the config paths it writes while it is on (a bool: `on`; a choice: `options`; or an action: `act`). The overlay
  is applied **in HudApp's constructor before anything reads `config`** (mbExp, the signal watchers), and again on each
  change. **Off = the key exactly as app.json has it**: the baseline of every path is read once before the first write and
  put back (a key app.json does not carry is removed again, with any object the overlay created on the way). With every
  setting off, `config` is byte for byte app.json's (tested for both apps, after every option of every setting, and all
  on / all off).
- What a change does afterwards: **in place** for keys the engine reads at the moment of use (`ccActive.release` — then the
  message state is decided again at once —, `mapWindow`, `mapForce`, `mapSlotLog`); f30's **scene textures** (`sceneTex`):
  every scene texture dropped first (they are keyed by name, not by file, and the old and new set must never sit together),
  then a rebuild; f30's **MB experiments** (`mbGap`, `mbCover`, `mbRebuild.onMode`): the old cover layer dropped, a new
  `MbExp`, a rebuild; **`ccDisplayed`**: subscribed only at start, so the log says it applies after a restart and the
  setting's label says "(after restart)". An action: `diagSilent` runs research3/MK's silent-fields summary
  (`twin_tokens.summary`) at once and every 5 minutes while on.
- **Screens** (app.json): a `DIAG` screen (kind `menu`, `settings: "placed"`) holding the rows; a **`BTN_DIAG` "Діагностика"
  button on MAIN** (next to Settings); the diagnostics keys are in the `SETTINGS` screen's `skip`. Deviation from the brief's
  "a sub-screen of the settings": the kit's `settings` screen can hold only setting rows, not a button, so the sub-screen is
  reached from MAIN. `shared/menu.js`: the button's handler and one status part, "Diagnostics on: N", in STATUS2 while any is on.
- **Twin Dial** settings (all off): "Закривати повідомлення, що застрягло" (`ccActive.release` =
  `{deferValues: [65535], leftList: true}`: the value of SPEC-R3 5.4 step 7; **the narrowing itself is B3's engine side**),
  "Вікно карти" вимк. / W1 / W2 (`mapWindow`), "Примусове вікно карти" (`mapForce`), "Журнал слотів карти" (`mapSlotLog`,
  see the integration fix in R3B-INTEGRATION §4), "Журнал полів, що мовчать" (the action).
- **f30_cluster** settings (all off; English labels like the rest of its menu): "Release a stuck check-control message"
  (`ccActive.release` = MC's recommended `{deferValues: [65535], leftList: true}`), "Second 'shown now' witness (after
  restart)" off / log / use (`ccDisplayed`; "use" also sets `ccActive.release.witness`), "Lighter scene textures" off / R8 /
  ETC2 (`sceneTex`), "No layer over the gear gap" (`mbGap`, the value of `tools/research3/mb/exp/f30-gap.json`), "Cover over
  the gear gap" off / clear / black / grey (`mbCover`), "Rebuild on every drive-mode change" (`mbRebuild.onMode`).
  `mbRebuild.everyMs` is not offered (a timer set at start).
- **Files of `apps/f30_cluster` changed: `apps/f30_cluster/app.json` only** (shared list + `diag_settings.js`; MAIN item
  `BTN_DIAG`; SETTINGS `skip`; the `DIAG` screen; six settings; `config.diag`). `config.startupHold` is not set there.
  The seven f30 suites (bottom-row, cc-release, daynight, fonts, mb-exp, native-ui, night, plus probes, scene-tex,
  strip-mask) keep main's counts.

### 1.2 The start-up fix (research3/MP), `config.startupHold`

Why three builds: at cluster-render's "ready" the first build is made; the first time zone and the first message list each
make the bottom row's clock / info field "ours" (`HudApp._own`, `_rowWhy`), and those widgets exist only at a build, so each
arrival is another full rebuild. **"Apply them in place"** would need every row widget built always and shown or hidden live,
in the engine and in f30's layouts: not done; its best case saves the same bytes as the hold (the third build's pixels), so
the hold was implemented: `hold()` at the top of `_rebuildInner` keeps the **first** build until both first values are in or
`ms` (default 1000) after the first ask, one timer, nothing after the first build changes. While it waits, an engine with the
message machine reports the blind state "window" (no moment of "ready and none": test-twin-sim's blind-start check found it).

Measured with `tools/research3/mp/measure.js <app> --quick` (bench, start phase; the car-like first values come 300 ms after
start; bytes transfer to the car, milliseconds do not). Twin Dial at `twin-b/b7` (0.1.0's layout), f30 6WB Comfort:

| | builds at start | bytes on the wire | layers made / dropped | shader source sent | final layout complete |
|---|---|---|---|---|---|
| Twin Dial, no hold | 3 (the 2nd torn down) | 4362 KB (4285 KB pixels) | 42 / 28 | 45 KB | +341 ms (first, incomplete +186 ms) |
| Twin Dial, `startupHold` 1000 | **1** | **2451 KB** (2420 KB pixels) | 14 / 0 | 15 KB | +386 ms (one build, complete) |
| f30, no hold | 3 | 8224 KB (8011 KB pixels) | 63 / 42 | 162 KB | +336 ms |
| f30, `startupHold` 1000 (BENCH_CONFIG) | **1** | **5917 KB** | 21 / 0 | 54 KB | +473 ms |

At the upload floor of 2000 KB/s that is about 2.07 s → 1.2 s of upload for Twin Dial and 4.0 s → 2.9 s for f30. The price:
the first frame waits for the car's values, at most `ms`. On the bench with **no** message list at all (the plain bench server
feeds none) the build waits the full 1000 ms and says so ("start-up: first build after 1001 ms, still waiting for the message
list"): that is the case of a car whose list never arrives at subscribe. **Twin Dial: on** (`config.startupHold.ms 1000`);
**f30: off** (not in its app.json) until the owner wants it: one line, measured above.

### 1.3 The runner, `tools/twin-dial/run_all_tests.sh`

Every `bench/test-*.js` one at a time on one port (`RUN_ALL_PORT`, default 8607), then `check_signals.py` for the three apps
and the bake test (`tools/twin-dial/test_bake.py`); one line per suite with main's count beside it ("!" when different,
"new" for a new suite), exit non-zero on any failure, crash or missing summary. `--only <word>`, `--fast` (no bench server).
Logs per suite in `RUN_ALL_LOG` (kept on a failure). Main's own bake test fails its two byte-for-byte re-bake checks on this
Mac (B1's re-bake fixes it on the integration branch); the runner reports that case as "known" unless `STRICT_BAKE=1`.
Never run two at once: `test-twin-budget.js` and the bench share `bake/work`.

## 2. Files (twin-b/b7)

New: `shared/diag_settings.js`, `bench/test-diag.js`, `tools/twin-dial/run_all_tests.sh`. Changed (marked `// b7:`):
`shared/hud.js` (5 hooks: the require, the overlay in the constructor, the settings listener's first line, the hold at the top
of `_rebuildInner`, `release` in `stop()`), `shared/menu.js` (2 lines), `apps/twin_dial/app.json`, `apps/f30_cluster/app.json`.
Further integration edits are on `twin-b/integrate` only (R3B-INTEGRATION §4).

## 3. How to run

```sh
node bench/test-diag.js --unit            # the overlay, the wiring, the hold (seconds)
node bench/test-diag.js                   # + twin_dial and f30_cluster on the bench (BENCH_PORT, default 8607)
sh tools/twin-dial/run_all_tests.sh       # everything (about 30 min); RUN_ALL_PORT=8651 for a free port
node tools/research3/mp/measure.js twin_dial --quick       # the start-up bytes; BENCH_CONFIG='{"startupHold":false}' for 0.1.0's
```

## 4. Tests

`bench/test-diag.js` (59 unit + 41 bench on the integration branch): both apps' wiring; byte-for-byte restore after every
option; exact values (release, witness, scene textures, map keys); a build's own baseline kept while off; the hold (waits,
one timer, the limit, release, the blind state, which signals count); Node 8 syntax of the new file; the tab bridge
(integration); on the bench: Twin Dial's five settings change nothing that drops a layer, log `diag: <key> on|off`, the
status line counts them, BTN_DIAG opens DIAG, a saved setting is in force from the first build, `startupHold: false` gives
0.1.0's builds; f30: inert while off, the cover and the gap cut rebuild and are undone, the scene textures re-made as R8 and
back with no "pixel memory full", the release in place.

Full-suite results: R3B-INTEGRATION §5.

## 5. Open problems and what is not verified

- Nothing on a car: whether the HMI shows a `menu` screen reached from a button the way the bench's stub does; Cyrillic
  labels go through the kit's StringId path (the kit supports it; not seen on this car's HMI).
- The start-up hold's 1 s is a bench choice: on a car whose message list does not arrive at subscribe, every start waits 1 s.
- `ccDisplayed` (f30) needs a restart to take effect: by design of the subscription, said in the label.
- f30's `startupHold` stays off: one line in its app.json when wanted.
