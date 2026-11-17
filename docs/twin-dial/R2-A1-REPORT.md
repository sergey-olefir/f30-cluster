# Twin Dial round 2, package A1: fonts, atlases, pictograms

Branch `twin-dial/r2-a1` (from `twin-dial/r2`). Spec: `docs/twin-dial/SPEC.md` rev 2, sections 9 and 10. Nothing pushed, no version bump,
nothing under `apps/f30_cluster/` or `apps/driver_profiles/` touched.

## What was built

1. **Fonts in `tools/fonts-src/`** (SIL OFL 1.1, no Reserved Font Name; `SOURCES.json` has URL and licence of each):
   `Saira[wdth,wght].ttf` (133 KB: Basic Latin, Latin-1, Latin Extended, punctuation; wght 400-700, wdth 100-125),
   `NotoSans-wght.subset.ttf` (149 KB: Latin, the Cyrillic block, General Punctuation, `CAR_TEXT` incl. U+02BC, No, minus; wdth pinned
   100, wght 400-600), `Saira-OFL.txt`, `NotoSans-OFL.txt`. Both are cut from the downloaded originals by
   `tools/twin-dial/a1/subset_fonts.py` (reproducible from `bake/work/twin-dial/refs/vt-fonts/`; only glyphs and axis ranges removed).
   The Saira file keeps the name the brief gave; the Noto file is `-wght.subset` because its width axis is gone.
2. **`tools/bake_fonts.py`**: new `stretch` option in `bake()` and a `twin_dial` list (`TWIN_FONTS`, 16 atlases) in `apps/twin_dial/hud/fonts/`.
   - `stretch` 1.0 is the old path. Proof: all 18 committed f30_cluster atlases that exist reproduce byte for byte.
   - `stretch` != 1 draws each glyph 4x larger and reduces it by area with the stretch in the reduction (coverage stays exact);
     metrics come from that drawing. The atlas JSON records `"stretch"`.
   - `bake(None, ...)` returns the metrics without writing (the comparison sheet uses it). Blank characters (space, thin space U+2009 ...)
     are cells with an advance and no ink in every list (no effect on the other lists: they hold none but the plain space).
   - A Saira atlas **refuses** a Cyrillic or other non-Latin character at bake time (`ValueError`).
   - Slot map: `design/twin-dial/font_slots.json` (SPEC 9's rows to atlas names).
3. **Pictograms.** How the engine reads icons: `shared/hud.js` paints an `icon` widget with `shared/icons.js paintIcon()`, a distance
   function drawn at the widget's own size and colour. So what is "baked" is the distance functions in a file the car has.
   - `shared/twin_icons.js` (new, **generated**, 10.7 KB) by `tools/twin-dial/a1/build_twin_icons.js` from
     `design/twin-dial/vt/pictograms.js`: the 25 drawings of SPEC 10 plus the step evaluator, copied as text from the strip pictograms.
     Requiring it adds them to `icons.js ICONS` (self-registering). `--check` shows drift.
   - `apps/twin_dial/hud/icons/icons.json` (5.7 KB): the slot table (tab 38, gauge 32, symbol 54, spare 32), ink box, ink sum and alpha hash of
     every icon at its slot size; the test compares it with what `paintIcon` gives.
   - `stepDist` is exported from `design/strip/pictograms/pictograms.js`; the copy in `design/twin-dial/vt/pictograms.js` is gone.
     VT's baked PNGs and SVGs reproduce unchanged except the three below.
   - **Bug found and fixed in package P's `dArc`** (`design/strip/pictograms/pictograms.js`): an arc whose start angle is above 180 degrees
     (one wrap of 2 pi, not enough) was drawn as a whole ring in the wrong place. Visible in `cc_washer`, `cc_brake` and `td_radio` (stray arc
     tails; before/after checked by eye, only those three change of the 25). The first symptom was a washer icon with ink outside its box, found
     by my "no icon has ink outside its box" test. VT's baked PNGs of the three were regenerated. **Not touched:**
     `shared/strip_icons.js` (f30_cluster's shipped copy, same bug, f30 draws only `cc_warn` / `cc_info` so unaffected) and the strip's own
     baked PNGs under `design/strip/pictograms/baked/` (stale for `cc_brake` and `cc_washer`). Lead decides whether to bring them along.
4. **Comparison sheet** `bake/work/twin-dial/r2/A1/saira_stretch.png` (git-ignored; script `tools/twin-dial/a1/compare_saira.py`): per sample
   mockup crop | atlas 1.00 | atlas 1.06, 3x. Numbers it prints (ink width ratio from the atlases; the '0' w/h from integer ink boxes, so
   coarse at small sizes): 92 px '0' w/h 0.938 -> 0.969 (VT measured the references' readout zero at 0.97), digit advance 77 -> 82 px (x1.065),
   ink width x1.05-1.09 depending on rounding. The 1.00 column and the mockup agree (the mockup is unstretched).
   **Observation for the owner / C:** the atlas digits are tabular (the existing rule: one advance for 0-9), so in the clock "14:43" the "1" stands in
   a full cell and the gap after it looks wide next to the mockup's proportional "14:43". Fine for the speed (cells), visible on the clock page.
   If it bothers, the clock can use a separate proportional atlas (one more 70 px atlas, +0.07 MiB) - say so and I add it.

## Atlas budget

| atlas | face | px | cell h | size | raw MiB | JSON KiB |
|---|---|---|---|---|---|---|
| td_scale_l | Saira | 28 | 25 | 1024x25 | 0.024 | 33 |
| td_scale_s | Saira | 18 | 18 | 1024x18 | 0.018 | 24 |
| td_tach | Saira | 57 | 45 | 1024x45 | 0.044 | 60 |
| td_big (speed + clock) | Saira | 92 | 70 | 1024x70 | 0.068 | 94 |
| td_gear | Saira | 64 | 50 | 1024x50 | 0.049 | 67 |
| td_label | Saira | 22 | 24 | 1024x24 | 0.023 | 34 |
| td_title | Noto | 41 | 57 | 1024x456 | 0.445 | 622 |
| td_val | Noto | 39 | 55 | 1024x440 | 0.430 | 601 |
| td_body | Noto | 31 | 42 | 1024x294 | 0.287 | 406 |
| td_row | Noto | 40 | 55 | 1024x440 | 0.430 | 601 |
| td_tab | Noto | 33 | 45 | 1024x315 | 0.308 | 434 |
| td_u19 / td_u20 / td_u21 | Noto | 19 / 20 / 21 | 29 / 29 / 31 | 1024x145-155 | 0.142-0.151 | 207-221 |
| td_msg | Noto | 42 | 57 | 1024x456 | 0.445 | 622 |
| td_cnt | Noto | 29 | 25 | 1024x25 | 0.024 | 34 |

Total 3.03 MiB raw, **4.18 MiB** as JSON in `hud.pack` (f30_cluster's fonts folder is 3.3 MiB). Every full-text Noto atlas is at most 0.445 MiB
(target 0.8). Saira digit atlases are at most 1024 x 70. Text widgets (image sheets) blit from the atlas on the CPU; only `atext` atlases
(`td_big`, `td_gear` if C draws gear with atext) go to the GPU as R8 assets: 0.068 + 0.049 MiB, counted twice 0.23 MiB. Fonts load lazily by
name, so a font no widget uses costs pack bytes only. If the pack size matters, `td_u19/20/21`, `td_val`, `td_row` could take a reduced set
(Ukrainian + digits + our symbols) and save about 1.3 MiB; not done, the brief asked for full text.

Character sets: Saira slots hold digits plus what each draws (`td_big`: `:` `-` en dash; `td_gear`: P R N D M S, `-`, en dash; `td_label`: A-Z, digits,
`+ - /` en dash, space); Noto (all but `td_cnt` = digits, `/`, space) hold printable ASCII, `CAR_TEXT` (Ukrainian, Russian, Belarusian, Latin
accents, quotes, dashes, No, U+02BC with its own glyph), and `° x ø . +- minus`, the thin space (odometer "48 215") and No.

Notes for C and B: `td_gear`'s widest glyph is M (70 px) against digits 57 px, and atext's cell is the widest advance, so a gear atext field is 70 px per
cell; `td_big`'s widest is the digit (82 px). Cell heights/baselines: see the table and `baseline` in each JSON (place text by baseline, as gen_6wb does).

## Files

New: `tools/fonts-src/{Saira[wdth,wght].ttf, NotoSans-wght.subset.ttf, Saira-OFL.txt, NotoSans-OFL.txt, SOURCES.json}`, `tools/twin-dial/a1/{subset_fonts.py,
build_twin_icons.js, compare_saira.py, test_bake.py}`, `apps/twin_dial/hud/fonts/td_*.json` (16), `apps/twin_dial/hud/icons/icons.json`, `shared/twin_icons.js`,
`design/twin-dial/font_slots.json`, `bench/test-twin-fonts.js`, this report.
Changed: `tools/bake_fonts.py`, `design/strip/pictograms/pictograms.js` (export + the arc fix), `design/twin-dial/vt/pictograms.js` (copy dropped),
`design/twin-dial/vt/pictograms/baked/*` (three icons + index + sheet). Outside my files: nothing.

How to run:
```
UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/bake_fonts.py twin_dial      # atlases
node tools/twin-dial/a1/build_twin_icons.js [--check]                                                                              # icons
uv run -q --no-project --with fonttools --with pillow python -I tools/twin-dial/a1/subset_fonts.py                              # font files
node bench/test-twin-fonts.js            # 209 checks (runs the python checks through uv; TWIN_NO_PY=1 skips them)
```

## Lead: what to merge and decide (hooks for others)

- **`require('./twin_icons')` in `apps/twin_dial/main.js`** (package C) so the icons register, and `twin_icons.js` **and `strip_icons.js`** in `app.json`
  `shared` (`icons.js` requires `strip_icons.js` unconditionally; `twin_icons.js` requires `icons.js`). I chose not to hook `shared/icons.js`
  (a `try { require('./twin_icons') }` there would put an untested path into f30_cluster's start-up). The cost: any test or tool that paints twin
  icons without the app's main.js must `require('shared/twin_icons.js')` itself.
- `NOTICE` (C): Saira (c) 2020 The Saira Project Authors, Noto Sans (c) 2022 The Noto Project Authors, SIL OFL 1.1, texts in `tools/fonts-src/*-OFL.txt`.
- Font names for the layout: see `design/twin-dial/font_slots.json`.
- Decide: proportional digits for the clock page (see above); whether to fix `shared/strip_icons.js` / the strip's baked PNGs for the arc bug.

## Tests (all run in this worktree, one at a time)

- `node bench/test-twin-fonts.js`: **209 passed, 0 failed** (includes the python checks of `test_bake.py`). It fails when the feature breaks: the Saira layout check is
  shown to flag a Cyrillic literal, `{{ccHead}}`, `{{road}}`, a missing letter; the box test caught the arc bug; the generated-file and
  atlas-drift checks fail on any edit of a source. Not yet run on a real layout: `apps/twin_dial/hud/layouts/twin.json` is package C's; the test
  runs the Saira check on it as soon as it exists (token names it accepts: speed, rpm, gear, mode/program, ready, clock/time, digits; anything else
  in a Saira widget is reported, so C or the lead may have to extend the list in `sairaViolations` after checking the token is Latin-only).
- f30_cluster suites on this branch: `test-bottom-row` 254, `test-native-ui` 47, `test-strip-mask` 40, `test-fonts` 34, `test-probes` 25, `test-daynight` 24, `test-night` 48:
  all as on main, no change.

## Not verified / hypotheses

- Nothing was seen on a car. Whether Saira at wght 550 / wdth 125 / stretch 1.06 reads like the references is the owner's call on the sheet; weight and stretch
  are one line each in `TD_SAIRA`.
- The atlases are 1x renderings (stretched ones from a 4x drawing); FreeType hinting differs a little from the mockup's 3x rendering; compare on the bench.
- `td_scale_l` / `td_scale_s` / `td_tach` atlases are not drawn by the engine (A2 bakes the face numerals straight from the TTF); they exist for tests and the gallery.
- U+2009 (thin space) and U+02BC are in the atlases; whether the car's own text ever uses other characters is unknown (a missing glyph falls back, by design).
