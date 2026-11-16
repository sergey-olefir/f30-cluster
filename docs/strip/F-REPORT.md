# Package F: Cyrillic fonts and the end of the generator drift

Branch `strip/F` (base `integrate/bottom-row` 3c8ef46). Date 2026-11-16. Bench port 8163.
Status words: **verified** means computed from the engine's own rule, run on the bench or read from the files.
**Hypothesis** means it has not been checked on the car. Nothing in this package was run on the car.

## 1. Verdicts

1. **Ukrainian is baked into `wb_cap` and `wb_capb`** (verified on the files and the bench). Each font now has:
   - the 66 Ukrainian letters (33 upper, 33 lower);
   - both apostrophes ' and ʼ, plus the quote marks ‘ ’ « » „ “ ”;
   - the en and em dashes – —, the number sign № and the ellipsis …;
   - plain punctuation: , ; ! ? ( ) " % & # * = _.

   `wb_capb` also gains lowercase Latin and `. : + - °`. A Ukrainian road label and a Ukrainian message are drawn by
   us with no latch. On the bench there is ink above the capitals (Ґ) and below the baseline (р, у), so the taller
   cell is not clipped.
2. **No other font draws the car's text** (verified with `grep` over the token table and the layouts). Only
   `{{road}}`, `{{ccName}}` and `{{ccDesc}}` carry the car's own words, and all three are drawn in `wb_cap`.
   `{{mode}}` is our own English label, and `wb_val` and `wb_row` draw only figures and units. The GPU glyph atlases
   (`hud.js _atlas`) take only ASCII, so Cyrillic never reaches a GPU atlas.
3. **The source font already had every glyph** (verified with fontTools): `tools/fonts-src/Roboto-wdth-wght.subset.ttf`
   (SIL OFL) has 255 Cyrillic codepoints. The only gap is U+02BC, the modifier-letter apostrophe that Ukrainian
   spelling prefers. It is drawn with U+2019's glyph, which has the same shape (`CAR_SUBS`). Nothing was downloaded
   and nothing of BMW's was used.
4. **The generator drift is fixed for good** (verified, `bench/test-fonts.js`):
   - `design/gen_6wb.py` reproduces all five committed layouts byte for byte.
   - A font re-bake can no longer move ink. It changes boxes only, and the test holds every text to its recorded
     baseline.
5. **Cost** (verified on the bench, Latin scenes in both runs):
   - **Peak:** the worst state went from 13.22 to **13.58 MiB of 16**. That state is 6WB Comfort + G20 with the
     whole row ours and a message showing.
   - **Switch peaks:** no switch rises above the higher of the two layouts it moves between.
   - **Layers:** the counts are unchanged in every state, with no refusals.
   - **Where the 0.37 MiB comes from:** almost all of it is a side effect of the sheet packer, not of the glyphs.
     With the taller `mode` box, the packer now merges `limit` and `mode` into one wide sheet (§3.2).
   - **The cheaper option:** leaving `wb_capb` without Cyrillic costs about 0 (measured). Section 3.3 has the
     decision for the lead.
6. **A character still missing falls back to BMW** (decided and kept). We never draw a replacement glyph (§5).
7. **Package T's sizes are applied as bakes** (T's file is marked **provisional**; §2.1).
   - `wb_row` is re-weighted to T's setting. It keeps its size, cell and baseline, and only the figure widths change.
   - Four new faces are baked at BMW's measured sizes: `wb_road` and `wb_msg` (both with Ukrainian), `wb_rowu` and
     `wb_lim`. **No layout uses them yet.** Moving the road label, the message, the units and the limit onto them is
     package X's code (`nav_row`, `cc_row`, the row parts), together with T's placement offsets.

## 2. What was baked

| font | used for | glyphs before → after | cell before → after | baseline offset | atlas (alpha bytes) | JSON in hud.pack |
|---|---|---|---|---|---|---|
| `wb_cap` (Roboto wdth 87.5, wght 650, 21 px) | captions, road label, message | 69 → 161 | 24 → **28** | 18 → 21 | 1024×24 → 1024×84 (24.0 → 84.0 KiB) | 36 664 → 123 782 B |
| `wb_capb` (wght 700, 21 px) | READY, mode, CHARGE / POWER (message headline, if X uses it) | 38 → 161 | 22 → **28** | 17 → 21 | 1024×22 → 1024×84 (22.0 → 84.0 KiB) | 32 241 → 123 784 B |

- The cell grows for three reasons:
  - Й, Ї and Ґ rise 4 px above the capitals: their tops are at −19 against −15.
  - Д, Ц and Щ reach the lowercase descender (+4).
  - The parentheses go one row lower still (+5).
- **hud.pack:** +178 661 bytes (+174 KiB) of font JSON.
- **JS heap:** +122 KiB of decoded atlas.
- **Pixel memory:** the font atlases cost none, because the text is rasterised on the CPU into sheets. Only the taller
  text boxes cost pixel memory (§3).
- **The atlases are reproducible.** Re-running `tools/bake_fonts.py f30_cluster` at the base gave byte-identical
  JSON for all 14 F30 fonts, so the bake is deterministic. Pillow was 13.0.0.

### 2.1 Package T's sizes (commit 4f9c6f5; from `bake/work/strip/pub/T/typography.json`, provisional)

I checked each new bake against T's targets by reading the glyph heights off the atlases:

| font | setting | measured on our bake | T's target (BMW) | used by |
|---|---|---|---|---|
| `wb_row` | 43 px, wght 450, wdth 100 (was 500 / 87.5) | figure 31, digit advance 24, cell 35, baseline 33 (unchanged) | figure 31.1, advance 24.12 | own range, clock, temperature (already) |
| `wb_road` | 42 px, wght 325, wdth 90.625, Ukrainian | cap 30, x 22, cell 51, baseline 39 | cap 29.76, x 22.0, baseline 700.17, centre 961.38 | nothing yet. For X: `nav` |
| `wb_msg` | 35 px, wght 450, wdth 87.5, Ukrainian | cap 25, x 18, cell 44, baseline 34 | cap 24.6–25.0, x 18.3–19.2, one line at 669.23 | nothing yet. For X: the message line |
| `wb_rowu` | 34 px, wght 300, wdth 87.5, `kmiCF°l/h` | C 24, k 26, m 18, cell 32 | C 24.25, k 22.6 (Roboto's k is taller, T's note) | nothing yet. For X: `own_range_u`, `own_temp_u` |
| `wb_lim` | 38 px, wght 450, wdth 87.5, figures | figure 27 | 26.75, stem 3.94 | nothing yet (optional). For X: `limit` |

**Ink moves from the `wb_row` change** (intended, per T). No box moves, and the right edges are held:

| widget | ink before | ink after |
|---|---|---|
| `own_range` | x 181–248 | x 178–248 |
| `own_clock` | x 347–447 | x 345–449 (BMW's measured clock: 345.7–450.0) |
| `own_temp` | x 1513–1614 | x 1508–1614 |

These are the same in `wb_dials` and `wb_sport_dials`.

**What is left for X:**

- T's horizontal placement offsets, for example `own_range` +5.25 px and `own_temp` +7.75 px, and its 1.13 px
  baseline offset (697 → 698.13).
- These are positions in X's row code. F changed fonts only.

**What the new fonts cost:**

- **hud.pack:** `wb_road` 357 KB and `wb_msg` 249 KB of JSON; `wb_rowu` and `wb_lim` together under 100 KB.
- **Pixel memory:** none until a layout uses them.
- **Once X wires them:**
  - the `nav` box grows from 28 to 51 px, which is +0.18 MiB of sheet pixels for a 540 px wide box before any
    packing effect;
  - each message line grows from 28 to 44 px;
  - **re-measure with `tools/strip/F/measure.js` then**, and weigh it against the headroom note in §3.3.
- **Hypothesis: wb_cap's Cyrillic.** If X moves the car's text onto `wb_road` and `wb_msg`, `wb_cap` and `wb_capb`
  will no longer need Cyrillic, and T says the same. Keeping it costs about 12 KiB for `wb_cap`, plus the 0.37 MiB
  packer effect for `wb_capb` (§3.2).

## 3. Cost per layout (bench, `BENCH_LAYER_CAP=8`, 16 MiB rule)

The measurements below were taken before T's sizes. `wb_row` kept its cell and the new fonts are unused, so the
numbers still hold. Both suites were re-run on the final state, with no refusals.

### 3.1 Method

- `tools/strip/F/measure.js` starts its own bench on port 8163 with `tools/strip/F/peak.js` preloaded.
- `peak.js` logs the bench's own pixel count (`pixelBytes()`: every image and asset counted twice) every time it
  changes.
- The script walks 17 steps: every 6WB layout, both `bottomRow` modes and the message state, plus every pair of
  layout switches.
- `peaks.py` then gives each step's start, end and switch peak.
- Raw numbers are in `design/strip/F/cost.json`.
- "Before" is the base commit's fonts and layouts on this branch's engine. The comparison uses Latin scenes, because
  the base fonts would latch on Cyrillic.

| state | before MiB | after MiB | Δ | layers before / after |
|---|---|---|---|---|
| 6WB Comfort | 11.527 | 11.539 | +0.012 | 21 / 21 |
| 6WB Comfort + G20, `allG20` | 10.728 | 10.740 | +0.012 | 15 / 15 |
| 6WB Comfort + G20, `all6WB` (road label, sign, clock ours) | 12.025 | 12.422 | **+0.397** | 20 / 20 |
| 6WB Comfort + G20, `all6WB`, message ours | 13.216 | 13.584 | **+0.368** | 20 / 20 |
| 6WB Sport | 2.104 | 2.446 | **+0.342** | 18 / 18 |
| 6WB Eco Pro | 3.045 | 3.052 | +0.007 | 14 / 14 |
| 6WB Sport + G20 | not measured: no setting loads it (only a stale `settings.json` could) | | | |
| **highest point of the whole walk, switches included** | **13.216** | **13.584** | +0.368 | |

- **Switch peaks:** every switch peaked at the higher of its two ends, with an overshoot of 0.000 MiB in all 17 steps,
  before and after. The engine drops a layout's layers before it makes the next one's.
- **Cyrillic scenes:** the same walk with Cyrillic text gives identical numbers. Boxes do not depend on the string.

### 3.2 Why three states pay about 0.35–0.4 MiB

- **The packer rule.** `hud.js _plan` lets a text join a sheet only while the sheet's union box stays within
  `packWaste` (8) times its members' own area.
- **Before:** the `limit` figure [321, 490, 60×32] and the `mode` label [1388, 514, 240×25] are both on connection 2
  at z 5. Their union was 1307×49 px, 8.09 times their area, so they stayed apart.
- **After:** `mode` is 28 px tall and the ratio drops to 7.2. They now share one 1307×48 sheet, which is 0.48 MiB of
  mostly empty pixels. The `READY` sheet shrinks by 0.06 MiB. The layer count is the same.
- **The cause is verified.** With `wb_capb` left Latin-only, the same three states measured 12.017, 13.209 and
  2.109 MiB, which is the base within ±0.01.

### 3.3 Options the lead decides

| option | glyphs | worst state | what it costs |
|---|---|---|---|
| **as shipped**: Ukrainian in `wb_cap` and `wb_capb` | 161 + 161 | 13.584 MiB | +0.37 MiB in the 3 states above |
| `wb_capb` Latin-only: Ukrainian only in `wb_cap`, the one font that draws car text today | 161 + 38 | 13.209 MiB (measured) | nothing. If X draws a bold headline it needs its own bold Cyrillic font, which costs nothing until a layout uses it |
| **wider set** (`CAR_WIDE = True`): adds ЁЪЫЭЎ ёъыэў and the Latin accents of German, French, Spanish, Polish and Czech street names (85 more glyphs) | 246 + 246 | 13.590 MiB (measured) | +6 KiB pixel memory, cell 29 (Č, Ć, Ż reach −20), +97 KiB of font JSON in hud.pack, 1024×116 atlases. A road name abroad would then rarely latch |

**Warning for the merge: headroom.** At 13.58 MiB, a full-resolution RGBA strip mask from package M (1920×180×4 bytes,
counted twice, 2.64 MiB) would pass 16 MiB in the message state. An R8 mask (0.66 MiB) fits either way. With
`wb_capb` Latin-only, even the RGBA mask would fit, at 15.85 MiB. This is a hypothesis about M's format; M decides
the format.

## 4. The generator drift, and its fix

### 4.1 What it was

- **Where the ink lands.** The engine draws a text's glyph cell from the top of its box (`shared/hud_text.js
  mask()`), so the ink is at the box's y plus the font's baseline offset.
- **How the box was placed.** `text()` centred the box on `cy` using the font's current cell height.
- **What went wrong.** The committed layouts had been generated on the Arimo cells: `wb_cap` 26, `wb_capb` 25,
  `wb_val` 32, `wb_big` 90. The fonts were later re-baked in Roboto (24, 22, 33, 92) without regenerating the
  layouts. Regenerating then moved the ink, measured with `tools/strip/F/inkbox.py` (the engine's mask rule, read off
  the atlases):

| font | texts | ink move on regenerate (old generator) |
|---|---|---|
| `wb_cap` (placed by `cy`) | captions, `range_in`, arc labels, row heads | **+1 px** (down) |
| `wb_capb` | READY, mode, CHARGE, POWER | **+2 px** |
| `wb_big` (GPU) | Sport's big speed | **−1 px** |
| `wb_cap` placed by baseline (`base_at`) | `cc_name`, `cc_desc` | +1 px; `nav` 0 |
| `wb_val`, `wb_row`, `wb_spd`, `wb_rpm`, `wb_gear`, `wb_mini` | everything else | 0 (`wb_val`'s box height only) |

### 4.2 The fix (`design/gen_6wb.py`, the package F block at the top)

- **Each position becomes a baseline once.** It is computed on the cell the position was placed and checked on.
  `PLACED_ON` freezes, per font, the box height it was centred with and the baseline of the font the car has drawn it
  in since.
- **The box is built round that baseline** from the font as baked now: y = baseline − baseline offset,
  h = cell height.
- **`base_at(font, baseline)` keeps its meaning** for `nav_row`, `cc_row` and `own_row`, so they needed no change.
- **The result:** a re-bake moves boxes, never ink.
- **Tested both ways:**
  - With today's fonts (the first commit), every text's ink is exactly where the committed layouts put it.
  - With the Cyrillic fonts, it is still there.
  - With the wider set, all baselines hold too: only the "ß is missing" check fails, as it should.

### 4.3 Before and after, every text widget (committed base → strip/F, Latin samples)

| result | texts |
|---|---|
| ink and box identical | 94 |
| box changed, ink identical | 55: every `wb_cap` / `wb_capb` text (taller box, same baseline), `wb_val` texts (h 32 → 33), `wb_big` (h 90 → 92) |
| **ink moved (intended)** | 4: `cc_name` and `cc_desc` in `wb_dials` and `wb_sport_dials`, **+1 px** down |
| **ink moved (intended, T)** | 6: `own_range`, `own_clock` and `own_temp` in both see-through layouts, wider figures (§2.1), same baseline |

- **Why the message lines move.** They now sit on the measured baselines 645.8 and 690.2, rounded to 646 and 690.
  Before they were at 645 and 689, which was the drift left by the Arimo-to-Roboto switch:
  `docs/G20-DESIGN-SPEC.md`'s numbers are 0.2 px from the new position and 0.8–1.2 px from the old one.
- **They may move again.** Package X owns these two widgets and is redesigning the message as one line.
- **The full table** (box and ink before and after for all 159 texts) is `design/strip/F/text-ink.json`. A markdown
  copy can be made with `python3 tools/strip/F/inkdiff.py before.json after.json --md`.
- **Car-text samples** (ЙЇҐ Щуцдй and the like, made up) in the strip, after:
  - `nav` ink [911, 681, 1011, 704] inside box [690, 679, 540×28];
  - `cc_name` ink [903, 627, 1032, 649];
  - `cc_desc` ink [900, 674, 1036, 694];
  - 0 rows clipped and 0 glyphs missing.

## 5. A character still missing

**Decision: the element falls back to BMW, as it does today. There is never a replacement glyph or box.**

- **The safety rule.** A BMW warning may be hidden only when our own text for it is on the screen, and a message with
  a box in place of a letter is not that.
- **The road label.** A tofu box in a street name reads as wrong.
- **What X still owns.** The fallback is X's row logic (`_missingGlyphs` → `_rowFail`), and X makes it
  all-or-nothing.
- **What F did.** F widened the set so the fallback is rare in Ukraine. The test now feeds a Greek street for that
  path, and `bench/test-fonts.js` checks that a character outside the set (Ω, ß) is still missing.

## 6. Tests

| suite | base | strip/F |
|---|---|---|
| `node bench/test-bottom-row.js` | 91 passed | **100 passed, 0 failed** |
| `node bench/test-native-ui.js` | 44 | **44 passed, 0 failed** |
| `node bench/test-fonts.js` (new, no bench) | would fail 5/5 on generator equality | **40 passed, 0 failed** |

### What the new checks catch

- **`test-fonts`:**
  - the generator reproduces each of the five layouts byte for byte, which is the drift;
  - every text sits on its recorded baseline and its box is exactly its cell high, so a stale layout after a re-bake
    shows up as clipping or wasted memory;
  - `wb_cap`, `wb_capb`, `wb_road` and `wb_msg` carry the Ukrainian set and the punctuation;
  - every glyph is one cell high;
  - U+02BC is drawn as U+2019;
  - Ω and ß are still missing.
- **`test-bottom-row` (package F block):**
  - a Ukrainian road label is ours, built and not latched;
  - ink in its box is read off the bench's `/px`, including the rows above the capitals and below the baseline;
  - a Ukrainian message is ours, built and not latched, and no font logs a missing glyph.
  - The old "the font cannot draw it" check now uses Greek.
- **New fake scenes:** `road-cyrillic`, `cc-cyrillic` and `cc-greek`, all made-up text.

## 7. For the lead

- **Merge F first.** Then `python3 design/gen_6wb.py apps/f30_cluster/hud/layouts` is stable, and every hunk that X,
  M or D regenerate is their own. If anyone moves a text on purpose, they update `design/strip/F/text-ink.json` in the
  same commit; `test-fonts` says which widget moved.
- **Stale comments, not touched because they are X's code:**
  - `shared/hud.js` around line 3788 ("Our 6WB fonts are baked subsets (Latin and figures only)");
  - the comment in `gen_6wb.py nav_row()` ("It has no Cyrillic and no accents").

  Both are now false.
- **For X:** move `nav` to `wb_road`, the message to `wb_msg`, the units to `wb_rowu` and `limit` to `wb_lim`. All of
  them are already baked. Keep the calls as `base_at(font, baseline)` with T's baselines, then regenerate, update
  `text-ink.json` and re-measure.
- **Decide §3.3:** keep `wb_capb` Cyrillic or not, and turn on the wider set or not. The headroom against M's mask
  format matters for the first.
- **Car check (hypothesis until then):** the fonts are what the car draws, so the first car run with a Ukrainian road
  label should show it in our row with no "is BMW's again" line in the log.
