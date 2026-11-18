# KC: checks, night, "everything on" and the choice sheets (Twin Dial round 3b)

Branch `twin-r3b/kc` (from `twin-r3/k2`). Mockups only: nothing under `apps/`, `shared/`, `bench/`, `design/gen_twin.py`, `tools/twin-dial/bake_*.py`.
Everything below is in `bake/work/twin-dial/mockup/r3b/kc/` (git-ignored): `checks.json`, `compare.json`, `compare_sheets/`, `sheets/`, `z/` (Z01-Z04),
`kb_final/` (KB's pages re-rendered by KC, identical to KB's published set, used by the sheets), `night_validation.json`, `index.html`.
Inputs: K1's and K2's pictures (`mockup/r3/`), KA at `1805b14`, KB at `1556583` (both READY).

## Tools (`tools/twin-dial/mockup/`)

| File | What |
|---|---|
| `inkrec_r3b.py` | runs a generator (K2's `pages.py`, KA's `make_ka.py`, KB's `pages.py`, `zpics_r3b.py`) **unchanged** in a scratch tree and records the ink box of every text and icon on every 1920 x 720 PNG it saves (Pillow hooks). The published pictures are never touched. |
| `checks_r3b.py` | the checks of MOCKUP-SPEC-R3B §5 (below) on the pixels plus the ink records; `checks.json` lists failing checks by picture. |
| `test_checks_r3b.py` | 25 doctored inputs the checks must fail on (pixel in the belt group / gear gap / a lamp hole, text over a separator, over the title rule, beyond the window side, two numerals 2 px apart, a numeral on the strip, two row items 4 px apart, our ink inside the open window, a sign 10 px off). It found three bugs of my own while I wrote it (a lone belt pixel was waved through as the lamp-hole corner note; "14:43" and "+7.5" were merged as number + unit; a wrong test box). All pass. |
| `compare_r3b.py` | the reference comparison (below). |
| `night_r3b.py`, `zpics_r3b.py`, `sheets_r3b.py` | night, Z01-Z04, the sheets and `index.html`. |

## 1. Checks

Pictures checked: K1/K2 96 (the old set), KA 50, KB 71 (11 of them composite sheets, skipped: T06-T11, 1J, 1K, 2S, 5G, P01; 60 frames checked), Z 4: 210 single frames in all. Annotated copies, close-ups and KA's
A02 / A03 (reference crops beside ours) are not full frames and are not checked. Statuses: pass / fail / note (a measurement with no limit in the specifications) / skip.

| Check | Rule | Result |
|---|---|---|
| keep-outs | 0 non-black px in the belt group, the gear gap, the seven side-lamp holes | **pass on belt group and gear gap in all 210 single-frame pictures; one standing note**, below |
| cells | every text and icon of the bar inside one cell, none across a separator (separators detected in the picture) | KA, KB, Z and K2 (except the one below): pass, no item nearer than 4 px to a separator; **fail only on K2's `T7_today_seps`** (the unit "км" crosses today's separator at 744 by 2.3 px: that is what the picture exists to show) |
| centre page | ink inside the window's sides [729, 1191], nothing across the title rule (y 295-297.5), the columns beside the window black (y 176-590; map pictures exempt) | **fail: the unit "бар" on the technical page** (KB `1D`, `1E`, `1F`, `1G`; K2 `V1_tech`, `T15_other_icons`): box x 1156.0-1193.7 against the edge 1191 (2.7 px by Pillow's text box, 1.7 px by KB's ink measure; either way past the 1 px tolerance). Everything else passes |
| dial gaps | >= 4 px between any two ink boxes of a dial; numerals >= 4 px to the strip (0.893 R) and to the band's inner edge (0.5795 R) | pass everywhere; smallest gap 4.8 px (numerals), smallest numeral-to-strip 5.6 px (speedometer), 13.3 px on the tachometer |
| bottom row | >= 6 px between items (a number and its smaller unit count as one) and round the sign | pass; smallest 17.7 px (two-line row), 86.7 px to the sign |
| fallback window | nothing of ours inside while BMW's panel is drawn open (pixels and boxes, the panel's label excepted) | pass in all 12 pictures with the window open (KA L18; KB 2J, 2S2, 2S4, 2S5, 2T; Z01; K2's five) |
| sign clearances | SPEC-R3 §8, measured on the pixels | **pass in every picture with a sign (KA 32, KB 60, Z 4, K2 6)**: stored-message marker 10.7 (10.7), fallback window 41.0 (41.0, the sign's box to the window's bbox), gear gap 47.0 (47.0), panel bottom 15.0 (15.0), our ink 25.3 (26.0: the speedometer's ring; KA gets 25.1 by the bottom rule's end). To the window's polygon 54.3 px |
| markers | the red and the green marker never touch when >= 2 degrees apart | KA C07 (limit 90, set 110, 18.75 deg apart), both places and both night versions: pass, 0 touching px. C06 and C08 (same angle): note, nothing touching, they sit in two annuli |
| cruise readout (new) | >= 4 px to every other ink of the dial; distances to the black box and the gear gap | pass; see §1.2 |
| naming / data status | file name starts with the picture's id; the index entry carries a data status | pass for KA and KB (all) |

### 1.1 The one standing note: pixel (1774, 207)

In **every** picture, K1's, K2's, KA's, KB's and Z's, and 0.1.0's `00_today`, the right dial's bezel touches the corner of the side-lamp hole 4 [1774, 176, 1873, 208]
(the +3 px rectangle of VG): one pixel of value 142 at (1774, 207), and hole 2 two pixels of value <= 1. The check treats up to one pixel in a hole as a note. KA measured the same
(KA-REPORT §2: a bezel half width of 0.0100 R would bring it to values <= 34; 0 would need about 0.0005 R more) and KB's finding 9 says the same. It is VG's geometry, not content;
the owner or lead decides whether the undilated lamp box (clear by 3.7 px) is the test.

### 1.2 Cruise readout: what the check measured (KA's C1 and C2)

| | C1 (hub, above the coolant) | C2 (the coolant's place) |
|---|---|---|
| readout ink box (set 110) | x 1467-1590, y 512.3-563.0 | x 1489-1617, y 590.3-644.0 |
| to the black box [1420, 320, 1611, 440] | 72.3 px | 150.3 px |
| to the gear gap | 97 px | 29 px |
| nearest other ink (box / pixel) | 16.0 / 17.5 px (the coolant icon) | 76.6 / 53.1 px |
| three digits (130) | box 1455.3-1590, nearest ink pixel **11.8 px** (the rim's end) | as 110 |
| farthest corner from the spec's disc centre (1540, 528) | **81 px (91.6 with three digits) against the disc's r = 45** | 139 px |

The spec's "free disc r 45" is narrower than its own layout: the right-aligned number 110 starts at x 1467, 73 px left of the disc's centre, and the symbol at 1572 reaches 1590.
The layout still clears everything (the disc's number comes from the readout's text, not from the disc), so the 14 px of SPEC-R3 §9 is a statement about the disc, not about the ink: the ink has 16-17 px (11.8 px with
three digits). Nothing to fix; the build should take the ink numbers.

## 2. Against the references (`compare.json`, `compare_sheets/`)

Scale 0.75 (the references' R 400 is our R 300); a dial about its own centre, the frame about the midpoint of the two centres. "Ink" = a bright or red pixel; recall / precision: ours within 2 px of the reference's and the converse;
the needle's sector (+-6 deg, found in each picture) and the hub excluded on the dials. Definitions are in the module's docstring. The contact sheets (ours | reference, not ours | difference) are git-ignored.

| Comparison | ink ratio | centroid shift (px) | recall 2 px | precision 2 px | dE ink | dE band | row profile r | Known, deliberate differences |
|---|---|---|---|---|---|---|---|---|
| A01 tachometer vs 06 | 1.024 | (0.7, 1.3) | 0.864 | 0.900 | 7.3 | 3.2 | 0.74 | 06's red arc ends at 125.2 deg, ours at 143.6; our numeral shadow is SD's model, 06's is the photograph; our small speedometer set; the hub text masked |
| A01 speedometer vs 06 | 1.007 | (-3.7, -1.4) | 0.791 | 0.813 | 5.6 | 2.6 | 0.68 | as above; our digit "87" and the limit sign are outside the annulus |
| T01 tab bar vs 06 | 1.892 | (-2.8, -0.3) | 0.778 | 0.519 | 9.0 | 7.9 | 0.84 | our icons and texts (range "412", the radio name) are larger or more numerous than 06's; separators 780 / 848 are ours (06's are 6.6 / 6.1 / 2.8 / 4.3 px away, KB finding 8); our fifth tab is navigation. Selected-tab fill at the cell's foot: ours (163, 8, 33), 06 (129, 35, 37), dE 19.9: ours is the spec's (176, 10, 37) ramp end, 06's measured ramp ends at (150, 38, 43) before the panel's black floor |
| 1A date page vs 06 | 1.345 | (4.4, 21.6) | 0.411 | 0.286 | 6.0 | (edge pixels) | 0.49 | our large Saira clock, our language, the weekday and date lines at our own rows, no side gauges (the reference is not a like-for-like layout; the numbers say how far the owner's mockup is from 06) |
| 1B trip page vs 02 | 0.782 | (-8.3, -3.1) | 0.566 | 0.663 | 3.3 | (edge pixels) | 0.91 | our Ukrainian words, our stacked consumption unit, no side gauges: the table grammar (rows, columns, title rule) agrees (row profile 0.91) |

The dials are within 0.3-0.9 px of the references in layout (centroid) and agree on 80-90 % of the ink within 2 px; the deliberate differences account for the rest. Reference 02's dial band is much lighter than our look (its ink
threshold picks up the band), so the dials are compared to 06 only.

## 3. Night (`sheets/S7_night.png`)

A01, T01-T05, 1D, 2B, 2C, 3D, 4E, 5A, 5C, C07, L04: day above night. SPEC-R3 §6's multipliers (SPEC rev 2 §7.2's, with the tab fills x 0.75 and amber x 0.8) applied to the finished picture per material, in linear light, by region and
colour class (`night_r3b.py`; BMW's panel stand-in untouched). It is an approximation of the engine's uniforms at ink edges. **Validated against KA's own night render** of C07 (KA applies the multipliers inside the drawing): mean absolute difference 0.45 levels,
99th percentile 12, 0.07 % of the pixels differ by more than 20. All night values remain hypotheses (no night reference of the facelift).

## 4. "Everything on" (`z/`, `sheets/Z_everything_on.png`)

Composed from KA's dials, limit, cruise and sign and KB's tabs, pages and bottom row, without new design: **Z01** driving at 103, limit 90 (sign, marker, full red strip L1), cruise 110, a two-line amber message has just arrived (BMW's panel open, bottom row gone, tab 2, card painted); **Z02** the same 150 ms later (window closed, one-line row, amber rule); **Z03** tab 5 with the map window, over the limit; **Z04** an incoming call on tab 4, cruise in standby.
All four pass every check.

## 5. What the pictures show that the lead should know

1. **"бар" overhangs the window by 1.7-2.7 px** on every technical page (above). KB proposes Noto 19 for the unit (ends 1188) or the third value at x 1146.
2. **The cruise readout is wider than the spec's disc** (81 px from its centre, 91.6 with three digits against r = 45; above). It clears the dial's ink by 16-17 px (11.8 px with three digits).
3. **C3 does not fit** (KA, 110 px of room): no picture.
4. **Standing pixel in lamp hole 4** (1774, 207), value 142, in every picture (§1.1).
5. **Map road name (KB finding 6):** the descenders of "вулиця" reach y 597, 1.3 px into BMW's panel window if it were open on tab 5; the road-name bar of the spec's number (baseline 590) sits below the map. Not drawn open, so not a failed check.
6. KB's pictures were rendered first with K1's dials; KB re-rendered with KA's `r3b_base` and the sign before READY, and the published set is the same as my own re-render byte for byte on the spot checks (T01, 2S3, 5A).

## 6. Decisions the owner must make, and what each unblocks

| # | Decision | Sheet | Unblocks |
|---|---|---|---|
| 1 | The red strip: **L1** (dim below the limit, full over; KA recommends), **L2** (only between limit and needle, over) or **L3** (always full). Cost +174 shader bytes whichever; | `S1_red_strip.png` | SPEC-R3 §8, `u_lim` strip mode and `config.limit.strip` in 0.1.1 |
| 2 | The cruise / limiter place: **C1** (hub, above the coolant; KA recommends: 0 bytes, coolant stays) or **C2** (in the coolant's place: +111 bytes, hides the coolant); the unit's colour in C1 (green or grey 227); C3 is out | `S2_cruise_place.png` | SPEC-R3 §9, the 0.2.0 build brief (the drawing is switched off in 0.1.1) |
| 3 | The numeral shadow: SD's measured model (SPEC-R3 §2.4) or K1's by-eye shadow; the owner saw K1's | `S3_shadow.png` | the constants of `bake_face.py` (one re-bake of both faces, same size) |
| 4 | Technical data and tyres as pages of tab 1 with the "Технічні дані = показувати / сховати" setting (the strip 1J shows what it does); page dots under the title rule or none | `S4_tech_page.png` | SPEC-R3 §4.1 and §10, the cycle's page list, the dots as four small discs on the centre sheet |
| 5 | The final look of every tab and state (confirmation): the overview | `S5_overview.png` | the whole 0.1.1 page build (nothing to choose; objections here stop the build) |
| 6 | The message sequence: that BMW's panel is seen for the 150 ms of frames 2 and 5 | `S6_sequence.png` | SPEC-R3 §5.4, `CC_SETTLE_MS` |
| 7 | Night: the multipliers as pictured (hypotheses) | `S7_night.png` | SPEC-R3 §6, the night uniforms |
| 8 | Small design choices the pictures exposed: the unit "бар" (Noto 19 or a shifted value); tab 4's line "Телефон не підключено" (459.7 px, 1.2 px inside the window each side: Noto 36 or "Немає телефону"); the road name's place on the map page (the spec's baseline 590 or SN's 572 on the map's foot) | `S4`, KB-REPORT findings 2, 4, 6 | SPEC-R3 §4.1, §4.4, §4.5 numbers |

KC recommends nothing on 1-4: KA's recommendations (L1, C1) are in the sheets' footers as KA's.

## 7. Limits of this round's checks

- Text-over-text on the pages is not computed by KC: KB's own record (`close_pairs`, ink boxes nearer than 6 px) is empty for every single frame; KC re-checked the title rule, the window's sides and the cells.
- The composites (KB's T06-T11, 1J, 1K, 2S, 5G, P01) are not frame-checked; their frames exist as single pictures (2S1-2S6, 5G's four in the composite only).
- The needle at rest on a numeral (SPEC rev 2 §5.3's last clause) is not checked: every picture has the needle in motion (87, 103, 63...).
- The night transform is an approximation by region and colour (§3).
- Reference comparison numbers describe the photographs' ink under a fixed threshold; they say "how close", not "right".
