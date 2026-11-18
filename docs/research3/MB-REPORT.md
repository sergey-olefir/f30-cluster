# MB: the black rectangle — what f30_cluster does that Twin Dial does not

Brief: `docs/AGENT-BRIEF-research3.md` §3 MB. Branch `research3/mb` (worktree `.claude/worktrees/r3-mb`), off `main`
82927e5. No car, no push, no version bump. Labels: **verified** = measured here (command given), **hypothesis** = needs
the car, **refuted** = contradicted by a measurement or by a car observation already on record.

## 0. Answer

The two apps say the same things to cluster-render except four, and only one of them is at BMW's gear letter:

1. **f30_cluster puts a layer RECTANGLE (and opaque pixels) over BMW's bottom-row gear letter in every theme and
   state; Twin Dial never puts any layer rectangle within x 1380–1460, y 660–720** (verified, §2). Every cluster-render
   layer is a RAMSES quad scaled to its rectangle inside the scene the KOMBI renders itself (upstream
   `graph_ramses19.cpp` `quad()`), so the KOMBI receives our rectangles as geometry, not only as pixels.
2. f30 rebuilds all its layers on every drive-mode change (it changes theme), with 0.8–5.8 MB of texture uploads and
   36–55 KB of shader source per switch (20–26 KB of it never sent before); Twin Dial changes nothing on a drive-mode change (verified, §1). But Twin
   Dial **also** rebuilds everything at start (twice) and on every check-control message, so "a rebuild" as such is
   shared.
3. f30 is heavier (21 layers / 3 connections vs 14 / 3; 11.4 vs 4.7 MiB pixel memory; largest shader 13.3 vs 4.5 KB),
   inside every limit in both (verified, §1).
4. Neither app ever makes cluster-render release or re-map the panel: the longest time with no layer at all is 1–18 ms
   (f30) and 0–3 ms (Twin) against `panel_linger_ms` 3000 (verified, §1). Slot, content id, class and DCSM client
   id are cluster-render's, identical for both; both send only `target: "panel"`, class `content`, no `exclusive` /
   `prewarm` / `contend` / `guide_hold` (verified).

Ranked theories (§3): **(a) our rectangle / paint over the gear letter — supported, first**; (b) the rebuild on a
mode switch — weakened (Twin rebuilds too; a f30 layout switch alone did not bring the box on 11-13; the mode switch is
also a KOMBI event both apps see); (c) layer count / pixel memory — weakened; (d) map slot / content id — refuted for
the apps; (e) unmap/map timing — refuted on the bench. Whether the KOMBI reacts to the **rectangle** or to the
**pixels** under the letter is the open question. One old observation already leans to the rectangle: in the 11-13
photos 41–43 (box present) the build very likely installed, 0.7.7 "6WB Dials + G20", had **alpha 0 on every pixel over the
letter** while two layer rectangles covered it (verified by replaying 0.7.7, §3.1; caveat: cluster-render 0.5.8 era,
H1 not excluded). The experiments of §4 settle it in two installs.

Experiments on this branch, each one app.json `config` key, all absent (= off) in the shipped `app.json`
(`shared/mb_exp.js`, hooks in `shared/hud.js` marked `research3 MB`; ready-made keys in `tools/research3/mb/exp/`):

| Key | App | What it does | Measured on the bench |
|---|---|---|---|
| `mbGap` | f30 | every effect layer touching the gap is made as up to 4 layers round it (same shader, `u_sub` maps v_uv back); 3 widgets (`row_b2`, `msa`, `oilt` with z 2 to keep its place in the stack) moved to a 4th connection to stay ≤ 8 a connection | 0 layers touch the gap in all 9 states and 4 themes; picture outside the gap identical (max 0.03 of a code, 0 px > 2 codes); 25 layers, ≤ 8 a connection, 0 waiting at cap 8; pixel memory unchanged |
| `mbCover` `"clear"`/`"black"`/`"grey"` | Twin (any) | one layer over the gap at z 1000, transparent / black / f30 Comfort's grey | one 80 × 60 layer, 15 layers; nothing else changes |
| `mbRebuild` `{onMode}` / `{everyMs}` | both | rebuild the same layout on every drive-mode change / every n ms | Twin: a mode change drops and re-makes all 14 layers |

## 1. The trace: every message to cluster-render

**Method.** `bench/server.js` got an opt-in tap (`BENCH_TRACE=<file>`, off unless set): one JSON line per message an
app sends (op, ref, connection, kind, target, class, z, rectangle, shader length + hash, uniform name + count, frame
rects + bytes) and per event back. `tools/research3/mb/trace.py <app> <variant>` starts a bench on port 8303 (via
`tools/shots/bounded.py`), fixes the signals (manual, 1500 rpm, 50 km/h, D) and runs the same session for both apps,
marking each step: start → drive mode Comfort (4) → Sport (1) → Eco Pro (7) → Comfort → night → day → message on
(ccList [id 40, stored 987], statusActiveCCMessage 40) → message off (0, ccList resting) → 10 s idle.
`tools/research3/mb/analyse.py` summarises. Data: `design/research3/mb/traces.json` (run 1, incl. f30 `g20` and
`nomode`), `traces-repeat.json` (runs 2 and 3). Raw traces: `bake/work/research3/MB/trace*/`.

**Spread.** Three runs of each app: every count (layers, drops, assets, frames, bytes, shader bytes) is identical
between runs; only the split between "pre" and "start" moves with the mark's timing. Times vary: rebuild window
f30 6–36 ms, Twin 10–16 ms; no-layer gap f30 1–18 ms, Twin 0–3 ms.

### 1.1 Per step (run 1; f30 = 6WB Comfort, defaults: "Change with the drive mode" on, G20 off)

| Step | f30: made / dropped layers, assets +/−, bytes sent, new shader bytes | Twin: same |
|---|---|---|
| start (two builds, the second ~250 ms after the first) | 42 / 21, 11 / 0, 7.5 MB, 34.7 KB (5 shaders) | 28 / 14, 5 / 0, 4.1 MB, 8.2 KB (4) |
| drive mode → Comfort (no change) | 0 / 0, one 5.7 KB text frame | 0 / 0, one 8.6 KB frame |
| → Sport | **18 / 21, 1 / 6, 0.85 MB, 26.1 KB new (41.4 KB made)** | 0 / 0, one frame |
| → Eco Pro | **15 / 18, 0 / 3, 1.04 MB, 20.7 KB new (36.4 KB made)** | 0 / 0, one frame |
| → Comfort | **21 / 15, 8 / 0, 5.79 MB, 55.2 KB made** | 0 / 0, one frame |
| night, day | 0 / 0; 35 frames + 57 uniforms, 99 KB each | 0 / 0; 15 frames + 20 uniforms, 137 KB each |
| message on | **21 / 21** (full rebuild), 1.58 MB | **14 / 14** (full rebuild), 1.61 MB |
| message off | 1 frame + 1 uniform | 7 frames + 8 uniforms |
| idle 10 s | nothing | nothing |

With "Change with the drive mode" off (`nomode`), f30 does nothing on a mode change either (1 frame each), exactly like
Twin; with G20 on, f30's mode switches cost the same as above.

### 1.2 What f30 does that Twin never does

| # | f30 only | Twin |
|---|---|---|
| T1 | layer rectangles over the gear letter and the gap: bg (0,0,1920,720) z0 and tacho (1173,45,670,670) z1, in every state | none (backdrop is (0,0,1380,720), (1380,0,540,660), (1460,660,460,60)) |
| T2 | a full rebuild on a drive-mode change, with new shaders and texture uploads (assets dropped and made) | never; its rebuilds (start, message) re-make the same shaders and keep every asset |
| T3 | 21 layers (7 / 7 / 7 on three connections), 20 assets over a session, 11.36 MiB pixel memory (cluster-render's accounting) | 14 layers (6 / 6 / 2), 5 assets, 4.73 MiB |
| T4 | 13 distinct fragment shaders over the session, 81.6 KB; the largest 13 267 B (the 6WB dial) | 4 distinct, 8.2 KB; the largest 4 461 B |

Shared by both (so ruled out as the cause of a difference): connect + hello on three connections; target `panel`
only; class `content` only; no special layer flags; a double build at start; a full drop-and-make on a message
(the target empty for ≤ 18 ms); day/night as uniforms and frames only; no asset over 16 a connection; nothing refused,
nothing waiting.

**f30's Waze path is dead in 0.7.20**: `_wazeWant()` needs the setting `mapInTheme`, which `apps/f30_cluster/app.json`
no longer declares, so f30 never moves Waze-on-Cluster's map to the panel (verified, code read). BMW's own map in the
cluster (slot 0x100) is mapped by the HMI whatever app draws the panel.

## 2. Geometry against BMW's elements

`tools/research3/mb/geometry.py` replays each step's snapshot with package O's renderer (`tools/strip/O/render.py`: the
apps' real shaders on the Mac GPU) and reports, per region, the layers whose rectangle touches it and our composite
alpha. Data: `design/research3/mb/geometry-default.json`, `geometry-g20.json`, `geometry-gap.json`.
Regions: gear letter [1398, 668, 1424, 703]; gap [1380, 660, 1460, 720]; box [1406, 342, 1597, 419] (`shared/visible.js`;
the overlay catalogue's `overlay.black_box` is [1422, 320, 1612, 440]); BMW's stock gear place [1496, 320, 1543, 395];
map [555, 155, 1395, 612]; message panel [699, 603, 1223, 700].

| App / theme | Gear letter: rectangles over it | our alpha there | our colour there | Gap |
|---|---|---|---|---|
| f30 6WB Comfort | bg (whole), tacho (whole) | 1.0 on 100 % | (24, 24, 25) dark grey | 2 rects, 100 % opaque |
| f30 6WB Comfort + G20 | bg (whole), tacho (whole; its pixels there alpha 0) | 1.0 on 100 % | (0, 0, 0) | 2 rects, 100 % opaque |
| f30 6WB Sport | bg, tacho | 1.0 | (4, 0, 0) | same |
| f30 6WB Eco Pro | bg, tacho | 1.0 | (2, 3, 5) | same |
| Twin Dial (every state) | **none** | **0** | – | **no rectangle, alpha 0** |
| f30 + `mbGap` (every theme, state) | **none** | **0** | – | **no rectangle, alpha 0** |

The same in all nine steps of each run (day / night / message do not change it). Other regions:
- **The box's area**: both apps paint it fully opaque (f30 Comfort the red hub (62, 23, 25), Sport / Eco black; Twin
  (35, 35, 35) with the speed digits, layer (1417, 374, 246, 70)). So a box would be as visible on Twin as on f30:
  the owner's "no box on Twin" is a real negative, not a box hidden by black paint.
- **The map**: f30 opaque 98.5 % (G20 Comfort 45 %: see-through round the dials), Twin 98.2 %. Neither app leaves BMW's
  map visible by default.
- **The message panel**: both start with the window open (5–6 % opaque: the blind start) and cover it after the
  message clears; the same in both (MC's subject).

## 3. The theories, ranked

| # | Theory | Diff evidence | Car / outside evidence | Verdict |
|---|---|---|---|---|
| a | **Our rectangle (or paint) over BMW's gear letter** | the only difference at the letter (T1): f30 always, Twin never; f30's G20 / Sport / Eco are black there but still a rectangle | bimmer-lab (X3, same panel, same box coordinates): a geometry gap over the letter removed it; #199 (G80): a layer ending at y 646 had no boxes, a full one did; on 11-13 the box came after P → D and stayed through later switches (CAR3-K §1): a KOMBI event while covered, then latched; in 41–43 our pixels over the letter were transparent, only rectangles covered it (§3.1) | **supported, first** (a1, the rectangle, leads) |
| b | **The rebuild on a drive-mode switch** | f30 only (T2) — but Twin rebuilds fully at start and on every message (14 / 14, empty ≤ 3 ms) and shows no box; f30's rebuild differs only in what it brings (new shaders, textures) | 11-13: a layout switch alone (32 → 34) brought no box, and later switches did not clear it (38 → 41). A drive-mode switch is also a KOMBI event (the drive-mode pop-up, FES `requestSwitchDrivingExperienceInstrumentPackDisplay`) that Twin users get too | **weakened**; confounded with (a) until E-T1 / E4 |
| c | **Layer count or pixel memory near a limit** | f30 21 / 32 layers, ≤ 7 / 8 a connection, 11.4 / 16 MiB; nothing refused or waiting; f30 `mbGap` adds 4 layers (25) | no limit message in any car log read so far (BR); a resource limit does not explain a box at one fixed BMW place | **weakened** (the KOMBI's own limits are unknown) |
| d | **The map slot or a content id used only by f30** | both send only `panel`; slot / id / class / client id are cluster-render's config; f30's Waze move is dead code in 0.7.20 | BMW's map (0x100) is the HMI's, the same under either app | **refuted** for the apps (Waze's own HUD map on 0x1000400 remains BR's E2, app-independent) |
| e | **Timing between unmap and map** | no unmap at all in either app: empty for ≤ 18 ms vs a 3000 ms linger | car log (BR): every 0x203 re-map came from a KOMBI lock (door, wake-up), not from a switch | **refuted** on the bench; one log read confirms (§5) |
| f | (new) **KOMBI load per switch**: shader compile and texture upload | f30 sends 36–55 KB of shader and up to 5.8 MB of texture per switch (T2, T4) | the KOMBI is known to reset on too-big shaders (kombi-shader-size); nothing ties load to the box's place | **hypothesis, low** |

Within (a), two readings remain and the code cannot tell them apart:
- **a1, rectangle**: the KOMBI reacts to client geometry over the letter (it has it: one quad per layer).
- **a2, pixels**: the KOMBI checks the composed picture around the PRND indicator (a region compare / CRC, plausible
  for a safety indicator whose data is E2E-protected, BS §3) and falls back to its stock place, whose dark backing is the
  box. a2 predicts no box for opaque **black** under the letter (f30 G20 / Sport ≈ black) and for transparent pixels.
  The 11-13 box photos 41–43 had **transparent** pixels under the letter (§3.1): a1 is the better-supported reading.

### 3.1 What 0.7.7 drew under the letter in the photos

The 11-13 photos with the box (38: "6WB Comfort + BMW map", 41–43: "6WB Dials + G20") were taken on 0.7.7 (CAR3-K
§2 compares against "exactly as 0.7.7"). Commit `ad24fe3` (0.7.7) was checked out into a scratch worktree, run on its
own bench (`tools/research3/mb/oldsnap.py`, P, manual signals) and replayed (`design/research3/mb/geometry-v077.json`):

| 0.7.7 layout (photo) | Rectangles over the gear letter | Our alpha on the letter | Box in the photo |
|---|---|---|---|
| 6WB Comfort (32, 33) | bg, tacho | 1.0, (24, 24, 25) | no (P, at start) |
| 6WB Comfort + BMW map (38) | bg, tacho | 1.0, (24, 24, 25) | **yes** (D) |
| 6WB Dials + G20 (34–37 / 41–43) | bg, tacho | **0.0 on every pixel** (gap: max 0.057) | no in P (34–37) / **yes** in D (41–43) |

**In 41–43 the box was there while every pixel of ours over the letter was fully transparent and only our two layer
rectangles covered it** (verified for 0.7.7's code; that the car ran exactly that build at those photos is CAR3-K's
reading). That speaks for **a1 (the rectangle)** and against "our pixels under the letter" (a2). Two caveats keep it a
hypothesis: those photos are from the cluster-render 0.5.8 days, very likely with the panel on the speech-dialog id
0x1000400 (BR finding 2, H1), which can bring a box of its own; and "transparent" is our alpha, so a KOMBI that tests
coverage rather than colour would see no difference. E2 (Twin with a clear rectangle over the letter, on today's
cluster-render 0.5.12 with the panel on its own id) is the clean test.

## 4. Experiments ready for the car

All are installs (writes to the car): **NEEDS THE OWNER'S APPROVAL** for each build. Each is one `config` key; the
lead makes the build by merging the file from `tools/research3/mb/exp/` into the app's `config` (or a probe build
does). The log says which is on (`mb: experiment on: ...`, `mb gap: widget ... as N layers`, `mb cover: ...`,
`mb: drive mode changed, the layout stays: rebuilding ...`). Undo: reinstall the build without the key.

| Id | App + key | Question it answers | Bench proof |
|---|---|---|---|
| E1 | f30 + `mbGap` (`exp/f30-gap.json`) | does f30 stop getting the box when nothing of ours is over the letter, everything else unchanged? | §0 table; `bench/test-mb-exp.js` part 2; `design/research3/mb/diff-f30-gap.json` |
| E2 | Twin + `mbCover: "clear"` | does a bare rectangle (transparent pixels) over the letter bring the box? (a1 vs a2) | test part 3 |
| E3 | Twin + `mbCover: "black"`, then `"grey"` | if E2 gives no box: do opaque pixels bring it, and do they have to differ from black? | unit test; `twin_dial-cover-grey` trace |
| E4 | Twin + `mbRebuild: {onMode: true}` (or `{everyMs: 30000}`) | does rebuilding as f30 does, with the letter free, bring the box? (b alone) | test part 3; `twin_dial-rebuild-mode` trace |
| E5 | f30, no build: "Change with the drive mode" **off** | does the box come with gear / drive-mode changes when f30 never rebuilds? (b vs a, today's build) | `nomode` trace: 0 layers made on a mode change |

### 4.1 The owner's protocol (one session, parked, engine running, brake held for gear changes)

For every step: **one photo of the whole cluster** (the right dial's hub, the bottom row with BMW's gear letter, the
centre), and a note: app, theme, G20 on/off, gear, drive mode, box yes/no. The box is the black rectangle over the right
dial's hub, cutting the needle (Twin Dial: it would cut the speed digits).

0. **Baseline (installed builds, nothing new).** Twin Dial: P → D → N → R → P, then the drive-mode button Comfort →
   Sport → Eco Pro → Comfort. Expect no box. Then f30 6WB Comfort, "Change with the drive mode" on: the same.
1. **E5** (today's f30): "Change with the drive mode" off, theme 6WB Comfort, the same gear and mode changes. Then G20 on,
   again.
2. If the box showed in 0 or 1: with the box up, pick another theme in the menu (a rebuild, no KOMBI event) — does it
   stay? Then P → D → P — does it go?
3. **E2** (Twin, clear rectangle): the sequence of 0. **E3** (black, then grey) only if E2 shows no box.
4. **E1** (f30 with the gap): the sequence of 0 in 6WB Comfort, Sport (mode switch) and with G20 on.
5. **E4** (Twin rebuilding on each mode change): the drive-mode sequence of 0, three times.

The lead, read-only, at the moment of any box (BR's E0): `grep -e 'slot 0x20' -e 'slot 0x323' /run/cluster-render/status.txt`
and the last 60 lines of cluster-render's log for `slot 0x203`, `slot 0x200`, `falling back`, `went away`; and the app's
log for the `mb` lines and its rebuild lines (`layout "...": N widgets`).

### 4.2 What each outcome proves

| Outcome | Means |
|---|---|
| 0: Twin no box, f30 box | the observation reproduces; go on |
| 1 (E5): box with mode/gear changes while f30 never rebuilds | (b) is not needed: a KOMBI event while the letter is covered |
| 1 (E5): never a box with E5 on, box with it off | (b) the rebuild (or what it uploads) matters; then E4 |
| 2: the box stays through a theme change and clears only at a gear change with the letter free | latched by the KOMBI, as BC §0.4 says |
| E1: no box in any theme | **cause found: our cover of the letter**; ship the gap (as Twin), choose the look of the 80 × 60 window |
| E1: box as before | not the letter (or the window must also leave BMW's mode label); back to (b)/(f) |
| E2: box | the KOMBI reacts to a **rectangle** over the letter (a1): pixels cannot fix it, only geometry |
| E2: no box, E3 black: no box, grey: box | the KOMBI compares **pixels** (a2): black under the letter is enough — f30 could stay one rectangle if it paints black there (G20, Sport already do) |
| E2, E3: never a box on Twin | covering the letter is not sufficient on its own; with E1 decides between (a) and (b) |
| E4: box | rebuilding alone (with the letter free) brings it: the KOMBI dislikes our scene changing; fix in the rebuild |
| E4: no box | the rebuild alone does not |

The cheapest order that separates the theories: 0 → 1 → (one install) E2 → (one install) E1; E3 and E4 only if needed.

## 5. What the car must answer (read-only, for the lead)

1. During any box: the slot table (above) — 0x203 on 0x10004f8 (not 0x1000400), 0x200 disabled, 0x323 empty; and no
   `asking for scene … after its release` line at a f30 switch (theory e).
2. The photos of §4.1.
3. Nothing else: the experiments add no signal, no setter, no probe.

## 6. Files

- `bench/server.js`: `BENCH_TRACE` (off unless set).
- `shared/mb_exp.js` (new), `shared/hud.js` (hooks marked `research3 MB`, inert while `this.mbExp` is null),
  `apps/*/app.json`: `mb_exp.js` in `shared` (packaged; never loaded without a key).
- `bench/test-mb-exp.js` (new).
- `tools/research3/mb/`: `trace.py`, `analyse.py`, `geometry.py`, `diff.py`, `oldsnap.py`, `exp/*.json`.
- `design/research3/mb/*.json`: the numbers above.
- `docs/research3/MB-UPSTREAM-DRAFT.md`: the draft for the upstream issue (not posted).

## 7. Tests (this branch, one at a time, `BENCH_PORT=8303`)

| Suite | Result |
|---|---|
| `bench/test-mb-exp.js` (new) | 46 passed: off without a key; the pieces never touch the gap and cover the rest exactly (6 rectangles); all 37 shaders with v_uv rewritten (< 100 bytes more, v_uv read only through `u_sub`); fan-out of uniform / bind / set / drop; cover and its drop; on the bench f30 + `mbGap` in Comfort, Sport, Eco Pro, Comfort + G20 at cap 8 (no rectangle on the gap, nothing waiting, ≤ 8 a connection); Twin + cover + rebuild on mode; Twin as shipped (no `mb:` line, nothing on the gap, nothing dropped on a mode change) |
| f30: test-bottom-row / native-ui / strip-mask / fonts / probes / daynight / night | 254 / 47 / 40 / 34 / 25 / 24 / 48 passed, as on `main` |
| twin: budget / layout / pages / cc / probe / fonts / bake / sim | 75 / 61 / 100 / 149 / 110 / 219 / 35 / 39 passed, as on `main` |

Not proven here: anything on a car; whether the KOMBI compiles the cut pieces' shaders (each +73–77 bytes; the largest,
the 6WB dial, 13 344 bytes, against a reset seen above ~26 000); the bench's fp32 against the car's fp16 (the `u_sub`
maths is one multiply-add on values ≤ 1 in highp where available, as the shader already declares).

The picture of each experiment against today's (`tools/research3/mb/diff.py`, every traced state):
f30 + `mbGap`: 0 px differ by more than 2 codes outside the gap (max 0.03), the 80 × 60 gap itself becomes ours-free
(`design/research3/mb/diff-f30-gap.json`; PNGs in `bake/work/research3/MB/diff/f30-gap/`). In 6WB Comfort this shows
as an 80 × 60 black notch in the dark-grey (24, 24, 25) strip round BMW's letter; in G20 / Sport / Eco Pro our strip
is already black (0–5) there. Twin + cover: 0 px differ outside the gap (`diff-twin-cover-grey.json`).
