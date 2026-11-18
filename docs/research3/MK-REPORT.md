# Research round 3, package MK: Twin Dial's empty trip page, the odometer and R1

Branch `research3/mk` from `main` (`82927e5`), worktree `.claude/worktrees/r3-mk`. No car, no push, no version bump.
The owner's protocol is `docs/research3/MK-PROTOCOL.md`.

## 0. The answer in four lines

1. **The empty trip page of 0.1.0 is by design, and it says nothing about the car** (verified, code). With
   `config.trip.factors` null (the shipped state) `tripValues` returns null for all five values **before it reads any
   field**, so the page is all dashes whether the car sends the fields or not. R1 is always the range for the same reason.
2. **Whether the car sends the fields is unknown** (no Twin Dial car log exists on this Mac: `bake/work/` and
   `reference/car/` searched, nothing). But 0.1.0 already logs `trip average|travel|departure raw (P4): …` on each
   change of each field and `odometer raw (P3): …`, so **the log the owner already has answers the main question**: grep it
   first. What 0.1.0 cannot tell is *why* a field is missing: the kit swallows getter errors and there is no summary.
3. **On this branch (the owner's decision of 2026-11-18): the most likely factors are on by default**, each value is
   logged UNVERIFIED on its first arrival, a summary after 2 and 10 minutes names every silent source and asks its getter
   once (read only), and every value has a fallback chain (KombiIF, then the head unit's ResetLogic3; the odometer over
   four carriers). A dash is left only for a value no source sends or whose every source sends its invalid marker.
4. **A second build** (the existing probe build, widened) listens to every other trip carrier the catalogue has
   (ResetLogic, ResetLogic2, BcPersonal, LSCDataSink) for the case where the MK build's summary says KombiIF and
   ResetLogic3 are both silent.

## 1. Method

| What | Command | Result |
|---|---|---|
| Path through the code | read `shared/twin_tokens.js`, `shared/hud.js` (`_setupVehicleData`), `kit/runtime/car.js`, `kit/runtime/signals.js` at `82927e5` | section 2 |
| Car logs | `grep -rl "trip average raw\|odometer raw\|P4)" bake/work reference` and `find bake/work reference -name '*.log'` | none for Twin Dial (only bench logs of round 2 under `bake/work/twin-dial/r2/E/`) |
| Provider evidence on the car | `grep -ril "resetlogic\|bordcomputer\|bcdata" reference/car/2026-11-15/{logs,oap,processes,system}` | none: no process, journal or app log names a trip provider |
| Catalogue | `python3 -I tools/twin-dial/vs/survey.py <catalogue> --fields tools/research3/mk/fields.json` (output, BMW names: `bake/work/research3/MK/fields.txt`) and `python3 -I tools/research3/mk/candidates.py <catalogue>` | `design/research3/mk/candidates.json`, section 3 |
| Declarations | `python3 -I tools/signals/check_signals.py <catalogue> apps/twin_dial/app.json`, `python3 -I tools/twin-dial/probe_build.py check`, and the probe block alone | all pass (normal, probe, probe block) |
| Unit tests | `node bench/test-twin-trip.js` (new), `node bench/test-twin-pages.js`, `node bench/test-twin-probe.js` | 82 / 101 / 115 passed, 0 failed |
| The real app on the bench | `node tools/research3/mk/bench_trip.js` (port 8305, its own bench tree, summaries shortened to 25 / 45 / 65 s), run twice | `design/research3/mk/bench-trip.json`, section 4.3 |
| Packing | `kit/tools/build.py twin_dial` in a bench tree with the stub SDK, normal and probe | both pack: 1 656 839 and 1 657 372 bytes (stub SDK: never ship) |
| Regression | all 16 suites under `bench/` | section 5 |

## 2. The path from the three fields to the page (step 1)

| Step | 0.1.0 (`main`) | `research3/mk` |
|---|---|---|
| Subscribed? | yes: `app.json` declares the three KombiIF fields `rs`; `config.twin` makes `_setupVehicleData` call `twin.wire(hud, extra)`; `Car` watches every interface in `extra`; the kit calls each getter once when the provider is available (`signals.js fetchAll`) and subscribes the notifier | same, plus ResetLogic3.bcDataAll `rs`, MileageSupreme `rs`, VehicleInformation.Range `s`, SecureMileage `rs` |
| Handler | stores `td.avg / td.travel / td.start` | same, plus units, ResetLogic3 (`td.rl3`), the odometer carriers (`td.odo`) |
| Log on arrival | `trip <what> raw (P4): n,n,n` **on every change**, no throttle, no factor, no "unverified" | `trip <source> (<field>) first at T s: raw <member=n …> -> <what the page shows> [UNVERIFIED: compare with the car's trip page]`; afterwards a changed value at most once a minute, at most 30 lines per source |
| A getter that fails | `p.getValue(f).catch(() => {})` in `kit/runtime/signals.js`: **silent**, no line | the summary asks each silent source's getter once more and logs `answered` / `error or no answer: <msg> (the car does not send it)` / `provider not available` / `watch error: …` |
| Silent field | nothing in the log ever says so | `trip summary #n at T s: heard …; SILENT …` at 2 and 10 minutes |
| Value on the page | `tripValues`: `if (!factors) return out` (all null) → **every value a dash** | factors default to bc 1, speed 0.1, cons 0.1, way 0.1 (rl3: 0.1 each); per value the first source of `config.trip.order` with a valid value wins |
| Dash | always (factors null) | only: silent, or every source carries its marker (KombiIF averages 4095 / 65535, way 65535, hours 4095, minutes 255, departure hour ≥ 24 / 255; rl3 65535 / 0xFFFFFFFF / hour 255), or `config.trip.factors` = false (kill switch) |
| Odometer | `mileageKilometre` × 1 if 0 ≤ m < 16 777 215, else dash; logged on every change | first valid carrier of `config.odometer.order` (rangeTank, supreme, range, secure); 0 and ≥ 16 777 215 = no value; MileageSupreme only with qualifier AVAILABLE / REDUCED |
| R1 | always the range (factors null) | the trip distance whenever a source delivers one, else the range |

So step 1's question "can the shipped build tell silent from unscaled?" has two halves. **Arrived vs not: yes** (the P4
lines exist in 0.1.0). **Silent vs refused vs no provider: no**. The MK build adds the missing half (verified on the
bench, section 4.3, and in `bench/test-twin-trip.js` section 6).

## 3. Candidates from the catalogue (step 2)

All from the 2026-11-15 catalogue (`design/research3/mk/candidates.json` has every row with its "how one reading tells").
The catalogue states **no unit** for any of these members: every scaling below is a **hypothesis**.

| Value | Field (getter / notifier) | Member, type | Most likely scaling | One reading against the car's trip page tells |
|---|---|---|---|---|
| Average consumption | KombiIF.statusBordcomputerAverage (2 / 32770) | consumptionAverage1BC1, …2BC2, UInt16 | 0.1 l/100 km | raw 68 for 6.8 → 0.1; 680 → 0.01; 7 → 1. Unit enum must be 1 (l/100 km) |
| | ResetLogic3.bcDataAll (7 / 32775), fallback | bcData3.consumptionCombustionAverageDigit / …Scale, UInt16 | Digit = the number in 0.1; Scale = the bar position (maxValues is its full scale) | Digit / shown = 10 → 0.1; Scale follows the bar, not the number |
| | ResetLogic2.bcDataAll (1 / 32769), ResetLogic.bcDataAll (1 / 32769) | Digit/Scale; consumptionAverage | as above | probe build only |
| | LSCDataSink.dataCombinedInstrumentCluster (– / 32772), BcPersonal.driveSegment (1 / 32769) | averageRangeConsumption; bcBeConsFuelVisible | unknown (range computer; per segment) | probe build only |
| Average speed | KombiIF.statusBordcomputerAverage | speedAverage1BC1, …2BC2, UInt16 | 0.1 km/h | raw 410 for 41 → 0.1; 41 → 1 |
| | ResetLogic3 (fallback); ResetLogic2, ResetLogic, LSCDataSink.averageSpeed, BcPersonal.bcBeSpeedAvgDrive (probe) | speedAverage UInt16 … | 0.1 km/h (BcPersonal: 1) | same |
| Distance | KombiIF.statusBordcomputerTravelData (5 / 32773) | wayPassed, UInt16 | 0.1 km (caps at 6 553.5 km) | raw 124 for 12.4 → 0.1; 12 → 1 |
| | ResetLogic3 (fallback) | bcData3.counterDistance, **UInt32** | 0.1 km, but metres are possible (the widest type) | raw 12 400 for 12.4 → 0.001; the log's cross-check catches it (section 4.2) |
| | BcPersonal.driveSegment (probe); Guidance.travelledDistance (only while guided, not used) | bcBeTripDistanceKm | 1 km | |
| Driving time | KombiIF.statusBordcomputerTravelData | rideDurationHours UInt16, rideDurationMinutes UInt8 | plain h, min | h:mm equal; minutes > 59 would be total minutes (carried) |
| | ResetLogic3 (fallback) | dateTimeTrip {day, hour, minute} | plain | day × 24 + hour : minute |
| Departure | KombiIF.statusBordcomputerTravelStart (6 / 32774) | hourDepartureBC, minuteDepartureBC UInt8 | plain, **local or UTC unknown** | equal → local; off by the zone → `config.trip.departureUtc` = ["kombi"] |
| | ResetLogic3 (fallback) | bcData3.dateTimeReset {hour, minute}, only while resetOption = STARTOFDRIVING (4) | as above | as above, ["rl3"] |
| Which counter | KombiIF suffix 1 / 2; KombiIF.statusBordcomputerStatus2 (4 / 32772, probe) | BC1 / BC2 | bc 1 | the iDrive page whose averages match speed1/cons1 or speed2/cons2 |
| Odometer | KombiIF.statusRangeTankStatus (29 / 32797) | mileageKilometre UInt32 | 1 km | equals the cluster's odometer |
| | MileageSupreme (1 / 32769), VehicleInformation.Range (– / 32770, notifier only: arrives only when it changes, i.e. after 1 km), SecureMileage (1 / 32769) | UInt32 | 1 km | same |
| | VehicleModel.MileageVehicle (– / 32776) | UInt16 in a CRC / alive frame | not a usable odometer | not used |
| R1 | KombiIF.statusRangeTankStatus | range UInt16, 4095 = none | km (**verified**: f30_cluster draws it on this car) | — |

Where the providers live (hypothesis): KombiIF (46363), like Vehicle (46352) and CDS (46355), is the vehicle side whose
other fields arrive on this car (fuel, range, coolant, the clock). The ResetLogic services (45128 / 45133 / 45134) sit in
the 45xxx range with the head unit's own services (HmiMediaState 45181, ConnectivityAggregator 45131); the head unit's
iDrive trip page is most likely fed by one of them. So **if the car's own iDrive trip page shows numbers, one ResetLogic
generation very probably has a provider** even if KombiIF's trip fields are silent; this is why ResetLogic3 is the
fallback and the other two are in the probe build.

## 4. The two builds (step 3)

### 4.1 Build 1: the normal build on `research3/mk`

`apps/twin_dial/app.json` + `shared/twin_tokens.js`. Nothing else of the engine changes; `twin_tokens.js` is packed only
by Twin Dial (f30_cluster's `app.json` does not list it).

| `config` key | Default on the branch | What it does |
|---|---|---|
| `trip.factors` | `{ bc 1, speed 0.1, cons 0.1, way 0.1, rl3 { speed 0.1, cons 0.1, way 0.1 } }` | the unit of each raw integer; a key left out keeps its default; `false` = dashes (kill switch) |
| `trip.order` | `["kombi", "rl3"]` | per value, the first source with a valid value wins; `["kombi"]` also stops subscribing ResetLogic3 |
| `trip.departureUtc` | `[]` | sources whose departure is UTC are moved into the car's zone (dash while no zone is known, never a wrong time) |
| `trip.verified` | `false` | `false`: each source's first line says UNVERIFIED |
| `trip.summaryMs` | `[120000, 600000]` | when the summaries run |
| `odometer.factors` | `{ rangeTank 1, supreme 1, range 1, secure 1 }` | km per bit per carrier |
| `odometer.order` | `["rangeTank", "supreme", "range", "secure"]` | the carrier chain; a carrier not listed is not subscribed |
| `odometer.verified` | `false` | as `trip.verified` |

A wrong factor is one line of `app.json`, no code. Cost: **+3 interfaces, +4 fields** (14 → 17 interfaces, 27 → 31
fields), i.e. three more `buildProxy` at start (serialised in `signals.js`; MP measures the start-up). All read only,
all `r` with a non-zero getter (ResetLogic3 7, MileageSupreme 1, SecureMileage 1); Range is `s` only.

### 4.2 What the log says (numbers, field names, enum names only)

1. **First arrival, one line per source**, with the raw members that decide a factor and what the page shows:
   `trip average (statusBordcomputerAverage) first at 26.8 s: raw speed1=410 cons1=68 speed2=520 cons2=55 speedUnit=0 consUnit=0 -> speed 41.0 km/h, cons 6.8 l/100 km (BC1) [UNVERIFIED: compare with the car's trip page]`.
   Later changes: at most once a minute, at most 30 lines per source (0.1.0 logged every change: a driving average
   changes every few seconds).
2. **Summary at 2 and 10 minutes**: which source spoke (count, first time) and which is SILENT; what each value shows
   and from where (`[kombi]`, `[rl3]`) or why it is a dash (`[silent]`, `[invalid]`, `[factors off]`); the factors and
   UNVERIFIED; the odometer and its carrier.
3. **Plausibility**: `trip check: OUT OF RANGE speed 410 …` when a shown value leaves its range (speed 0–250, cons
   0–99.9, distance 0–99 999, odometer 1–2 000 000) — the value is still shown, never hidden; and **per source**
   `trip check [kombi]: distance / time = 17.3 km/h, average speed 41.0 km/h, ratio 2.37 -> consistent`. A ratio above
   5 or below 0.2 says "a factor is about 10x off": the first drive can catch a wrong factor **without** the iDrive page
   (verified in the tests: rl3 in metres read as 0.1 km gives ratio 0.01).
4. **Getter lines** for each silent source with a getter: `answered (object): the notifier is silent, the getter is not`
   (the answer is then used like a notification), `error or no answer: <msg> (the car does not send it)`,
   `provider not available (the interface itself never came up)`, `watch error: <msg>`.

### 4.3 On the bench (the real app, `tools/research3/mk/bench_trip.js`, two runs)

| Phase | What the bench fed | What the app logged (both runs) |
|---|---|---|
| A (0–25 s) | odometer 48 215, no trip field | `odometer raw (P3): 48215 -> 48215 km (factor 1 km) [rangeTank, first at 0.3 s, UNVERIFIED …]`; summary #1: `heard rangeTank; SILENT supreme, range, secure, average, travel, start, rl3`; every trip value `[silent]`, odometer `[rangeTank]`; getter lines for the six silent sources with a getter |
| B (25–45 s) | KombiIF's three structs (tenths: 41.0 km/h, 6.8, 12.4 km, 0:43, 14:00) | three first-arrival lines with UNVERIFIED; summary #2 `cons 6.8 [kombi], speed 41 [kombi], distance 12.4 [kombi], time 0:43 [kombi], departure 14:00 [kombi]`; `trip check [kombi]: … ratio 2.37 -> consistent` |
| C (45–65 s) | the same structs with their markers (4095 / 65535 / 255) | summary #3: every trip value `[invalid]`, the odometer still `[rangeTank]` |

Spread over the two runs: the same lines in every phase (14 / 9 / 5) once counts and times are masked; first arrival
at 26.8 s and 26.7 s; rangeTank heard 485 times by summary #1 in both; the only textual difference is that run 1 predates
the per-source tag (`trip check:` became `trip check [kombi]:`, same numbers). No uncaught error in either run. Two bench limits, said plainly: the bench's fake head unit has no proxy for KombiIF
(its getter line reads `no proxy`) and no provider for ResetLogic3 / MileageSupreme / SecureMileage (`provider not
available`); on the car the kit's watch returns a real proxy, so those lines become `answered` or `error or no answer`.
Timings are bench timings (the bench feeds the range struct every 50 ms; the car notifies on change).

### 4.4 Build 2: the probe build, widened

`python3 tools/twin-dial/probe_build.py on` (unchanged mechanism) now also declares and logs, under P4:
ResetLogic.bcDataAll and .averageConsumption, ResetLogic2.bcDataAll, BcPersonal.driveSegment (numbers only: no time
stamps, no start odometer) and LSCDataSink.dataCombinedInstrumentCluster (`s`). 40 → 45 probe fields; 30 interfaces /
57 fields when merged. `check_signals.py` passes on the block alone and merged; `test-twin-probe.js` 115 / 0.
It is for one case only: the MK build's summary says KombiIF and ResetLogic3 are silent.

## 5. Tests and regression

| Suite | `main` | `research3/mk` |
|---|---|---|
| f30: bottom-row / native-ui / strip-mask / fonts / probes / daynight / night | 254 / 47 / 40 / 34 / 25 / 24 / 48 | 254 / 47 / 40 / 34 / 25 / 24 / 48 (night: see below) |
| driver-profiles | 105 | 105 |
| twin: bake / budget / cc / fonts / layout / pages / probe / sim | 35 / 75 / 149 / 219 / 61 / 100 / 110 / 39 | 35 / 75 / 149 / 219 / 61 / 101 / 115 / 39 |
| twin: trip (new) | — | 82 |

`test-night.js` gave 44 / 4 once inside the full sequential run, then 48 / 0 in two runs alone on the branch and 48 / 0
on the `main` state (stash) right after; it starts a bench of its own on the fixed port 8163, which the other round-3
worktrees running the same suite in parallel share, and MK touches nothing it loads (f30_cluster does not pack
`twin_tokens.js` or `twin_probe.js`). Read as a port collision, not a regression; the lead's merge run settles it.

`test-twin-pages.js` changes one expectation on purpose (the owner's decision): "the fields arrive with no factors
configured: the default factors show the values" (was "still dashes"), plus one new check that `factors: false` gives
dashes again. `test-twin-probe.js`: the five new probe fields with injected values, the field count 40 → 45.

`bench/test-twin-trip.js` covers: the defaults (null, absent, partial, `false`); every invalid marker and silence;
zero is a value; minutes above 59 carry; an implausible value is shown; the fallback per value both ways and back;
`trip.order`; rl3's departure only for STARTOFDRIVING; `departureUtc` with and without a zone; R1 from rl3 and from
KombiIF; the odometer chain with the qualifier, 0, 16 777 215 and a per-carrier factor; carriers not in the order are not
subscribed; the first-arrival lines (exact text), the one-minute throttle, the 30-line cap, `verified`; no Cyrillic in
any line; the summary's silent / heard / invalid / factors-off, the cross-check per source, the getters (answered /
error / no provider / watch error, the answer used); the timers; every watched source declared in `app.json` with the
right flags; Node 8 syntax; no setter or method call in the file.

## 6. Verified, hypothesis, refuted

| # | Finding | Label |
|---|---|---|
| 1 | 0.1.0 shows dashes for every trip value whatever the car sends (factors null → `tripValues` returns before reading) | **verified** (code; `test-twin-pages` on `main` has "the fields arrive but with no factors the page still shows dashes") |
| 2 | 0.1.0 subscribes the three fields and logs each arrival as `trip … raw (P4)` (every change) and the odometer as `odometer raw (P3)` | **verified** (code) |
| 3 | 0.1.0 cannot tell "silent" from "getter refused" from "no provider" | **verified** (code: `signals.js` swallows getter errors; no summary) |
| 4 | No Twin Dial car log is on this Mac | **verified** (searched `bake/work/`, `reference/car/`) |
| 5 | The MK build logs first arrival, summary, getter outcome and shows values with the default factors | **verified** (bench, two runs; 82 unit tests) |
| 6 | Both builds' declarations pass the catalogue check, every `r` has a non-zero getter | **verified** |
| 7 | The factors 0.1 / 0.1 / 0.1, BC1 = "since start", the departure in local time | **hypothesis** (the catalogue has no units; the first drive decides) |
| 8 | KombiIF's trip fields are sent on this car | **hypothesis, open**: the owner's existing log answers it (grep `raw (P4)`) |
| 9 | ResetLogic3 has a provider on this head unit (it feeds the iDrive trip page) | **hypothesis** |
| 10 | ResetLogic3's "Digit" is the shown number and "Scale" the bar position | **hypothesis** (from the member names and `maxValues`) |
| 11 | The odometer member `mileageKilometre` carries the odometer in km | **hypothesis** (never read on the car; 0.1.0 already shows it with factor 1 if it arrives) |
| 12 | "The trip page is empty because the car does not send the data" | **not supported**: 0.1.0 would be empty either way; neither shown nor refuted |

## 7. What the car must answer, in order

1. **Before installing anything** — the lead greps the owner's existing 0.1.0 log (read only):
   `grep -E 'trip (average|travel|departure) raw \(P4\)|odometer raw \(P3\)|signal KombiIF'`.
   - P4 lines present → the car sends KombiIF's trip data; the page was empty only by design. Build 1 shows it; the
     five-minute protocol confirms the factors.
   - No P4 lines, `signal KombiIF subscribed` present → silent or refused; build 1's summary tells which, and whether
     ResetLogic3 fills in.
   - `odometer raw (P3): none` or `16777215` → the range struct carries no odometer; build 1 tries three more carriers.
   - Also ask the owner: did the bottom row's odometer (L1) show a number on 0.1.0?
2. **Install build 1** (lead's decision), drive 3 minutes, run `docs/research3/MK-PROTOCOL.md`. Each mismatch is one line
   of `config.trip` / `config.odometer`; when all match, `verified: true`.
3. **Only if** build 1's summary says every trip source is SILENT with a getter error: build 2 (probe) for one drive.

## 8. What the lead must decide

- Install build 1 on the car (it changes what the owner sees: numbers instead of dashes, UNVERIFIED in the log only).
- Whether the three extra odometer carriers and ResetLogic3 (+3 interfaces at start) are worth it before the log read
  of step 7.1; `config.odometer.order` = ["rangeTank"] and `config.trip.order` = ["kombi"] remove them without code.
- Merge order with MP (start-up cost of the extra subscriptions) and MC (none shared: MK touches only
  `twin_tokens.js`, `twin_probe.js`, Twin Dial's `app.json` / `probe.json` and their tests).

## 9. Files

- Code: `shared/twin_tokens.js`, `shared/twin_probe.js`, `apps/twin_dial/app.json`, `apps/twin_dial/probe/probe.json`.
- Tests: `bench/test-twin-trip.js` (new), `bench/test-twin-pages.js`, `bench/test-twin-probe.js`.
- Tools: `tools/research3/mk/fields.json`, `tools/research3/mk/candidates.py`, `tools/research3/mk/bench_trip.js`.
- Data: `design/research3/mk/candidates.json`, `design/research3/mk/bench-trip.json`.
- Docs: this report, `docs/research3/MK-PROTOCOL.md`; `docs/twin-dial/SPEC.md` 6.2 / 6.3 and
  `docs/twin-dial/PROBE-PROTOCOL.md` P3 / P4 brought in line with the code's keys (`cons`, `way`, `bc`).
- Scratch (not committed): `bake/work/research3/MK/` (catalogue survey with BMW names, the two packed builds).
