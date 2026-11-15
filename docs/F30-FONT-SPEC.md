# The F30 6WB's typeface, measured: keep Arimo or not

**Not. Arimo is wrong and has been replaced with Roboto variable at width 87.5.** The decisive fact
needs no statistics: **Arimo's "1" carries a foot serif and the F30 6WB's does not**, so every number
on both dials that contains a 1 — 1, 10, 100, 120, 140, 160, 180, the rev scale's 1, `1/min x 1000`,
`1/1` on the fuel gauge, the clock, the range — was drawn with a horizontal base bar the real cluster
has never had. Measured, that makes Arimo's "1" **0.655 of the figure height against the 6WB's 0.410,
60 % too wide**, and its other figures 7–15 % too wide and too round besides. Ranked against 21 other
freely licensed faces by a fit that models the photographs' bloom (§4), Arimo came **17th, 11th and
17th of 22** on the three runs that have enough glyphs to rank on, while **Roboto at width 87.5 came
1st, 1st and 3rd**. Roboto is already in the repo, already carries Cyrillic, and is already what the
sister package recommends for the stock G20 (`docs/G20-DESIGN-SPEC.md` §1.4), so one width axis value
now serves the whole app. The swap is done inside `tools/bake_fonts.py` with every font name
unchanged, so no layout moved; it is proved on the bench in §7.

**Sources.** The reference images only (`reference/6wb/`, `reference/ours/`), plus the sister
package's G20 spec and the web. **The car is offline: nothing here was read from it.** Every number is
marked **measured** (with the image and the method) or **estimated**.

**Numbers live in `design/f30-font/measured.json`**, which the tools and this document share.

**Hard rule honoured.** No BMW font file was looked for, downloaded, committed or shipped.

---

## 0. Headline numbers

| What | Value | How |
|---|---|---|
| The 6WB's "1", ink width / figure height | **0.410** | measured, image 05 |
| Arimo Bold's "1" / figure height | 0.655 (**+60 %**) | measured, the file we shipped |
| Roboto 700 wdth 87.5's "1" / figure height | 0.397 (−3 %) | measured |
| Digit advance / figure height | **0.690–0.715**, figures are **tabular** | measured, images 04 and 05 |
| The "1" sits **left** in its tabular cell | by 1.3 px in a 16.8 px cell (7.5 %) | measured, image 05 |
| x-height / figure height | **0.742** | measured, image 05 |
| Stroke / cap height | **0.191** digits, 0.197 gear, **0.203** READY | measured, bloom-corrected |
| Weights on the cluster | **one**, not three — everything within 6 % of one stroke | measured |
| Faces ranked | 22 free faces; **Roboto wdth 87.5 wins**, Arimo 17th | measured, §4 |
| Over-speed marking | a **sector**, limit → current speed, r **0.576 R … 0.732 R** | measured, image 12 |
| Speedo calibration | **1.0°/km/h**, 0 km/h at **230.1°**, 260° of sweep | measured, image 12, rms 0.03° |
| Cyrillic in Roboto / in Barlow | **full Ukrainian+Russian / none at all** | measured, the files |
| Cost of a Cyrillic street-label font | **+116 KiB** atlas, +159 KiB JSON | measured, baked both ways |

---

## 1. What each reference image is

The brief warned that some 6WB references are renders. One is worse than a render.

| Image | Nature | Used for |
|---|---|---|
| **05** `comfort_tach-closeup` | **photograph** — lateral chromatic aberration on every edge, lens vignetting, a studio highlight on the glass | the master. Rev digits 1–7 at a 48.5 px figure height, `1/min x 1000`, READY, OFF, gear P |
| **13** `ticks_closeup` | **photograph** — strong blue/orange fringing, the glyph core clipped to 255 | one "6" at a 205 px figure height; the cross-scale check |
| **04** `comfort_whole-cluster_mph` | **photograph**, same studio series as 05, straight on | the speed scale and the tabular-advance test |
| **03** `three-modes_photo_bimmerstop` | **photograph**, handheld through the wheel | the real bottom row: `Time 14:21 / Total 64747 km / Temp +39.0 °c` |
| **17** `physical-cluster_full` | **photograph** (video frame), soft | the bottom row and side gauges at a larger size |
| **07** `physical-cluster_all-lamps-lit` | **photograph** (video frame) | confirms the bottom row's field set; glyphs bloom together |
| **12** `speedo_signs_overspeed-wedge` | **low-resolution frame, origin uncertain** — at 374 px wide no camera artefact survives, so photograph and screenshot cannot be told apart. Its own dial calibration fits a straight line to **0.03° rms**, which is what a real rendering gives | the over-speed marking; the dial calibration |
| **02** `three-modes_clean-render` | **SYNTHETIC — not a BMW asset.** "Fasten seatbelt" is doubled and smeared, "EfficientDynamics" is illegible, "OPO" appears where OFF belongs, the Sport frame matches no F30 state, and the letterforms differ between its own three panels | **nothing.** Excluded from every measurement below |
| **01** `three-modes_small` | a downscale of 02 | nothing |
| **06**, **14**, **15** | photographs | layout only; 06's text is 6–8 px tall, 14 and 15 have none |

**Weighting.** Everything typographic rests on photographs 05, 13, 04 and 03. Image 02 is excluded
outright: it is a generated picture, and measuring a typeface on it would measure the generator.

---

## 2. The measurement

### 2.1 Method, and the one thing the G20 package did not have to handle

`tools/f30font/measure.py` is `tools/g20spec/measure.py` minus the rectification: the F30 images are
third-party pictures of someone else's car at their own scales, with no common panel frame to warp
to. So everything is measured in the **image's own pixels** and turned into **ratios**, which are
scale-free and are what identifies a face. An absolute px figure is only ever quoted with the image
it came from.

The new problem is **bloom**. Every reference is a bright LCD photographed with its core clipped to
255, so each glyph's ink is dilated by roughly a constant *d* px in width *and* height. Charging that
dilation to a candidate face — which is what a plain "match the heights, then compare the widths" fit
does — ranks the faces wrong, and badly: run that way, the fit prefers a *light* weight paired with a
large fake bloom.

So the fit models it (`tools/f30font/fontfit.py`):

> measured_w(i) = s · W(i) + d  and  measured_h(i) = s · H(i) + d

with *s* and *d* both least-squares, *d* constrained to ≥ 0. Two further observations pin *d* instead
of leaving it free:

- **the stroke**, which blooms like a glyph: predicted stem = s · stem(font) + d;
- **the counter** — the hole inside a 0, 4 or 6 — which **shrinks** by the same bloom that grows the
  ink, so it enters with coefficient **−1**. This is what breaks the weight-against-bloom
  degeneracy, and it changes the answer: before the counters went in, the fit put Noto Sans Display
  at 450 with 2.9 px of bloom level with Roboto 700 at zero bloom; the measured counter of the 6WB's
  "0" (5.60 px) rules the first out by **+30 to +48 %** and leaves bloom at **0.2–0.7 px**, which is
  physically sensible and consistent between two runs of the same image.
- **the advance**, which bloom does *not* move (it is a pen step, not ink), enters with coefficient 0.

**The method's own cross-check.** The rev scale's "6" measures w/h **0.6394** on image 05 (h 50.3 px)
and **0.6390** on image 13 (h 205.0 px) — two different photographs at a 4× scale difference agreeing
to **0.1 %**. That is what licenses the ratio fingerprint.

**Error bars.** A single ink edge is good to about ±0.3 px at the scale it was read. Nothing is better
than the bloom model's residual, about **2 % of a figure height**.

### 2.2 Per text kind

All **measured**. Ratios are what to compare; px are quoted with their image.

| Text kind | Image | Cap / figure height | x-height | Stroke | Advance | Tabular? |
|---|---|---|---|---|---|---|
| **Rev scale numbers** | 05 | figure **48.25** (flat 1/4/7), 50.1 (round 3/6) | — | **9.12** (0.188 of figure) | — | yes (§2.3) |
| **Speed scale numbers** | 04 | figure **14.87** | — | — | **10.26** ±0.39 (0.690) | **yes** — see below |
| **Unit captions** `1/min x 1000` | 05 | figure **23.50** | **17.44** (0.742) | **4.50** (0.191) | **16.81** (0.715) | yes |
| **READY** | 05 | cap **24.38** | — | **5.38** (**0.221** of cap) | — | — |
| **OFF** | 05 | same size and weight as READY | — | — | — | — |
| **Gear** (P) | 05 | cap **39.75** | — | **8.25** (0.208 of cap) | — | — |
| **Bottom-row values** `14:21 64747 +39.0` | 03 | figure **13.2** | — | — | not separable (digits bloom together) | — |
| **Bottom-row labels** `Time Total Temp` | 03 | cap **8.2** = 0.62 of the value figure | — | — | — | — |
| **Bottom-row units** `km`, `°c` | 03 | x-height **8.74** = **0.66** of the value figure | — | — | — | — |
| **Side-gauge figures** `0 10 20`, `1/1` | 17 | 7–9 px, blurred | — | — | — | — |

**The tabular test (measured, image 04).** Across the eight numbers 20/40/60/80/100/120/140/160 the
advance between adjacent non-"1" digits reads 10.2, 10.0, 11.0, 10.0, 10.0, 10.5, 10.6, 9.8 — **mean
10.26, sd 0.39**, equal within the noise whatever the digits are. The figures are **tabular**. A "1"
leading a number gives 9.0–9.8 only because its narrow ink sits inside a cell of the same width.

**The "1" sits left in its cell (measured, image 05).** In `1000` the ink advance from the "1" to the
next "0" is 12.76 px where a "1" centred in a 16.81 px cell would give 14.02 — so the "1"'s ink begins
about **1.3 px left of centre, 7.5 % of the advance**. The G20's own face does the same thing
(`docs/G20-DESIGN-SPEC.md` §1.2, 1.3 px in a 24.2 px cell), so it is a family habit, not a quirk.

**Three weights or one?** The G20's stock cluster uses three (Light street label, Medium values, Bold
message). The F30 6WB uses **one**: stroke/cap reads **0.191** for the digits and the caption, 0.197
for the gear and 0.203 for READY — a 6 % spread, which is one weight with READY at the very top of it.
That is a real difference between the two clusters and it is the easiest thing to get wrong.

Three further facts worth recording because they are not what our layouts assume:

- **The bottom-row labels are mixed case** — `Time`, `Total`, `Temp`, `Trip`, with an initial capital
  and lowercase — **not** all caps (measured, images 03 and 07).
- **The temperature unit is a degree ring followed by a lowercase `c`** on images 03 and 17, not `°C`.
- **Our `wb_cap` was baked Regular; the 6WB's caption is bold** (stroke/figure 0.191, the same as the
  dial digits). Fixed in §6.

### 2.3 The shapes of 1, 4, 7, 0, R, E

**Measured** on image 05 at a 48.5 px figure height, cross-checked on image 13 at 205 px.

| Glyph | The 6WB | w / figure | Arimo Bold | Roboto 700 w87.5 |
|---|---|---|---|---|
| **1** | a plain stem with a long, steep flag down-left, reaching about 40 % of the height, and **no foot serif** | **0.410** | 0.655 — **has a foot serif** | 0.397 |
| **4** | **closed**; a straight diagonal, the crossbar low, the stem protruding below it | 0.683 | 0.754 | 0.658 |
| **7** | no crossbar; a plain straight diagonal | 0.629 | 0.662 | 0.637 |
| **0** | a narrow oval, no slash, no dot; counter 5.60 × 16.00 at a 23.7 figure height | 0.642 | ≈0.73 | 0.646 |
| **R** | closed bowl, the leg splayed out to the right | 0.656 of cap | — | — |
| **E** | arms of near-equal length, the middle one barely shorter | (E and A touch; excluded from the fit) | — | — |

**Aperture and terminals.** The "6"'s upper terminal (image 13, the one glyph big enough to judge)
curls over and is cut at a steep, near-vertical angle, leaving a narrow aperture against the bowl; the
bowl is large and close to circular. Stem ends elsewhere are cut **horizontally** (`m`, `n`, `i` in
`1/min`). **Round glyphs overshoot the flat ones** by about 1.6 px at a 48.5 figure height (3 %), part
of which is bloom on a curve. The `i`'s dot measures 4.0 × 4.0 px at a 23.5 figure height — square
within the measurement, but at that size round and square cannot honestly be separated (**estimated**).

---

## 3. The verdict on Arimo, per text kind

The comment in `tools/bake_fonts.py` said Arimo was chosen because it is Helvetica-shaped and "the
6WB's own print is". The second half was never checked. It is wrong in the one place it shows most.

### 3.1 The disqualifying fact

**Arimo's "1" has a foot serif. The 6WB's has none.** See `design/f30-font/fonts/rev.png` (committed,
no photo pixels) and `bake/work/f30font/one_compare.png`. Helvetica's and Arial's "1" have no foot;
Arimo's does, so "Helvetica-shaped" did not carry the property it was being relied on for.

At the sizes we actually baked, the extra ink is:

| Baked font | Size | Figure height | 6WB's "1" would be | Arimo Bold drew | Error |
|---|---|---|---|---|---|
| `wb_rpm` rev scale | 44 px | 31 | 12.7 px | 20.3 px | **+7.6 px, +60 %** |
| `wb_spd` speed scale | 30 px | 20 | 8.2 px | 13.1 px | +4.9 px, +60 % |
| `wb_val` bottom values | 36 px | 26 | 10.7 px | 17.0 px | +6.3 px, +60 % |
| `wb_big` Sport speed | 120 px | 86 | 35.3 px | 56.3 px | **+21.0 px, +60 %** |

A 21 px error on a single glyph, on the biggest number on the screen, is not a subtlety.

### 3.2 The rest of it

| Text kind | Arimo's best fit | rms, % of figure | Rank of 22 | Where it goes wrong |
|---|---|---|---|---|
| Rev scale digits | wght 550 | **6.87 %** | **17th** | the "1" (+60 %); the 4 and the 0 too wide and too round |
| Speed scale digits | wght 400 | **6.88 %** | **17th** | the same, plus advance **+6.5 %** |
| Unit caption | wght 550 | **6.76 %** | 11th | the "1"; stroke −6.8 % |
| READY | wght 400 | — (5 dof, not rankable) | 22nd | caps too wide |

Arimo's **digit advance / figure height is 0.782** against the 6WB's measured 0.690–0.715 — **+9 to
+13 % too wide**, so a four-digit number was 8–11 px too long at `wb_rpm`'s size. Its **x/cap is
0.768** against Roboto's 0.746 and the 6WB's implied 0.763, which is the one ratio Arimo gets right.

**Verdict: replace it, everywhere in the 6WB themes.**

---

## 4. The shortlist

22 freely licensed faces, each fitted by §2.1's method; weights 300–900 and, where the face has the
axis, widths 75 / 82.5 / 87.5 / 93 / 100. Ranked by rms as a percentage of the figure height. Runs
with fewer than 6 degrees of freedom (READY, the gear, the lone "6") are reported but not ranked on.

**Rev scale digits** — 7 glyphs, 15 observations, 13 dof, the strongest run:

| # | Face | Setting | rms | % of figure | bloom | stroke |
|---|---|---|---|---|---|---|
| **1** | **Roboto variable** | **wght 700, wdth 87.5** | **0.897 px** | **1.85 %** | 0.53 | +9.2 % |
| 2 | Noto Sans | 750 / 82.5 | 1.511 | 3.12 % | 0.10 | +12.2 % |
| 3 | Open Sans | 700 / 87.5 | 1.514 | 3.12 % | 0.71 | +14.0 % |
| 4 | Barlow Medium | static | 1.553 | 3.20 % | 3.07 | +1.7 % |
| 5 | Fira Sans Regular | static | 1.587 | 3.27 % | 3.88 | +10.6 % |
| 6 | Noto Sans Display | 450 / 93 | 1.601 | 3.30 % | 4.05 | +9.1 % |
| … | | | | | | |
| 17 | **Arimo** | 550 / — | 3.334 | **6.87 %** | 4.53 | +9.5 % |

**Unit caption `1/min x 1000`** — 6 glyphs plus a stroke, an advance and a counter, 12 dof:

| # | Face | Setting | rms | % of figure | stroke | advance |
|---|---|---|---|---|---|---|
| **1** | **Roboto variable** | **650 / 87.5** | **0.766 px** | **3.26 %** | −4.1 % | **+1.2 %** |
| 2 | Barlow SemiCondensed | static | 0.939 | 4.00 % | −3.6 % | −3.4 % |
| 3 | Noto Sans Display | 450 / 100 | 0.967 | 4.11 % | −8.9 % | −4.3 % |
| 4 | Noto Sans | 500 / 87.5 | 0.988 | 4.21 % | −10.8 % | −4.8 % |
| … | | | | | | |
| 11 | **Arimo** | 550 / 75 | 1.590 | **6.76 %** | −6.8 % | +0.1 % |

**Speed scale digits** — 6 glyphs plus the advance, 11 dof:

| # | Face | Setting | rms | % of figure | advance |
|---|---|---|---|---|---|
| 1 | Noto Sans Display | 500 / 93 | 0.223 px | 1.50 % | −0.3 % |
| 2 | Noto Sans | 500 / 87.5 | 0.228 | 1.53 % | −0.1 % |
| **3** | **Roboto variable** | **600 / 82.5** | **0.250** | **1.68 %** | **−0.1 %** |
| 4 | Open Sans | 450 / 93 | 0.277 | 1.87 % | +0.2 % |
| … | | | | | |
| 17 | **Arimo** | 400 / — | 1.023 | **6.88 %** | +6.5 % |

**Disqualified whatever they score:** **Archivo**, **Public Sans**, **Barlow** and **Barlow
SemiCondensed** have **no Cyrillic at all** (measured on the files, §8). That does not matter for a
dial scale, which is digits, but it rules them out of any font that could ever be handed car text, and
it rules out using one family for everything.

The shape fingerprint behind the ranking, as plain ratios anyone can check
(`tools/f30font/fingerprint.py`):

| Face | "1" | "2" | "3" | "4" | "5" | "6" | "7" | x/cap | adv/fig | stem/fig |
|---|---|---|---|---|---|---|---|---|---|---|
| **The 6WB** | **0.410** | 0.637 | 0.652 | 0.683 | 0.642 | 0.662 | 0.629 | ≈0.763 | **0.690–0.715** | 0.188 |
| Roboto 700 w87.5 | 0.397 | 0.637 | 0.630 | 0.658 | 0.610 | 0.623 | 0.637 | 0.746 | 0.740 | 0.192 |
| Arimo 700 | **0.655** | 0.676 | 0.704 | 0.754 | 0.704 | 0.683 | 0.662 | 0.768 | **0.782** | 0.190 |
| Noto Sans Display 450 | 0.365 | 0.608 | 0.608 | 0.676 | 0.581 | 0.608 | 0.615 | 0.750 | 0.730 | 0.128 |
| Fira Sans Regular | 0.417 | 0.604 | 0.619 | 0.662 | 0.612 | 0.633 | 0.561 | 0.768 | 0.806 | 0.137 |

---

## 5. The recommendation

**Use Roboto variable (SIL OFL), width axis 87.5, one weight band for the whole F30 face.** Reasons,
in the order they matter:

1. **It fits best.** 1st, 1st and 3rd on the three rankable runs; Arimo 17th, 11th, 17th.
2. **Its "1" is right** — a bare flagged stem, 0.397 of the figure height against the measured 0.410.
3. **It costs nothing.** `tools/fonts-src/Roboto-wdth-wght.subset.ttf` is already in the repo (364 KB,
   Latin + Cyrillic, 633 codepoints), already used by the G20 fonts, already licensed in each app's
   NOTICE. No new file, no new licence line.
4. **It carries full Ukrainian and Russian Cyrillic** (§8), which the face has to if any of our text
   is ever handed a street name.
5. **It agrees with the sister package.** `docs/G20-DESIGN-SPEC.md` independently lands on *Roboto
   variable at wdth 87.5* for the stock G20. One width axis value now serves both halves of the
   cluster, which is exactly what you want where our pixels sit next to BMW's.

**Per text kind.** Weights come from the measured stroke/cap, bloom-corrected:

| Text kind | Measured stroke/cap | Roboto setting | Baked as |
|---|---|---|---|
| Speed and rev scale numbers | 0.191 | **wdth 87.5, wght 650** | `wb_spd` 28 px, `wb_rpm` 43 px |
| Unit captions, OFF, small print | 0.191 | wdth 87.5, wght 650 | `wb_cap` 21 px |
| READY, the mode label | **0.203** | wdth 87.5, **wght 700** | `wb_capb` 21 px |
| Gear | 0.197 | wdth 87.5, wght 650 | `wb_gear` 45 px |
| Bottom-row values (our F30-style strip) | 0.191 | wdth 87.5, wght 650 | `wb_val` 36 px |
| Side-gauge figures | — | wdth 87.5, wght 650 | `wb_mini` 14 px |
| Sport's big speed and gear | — | wdth 87.5, wght 700 | `wb_big` 118 px |
| **Our values in BMW's own row** | — | **wdth 87.5, wght 500** (the G20 spec's) | `wb_row` 43 px — §6 |

Every px size above is the one that reproduces **exactly the rendered height Arimo gave**, so no
layout had to move.

**One honest tension.** On the rev digits the glyph *outlines* fit best at wght 700 while the *stroke*
alone would say about 560, and the width axis fits the outlines at 87.5 while the advance alone would
say 82.5. The 6WB's face is therefore a little wider for its weight than Roboto is, by one or two
weight steps and about 5 % of width. **wght 650 and wdth 87.5 split those differences** (judgement,
not measurement); wdth 87.5 also wins because our scale numbers are each their own widget, so the
per-glyph shape matters and the advance barely does.

**See it:** `design/f30-font/fonts/rev.png`, `caption.png`, `ready.png`, `speed.png` — candidates at
the measured height, **no photo pixels**, committable. The same sheets with the photograph on top are
`bake/work/f30font/sheet-*.png`, git-ignored.

---

## 6. Which text takes which face

Some of our text stands in BMW's own bottom row, where the eye compares it with BMW's pixels left and
right. That text must look like **the stock G20**, not like an F30. `feat/bottom-row` owns this code;
nothing below was changed by this package except where it says "done".

| Widget id | Layouts | Baked font | Sits in | Face it should use | Status |
|---|---|---|---|---|---|
| `own_range`, `own_clock`, `own_temp` | `wb_dials`, `wb_sport_dials` | `wb_row` | **BMW's own row** (`bake_fonts.py`: "at BMW's places, its size") | **G20** — Roboto wdth 87.5 **wght 500** | **done**, name unchanged |
| `own_range_u`, `own_temp_u` (the `km` and `°C`) | `wb_dials`, `wb_sport_dials` | `wb_val` | **BMW's own row** | **G20** — Roboto wdth 100 wght 500, cap 0.78 of the value | **not done** — needs a new font name, see below |
| the **street label** | not built yet | — | BMW's own row, centred x 960.5, baseline 700.5 | **G20** — Roboto wdth 87.5 **wght 350**, cap 30.9 | for `feat/bottom-row` |
| the **check-control message** | not built yet | — | BMW's own row, centred x 967.5 | **G20** — Roboto wdth 100 **wght 500–600**, cap 26.6 | for `feat/bottom-row` |
| the **speed-limit sign's digits in BMW's row** | not built yet | — | BMW's own row, in the disc at (537.4, 621.3) | **G20** — Roboto wdth 100 wght 400, figure 26.4 | for `feat/bottom-row` |
| `limit` | all 6WB layouts | `wb_val` | **our own** 6WB sign, inside the speedo at (321, 490) | **F30** — it is the F30's sign, not BMW's | keep |
| `row_h0..2`, `row_v0..2`, `row_b0..2` | `wb_comfort`, `wb_sport`, `wb_eco` | `wb_cap`, `wb_val` | **our own** F30-style strip (it reproduces the 6WB's `Time / Total / Temp`) | **F30** | keep |
| `spd*`, `rpm*`, `speed_unit`, `rpm_cap`, `ready`, `off`, `mode`, `gear`, `gear_l`, `fuel_*`, `range_*`, `cons_*` | all 6WB layouts | `wb_*` | the dials | **F30** | keep |

**The one change that needs the coordinator.** `own_range_u` and `own_temp_u` draw the `km` and `°C`
beside values that are now in the G20 face, but they share `wb_val` with our F30-style strip in
`wb_comfort`. Splitting them needs **a new baked font name** and a one-word edit in
`apps/f30_cluster/hud/layouts/wb_dials.json` and `wb_sport_dials.json` — which this package must not
make. Suggested: add `('wb_rowu', 'Roboto-wdth-wght.subset.ttf', 33, LOWER + UPPER + '°/. ', 0, [500, 100])`
to `F30_FONTS` and point those two widgets at it. Until then they are one notch too bold and 5 % too
narrow for BMW's row — visible only if you look for it.

**Nothing else moved.** Every other font name is unchanged, so no layout file was touched by this
package.

---

## 7. The re-bake, and the proof

`tools/bake_fonts.py` `F30_FONTS` now names `Roboto-wdth-wght.subset.ttf` with `[wght, wdth]` axes.
**Every font name is unchanged**, so the rule's escape clause applies and no layout was edited.

**Font assets** (`apps/f30_cluster/hud/fonts/`, all 25 fonts):

| | before | after | change |
|---|---|---|---|
| Atlas bytes (the CPU blit buffer) | 1859.0 KiB | **1833.0 KiB** | **−26.0 KiB** |
| JSON on disk (what `hud.pack` carries) | 2514.9 KiB | **2480.3 KiB** | **−34.6 KiB** |

Only four fonts changed cell height at all, and no baseline moved by more than 1 px:

| Font | size | cell height | baseline | atlas |
|---|---|---|---|---|
| `wb_cap` | 22 → 21 | 26 → 24 | 19 → 18 | **−28.0 KiB** (it dropped from two atlas rows to one) |
| `wb_capb` | 22 → 21 | 25 → 22 | 18 → 17 | −3.0 KiB |
| `wb_val` | 36 → 36 | 32 → 33 | 29 → 29 | +1.0 KiB |
| `wb_big` | 120 → 118 | 90 → 92 | 87 → 88 | +4.0 KiB |
| `wb_spd`, `wb_rpm`, `wb_gear`, `wb_mini`, `wb_row` | −1 or −2 px | unchanged | ≤1 px | 0 |

**Bench proof.** `BENCH_PORT=8160 node bench/server.js f30_cluster`, one fixed signal set (4200 rpm,
98 km/h, gear 3, limit 60), every 6WB layout shot at 1920×720 before and after
(`tools/f30font/shots.py`), then pixel-compared:

| Layout | changed px | % of panel | pixel memory before → after | layers |
|---|---|---|---|---|
| 6WB Comfort | 13 846 | **1.002 %** | 11.5 → **11.5 MiB** | 21 → 21 |
| 6WB Dials + G20 | 13 877 | 1.004 % | 11.1 → **11.1 MiB** | 19 → 19 |
| 6WB Sport | 9 281 | 0.671 % | 2.1 → **2.1 MiB** | 19 → **18** |
| 6WB Sport + G20 | 10 267 | 0.743 % | 3.2 → **3.1 MiB** | 18 → **17** |
| 6WB Eco Pro | 11 475 | 0.830 % | 3.0 → **3.0 MiB** | 14 → 14 |

Only text pixels moved — the changed region is bounded by the dials in every layout, 0.7–1.0 % of the
panel, which is about what the text covers. **No layout gained pixel memory**, and the two Sport
layouts each **lost a layer**: the big GPU speed is drawn by the atlas-text shader, which splits a
widget in two when the figure grid is odd, and Roboto's narrower advance now fits it in one.

No font error of any kind appeared in the log: zero "font … is missing", zero "atlas asset refused",
zero missing glyphs. The warnings that remain (dials under the hood, overlaps with BMW's lamps) are
geometry warnings that predate this change and are identical before and after.

Pictures: `bake/work/f30font/before/`, `after/`, `diff/` (git-ignored). The clearest one is
`bake/work/f30font/cmp_before.png` against `cmp_after.png` — the speedo's `100 120 140 160`, where
Arimo's footed "1" becomes a bare stem.

---

## 8. Cyrillic

The car hands us street names and check-control text in the navigation's language, Ukrainian here.
Every baked font today is Latin-only: no F30 font's character set reaches above U+00FF.

### 8.1 What has to change, and it is in two files, not one

**1. `tools/bake_fonts.py` (this package's file).** Add the range and a font that uses it:

```python
CYR_U = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯҐЄІЇ'     # 37: Russian plus Ukrainian Ґ Є І Ї
CYR_L = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяґєії'     # 37
```

**2. `shared/hud.js` — and this one is not ours.** `_atlas()` builds the shared GPU glyph atlas with

```js
const chars = Object.keys(glyphs).filter((ch) => ch.length === 1 && ch >= ' ' && ch <= '~').sort().slice(0, 64);
```

so it **throws away everything above U+007E and caps the atlas at 64 glyphs**. A Cyrillic street name
drawn through a `"gpu": true` text widget would come out blank no matter what is baked into the font.
The CPU path (`textRaster.drawText` into an image sheet) has no such filter and needs only the bake
change. Today the only `gpu` text in the F30 app is Sport's big speed, which is digits, so nothing is
broken right now — but **a street label or a check-control message must either stay on the CPU path or
that filter must be lifted**, and `shared/hud.js` belongs to `feat/bottom-row` and `audit/features`.
With the filter lifted, 143 glyphs at the street label's cell size give a 400 × 468 R8 atlas,
about 374 KiB — well within budget.

**3. Do not add Cyrillic to the existing fonts.** It raises the cell height by 11–13 % (46 → 52 at the
street-label size, 26 → 29 at `wb_cap`'s) because Ё and Й rise above the Latin cap line, and
`bake_fonts.py` gives every glyph the same cell height, so a widget's `y` is the top of its tallest
character — **every layout using that font would shift by 3–6 px.** The street label and the message
are new widgets anyway, so they get **new font names** and nothing existing moves.

### 8.2 What it costs — measured, by baking it both ways

| Font | Latin only | Latin + Cyrillic | Extra atlas | Extra JSON | Cell height |
|---|---|---|---|---|---|
| Street label (Roboto 350 w87.5, cap 30.9 → em 43.5) | 92.0 KiB / 126.5 KiB | 208.0 / 285.4 | **+116.0 KiB** | +158.8 KiB | 46 → 52 |
| Check-control message (Roboto 550 w100, cap 26.6 → em 37.4) | 80.0 / 110.5 | 180.0 / 248.0 | **+100.0 KiB** | +137.5 KiB | 40 → 45 |
| `wb_cap` at 21 px, for comparison | 52.0 / 73.1 | 87.0 / 123.9 | +35.0 KiB | +50.8 KiB | 26 → 29 |

**Against the budget.** Two new Latin+Cyrillic fonts — one for the street label, one for the message —
cost **388 KiB of atlas buffer** and **533 KiB inside `hud.pack`**. The service's limit is 16 MiB of
cluster-render pixel memory and 6WB Comfort sits at 11.5 MiB, so this is **0.38 MiB, about 2.4 % of
the budget**, leaving the headroom at roughly 4.1 MiB. Affordable. Note that the bench's "11 glyph
atlases 8.4 MiB" line counts the **baked scene textures** as well as the font atlases
(`hud.js` keeps both in `this.atlases`); the font atlases themselves are tens of KiB each.

### 8.3 Do the recommended faces carry Cyrillic?

Measured on the files themselves (`fontTools`, the full Ukrainian + Russian set):

| Face | Codepoints | Ukrainian + Russian Cyrillic |
|---|---|---|
| **Roboto** `Roboto-wdth-wght.subset.ttf` | 633 | **complete — nothing missing** |
| Arimo | 3010 | complete (its problem is shape, not coverage) |
| Noto Sans, Noto Sans Display, Open Sans, IBM Plex, Fira Sans, PT Sans, Inter, Rubik, Manrope, Commissioner, Golos, Onest, Mulish, Jost | — | yes |
| **Archivo**, **Public Sans** | — | **none** |
| **Barlow, Barlow Condensed, Barlow SemiCondensed** (what the rest of the repo uses) | 525 | **none at all** |

So the recommended face is already covered, and **the Barlow family is not**: if any car-supplied text
is ever routed through `badge`, `head`, `unit`, `n_unit`, `r_label`, `c_speed` or any Cluster Themes
font, it will render blank. Worth a note wherever those fonts meet car text.

---

## 9. The over-speed wedge

`reference/6wb/12_speedo_signs_overspeed-wedge.png`: a 60 km/h limit sign up, the needle at 80, and
the F30's own red marking on the speed scale. **This section is measurement only** — `feat/bottom-row`
is implementing the feature.

### 9.1 The dial it sits on

**Measured** by `tools/f30font/wedge.py`: the 14 major (numbered) ticks are found as bright blobs, then
the dial centre and a linear `angle = a0 + k · speed` are fitted **together** by least squares (fitting
the centre from the ticks alone leaves a drift in the tick-to-tick spacing).

| | Value | |
|---|---|---|
| Centre | (187.37, 171.62) image px | |
| **0 km/h at** | **230.14°** clockwise from 12 o'clock | |
| **Scale rate** | **0.99897 °/(km/h)** — essentially exactly **1.0° per km/h** | |
| Per 20 km/h major tick | 19.979° | |
| Sweep 0 → 260 | 259.73° | |
| Fit quality | **rms 0.028°, max residual 0.047°** over 14 ticks | measured |

A dial that is 1° per km/h with 260° of sweep starting at 230° is a round, deliberate design, and the
0.03° residual is what a real rendering gives — which is the strongest evidence that image 12 shows a
genuine F30 6WB speedo and not a mock-up.

Radial landmarks, from a brightness profile along the 60 km/h tick. **R below means the tick outer
end, 147.5 image px.**

| Feature | image px | / R |
|---|---|---|
| Dial outer chrome ring | 158.2 … 163.5 | 1.072 … 1.108 |
| Tick outer end | **147.5** | **1.000** |
| Tick inner end | 133.0 | 0.902 |
| Numeral band | 107.0 … 128.8 | 0.725 … 0.873 |
| **The marking** | **85.0 … 108.0** | **0.576 … 0.732** |

### 9.2 The marking

Unwrapping the annulus to (angle, radius) makes the shape unambiguous: **it is a rectangle in polar
space, so it is a true sector** — two radial edges and two arcs. Not a chord, not a constant-width
band, not an arc stroke.

**Angular extent** (measured; convert with 0 km/h at 230.14°, 1.0°/km/h):

| | Angle | Speed |
|---|---|---|
| Leading edge (half-max) | 289.4° | **59.3 km/h** |
| **Leading bright line, peak** | **289.88°** | **59.80 km/h** — the limit |
| Trailing edge (half-max) | 307.55° | 77.4 km/h |
| Needle centre | 310.25° | 80.19 km/h |
| Visible extent | 18.15° | |

So **the sector runs from the limit to the current speed**. The leading edge is a **bright red radial
line centred on the limit value** (peak redness 197 against the body's 73–105). The visible trailing
end stops 2.8° short of the needle's centre, but the needle's own drawn width at that radius is about
4° (a 1.4° bright core plus a dark red outline either side), so **the wedge runs to the current speed
and the needle is drawn over its end** (that last step is **estimated**, from the needle's measured
width; the alternative, a deliberate 2.8 km/h gap, cannot be excluded from one still).

**Radial extent and the gradient** (measured, from a 0.5 px-binned radial profile in the clean angular
window 293–305°):

| | image px | / R | redness |
|---|---|---|---|
| Nothing below | 84.0 | 0.569 | 0 |
| **Inner edge (hard, half-max)** | **85.0** | **0.576** | rising |
| **Bright inner rim, peak** | **86.2** | **0.584** | **155** |
| Half intensity | 95.1 | 0.645 | 78 |
| **Outer edge (faded to nothing)** | **108.0** | **0.732** | 0 |
| Thickness | 23.0 | 0.156 | |

The fill **fades outward, monotonically and nearly linearly**, from the bright rim at the inner edge to
zero — reaching zero exactly where the numeral band begins (0.725 R). It never touches the ticks.

**Colour** (measured, in a non-colour-managed image):

| | RGB |
|---|---|
| At the rim | (181, 26, 17) |
| Mid fill | (175, 26, 18) |
| The limit sign's ring, same image, as a reference | (230, 44, 16) |

The hue does not change across the marking, only the intensity — so it is **one red drawn with a
radially falling alpha**, not a two-colour gradient. It is a **deeper red than the sign ring**, about
0.77 of its red channel.

### 9.3 Geometry a shader can draw

In the frame `shared/shaders.js` already uses, where `R` is the **dial radius** and the ticks' outer
end is `to = 0.905 * R` (so the image's R equals 0.905 of the shader's R):

```
sector:   angle from frac(limit) to frac(currentSpeed)        // already what u_over.x / u_over.y give
radius:   inner  0.521 * R        (hard edge)
          rim    0.529 * R        (brightest)
          half   0.584 * R        (50 % alpha)
          outer  0.663 * R        (alpha 0)
alpha:    1.0 at the inner edge, falling to 0 at the outer edge  — i.e. smoothstep(outer, inner, d)
colour:   one red, about #B21A11, deeper than the sign's #E2232E
extras:   a brighter radial line on the LIMIT edge, about 2x the fill's brightness
          a brighter arc along the INNER edge, about 2x the fill's brightness
          no edge treatment on the needle side: the needle covers it
```

**Our current wedge is wrong in two ways** (`shared/shaders.js`, the `u_over` block):

```glsl
if (u_over.x >= 0.0 && inSweep && frac >= u_over.x && frac <= u_over.y && d > 0.64 * R && d < 0.905 * R) {
    col = mix(col, u_red * 0.85, 0.8 * smoothstep(0.64 * R, 0.80 * R, d));
}
```

1. **Position.** Ours spans **0.64 R → 0.905 R**, running right out to the ticks and through the
   numerals. The F30's spans **0.521 R → 0.663 R** — much further in, stopping well before the
   numerals and never reaching the ticks.
2. **Gradient direction.** `smoothstep(0.64R, 0.80R, d)` makes ours **faint inside and strong
   outside**. The F30's is the **opposite**: strongest at the inner edge, fading outward.

The angular logic is already right — limit to needle — and so is the idea of a wedge.

### 9.4 What could not be measured

| Open | Why | What would settle it |
|---|---|---|
| Whether the bright leading line shows whenever a limit is known, or only while it is exceeded | only the exceeded case was photographed | one photo with a limit up and the needle below it |
| Whether the marking flashes, and how fast | a still cannot show it | one 30 fps video through an over-speed |
| What happens when the limit changes while the marking is up | same | the same video |
| Whether the outer fade is linear in alpha or a gamma curve | the image's own response curve is unknown | a screenshot rather than a photograph |
| The exact red, colour-managed | image 12 is not colour-managed | a screenshot, or a photo with a grey card |

---

## 10. One more thing the images show: the scale numerals are magnified near the needle — on one image only

**Measured, image 12.** With the needle at 80.2 km/h the speed-scale numerals do not all have the same
size:

| Numeral | 40 | 60 | **80** | 100 | 120 |
|---|---|---|---|---|---|
| Figure height (px) | 11.92 | 17.00 | **22.34** | 17.22 | 12.00 |
| Ratio to the far field | 1.00 | 1.43 | **1.87** | 1.44 | 1.00 |

Symmetric about the needle, 1.87× at it and 1.43× one major tick away.

**Measured, image 04: no such effect.** With the needle at 0, all eight numerals (20 … 160) measure
14.2–15.0 px — equal within the noise. If the magnification were needle-centred, "20" would be 1.43×.

**So the two photographs disagree and this is NOT established.** Both are F30 6WB speedos. Possible
readings — all **estimated**: it is a driving-only behaviour that a stationary bench photo does not
show; it belongs to a cluster software version image 04's unit does not have; or image 12 is not an
F30 6WB after all, despite its dial calibration fitting one to 0.03°. One photograph of a moving car
with the needle anywhere but 0 would settle it. **It does not affect the typeface verdict** — the
shapes are the same in both images, only the size differs — but `feat/bottom-row` should know before
anyone tries to reproduce image 12's speedo exactly.

---

## 11. Reproducing all of it

From the **main checkout**, which has `reference/` and `bake/work/`:

```sh
export UV_CACHE_DIR=bake/work/.uvcache
U="uv run -q --no-project --with opencv-python-headless --with numpy --with pillow --with scipy"

# the dial calibration and the over-speed wedge
$U python -I tools/f30font/wedge.py --img reference/6wb/12_speedo_signs_overspeed-wedge.png \
    --centre 185 174 --tick-r 112 158 --what cal --min-area 10 --major-area 25 --major-r 135 150 \
    --speeds 140,160,180,200,220,240,260,0,20,40,60,80,100,120
$U python -I tools/f30font/wedge.py --img reference/6wb/12_speedo_signs_overspeed-wedge.png \
    --centre 187.37 171.62 --what polar --polar-ang 275 330 --polar-r 40 150 \
    --polar-out bake/work/f30font/12_polar.png

# the glyph measurements
$U python -I tools/f30font/table.py --jobs bake/work/f30font/jobs_05.json --root .
$U python -I tools/f30font/measure.py --img reference/6wb/05_comfort_tach-closeup.png \
    --box 553 262 569 288 --what glyphs --invert --scale 10     # a counter

# the ranking, the fingerprint and the sheets  (--fonts: the candidate faces, kept outside the repo)
$U python -I tools/f30font/fontfit.py --fonts <dir> --widths 75,82.5,87.5,93,100 --top 12
$U python -I tools/f30font/fingerprint.py --fonts <dir> --axes
$U python -I tools/f30font/sheets.py --fonts <dir> --out design/f30-font/fonts \
    --photo-out bake/work/f30font

# the bench proof
BENCH_PORT=8160 node bench/server.js f30_cluster &
$U python -I tools/f30font/shots.py --port 8160 --out bake/work/f30font/before
uv run -q --no-project --with pillow python tools/bake_fonts.py f30_cluster
$U python -I tools/f30font/shots.py --port 8160 --out bake/work/f30font/after
$U python -I tools/f30font/shots.py --compare bake/work/f30font/before bake/work/f30font/after \
    --out bake/work/f30font/diff
```

Committed figures (no photo pixels): `design/f30-font/fonts/*.png`.
Review sheets that do carry photo pixels, git-ignored: `bake/work/f30font/`.

---

## 12. What could not be measured, and what would settle it

| Open | Why | What settles it |
|---|---|---|
| The `km/h` caption's own metrics | no reference resolves it above 9 px | a tach-quality close-up of the speedo's centre |
| The bottom row's digit advance | image 03 resolves the digits at 13 px but they bloom together | one sharp photo of the bottom row, or a screenshot |
| Whether the `i` dot is round or square | 4.0 × 4.0 px at a 23.5 figure height | a close-up of `1/min` at image 13's scale |
| The side-gauge figures' shape | 7–9 px and blurred on every image | a close-up of a side gauge |
| Whether the numeral magnification is real | images 12 and 04 disagree (§10) | one photo of a moving car with the needle off 0 |
| The marking's flash, timing and limit-change behaviour | no video in the reference set | one 30 fps video through an over-speed |
| The exact face name BMW used | BMW does not publish it | nothing public will, and it does not matter: the file may never ship |

The last row is worth stating plainly, as the G20 package does: **we are not trying to name BMW's
font.** We are matching what the cluster draws with a face we are allowed to ship. Roboto at width
87.5 does that to within about 2 % of a figure height. Arimo did it to within 7 %, with a foot serif
that should never have been there.
