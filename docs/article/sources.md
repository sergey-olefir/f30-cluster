# Sources: where every fact and number in the article comes from

Paths are relative to the repository root. "main" = branch `main` (94e9d31 at the time of writing); "rel" = branch
`release/0.1.1` (1e20f7d), which carries the car-fix reports and the Twin Dial integration. Commit hashes are short.
Memory notes are the lead's notes in the owner's Claude project memory; each is summarised in a tracked report too.

Status words: **verified** = measured / logged and written down in the named file; **hypothesis** = the file itself
calls it a hypothesis (the article says so in words).

## Project scale and timeline

| Fact | Source |
|---|---|
| git history 2026-11-11 … 2026-11-18, first commit eefecfd at app version 0.4.1 | `git log --all --reverse`; `git show eefecfd:apps/f30_cluster/app.json` |
| 640+ commits (650 objects incl. 2 stash commits), ~150 merges (151), ~190 branches (188 local) | `git log --all --format=%H \| sort -u \| wc -l`; `git log --all --merges`; `git branch \| wc -l` (2026-11-18) |
| 19 agent briefs | `ls docs/AGENT-BRIEF-*.md` on main |
| Version timeline 0.4.1 → 0.7.20 with dates | `app.json` version per commit on main (script in the lead's session; commits eefecfd, bc2fc0d, c117c76, 1b3af59, be51b4e, d8e97b2, 62e1e7a, 208cd2e, 5646a39, df94ad1, 8fa82c4, c2c9a57, 193c73b, 70692ae, cfe5853, 159f9d6, 209a115, 95892f5) |
| Twin Dial 0.1.0 (11-17) and 0.1.1 (11-18, integration) | `docs/twin-dial/R2-*-REPORT.md`; rel `docs/twin-dial/R3B-INTEGRATION.md` |
| Twin Dial 0.1.0 and f30 0.7.19/0.7.20 ran on the car | `design/car/answers.json` (`session.material`: twin_dial log from 2026-11-17, f30 runs 0.7.19 / 0.7.20) |
| Co-authors in the trailers (Claude models) | `git log --all --format='%(trailers:key=Co-Authored-By,valueonly)'` |

## 1. Platform and the hard rule

| Fact | Source |
|---|---|
| MGU, OAP apps, MGU App Kit, cluster-render, bimmer-lab engine | `README.md` |
| App runs on Node 8 | `shared/visible.js` header ("the car's 8.16.2"); PERF-AUDIT §1 |
| cluster-render builds a RAMSES scene the KOMBI renders; Unix socket, JSON messages | `docs/PERF-AUDIT.md` §1 (system table) |
| "BMW's warning is never hidden unless our own text for that exact message is on screen in the same frame" | `docs/AGENT-BRIEF-twin-dial.md` §0.6; `docs/twin-dial/SPEC-R3.md` §5.4; `docs/strip/X-REPORT.md` |
| BMW draws belt, parking brake (P), gear letter, black box over us | `docs/OVERLAY-REPORT.md` §1; `shared/visible.js` |

## 2. Platform limits ("war stories")

| Fact | Source |
|---|---|
| 16 MiB pixel memory, each image counted twice (w·h·8); 670×670 dial texture 3.4 MiB; switch peak old + new; drop-before-create | memory "scene-texture-peak-memory"; `docs/research3/MP-REPORT.md` §0 ("counted twice"); commit 208cd2e |
| 8 layers per connection | `docs/AGENT-BRIEF-twin-dial.md` §2; `docs/BAKE-REPORT.md` §4 |
| Unbound sampler → layer silently not drawn on the car; suspected 32-uniform limit and asset size first; 1×1 transparent blank | memory "ramses-unbound-sampler"; commit 62e1e7a ("Bind every declared sampler; version 0.7.3"); `shared/hud.js` `_bindBlanks` |
| fp16 mediump: `length()` overflows past ~256 px; big dials blank past ~0.8 R (0.77 R in the memory note, 0.79 R in BAKE-P10 §1); fixed in 0.7.5 with highp + `length(p / R) * R` | memory "fp16-mediump-overflow"; `docs/BAKE-P10-levels.md` §1; commit 5646a39; snippet from `shared/shaders.js` lines 18–22 and 1169 (rel) |
| KOMBI reset ~2.3 s (2.0–2.7 s) after each 6WB scene, 13 resets 19:07:05–19:12:49 (just under 6 min), the KOMBI tunnel torn down and renegotiated each time, structure/memory identical to 0.7.10, only shaders changed | `docs/CAR-SNAPSHOT-2026-11-15.md` §0.1, §0.3 |
| WBDIAL 25.4k chars worked, 26.7k reset; 0.7.13 one look per layer, Comfort WBDIAL 12.4k; guard after two resets; owner confirmed the same evening | memory "kombi-shader-size"; commit 70692ae ("KOMBI guard turns the theme off after two resets") |
| Getter id 0 → `UPDATE_FAILED`, 0.7.16 blocked four times, six fields, fixed in 0.7.17 by dropping `r` | memory "getter-id-zero"; commit 426d76b; commit "docs: why the Store update to 0.7.16 fails (UPDATE_FAILED)" |

## 3. Geometry and area

| Fact | Source |
|---|---|
| Hood measured from a grid photo, homography on 108 grid crossings, residual 3.5 px; X3 M40i numbers first, deeper hood | `shared/visible.js` (HOOD comment and array) |
| Black box [1420, 320, 1611, 440] on the G20 | `shared/visible.js` BLACK_BOX; `docs/twin-dial/SPEC-R3.md` §12 |
| G20 Comfort catalogue of 38 elements; relations over / under / gone / unknown; safe plan with holes for the 8 critical unknowns | commit "Overlay map E: G20 Comfort catalogue (38 elements)"; `docs/OVERLAY-REPORT.md` §1 |
| Twin layout: R 300, centres (380, 400) / (1540, 400); ≥ 4 px under the hood, ≥ 3 px from BMW items; auto-hold 3.7 px, ABS 4.3 px; 9 % smaller and 30 px lower than the references' proportion | `docs/twin-dial/VG-REPORT.md` §1.1–1.2 |
| Dial units (R, degrees clockwise from 12) | `docs/AGENT-BRIEF-twin-dial.md` §1 "Units" |
| Black box: a switch does not re-map the slot (3–19 ms without a layer vs 3000 ms linger); scene-id fallback hypothesis | `docs/CAR3-K-REPORT.md` §2–3 |
| No signal among 689 interfaces says "box"; box covers the stock centre gear-letter position (hypothesis) | branch `boxes/bs`: `docs/boxes/BS-REPORT.md` §0 |
| f30 puts layer rectangles over the gear letter in every state, Twin never; theory (a) "supported, first"; experiments behind config keys, off | `docs/research3/MB-REPORT.md` §0, §1.2 |
| Twin leaves the gap x 1380–1460, y 660–720; digital speed fallback below y 440 is a spec rule | `docs/AGENT-BRIEF-twin-dial.md` §2; `docs/twin-dial/SPEC-R3.md` §12 |
| Box still open | `docs/twin-dial/SPEC-R3.md` §15; `design/car/answers.json` items on the box are `manual` / `partial` |

## 4. Baking

| Fact | Source |
|---|---|
| Ten clusters C1–C10, packages P1–P8, P9 integration, SSIM/ΔE QC | `docs/BAKE-REPORT.md` §1, §8 |
| Our stack SSIM 0.61–0.66 vs the then-current WBDIAL 0.23–0.32 (C1/C2 vs refs 04/05) | `docs/BAKE-REPORT.md` §1 (last paragraph) |
| Bezel gloss mirrored: ridge correlation same / mirrored 0.22 / 0.93 (photo 04), 0.20 / 0.99 (06) | `docs/BAKE-REPORT.md` §3.1 table |
| Window ~4× too bright (hazed photo 17); proposed gain 0.24, photos span 0.08–0.39 | `docs/BAKE-REPORT.md` §3.3, open question 3 |
| G20 black floor 0.12 % / 0.09 % / 0.56 % of white (R / G / B) | `docs/BAKE-P10-levels.md` §2 |
| Baked RGBA8 assets sampled by the effect layers; live parts shaders | memory "f30-cluster-6wb-theme-goal"; `docs/BAKE-REPORT.md` §4 |
| Strip mask: one R8 atlas, lanes ours / bmw / standby / msg, lane switch = one uniform, full-size R8 vs half-size distance field (corner errors 0.41–0.56), hole 42.5 → 42.499 | `docs/strip/M-REPORT.md` §0 |
| Strip mask size 1908 × 353, r8 | `docs/research3/MT-REPORT.md` §2 inventory (strip_mask row) |
| Arimo's "1" foot serif, 0.655 vs 0.410, 22 faces, Roboto wdth 87.5 ranked 1st, 1st, 3rd | `docs/F30-FONT-SPEC.md` opening and §0 |
| Missing glyph → element back to BMW; wb_msg 85 Cyrillic glyphs since 0.7.18 | memory "fonts-latin-only" (citing research3/MC); `docs/strip/X-REPORT.md` (missing-glyph case) |
| Own pictograms after ISO 2575; car's 7 PNG symbols never stored | memory "cc-symbol-probe", "cc-source-cclist"; `docs/AGENT-BRIEF-twin-dial.md` §0.6, VT |
| Preview images in the evolution strip | `apps/f30_cluster/hud/previews/wb_comfort.json` at each commit (decoded by `src/previews_history.py`); identical pixels at 0.7.13, 0.7.18, 0.7.20 |

## 5. Listening to the car

| Fact | Source |
|---|---|
| Catalogue 689 interfaces, 5100 members | `docs/FEATURE-AUDIT.md` (marks table, "catalogue") |
| `newCCMessage` sent nothing in 25 min (0.7.18 log); `ccList` resting id 0, door → id 15 WHITE | memory "cc-source-cclist" (2026-11-17) |
| `newCCMessage` did arrive a few times in a later log (3 lines) | `design/car/answers.json` item L30 |
| `statusActiveCCMessage` 65535 all the time; `statusDisplayedCCMessage` follows the list within 30–60 ms; 285, 926, 927, 184 shown with no ccList entry | rel `docs/car-fix/CF1-REPORT.md` §1; `docs/AGENT-BRIEF-car-fix.md` §0 |
| signal_probe: draws nothing, 160 fields on 62 interfaces, 11 sets, all off at first start; lengths / enums only | `docs/car/CP-REPORT.md` §0 |
| Owner's session document in Ukrainian, blocks 0–9, safety rules, marks | `docs/car/SESSION.uk.md` §3–5 |
| TRIP = bit 0x40 of `operationColumnStalks`, 17 presses → 17 clean pairs; BMW still reacts under our layers | rel `docs/twin-dial/R3B-INTEGRATION.md` §6.1; memory "trip-button-bit"; commit c9fca28; `apps/twin_dial/app.json` `config.tabKey` (snippet) |
| The parser did not name the bit (no bit private to the steps) | `design/car/answers.json` item P13 (`why`) |
| Speed limit: `TrafficSignDisplayControl` provider never comes up; event `TrafficSignRecognition` ~2/s, class × 5, class 8 = 40, 6 = 30, 10 = 50; class 29 a chime request (hypothesis from the catalogue) → "145" | memory "speed-limit-source"; rel `docs/car-fix/CF2-REPORT.md` §2 |
| Cruise set speed and symbol in the HUD feed, also with the HUD off | memory "speed-limit-source"; `docs/AGENT-BRIEF-car-fix.md` §0 |
| Trip factors checked on the car's own trip page: way factor 1, not 0.1 | rel `docs/twin-dial/R3B-INTEGRATION.md` §6.2; `docs/research3/MK-REPORT.md` §0.3 (unverified defaults 0.1) |
| CarPlay distance in metres whatever the unit (5700 / KM → 5.7 km, 11 min) | rel `docs/car-fix/CF3-REPORT.md`, decision 1 |
| Read-only rules (`r` non-zero getter, `s`, named events, never a setter) | `docs/AGENT-BRIEF-car-fix.md` §1; memory "getter-id-zero" |
| Collector refuses non-read commands and shell metacharacters, tested; privacy check (VIN, phone, coordinates …) | `docs/car/CL-REPORT.md` §1 "The collector", §2 |

## 6. Twin Dial

| Fact | Source |
|---|---|
| Separate app, no see-through variant, messages drawn by us | `docs/AGENT-BRIEF-twin-dial.md` §0 |
| Seven round-1 packages in worktrees | `docs/AGENT-BRIEF-twin-dial.md` header and §3 |
| Five references rectified to R = 400 px, 0.35 px rms best; no further usable reference; HTTP 429 | `docs/twin-dial/VR-REPORT.md` "Answer", §1, line 112 |
| Owner: no more references for now; decisions D1–D10 (±125°, white needle, wedge, own messages, centre pages); "макети дуже круті" | `docs/twin-dial/SPEC.md` §0 and header |
| Invented grey "feet" dropped | commit "Twin Dial mockup: drop the invented grey feet below the band" |
| Round 2: Saira + Noto Sans, 25 pictograms, R8 faces | commit "Twin Dial R2-A1: … 16 atlases, 25 pictograms"; `docs/research3/MP-REPORT.md` (tdial R8 face) |
| Round 3: five live tabs, own colours, CarPlay media, BMW map tab, limit sign + marker + red strip, cruise in the speedometer opening | `docs/twin-dial/SPEC-R3.md` §0 (R1–R12) |
| Eight round-3 research packages (SB, SC, SD, SF, SM, SN, SP, SV), mockups (K1/K2, then KA/KB/KC), build B1–B7, conflicts only in marked hunks, "Integrate: …" commits | git log (2026-11-18); rel `docs/twin-dial/R3B-INTEGRATION.md` header, §1 |
| Fallback window, 150 ms rules, same-turn open, separate connections | `docs/twin-dial/SPEC-R3.md` §5.4–5.5 |
| Per-frame audit; six broken engines each fail; 35 cases × 3 modes, ~100 000 frames, 0 violations; eight broken machines fail | rel `docs/twin-dial/r3b/B3-REPORT.md` §3 |
| D7 strict until a "shown now" number matched a list entry; after the session the source is `statusDisplayedCCMessage` | `docs/twin-dial/SPEC.md` D7; rel `docs/car-fix/CF1-REPORT.md` §0 |

## 7. Performance

| Fact | Source |
|---|---|
| 50 ms tick, no interpolation, 0.31–0.33 of frames move; centre-screen page ~70 ms a frame on the car (estimate) | `docs/PERF-AUDIT.md` §0 |
| 0.7.14: needles on a 33 ms timer, interpolated one sample period back; corked writes | `docs/PERF-NEEDLE-REPORT.md` §1.1; commit cfe5853 |
| Table f30 vs Twin (5.8 / 2.3 MB, 2.9 / 1.14 s, 5.68 MB vs 6 KB, 11.41 / 4.73 MiB, 19.8 / 4.1–4.8 MB, steady KB/s) | `docs/research3/MP-REPORT.md` §0 table |
| Two RGBA8 dial textures 1754 KB each on the wire; R8 = a quarter of the bytes per texel; three builds at start | `docs/research3/MP-REPORT.md` §0 ranked causes 2 and 4 |
| ETC2 in cluster-render 0.5.12, charged once; alpha not needed; Safe 5.98 → 2.98 MB; best trade 2.23 MB; prototypes off; KOMBI drawing etc2rgb is a hypothesis | `docs/research3/MT-REPORT.md` §0 |

## 8. Working with the agent team

| Fact | Source |
|---|---|
| Worktrees, own branch, own bench port, no browser, no kill, bounded processes, evidence labels | `docs/AGENT-BRIEF-twin-dial.md` §1; `docs/AGENT-BRIEF-car-fix.md` §1; `tools/shots/bounded.py` |
| The push with an unrequested fix, reverted ("там все було добре. ревертай") | memory "push-as-asked" |
| G20 spec corrected by the strip packages | commit "G20 design spec and measured.json: correct what the strip packages disproved" |
| MC's wide release rule unsafe in one case, narrowed | `docs/twin-dial/SPEC-R3.md` §5.4 item 7; rel `docs/twin-dial/r3b/B3-REPORT.md` §1 |
| Twin 0.1.0 empty trip page was by design (factors null) | `docs/research3/MK-REPORT.md` §0.1 |
| SC model bug (a later sheet overtook an earlier one) | rel `docs/twin-dial/r3b/B3-REPORT.md` §4.3 |
| Shared `bake/work` collision risk for `test-twin-budget`, run with a private copy | rel `docs/twin-dial/r3b/B3-REPORT.md` §6 |

## 9. What next

| Fact | Source |
|---|---|
| Car-fix CF1–CF3 merged into the release branch | rel commits 4303651, cbc3802, 1e20f7d; `docs/car-fix/CF*-REPORT.md` |
| Next build numbers 0.1.1 / 0.7.21 | `docs/AGENT-BRIEF-article.md` §2 (the lead's plan); app.json on rel still says 0.7.20 / 0.1.0 |
| Trip recorder app: spec and bench prototype | branch `trip-graph/tg`: `docs/trip-graph/SPEC.md` §1 |
| Telltales at the top and a wholly-ours bottom deferred (R13) | `docs/twin-dial/SPEC-R3.md` §0 R13, §15 |

## Revision 2 (2026-11-18, after the owner's review): added facts

### Voice
The article speaks as "ми" (the car's owner plus the agent team); the owner is "власник авто". No byline in the text.

### Scale of the work

| Fact | Source |
|---|---|
| Up to 15 agents at once: mockups KA/KB/KC (3) + build B1–B7 (7) + car preparation CA/CL/CP/CQ (4) = 14, plus one more | the lead's message for this revision; `docs/AGENT-BRIEF-twin-build-r3.md` ("seven build agents … All seven start at once"), `docs/AGENT-BRIEF-car-signals.md` ("four agents"), `docs/twin-dial/MOCKUP-SPEC-R3B.md`; branch commit times on 2026-11-18 (18:37–20:44) overlap; `trip-graph/tg` commits 21:08–21:13 |
| More than 60 agents over the project | **the owner's count** (old worktrees were deleted); said as such in the text. Supporting: `git worktree list` shows 64 entries (62 agent worktrees) on 2026-11-18 |
| ~3.7 GB of working data in ~12 thousand files | `du -sh bake/work` = 7.1 G, of which `bake/work/.uvcache` (package cache, not counted) = 3.7 G → 3.4 G; `du -sh reference` = 333 M; files: 11 936 under `bake/work` without the cache + 280 under `reference` (measured 2026-11-18; includes this article's own 0.16 G) |
| Seven build packages edit overlapping files; new code in new files; marked hook blocks; conflicts only in marked hunks | `docs/AGENT-BRIEF-twin-build-r3.md` lines 30, 97 |
| 13 contradictions between reports found by the pre-session audit | `docs/car/CA-REPORT.md` §0.6 |

### The catalogue

| Fact | Source |
|---|---|
| 689 interfaces; 5100 members = 2319 fields + 2116 methods + 665 events; 7411 datatypes | counted from `reference/car/2026-11-15/someip/someip-interfaces.json` (keys `interfaces`, per-interface `fields` / `methods` / `events`, `datatypes`); the same in `all-signals-summary.txt` |
| 640 fields have a setter (flags `rsw` 360 + `rw` 280) | `reference/car/2026-11-15/someip/all-signals-summary.txt` first line |
| "Our clusters and the probe touch none" | `docs/AGENT-BRIEF-car-fix.md` §1 (never a setter); `docs/car/CP-REPORT.md`. Note: the repository's third app, Driver Profiles, does use two setters of the profile service (commit "Driver Profiles 0.2.0: the avatar … setters 29 and 8"); the article is about the two clusters and the probe and words the claim accordingly |
| The owner's "біля 700 сигналів" | = the catalogue's 689 interfaces; the article prints 689 |

### signal_probe

| Fact | Source |
|---|---|
| 0.1.0: 160 fields on 62 interfaces, 11 sets, all off at the first start, nothing subscribed while a set is off, draws nothing | `docs/car/CP-REPORT.md` §0.1; counted from `apps/signal_probe/fields.js` `TABLE` without S13 (160 rows, 62 interfaces) |
| 0.1.1: set S13 "Знаки", 10 sources, 8 of them events (flag `b`); 170 sources on 66 interfaces, 12 sets | `apps/signal_probe/fields.js` (170 rows, 66 interfaces, S13: 10 rows, 8 with `b`); `apps/signal_probe/app.json` version 0.1.1 |
| Set names (messages, computer and mileage, body and voltage, media, phone, view and buttons, navigation, assistance, technical, black box, unwired) | `apps/signal_probe/fields.js` `SETS` |
| Built "for the owner at the car with a 30 on the cluster"; under an hour | comment at `fields.js` line 281; commits 7b9db74 (19:59:04) → 5c95e5b (20:44:33), 45 min apart; the lead's message says "in an hour" |
| "Позначка N" marks | `docs/car/SESSION.uk.md` §4; `docs/car/CP-REPORT.md` §0.1 |
| Privacy: numbers, enum names, lengths; canary tests in every text member | `docs/car/CP-REPORT.md` lines 294, 311–312; "ARTIST (17 chars)" shape in rel `docs/car-fix/CF3-REPORT.md`; known / unknown contact in `docs/car/CL-REPORT.md` §1 (table SM, SP) |
| Per-field gaps and caps, 40 lines a second guard, 60 changes in 60 ms → 60 lines, summaries at +30 s / +2 min / +10 min, one read-only getter ask | `docs/car/CP-REPORT.md` §0.2–0.3, lines 295, 360; `apps/signal_probe/probe.js` header |
| Register of 91 items (31 L, 21 P, 22 X, 17 F) | `docs/car/CA-REPORT.md` §0.1 |
| Collector whitelist (`cat`, `ls`, `stat`, `tail -c`, `date -u`, `uname -a`, `journalctl -u cluster-render`), refuses anything else, tested against a fake ssh; parser = the reports' decision tables as code; patches proposed, never applied; privacy check | `docs/car/CL-REPORT.md` §0–2 |
| Session document: ten blocks, safety rules | `docs/car/SESSION.uk.md` §3, §5 |
| "About an hour in the car with a laptop on SSH, reading logs between presses" | **the owner's words** (relayed by the lead for this revision); the brief says "The lead reads the logs (read-only) and the owner does the presses" (`docs/AGENT-BRIEF-car-signals.md` line 3). No log on disk gives the session's total length |
| First collected probe log: 8 minutes (18:26:12–18:34:42 UTC), 44 of 53 fields spoke in four sets (S1 4/6, S2 17/19, S4 11/13, S10 12/15); silent fields and down providers named | `reference/car/2026-11-18-collect1/apps/signal_probe/signal_probe.log`, the `summary S<n>` lines (numbers only) |
| After the first collect: 28 answered, 14 partial, 13 not yet, 36 manual | `design/car/answers.json` `summary` |
| Class 8 with a 40 sign, class 6 with a 30 sign; the front camera's event gives the value in km/h | `docs/AGENT-BRIEF-car-fix.md` §0; memory "speed-limit-source" |
| CarPlay route: destination distance, travel time, arrival; no arrows, no lanes | `docs/AGENT-BRIEF-car-fix.md` §0 (Navigation); rel `docs/car-fix/CF3-REPORT.md` |

### Geometry and checks

| Fact | Source |
|---|---|
| Fit search rules (symmetric about x 960, bezel arc ≥ 4 px under the hood, disc ≥ 3 px from BMW items, largest R wins, then the centre distance nearest ref 02) | `docs/twin-dial/VG-REPORT.md` §1.1 |
| Numeral clearance rule 4 px, checked at bake time; speedometer numeral–numeral 7.6 px; a 120 would have 0.65 px | `docs/twin-dial/R2-A2-REPORT.md` "Clearance" |
| Ink recorder; 210 single frames; keep-outs (belt group, gear gap, seven side-lamp holes); 25 doctored inputs the checks must fail on; "бар" 2.7 px past the window edge | `docs/twin-dial/r3b/KC-REPORT.md` "Tools", §1 |

### Baking, masks, fonts

| Fact | Source |
|---|---|
| Twin Dial faces: R8 616 × 560, drawn at 3x and reduced (LANCZOS), byte = neutral code, tint / wedge / bar fills in the shader | `docs/twin-dial/R2-A2-REPORT.md` "What was built", "The faces" |
| Every committed payload regenerates byte for byte; manifest with sha256 of every payload and font hashes | same report, "What was built" (`bake/manifest/twin_dial.json`) and the "Run" paragraph |
| Mean abs difference vs the mockup 0.43 / 0.34 per channel at stretch 1.00 | same report, comparison table |
| Fallback-window mask R8 536 × 112, the stock panel outline dilated 3 px | same report, "The mask" |
| Twin Dial type: zero fills 0.904 of its box (ellipse 0.785); 38 families / 75 font files ranked by box deviation; Saira 4.23 % (next 7.13 %); Noto Sans 3.14 %; Saira's zero ~7 % narrower; stretch 1.06 | `docs/twin-dial/VT-REPORT.md` verdicts 1–3; `docs/twin-dial/R2-A2-REPORT.md` (1.06) |
| Noto Sans carries the car's text incl. U+02BC and « »; a Saira atlas refuses Cyrillic at bake time; 16 atlases, 3.03 MiB raw | `docs/twin-dial/VT-REPORT.md` verdict 3; `docs/twin-dial/R2-A1-REPORT.md` §2 and the atlas table |
| The audit pixel-compares with an independent render | rel `docs/twin-dial/r3b/B3-REPORT.md` §3 (V1) |

### The early photos (`images/photos-early_{uk,en}.png`, made by `src/photos.py`)

The owner asked for them in this revision (the first brief said renders only). All five are the owner's own photos in
`reference/g20/` (git-ignored); cropped to the cluster; the EXIF is not carried over.

| Cell | File | What it shows, and the source of the caption |
|---|---|---|
| 1 | `11_our-theme_on-car.jpg` | the first theme on the car, the black box over the rev counter's hub (`shared/visible.js` BLACK_BOX comment; `docs/OVERLAY-REPORT.md` §1 "seen on top of our opaque theme in 11, 12, 13") |
| 2 | `12_our-theme_night_2026-11-11.jpg` | build cb28ce7 with the baked scene; past 0.8 R the photo equals the background; a heavily over-exposed night-mode photo; blue black floor (`docs/BAKE-P10-levels.md` §1–2). That fp16 is the cause is the later finding (memory "fp16-mediump-overflow": "car photos of 0.7.1–0.7.4"); for this earlier build it is an inference from the same symptom, so the cell's label does not say fp16 |
| 3 | `14_stock-under-unbound-theme_2026-11-12.jpg` | 0.7.2 with baked off: only the text layers drew (memory "ramses-unbound-sampler") |
| 4 | `15_wb-comfort_0.7.4_fp16-cut_2026-11-12.jpg` | 0.7.4, the fp16 cut (file name; memory "fp16-mediump-overflow") |
| 5 | `16_wb-dials_0.7.4_over-stock_2026-11-12.jpg` | 0.7.4 "6WB Dials + G20": the stock scales show through (same memory note) |
| 6 | the bench render `02-motorway-130-nopass.png` | today's Comfort, for comparison (not a photo) |

Redaction: photos 3 and 5 showed BMW's map round the car's position and a street name in BMW's bottom row; both
regions are blurred twice with a wide Gaussian through a feathered mask (checked by eye: no road and no letter is
readable). Nothing else personal is in the crops: no reflection of a person, no plate, no document, no phone screen,
no centre display. The windscreen view above the cluster is cropped away.

Photos looked at and not used: `13_…baked_on-car` (480 × 360, too small), `reference/ours/32–43` (0.7.7, a later
stage; several carry BMW's map and a street name), `reference/g20/08–10, 17, 39, 40, 60–68` (stock cluster, not ours).

## Revision 3 (2026-11-18, final galleries): pictures swapped, versions released

| Fact | Source |
|---|---|
| Both apps are released: Twin Dial 0.1.1 and f30_cluster 0.7.21 | commit a884cb2 on main ("Versions: Twin Dial 0.1.1, f30_cluster 0.7.21"); `apps/twin_dial/app.json`, `apps/f30_cluster/app.json` |
| Twin Dial's night look only lowers the white level (to 0.80 linear), no colour changes | the lead's note for this revision, citing SPEC rev 2 §7.2; `docs/twin-dial/SPEC-R3.md` §6 (white × 0.8) |
| The 0.7.21 limit frame is fed by the car's real event (class 8 × 5 = 40) | the lead's note; gallery job name `limit-tsr-40` |
| Probe menu rows and texts | `apps/signal_probe/app.json` (`screens.MAIN.items`, the 12 `settings` labels), `apps/signal_probe/menu.js` `refresh()` (status line, "Позначка N", the warning line). The status numbers and the mark's time in the drawing are an example; "S6 … 8 з 8" follows `docs/car/CP-REPORT.md` §0.3 (S6 = 24 fields on 8 interfaces) |
| The "(fp16)" bracket stays only on the 0.7.4 cell (photo 15) | the memory note "fp16-mediump-overflow" names the car photos of 0.7.1–0.7.4, and the photo's own file name is `…0.7.4_fp16-cut…`; photo 12 (an earlier build) keeps no bracket |

Source frames now (all from the two final galleries; Twin Dial frames are the `.ours.png` files, our layers alone):

| Image | Frames |
|---|---|
| `hero-both.png`, `hero-f30.png` | `bake/work/shots/20261118-2239/C-scenarios/comfort/02-motorway-130-nopass.png` (f30_cluster 0.7.21) |
| `hero-both.png`, `hero-twin.png` | `bake/work/shots/twin-20261118-0.1.1/E/limit_50_cruise_60.ours.png` |
| `diagram-layer-stack_*` (middle plane), `photos-early_*` (sixth cell) | the same f30 frame |
| `diagram-zones_*` (underlay) | the same Twin Dial frame |
| `evolution-f30_*` (last cell) | `…/20261118-2239/A-sweeps/comfort/limit/limit-tsr-40.png` |
| `twin-mockup-vs-app_*` (lower) | `…/twin-20261118-0.1.1/B/M2_trip.ours.png` |
| `states_*` | f30: `A-sweeps/comfort/night/always-amber.png`, `always-ice.png`; Twin Dial: `E/tab2_card`, `E/tab3_carplay`, `E/tab4_call_auto`, `E/tab5_route` (`.ours.png`) |
| `diagram-probe-menu_*` (new) | drawn by `src/diagrams.py` `probe_menu()`; a drawing, not a screenshot |

Not used on purpose: `E/tab2_rows_setting` (shows a known defect), every `comfort-g20-*` context (photo backdrops), the
earlier galleries (`shots/20261116-2238`, `twin-dial/fin/gallery`) no longer feed any picture.

## Images

This table is from revision 1. Where it names a source frame, the "Revision 3" table above replaces it; the scripts are unchanged.

| File | What, from where |
|---|---|
| `images/hero-both.png`, `hero-f30.png`, `hero-twin.png` | bench renders in a drawn surround (`src/compose.py`). f30: `bake/work/shots/20261116-2238/C-scenarios/comfort/02-motorway-130-nopass.png` (0.7.18 era gallery). Twin: `bake/work/twin-dial/fin/gallery/A/day_none_trip_driving.ours.png` (the lead's gallery of the 0.1.1 integration, our layers only) |
| `images/diagram-*_{uk,en}.png` | `src/diagrams.py`; numbers from `shared/visible.js`, `docs/twin-dial/VG-REPORT.md`, `SPEC-R3.md` §5.4, the catalogue counts above |
| `images/evolution-f30_{uk,en}.png` | `src/previews_history.py` + `src/compose.py` (the app's own previews per commit) |
| `images/twin-mockup-vs-app_{uk,en}.png` | `bake/work/twin-dial/mockup/2_trip.png` (round-1 mockup) and `bake/work/twin-dial/fin/gallery/B/M2_trip.ours.png` |
| `images/photos-early_{uk,en}.png` | `src/photos.py`: five cropped, redacted photos from `reference/g20/` and one bench render (see "The early photos" above) |
| `images/states_{uk,en}.png` | Comfort `14-night-amber-msg`, `22-winter-morning` (same gallery) and Twin Dial bench renders |

Frames deliberately **not** used: `comfort/13-standby-msg.png` (BMW's simulated panel shows an odometer-like total close to
the car's real one), `comfort/10-start-up.png` (a street name in BMW's simulated row), every `comfort-g20-*` frame (our
simulation of the stock G20 look and a synthetic map behind the dials: too close to BMW artwork for the owner's rule).

## Revision 4 (2026-11-19): impersonal register, technical depth

"main" is now `819854b`. Line numbers are for that commit. Numbers marked *computed* were measured for this revision by
the command or script named (all read-only, run from the repository root).

### Voice
The article no longer speaks as "ми / we" or names an owner. The human / agent split is stated once, in "Коротко" /
"In short". Statements that came only from the owner (the hour in the car, 60+ agents) are marked in the text as
estimates not checked against the files; here they remain **the owner's statement**.

### Scale (re-counted 2026-11-19)

| Fact | Source |
|---|---|
| 650+ commits (657 objects), ~150 merges (152), almost 190 branches (189 local) | `git log --all --format=%H \| sort -u \| wc -l`; `git log --all --merges`; `git branch \| wc -l` |
| History 11–19 Nov (one commit on the 19th: 819854b, Signal Probe 0.2.0) | `git log --all --format=%ad --date=short` |
| "some twenty briefs": 20 files `docs/AGENT-BRIEF-*.md` on disk (7 tracked, 13 untracked), two of them for this article | `ls docs/AGENT-BRIEF-*.md`; `git ls-files 'docs/AGENT-BRIEF-*'` |
| 62 agent worktrees on disk (64 entries in `git worktree list`) | `git worktree list` |
| More than 60 agents; about an hour in the car | **the owner's statement**; the text says "estimate" |

### Shaders on the weak GPU

| Fact | Source |
|---|---|
| WBDIAL source with comments ~30k characters (29,997) | *computed*: length of the `WBDIAL` template literal in `shared/shaders.js` |
| Compacted: all five looks 18,153; Comfort with night 13,267; Sport 6,565 and Eco Pro 6,381 (day only); `tdial` 5,763 | *computed*: `node -e "const s=require('./shared/shaders.js'); s.wbdial.length, s.wbdialFor(st, night).length, s.tdial.length"`; 13.3 KB also in `docs/research3/MB-REPORT.md` §0; tdial 5763 in rel `docs/twin-dial/r3b/B1-REPORT.md` |
| 12.4k at 0.7.13 (kept from rev 3) | memory "kombi-shader-size" |
| tdial budget 8 KB, tested | `docs/twin-dial/SPEC-R3.md` §2.10, §12; `bench/test-twin-budget.js` |
| `compact()` snippet | `shared/shaders.js` 2692–2696, 2716–2717 |
| uniforms packed in vec4 (32 uniforms a layer, some GPUs fewer vectors); `u_geo`, `u_scale` | `shared/shaders.js` 1093–1098 |
| `_bindBlanks` | `shared/hud.js` 4043 |
| `r8a()` and why | `shared/shaders.js` 1615–1617, 2513–2514; `docs/strip/M-REPORT.md` §1 |
| scaled / clamped lengths; static test "no length() of an unnormalised offset" | `shared/shaders.js` 1169, 1489, 1626, 1643; `docs/twin-dial/r3b/B1-REPORT.md` (static budget line) |

### Rectification

| Fact | Source |
|---|---|
| homography + one radial term, formula; cubic residual ±3.5 px; k1 search, RANSAC then 3 rounds at 3 px; NCC on green − red | `tools/overlay/rectify.py` docstring (lines 11–17, 22–24), `fit_model` 151–167, `robust_fit` 170–194, `green_minus_red` |
| photo 10: 113 inliers, rms 1.205 px, plain homography 2.472 px, k1 −0.027 | `bake/work/overlay/rect/H.json` entry `10` (git-ignored output of rectify.py) |
| photo 11: 30 text points, rms 0.161 px vs plain 1.606 px | same file, entry `11` |
| SIFT: CLAHE 3.0 / 8×8, 12,000 features, ratio 0.8, gate 40 px | `rectify.py` `sift_pairs`; H.json entry `09` (`method`) |
| first tool: 6000 features, ratio 0.78, RANSAC 6 px, bench render ↔ photo 11 | `tools/ref/sift_align.py`; `docs/AGENT-BRIEF-bake-6wb.md` §5 |
| photos coarser than 4 panel px per photo px are for visual checks only; rms ≤ 3 px to be usable | `rectify.py` `ACCEPT_RMS`, `COARSE`; H.json `_about.accept` |
| picture arrows: largest 6.94 px, rms 2.38 px | *computed* by `src/r4_rectify.py` (difference of H.json's plain homography and full model at the 133 major crossings) |
| black box visible in the grid photo | seen in `reference/g20/10_grid_over-stock.jpg` at panel ≈ (1430–1610, 330–440) |

### Black box

| Fact | Source |
|---|---|
| every layer is a RAMSES quad in the KOMBI's scene; Twin never in x 1380–1460, y 660–720 | `docs/research3/MB-REPORT.md` §0 items 1, 4 |
| three diagnostic settings, off by default; mbGap: split into up to 4 layers, 3 widgets to a 4th connection; ≤ 0.03 of a code outside the gap | `apps/f30_cluster/app.json` settings `diagMbGap`, `diagMbCover`, `diagMbRebuild` and config 1205–1207; MB-REPORT §0 table |
| "a diagnostic experiment on the car hid it" (2026-11-19); which one is **not known** here | `docs/AGENT-BRIEF-article-r4.md` §2.3; placeholder `[МЕХАНІЗМ: уточнити]` / `[MECHANISM: to confirm]` left for the lead |

### Splitting the 6WB into layers

| Fact | Source |
|---|---|
| procedural WBDIAL SSIM 0.23–0.32 | `docs/BAKE-REPORT.md` §1 |
| per-dial fit: rays from a hand seed, sub-px ridge, RANSAC circle, ellipse; outer half-max edge = R, ridge 0.99 R; roll from the centre line / floor edge / 3.2° minor pitch / 6000 tick | `docs/BAKE-P0-inventory.md` §1 |
| residuals 17: 0.64 / 0.59 / 0.14 / 0.21 px | same, table |
| exposure: p5 at 1.0–1.08 R, top 0.5 % inside 0.95 R → 235, gains 0.8–1.25; mask bits | same §2; `bake/README.md` (reference crops) |
| gloss brightest toward the window, dials mirrored → reflections suspected | `docs/BAKE-P0-inventory.md` §3 item 5 |
| ten clusters C1–C10, P1–P8 + P9 | `docs/AGENT-BRIEF-bake-6wb.md` §6.1, §9; `docs/BAKE-REPORT.md` §1 |
| the speedometer stack (z, kind, class) | `bake/manifest/C1.json`; `bake/src/C1/draw.py` `SOFT`, `CRISP`; rev-dial extras `bake/manifest/C2.json` |
| tick trapezoid, 4×4 supersampling; radii 0.820–0.902, half-width 0.0085→0.0112, bezel 0.9915 σ 0.0058, disc 0.487 (theme 0.51), ring 0.330 (0.36), floor 0.245; arcs open at the bottom | `bake/src/C1/params.py`, `draw.py` (`SS = 4`, `ticks`, `open_arc_cov`) |
| what not to bake, alpha-over only, ≤ 8 MiB per mode, 8 layers per connection / 32 | `docs/AGENT-BRIEF-bake-6wb.md` §3, §6.3 |
| asset route, Comfort 4.31 MiB | `docs/BAKE-REPORT.md` §1, §4 |
| bake_scene: whole static stack → 670×670 RGBA, straight alpha, procedural layers at 1x, bilinear premultiplied upscaling | `tools/bake_scene.py` 1–6, 41–50, 96–105 |
| live in the baked path: over-speed band, arc fill, hub, needle shadow, needle | `shared/shaders.js` 1212–1226, 1302–1348; bake_scene.py comment line 98–99 |
| 21 layers on 3 connections; 11.41 MiB settled; 3.42 MiB = 670·670·8 | MB-REPORT §0 item 3; `docs/research3/MP-REPORT.md` §0 |
| QC metrics and targets | `bake/README.md` (QC); brief §8 |
| floor fill 0.924, hub well 0.925 / 0.923; stack 0.61–0.66 / ΔE 4.8–5.3; edges 3.8–4.9 px | `bake/manifest/C2.json`, `C1.json`; BAKE-REPORT §1, §7 |
| photo 02 synthetic (doubled "Fasten seatbelt", "OPO"); disc 0.568 R | `docs/F30-FONT-SPEC.md` §1; BAKE-P0-inventory §1 table |
| P10: sRGB-code subtraction, housing taken as black on 17 / 07; the linear-light correction; applies to albedo/glow/highlight/merged, not shadow/mask | `docs/BAKE-P10-levels.md` §3, §4 |
| photo_lin = F + g·panel^γ; 0.12 / 0.09 / 0.56 %; ±12 codes; 2.8 EV | BAKE-P10-levels §2, §8 |
| Twin uses the same floor, L' = (L − F)/(1 − F) | `shared/hud.js` 407 (`TW_FLOOR`); `shared/shaders.js` 2461–2466 (`linF`) |

### Shadows, light, glow, night

| Fact | Source |
|---|---|
| light measured as first harmonics of ridge brightness and highlight offset | `bake/src/C1/light.py` |
| correlation same / mirrored 0.22/0.93 (04), 0.20/0.99 (06), 0.80/0.91 (03) | `docs/BAKE-REPORT.md` §3.1 table |
| C1 gloss: base 0.26, lobes (8°, σ22, 0.42), (232°, σ32, 0.72), (300°, σ40, 0.10) | `bake/src/C1/params.py` `BEZEL` |
| P9 proposal: lobes 22° / 219°, key 90°; "nothing needs re-baking" | BAKE-REPORT §3.1 decision; C1 params still 8 / 232 (checked in the file) |
| `lit()` snippet, key 115°, rim modulation 0.35 | `bake/src/C1/draw.py` 44–49, 183–188; params `LIGHT` |
| AO 0.65·exp(−(0.962−r)/0.018), darkest 0.944–0.960; disc shade 0.22, scale 0.025, ×(1−0.5·lit); floor shade 0.45, ramp 0.035, 0.6–0.8; hub well 0.30, 0.135–0.26; groove wall 0.964–0.984 | `params.py` `FACE_SHADOW`, `FLOOR_SHADE`, `HUB_WELL`, `GROOVE`; `draw.py` 101–132 |
| floor shade evidence weak (05 yes, 04/03 no) | `bake/src/C1/build.py` `OPEN_QUESTIONS` |
| shadows merged into the @0.5x base | `bake/src/C1/build.py` 146–153 |
| tick spot 0.918, σ 0.012 / 0.016, 0.42 / 0.30, photo 108 / 66 / 26; halo 0.10, 0.006; fringe (120, 215, 255) 0.40 from 70 %; floor glow power 1.8 | `params.py` `TICK_SPOT`, `TICK_HALO`, `FRINGE`, `FLOOR` |
| fringe = probable lens CA, open question | BAKE-REPORT §5 Q15 |
| glow combined alpha = 1 − Π(1 − aᵢ) | `draw.py` `soft_glow` 172–179 |
| live needle halo 0.22 / 0.016 R; hub halo 0.30 / 0.020 R | `shared/shaders.js` 1339, 1317 |
| G20 sim glow gain by least squares, 0.47 / 0.58 / 0.63 / 0.73 → 0.6 | `tools/g20sim/calib_glow.py`; `docs/G20SIM-REPORT.md` (results, item 3) |
| needle shadow snippet and numbers; needle tube | `shared/shaders.js` 1319–1348 |
| over-speed band 0.521 → 0.663 R, 0.72 + 0.30 at 0.530 R | `shared/shaders.js` 1214–1226 |
| window veil 1 − (1 − t)², fades 150 / 40 / 56 / 60 px, rounded corners, only darkens | `shared/shaders.js` 1651–1652, 1717–1727, 1741; `docs/POLISH-A-REPORT.md` §2 |
| old round window length() not fp16-safe; distances on vectors / 64 | `docs/POLISH-B-REPORT.md` §1 ("Soft windows"); `shared/shaders.js` 1489 |
| f30 night transform, snippet; amber w (0.66, 0.59, 0.50), red → (1.0, 0.50, 0.06); signs dimmed; judged on the bench only; no night in Sport / Eco Pro | `shared/shaders.js` 1053–1070; `shared/hud.js` 372–393 (`NIGHT_LOOKS`, comment "Judged on the bench only"), 5806–5810 (`lookRows`) |
| Twin night multipliers (hypotheses) | `shared/hud.js` 394–398 (`TW_NIGHT`); `docs/twin-dial/SPEC-R3.md` §6 |
| Twin needle shadow ×0.85, 0.05 R, band minus strip, not on ink | `shared/shaders.js` 2577–2580; SPEC-R3 §2.6 |
| numeral shadow models SD / K1; decision: none; restorable by one word | `tools/twin-dial/bake_face.py` 73–82; SPEC-R3 §2.4 |
| red arc antialiasing; earlier ink threshold for red | `shared/shaders.js` 2535, 2551–2552 |

### Fonts and masks

| Fact | Source |
|---|---|
| bloom model, counter coefficient −1, 5.60 px counter, 0.6394 / 0.6390 | `docs/F30-FONT-SPEC.md` §2.1 |
| tabular 10.26 ± 0.39 px | same §2.2 |
| 22 faces, Roboto wdth 87.5 1st/1st/3rd; 1.85 % vs Arimo 6.87 %, 17th | same §0, §4 |
| atlases: coverage bytes, base64 JSON, uniform cell height, `ox`, tabular digits, car never rasterises | `tools/bake_fonts.py` docstring 1–19 |
| full Ukrainian, punctuation, CAR_WIDE (Russian, Belarusian, Latin accents), U+02BC → U+2019 | `tools/bake_fonts.py` (package F block, `CAR_SUBS`, `CAR_WIDE`) |
| wb_msg: Roboto subset, 35 px, 1024 × 276, 246 glyphs | `apps/f30_cluster/hud/fonts/wb_msg.json` (*read*) |
| strip mask 1908 × 353 R8, lanes ours (0,0), bmw / standby (0,124), msg (0,248), 21 shapes; 1.28 MiB = 1908·353·2 | `apps/f30_cluster/hud/scene/strip_mask.json` |
| the encoding table, 42.499 / rms 0.004, 0.60/255 in seven states, 60 of 1920 columns / 0.94 texel | `docs/strip/M-REPORT.md` §0, §2 |

### Twin Dial's R8 face

| Fact | Source |
|---|---|
| 616 × 560 R8, 3× then LANCZOS, codes 109 / 124 / 6 / 47 / 227 / 255, band law, tint | `tools/twin-dial/bake_face.py` docstring and constants; `apps/twin_dial/hud/scene/face_tacho.regions.json` |
| 344,960 bytes, 0.66 MiB counted twice | *computed* (616·560; ×2) |
| decode steps | `tools/twin-dial/face_shade.py` docstring; `shared/shaders.js` TDIAL 2537–2554 |
| GPU = numpy to 0.000 codes outside the needle; 44 GPU checks | rel `docs/twin-dial/r3b/B1-REPORT.md` |
| redline default 6500 | SPEC-R3 §2.5 |

### Signal Probe 0.2.0

| Fact | Source |
|---|---|
| S14: 37 entries on 16 interfaces (11 events) + 7 S8 fields = 44; contents; S15: 21 events on 7 interfaces; 5–10 KB/s and 20 KB/s+; log rotates at 256 KB; only `DataFrontVehicle` answered, parked; not seen on a drive | `docs/car/CP-REPORT.md` §13; commit 819854b |

### New pictures (revision 4), all made by scripts in `src/`

| Image | Script, inputs |
|---|---|
| `dial-elements_{uk,en}` | `src/r4_dial.py`: runs `bake/src/C1/draw.py` (12 layers), `apps/f30_cluster/hud/scene/speedo.json`, the 0.7.21 bench frame `bake/work/shots/20261118-2239/C-scenarios/comfort/02-motorway-130-nopass.png` |
| `shading_{uk,en}` | `src/r4_dial.py`: the same code with `LIGHT.rim_mod` 0, no bezel lobes, no shadow / glow layers ("off"); curves from `params.py`; the needle sketch from the WBDIAL constants (a drawing) |
| `layers-exploded_{uk,en}` | `src/r4_layers.py`: decoded scene textures (window, horizon, bar, speedo, tacho, fuel, oil) at the `wb_comfort.json` positions; plane 4 = bench frame minus planes 2–3 (an illustration) |
| `twin-r8-face_{uk,en}` | `src/r4_twin.py`: `apps/twin_dial/hud/scene/face_tacho.json` decoded by `tools/twin-dial/face_shade.py` at 6500 rpm |
| `rectify_{uk,en}` | `src/r4_rectify.py`: the owner's photo `reference/g20/10_grid_over-stock.jpg` (town name blurred twice through a feathered mask; EXIF dropped), `bake/work/overlay/rect/10.png` (blurred the same), `H.json` |
| `masks-glyphs_{uk,en}` | `src/r4_masks.py`: `strip_mask.json`, `fonts/wb_msg.json` |

Revision-3 pictures were re-rendered with impersonal labels (`src/diagrams.py`, `src/photos.py`, `src/compose.json`);
`compose.json` paths are now relative to the repository root (`compose.py` changes directory to it).
