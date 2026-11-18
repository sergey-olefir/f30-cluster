# CF2 — the speed limit and cruise from the real sources (Twin Dial and f30_cluster)

Branch `car-fix/2` from `twin-b/integrate` (b10b8e4), worktree `.claude/worktrees/cf-2`. Brief: `docs/AGENT-BRIEF-car-fix.md` §0 and §2 CF2. No version bumped, nothing pushed.

## 1. What changed

| File | Change |
|---|---|
| `shared/limit_src.js` (new, 18.9 kB) | The shared decoder. `tsrOf` (the TrafficSignRecognition event → the engine's sign shape), `camOf` (the camera's event → a witness), `hudCruiseOf` (DisplayDataServer → twin_limit's cruise reading), `create()` (the merger of the sources, with its `limit:` log lines), `events()`. |
| `shared/hud.js` | Two hunks marked `// car-fix CF2:`. 1) An optional `require('./limit_src')`, the same pattern as twin_limit. 2) In the bottom-row block, the sign handler becomes `applySign`. config.sign's field goes through the merger, and `limitSrc.wire(extra, applySign)` subscribes the events. `hud.sign`, `limitState`, `limitKmh`, `nopassOn` and the `sign:` log line are set exactly as before. |
| `shared/twin_limit.js` | `wire()` also chains behind the TSR event (so the sign repaints when the event arrives) and behind `DisplayDataServer.functionalLibraryData` (`onHudCruise`). `cruiseNow()` uses the HUD feed's reading once it has arrived; the TrafficSignDisplayControl struct is the fallback until then. |
| `apps/twin_dial/app.json` | Declarations (§3). `limit_src.js` is added to `shared`. `config.sign` gains `tsr`, `camera`, `order` and `_tsr` (key for key the same as f30). **`config.cruise` = `{ "place": "C1" }`** (it was `null`). `config.limit.strip` is still `"L1"`. |
| `apps/f30_cluster/app.json` | The two event declarations, `limit_src.js` in `shared`, and the same `config.sign` additions. Nothing else changed: f30 draws its sign as before; only the source behind `hud.sign` is new. |
| `bench/fake-signs.js`, `bench/run-app.js` | The bench can feed the event: `POST /fake { tsr: { cls, warn, unit, withdrawal, next } }`. The event is built through config.sign.tsr's paths with all 16 outputs. |
| `bench/test-twin-limit.js` | New `srcChecks()` plus engine sections for the event and the HUD cruise. The declaration checks are updated, and the old "cruise null" checks now set `config.cruise = null` themselves. |
| `bench/test-bottom-row.js` | An f30 block for the event: class → km/h, warn, mph, event-vs-field order, fallback, and the log lines. |

## 2. Decisions

**The limit (both apps)**
- Limit = `presentClassLimitSpeed × 5`, in the event's own unit.
- These classes give **no sign** (state `none`): **0**, **29**, **253**, **254** and **255**, plus anything outside config.sign's 5..250 km/h and anything that is not a number.
  - 29 is added to the brief's list because FASuS's `NextClassLimitSpeed` enum names it `GONG_ANFORDERUNG_SPEED_LIMIT_WECHSEL` (a chime request, not a speed). Without this, ×5 would draw a 145 sign. This is a hypothesis from the catalogue.
  - 0 is `none` as the brief says, not the derestriction sign. The enum calls it `AUFHEBUNG_ALLES`; `config.sign.tsr.end` can move it to the end sign later.
- `presentWithdrawalLimitSpeed` is logged only. Its enum: 1 = BESCHRAENKUNG, the value the car sent all the time; 2 = AUFHEBUNG. `config.sign.tsr.endOn` (empty) would turn a 2 into the end sign once the car shows one.
- `controlSLIWarning` 1 → `warn 1`, 2 → `warn 2`, anything else → 0. "1 = over the limit" is the brief's hypothesis; it feeds `u_lim.z` and f30's `_arcOn` the way `displaySpeedLimitWarning` did.
- **Unit:** `unitOfMeasurementSpeedLimit` 1 means mph (FASuS's `UnitOfMeasurementSpeedLimit`: 0 KM_S_H, 1 MPH, 2 n/a, 3 invalid). Any other value means km/h. Nothing else in either app reads the car's units for the limit.
- **Order and fallback** (`config.sign.order: ["tsr", "field"]`, `staleMs: 3000`):
  - The first source that is *live* wins. Live means it has said something other than "none" and, for the event, said it within 3 s (the event comes about twice a second).
  - If no source is live, the newest reading of any source is shown; if nothing has arrived, nothing is shown.
  - On the owner's car the field never comes, so the event is the sign. On a car that sends both, the event leads and the field takes over when the event goes quiet or says 255.
  - Limitation: the field is notifier-only, so the switch to the fallback happens on the next field notification (or the next event), not on a timer.
- **Opt-in:** the event is subscribed only when `config.sign.tsr` is an object. Any other app with a `config.sign` (none today) subscribes nothing new.
- **Camera witness** (`config.sign.camera`):
  - The first `SPEED_LIMIT` sign of `trafficSign[]` gives `value`; the unit comes from `trafficSignRecognition.speedLimitUnit`.
  - Logged as `limit: camera 40 kmh` and `limit: camera 40 km/h, tsr 40 km/h agree` (or `differ`). Never drawn.
  - An event without a speed-limit sign is ignored and not logged, because it may come often.
- **Log** (numbers and enum names only; a word that is not an enum is logged as `text<length>`; at most 200 lines, one per change):
  - `limit: tsr class 8 -> limit 40 kmh warn 0 (warn raw 0, withdrawal 1, unit raw 0, next class 254)`
  - `limit: source tsr (TrafficSignRecognition event)` and `limit: source field (TrafficSignDisplayControl)`
  - the camera lines above
  - twin_limit's own `limit: limit 40 kmh (40 km/h) conditional no warn 0` stays.

**Cruise / limiter (Twin Dial)**
- `config.cruise = { place: "C1" }`. The source is `DisplayDataServer.functionalLibraryData`:
  - `cruiseCtrlSpeedHUD` = the set speed in km/h.
  - `ldmSym` gives the symbol: `LDM_SYM_DCC*` = cruise; `LDM_SYM_SLD*` (7..12) = limiter; the ACC / STA / ASSIST / ASSIST_PLUS family = adaptive cruise (unseen on this car); NONE, HDC and EDP draw nothing.
  - `ldmSymColor` `LDM_ACTIVE` = green with the green marker (`u_cru`). Any other colour (OFF, STANDBY, overridden, critical, brake-only) = grey with no marker.
  - **Set speed 65535 or 0, or `LDM_SYM_NONE` = nothing at all.**
- Enums are read as names or numbers. Each meaning is a key (`symMap`, `activeOn`, `hudInvalid`, `hudMph`), so the next car session can correct one line.
- **Unit:** km/h. The owner's car showed 61 / 59 / 40 in km/h. `config.cruise.hudMph: true` would read mph; there is no unit field in the feed.
- The TrafficSignDisplayControl longitudinal struct stays declared and logged. It is used only until the HUD feed first arrives, and it has never arrived on this car.
- The feed also carries rpm and speed, so it arrives often. The handler does one small decode, and the log line names only `ldm`, `colour`, `speed` and `limiter`, so a repeat with a changing rpm writes nothing and sends nothing (tested).
- FASuS `ldm-guidance` is not used: its `setSpeed` is encoded, not km/h (brief §0).

**f30_cluster**
- Only the source behind `hud.sign` changes. `signOf`, the drawing, holdMs, `_signShow` and `_arcOn` are untouched. f30 now shows a limit on this car wherever its sign was drawn before.

## 3. Declarations added (`tools/signals/check_signals.py` passes for f30_cluster, driver_profiles and twin_dial)

| App | Interface | Declaration | Catalogue |
|---|---|---|---|
| both | `de.bmw.dass.TrafficSignRecognition` | `_instances "1"`, `_broadcasts ["TrafficSignRecognition"]` | event 32769, service 13632 |
| both | `de.bmw.environmentalmodel.SignRecognitionFrontCamera` | `_instances "1"`, `_broadcasts ["TrafficSignRecognitionFrontCamera"]` | event 32769 |
| twin_dial | `de.bmw.infotainment.displaydataserver.DisplayDataServer` | `_instances "1"`, `functionalLibraryData "rs"` | getter 1 (non-zero), notifier 32769; `codingData` not declared |

Only the two events named in brief §0 are declared under `_broadcasts`. There is no setter, no method and no `w`. f30 does not declare the HUD feed because it draws no cruise.

## 4. Budget impact

- **Layers (Twin Dial):** `cruise_c1` (140 × 70 image sheet, connection 2, z 12) is now built at start. In the engine test the connections hold `{0: 7, 1: 4, 2: 3}` with everything on, still ≤ 8 each.
- **Pixel memory (Twin Dial):** + 76.6 KiB (140 × 70 × 4, counted twice). The sign sheet (66 KiB) was already there. Steady memory stays far below 6 MiB.
- **Shaders:** no change. `u_cru` already exists in `tdial` (B1), so no shader byte is added.
- **f30_cluster:** no layer and no pixel memory added.
- **Subscriptions:** twin_dial + 3 interfaces (two events and one field); f30 + 2 (two events).
- **Rates:**
  - TSR: about 2 notifications a second. Each one decodes one struct and does a string compare, with no repaint or uniform unless something changed.
  - Camera: rate unknown. Only a speed-limit sign is decoded.
  - DisplayDataServer: rate unknown, probably high because it carries rpm. One decode and a string compare per notification.
- **Package:** + 18.9 kB of JavaScript (`limit_src.js`) in each app.

## 5. Tests (each run alone, ports 8921 / 8922)

- `run_all_tests.sh --only twin-` (the 12 Twin Dial suites, one after another): **ALL GREEN, 1741 passed, 0 failed**. twin-bake 37, twin-budget 95, twin-cc 249, twin-centre 163, twin-fonts 327, twin-layout 106, twin-limit **222** (B5 had 157), twin-pages 100, twin-probe 115, twin-sim 39, twin-tabs 199, twin-trip 89. Every count except twin-limit equals the R3B integration run.
- f30 suites run alone: `bottom-row` **264 / 0** (main 254 + 10 new checks for the event), `probes` 25, `native-ui` 47, `daynight` 24, `cc-release` 57.
  - The first bottom-row run had one timing failure in the cc frame-counter check ("frame 2 of 3 ... holds it"), which does not touch the sign. It passed on the rerun alone; R3B-INTEGRATION reports the same kind of timing flake.
- `check_signals.py` (f30_cluster, driver_profiles, twin_dial): all declarations pass.
- Mutation checks:
  - Unwiring the events in hud.js and ignoring the HUD reading in `cruiseNow` makes 19 twin-limit checks fail.
  - Before the bench could route `tsr` (so the event never reached the app), all of the new f30 checks failed.
- Not run by me: the full `run_all_tests.sh` (bake-py, driver-profiles, night, scene-tex, strip-mask, mb-exp, diag, fonts). That run is the lead's.

## 6. Open / for the lead

- The full run (`run_all_tests.sh`) is the lead's. §5 lists what I ran.
- To confirm at the next car session, all from the `limit:` lines:
  - `unit raw` is 0 (km/h).
  - `warn raw` goes to 1 when over the limit.
  - Whether `withdrawal 2` and class 0 come with a derestriction sign.
  - Whether the camera agrees.
  - The DCC / SLD colours with the cruise suspended (LDM_OFF vs LDM_STANDBY), and the adaptive symbol if the car has ACC.
- CF1 also touches `shared/hud.js` and both `app.json` files. My hunks are in the bottom-row sign block and the require list at the top; in app.json they are new interface entries, `shared` and `config.sign` / `config.cruise`. The merge should be mechanical.
