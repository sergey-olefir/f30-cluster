# CA: the audit, nothing deferred is lost

Package CA of `docs/AGENT-BRIEF-car-signals.md`. Branch `car/ca`, from `main` at c1f53f2. No car, no push, no app change.
Data: `design/car/register.json` (the register), `design/car/register_fields.json` (its fields resolved against the
catalogue), the checker `tools/car/check_register.py`. Published early for CP, CL and CQ: `bake/work/car/pub/CA/`.

Evidence labels as in the brief: *arrives*, *arrives-other-app*, *not sent*, *unseen*. Statuses in the register:
`open`, `answered`, `partly-answered`, `needs-lead-decision`, `needs-owner-approval`, `out-of-session`.

## 0. In short

1. **The register has 91 items: 31 L, 21 P, 22 X, 17 F.** The brief's 34 are all there, 10 of them corrected; 40 items
   are new (found by the sweep). 13 items are answered or partly answered from material already in the repository or
   in saved car logs. `python3 tools/car/check_register.py` passes: ids, vocabularies, and all 170 distinct fields
   resolve in the catalogue with a usable flag and a real instance.
2. **23 of the 140 probe fields are already subscribed by the installed apps** (f30 0.7.20, Twin Dial 0.1.0). Their
   answers are in logs the lead can read before any install: statusActiveCCMessage, statusMenuCCMessage, ccList,
   ccListRiskClass, basicList, the three bord-computer fields, the range struct, UnitBN2020, playerMetadata,
   MediaSource (2), aggregatedCallState, guidingState, currentRoad, isOnGuidableRoad, the sign, FASuS next limit, two
   FES fields, the engine temperature, Vehicle2 displayed-cc (Twin Dial only). Section 3.
3. **No car log newer than 0.7.12 is on the Mac, and no photo of any of our builds newer than 0.7.7** (newest in
   `reference/ours/`: 2026-11-13). Every visual claim about 0.7.8 to 0.7.20 and Twin Dial 0.1.0 rests on the bench. F9
   (baseline photos at the start of the session) is the cheapest item in the register and everything compares with it.
4. **The brief's rule "never requestDefaultSymbols" contradicts the installed f30**: since 0.7.18 it calls the method
   once per run, 8 s after start (C3, decision D1).
5. **Two of the brief's counts were wrong**: the probe branches add 95 fields to main's 45, 140 on 59 interfaces, and
   P15 has 10 fields, P17 has 5 (C9). BS's black-box probe (4 more fields, never built) is missing from the brief.
6. **13 contradictions between reports** (section 6). Most important: the black box's rectangle (three values), MC's
   recommended release against SC's narrowing, and "ids seen so far 0, 15, 40, 987" where 40 is a bench value.

## 1. What was swept, and how

Read in full: the brief, MC, MK and MK-PROTOCOL, PROBE-PROTOCOL, VS, the commit notes 0.7.17 to 0.7.20 and 0.7.16.
Read by their open / hypothesis / "what the car must answer" sections: MB, MP, MT, SPEC-R3 (all "after probe" lines and
§12 to §16), SPEC rev 2 §15 to §19, the twin-r3 reports SB, SC, SD, SF, SM, SN, SP, SV, K1, K2 (branch `twin-r3/*`, copied
out with `git show`), boxes BC, BR, BS, the car reports CAR-SNAPSHOT, CAR3-G/H/I/J/K, CAR4-L, FEATURE-AUDIT, BOTTOM-ROW,
BAKE-REPORT, OVERLAY-PHOTO-PROTOCOL, PERF-AUDIT, PERF-NEEDLE, UI-NATIVE, ONE-SWITCH-DONE, POLISH-A/B/C/E/F, G20SIM-B/C/D and
the report, DRIVER-PROFILES-APP, the two untracked profile and key reports, the high-beam and update-failed reports
(branches), all twelve `docs/strip/*` reports (hypothesis lines), the R2 and V* Twin Dial reports (open sections).
Both apps' `app.json`: every string note matching unconfirmed / hypothesis / unseen / probe / not sent (30 notes).
`design/**/*.json` matched on the same words (one file: `design/twin-dial/vt/message_symbols.json`; the twin-r3 branch
JSON is probe and mockup data, covered through its reports). The saved car material: both apps' 0.7.12 logs,
car_vitals, cluster-render's journal, to confirm what "arrives" claims. The probe branches: the field lists of
`twin-r3/{sm,sp,sn,sv,sb}` diffed against main's `probe.json`.

Not read line by line: the Twin Dial reference-photo measurement reports (VC, VD, VG, VR, VT, R2-A1/A2/C/E, SD, SF, K1,
K2, the strip measurement tables) beyond their hypothesis and open sections; their open points that only a car photo can
settle are grouped as F14, F10 and F12. The old unmerged branches (`fix/*`, `strip/*`, `integrate/strip`,
`app/profiles-avatar`) are behind `main`: `git diff main integrate/strip -- docs` shows only deletions and a version
difference (0.7.18 against 0.7.20); I treated `main` as the truth and read their commit messages. `git log --all` since
0.7.12 was read for the car's own findings (0.7.16 to 0.7.20 notes, the 2026-11-17 owner log).

## 2. Corrections to §3 of the brief (10 items)

| Item | Correction |
|---|---|
| L4 | The grep matches 0.1.0's lines only; main's MK build writes `trip <source> (<field>) first at ...` and a summary instead. The parser reads both. |
| L6 | 0.1.0 logs `phone state raw (P9)` once per run, not per change. |
| L7 | The 0.1.0 line is `media text (P8): first line N characters, second M characters`. |
| L8 | `displayed cc: number N` is f30's line (main only); Twin Dial 0.1.0 shows the witness inside its cc lines. |
| L14 | The sign's line is `sign: ...` (config.sign), not `speed limit raw:` (config.limit is null). |
| P9 | 33 fields (aggregatedCallState, projectedTelephonyActive, SP's 31), not 32; two steps missing from the table: the wireless tray and the phone menu. |
| P15 | 10 fields on the branch, not 8. |
| P17 | 5 fields (consumption now and history, heading, position extras, service due), not 8; the consumption fields are not named in the brief's text. |
| F2 | SPEC §17.2 also asks for the day/night switch, the post-switch box photo and the wedge not reading purple. |
| F4 | The layout `diag_overlay` that the photo protocol needs was never built; the mattes of X16 replace it. The catalogue counts 9 unknown elements, not 6 lamps. |

## 3. What can be answered from logs before any install

The union of main's probe and the five branches is **140 fields, 59 interface names** (45 on main + SM 10 + SP 31 + SN
13 + SV 25 + SB 16; no field in two branches). `design/car/register_fields.json` lists each with its flags, ids and the
items that use it. The installed apps (assumed f30 = commit 95892f5, Twin Dial = 82927e5; decision D8 asks the lead to
confirm from the manifests) already subscribe to **23** of them (listed in section 0). So L1 to L8, L13, L14, L21, L25 and
L26 can run first. Twin Dial's main differs from 0.1.0 by four fields (MileageSupreme, ResetLogic3, SecureMileage,
VehicleInformation.Range); f30's main by one (Vehicle2.statusDisplayedCCMessage): the MC and MK builds are on main only.

Reading order I recommend for the lead (read-only, `collect.sh`): the surviving f30 log (0.7.18 to 0.7.20, rotating to
`.log.1`: the 40-line caps of `probe:` and `check-control list:` make this the most perishable) for L13, L25, L1, L2, L14,
L15, L17 to L21; then twin_dial.log for L4 to L8; then cluster-render's journal and status for L9 to L12, L24, L27.

## 4. Items the brief missed (40, by kind)

**L (logs, 16):** L16 clock primary source (answered), L17 MSA and READY, L18 vehicle-condition values, L19 drive-mode
changes, L20 the six speed-limit settings notifiers, L21 road label and navigation lines, L22 DME boost over UDS,
L23 the opt-in perf log (a data-folder write), L24 KOMBI resets with the 0.7.16 night looks, L25 ccList (id, symbol,
colour) pairs, L26 message auto-hide timing, L27 BR's E0 slot rows when the box shows, L28 the status socket against
status.txt, L29 dropped-layer uploads, L30 newCCMessage (not sent, answered), L31 UPDATE_FAILED (answered).
**P (signals, 4):** P18 black-box signals (BS: basicConfigKombi, statusWelcomeAnimation, dataDisplayGearboxSecure,
Dialog.dialogState and the 11 already named), P19 f30's unwired gap signals (indicators, belts, lights, dimmer, consumption,
Eco Pro range and driving style), P20 the high-beam camera (not a field: events only), P21 events worth a named exception.
**X (experiments, 11):** X12 gearCover (D10), X13 re-mapping by hand and Waze's HUD map, X14 slot logging and reseat, X15 the
cluster-render configuration experiments (needs approval), X16 the diagnostic mattes, X17 the Visible property on rows,
X18 to X20 Driver Profiles (read, write, avatar), X21 high-beam diagnostic reads, X22 the cluster coding read.
**F (photos, 9):** F9 baseline photos, F10 stock G20 gaps, F11 bottom-row guesses, F12 bake open questions, F13 pre-0.7.12
owner checks never reported back, F14 the facelift tachometer geometry, F15 smooth needles, F16 digital key, F17 the box in
Sport / Eco Pro and the stalk and headlight photos.

## 5. Already answered, or partly (13)

| Item | Answer | Where |
|---|---|---|
| L12 | cluster-render client 0.5.12 on 2026-11-15; confirm nothing updated since (0.6.6 is offered) | `reference/car/2026-11-15/cluster-render/` |
| L16 | `timeDateUTC` arrives, its offsets are "not available": the fallback L3 is the only clock source | commit 209a115 |
| L30 | `newCCMessage` never sent (25 minutes, messages showing): *not sent* | commit 209a115, VS §2.1 |
| L31 | the Store failure was getter id 0 on six "r" fields; 0.7.17 fixed it | `docs/UPDATE-FAILED-REPORT.md` (branch), commit 7c405b6 |
| L10 | cap and per-asset writes for the 0.7.12 era are in the saved journal | CL parses them |
| L11 | BMW's map was foreground in 0x100 for 7986 of 8000 s under f30's panel; the Twin Dial era has no journal | SN §1.2 |
| L19 | COMFORT_PLUS at start (2 starts), SIGNAL_UNBEFUELLT and INITIALISIERUNG unmapped values; a mode change was never in the saved logs | `f30_cluster-0712.log` lines 151, 1409 |
| L21 | currentRoad and guidingState arrive in f30 (shapes not recorded) | VS |
| L25 | seen: id 0 GREEN symbol 6, door id 15 WHITE symbol 2, stored id 987 | commits 209a115, 95892f5 |
| P6 | coolant raw minus 48 C arrives (car_vitals [126,123]); only the car's verdict is unseen | car_vitals |
| P16 | tyre pressure, temperature, target, boost at rest arrive through getters (*arrives-other-app*) | car_vitals |
| F7 | the stock media list is on photo 17; no phone-pad photo | `reference/g20/17` |
| F12 | item 20: 6WB Comfort runs 21 layers on the car, so sampled assets do not count as layers | PERF-NEEDLE:146 |

Evidence summary of what is *arrives*: fuel and range (the struct, not its mileage member), coolant and oil raw, gear
and drive mode at start, ccList (live), timeDateUTC (offsets unavailable), road and guidance state, tyres and boost
(another app). *Not sent*: newCCMessage. Everything else in P1 to P17 is *unseen*.

## 6. Contradictions between reports (13)

Full text with sources in `register.json` (`contradictions`). The ones that change a decision:

- **C1 the black box's rectangle**: [1420, 320, 1611, 440] in `shared/visible.js`, BAKE-C9, SPEC-R3 §12; [1406, 342,
  1597, 419] in MB (which cites visible.js wrongly), SN, K1 and the upstream draft; a third value in the overlay catalogue.
  visible.js says the second is the X3's. MB's geometry replay used it.
- **C3** the brief against the installed f30 (above).
- **C7** MC's "ids seen so far 0, 15, 40, 987": 40 is a bench value (`bench/test-bottom-row.js:1033`).
- **C8** MC's recommended release (wider `leftList`) against SC's narrowing; do not install "rec" unchanged.
- **C2** MB "twice" against MP "3 builds at start".
- **C4** FEATURE-AUDIT §6.1 against SB (the stalk is in the catalogue).
- **C5, C6** BR's slot finding as quoted by the round-3 brief, and the 0x1000400 history of CAR3-K / CAR-SNAPSHOT, are
  corrected by SN and BR §7; the two documents on `main` still carry the older reading.
- **C9 to C13**: probe counts, the sign disc position, the 0.7.18 results, fonts, colliding item numbers.

## 7. Facts the lead should have before choosing the sets

- Catalogue check (the checker): `RecogFrontCameraLightDetection` has no readable field, only events; my first draft of
  P20 named an event as a field. P20 is therefore a `_broadcasts` question (D2, D4).
- `Positioning` is two interfaces with one short name; the probe uses the navigation one (`...navigation.positioning`).
- `CarPlayManager` is read on instance `CarPlayManagerInst1`, `Telephone` has two instances and the probe reads the first,
  `Call2` is not read: instance choices are CP's table (§4.3 of the brief), the register carries `@instance` for each.
- 0.7.12's log shows the SDK's own `CurrentVehicleUnits` proxy failing (`envInfoProxy` undefined) although f30 declares
  `EnvironmentalInformation`; that is the SDK's proxy, not evidence about `UnitBN2020` (P5).
- X2 to X10 need builds that do not exist or are not installed: mbCover, mbGap, mbRebuild, sceneTex are on main only; the narrowed
  release (X7), Twin Dial 0.1.1 (X8, X10), the `mapWindow` and `mapSlots` keys (X6), `gearCover` (X12) are not written.
- Perishable: f30's log caps (40 lines per `probe:` field, 24 `sign:` lines, 40 `check-control list:` shapes) and its
  rotation; read before the session adds noise.

## 8. Decisions asked of the lead

D1 requestDefaultSymbols; D2 which events; D3 add S10 and S11; D4 P20; D5 CarPlay or Android Auto; D6 the two data-folder
writes (L23, X14); D7 which builds exist before the session; D8 which Twin Dial build is installed; D9 keep the
profile, key and coding items out of the signals session (X18 to X22, F16). Text in `register.json`.

## 9. For the other packages

- **CP**: the sets are `S1` to `S12` in `register.json` (`sets`); `P` items carry fields with `@instance`; use
  `register_fields.json` for flags and ids. Use 140 + 4 fields for the load estimate. P3 to P5, P10 need custom
  formatters (voltage member only; textual members as lengths).
- **CL**: `L` items carry the grep shapes (`steps`), `status` and `answer` per item; the shapes for the two Twin Dial
  versions differ (L4, L6 to L8). The decision tables to implement are in MC §6, MK §7 and MK-PROTOCOL, SB §3.3, SM §6, SP §5.2,
  SN §3.1, SV §5. L10 to L12 and the car_vitals facts can be answered today from `reference/car/2026-11-15/`.
- **CQ**: the order that saves installs is in the `needs` and `set` fields: L (no install) first, then F9, X1 (no build),
  X13, X16, then the probe sets, then drive items (P12, P15 to P17, L17, L22), and the builds that do not exist
  yet last; items marked `needs-owner-approval` or `out-of-session` never enter the session.

## 10. Method, limits

The register was written from the documents, not from the car; "answered" means a repository file or a saved log says so,
cited per item. Status `open` does not mean nobody saw it: owner remarks that never reached a commit note are lost
(for example Twin Dial 0.1.0's first runs and the owner's answers to the pre-0.7.12 checklists, F13). `check_register.py`
verifies fields, not the prose. Branch material was read from `git show`; nothing was checked out, nothing merged.
