# K1: mockups of the dials (Twin Dial round 3)

Package K1, branch `twin-r3/k1`. These are mockups of the dials: the fixes the owner asked for and the variants he can choose from. The geometry comes from SD's published numbers (`pub/SD/rings_redzone.json`, READY 2026-11-18 16:38) and the lead's numbers in §0. K1 checked both on SD's rectified frames 06 and 08. Nothing in `apps/` or `shared/` was changed.

## What to look at

All pictures are git-ignored, under `bake/work/twin-dial/mockup/r3/`:

| File | What |
|---|---|
| `dials_sheet.png` | **The contact sheet.** One row per choice (fixes, band look, red zone, inner rim, numerals, gear, tick strip, needle, combinations). Each tile is a labelled close-up of our tachometer. The rectified reference crops sit at the row's end, at the same R. |
| `<nn>_<variant>.png` | Every variant as a full 1920 × 720 panel (clock page, 87 km/h, 2400 rpm). |
| `close/<nn>_<variant>.png` | Our tachometer beside the reference crop(s), all at the same R. |
| `protected_zones_{r3_fixed,look_06,look_C_both}.png` | The annotated copies: hood line, BMW's belt group, the gear-letter gap, BMW's gear letter, the fallback window, the side-lamp holes, and (new) the KOMBI's black box. |
| `checks.json` | For each look: the red zone against the "8" numeral's ink, the ring ends, and a pixel audit of the keep-outs. |

To render them again (from the worktree root):

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/dials_r3.py
    node tools/twin-dial/r3/k1/shader_cost.js

## Code (tracked)

- **`tools/twin-dial/mockup/mockup.py`** — the dial drawing now takes a `Look`. Its defaults are 0.1.0, so `mockup.py` run on its own still writes the five round-1 pictures. I checked this with sha1 against a baseline taken before the change: all five are byte-identical.
  - New helpers for K2's `pages.py`: `draw_dials(cv, look, speed, rpm, gear, program)`, `finish(cv)`, `look_named(name)`, `eight_extent()`.
  - `annotate(img, black_box=True)` also draws the KOMBI's black box. It is off by default, so the old picture does not change.
- **`design/twin-dial/r3/k1/looks.json`** — every look as a difference from the look it extends. Each value carries its source and status.
- **`tools/twin-dial/mockup/dials_r3.py`** — the variant table, close-ups, contact sheet, annotations and checks.
- **`tools/twin-dial/r3/k1/shader_cost.js`** — the bytes each variant adds to the `tdial` source that is actually sent (`compact(TDIAL)`, 4461 bytes today). It counts them by applying sketch patches to a copy of that source; `shared/` is untouched.

## The fixes (`01_fixed`, look `r3_fixed`)

| Element | References (SD, rectified) | Today (0.1.0) | Fixed |
|---|---|---|---|
| Ring ends | All three end on one radial line. 06: band cut 143.0, bezel 143.60, rim 143.55. 02: 142.8 / 143.65 / 143.49. 04/08: about 140.6–140.9 | band and bezel 143.9; **rim 149.95** | band 143.0, bezel 143.6, rim 143.55 |
| Inner rim | 0.544 R (06), 0.545 (02); width ≤ 0.0072 R (06), 0.009 (02); 04/08 are thick (0.025) | 0.545 R, width 0.016 | 0.544 R, width 0.008 (SD's proposal) |
| Band | 06: 0.5795–0.9375 R | 0.580–0.940 | 0.5795–0.9375 (strip 0.893–0.9375) |
| Red zone | 06: red bezel arc 70.3 → 125.2°, white bezel and grey band after it. 08: wedge to 120.8°, grey after. **Only 05 runs the red to the end (147°).** | wedge 6.5k → 125°; the "8" ink (119.0–131.5°) sticks out of it | wedge from the redline to the band cut (143.0°); the "8" is wholly inside (checked in `checks.json`) |

Two findings that change what the owner was told:

1. **The inner ring is not shorter on ours. By angle it is 6.4° longer.**
   - Our rim runs to ±150°. Every reference ends the rim together with the band and the bezel (SD verified this to 0.15°; I measured the same independently on rectified 06 and 08).
   - What does differ: our rim is about twice as thick, and it overshoots the shared end line.
   - The fix (`30_rim_fixed`) makes it thin and ends it on that line. `31_rim_today` shows the old rim beside it.
   - If the owner still sees ours as shorter, a photo of the car is needed: the gallery render does not show it.
2. **No reference draws the red zone to the band's end** except 05. 06 and 08 stop it at the scale's last mark, as we do today, and their "8" overhangs the red as well (by 5.5° and 3.5°, per SD).
   - The fix follows the owner's wish and 05's rule.
   - `24_red_08_end` is our own compromise: the wedge ends 2° past the "8" ink and the grey band continues after it, as on 06 and 08.

## Variants and what each costs to build

"Face re-bake" means `tools/twin-dial/bake_face.py` with new constants. The two R8 faces stay 616 × 560, so there is no pixel-memory change. Shader bytes are from `shader_cost.js`.

| Picture | Variant | Face re-bake | tdial shader bytes | Other |
|---|---|---|---|---|
| 01 / 20 | Red zone to the band cut (wedge) | no | **0** | `hud.js _twinDialSend`: `u_red.w` = 143 instead of the sweep (one line) |
| 01 / 30 | Rings: rim 0.544 / 0.008 / 143.55, bezel end 143.6, band cut 143.0, band 0.5795–0.9375 | yes (`RIM_*`, `BAND_*`, `STRIP_RHO`) | 0 (constants change in place: band smoothstep, `ang` 144 → 143) | |
| 10 | Band A (today's law, with the fixes) | – | – | |
| 11 | **Band B** (06): Y = 0.0188 e^4.60(ρ−0.6) e^0.59(1−cos θ), tint 0.76 / 1 / 1.064, strip (98, 109, 111) | yes (band law, strip code) | +3 (`TINT` and the wedge's band underlay `Lb` must change with the law) | `face_shade.py` and the regions JSON decode in step |
| 12 | Band C (between A and B) | yes | +3 | as B |
| 21 | Red bezel arc (06), no wedge | no | +78 (the arc term plus a wedge on/off flag in the spare `u_bar2.z`) | layout key for the style |
| 22 | Wedge and red bezel arc | no | +60 | |
| 23 | Wedge with the rim red over it (08) | no | +100 | |
| 24 | Wedge ends just past the "8" | no | 0 | `u_red.w` = 135 |
| 41 | Numerals with 06's soft shadow | yes (the shadow baked as darker band codes under each numeral) | 0 | the red 7/8 lose their shadow on the wedge (the wedge replaces band codes): acceptable |
| 51 | Gear in the hub's centre, program under it (06 / 07 / 11) | yes (the unit label "1/хв × 1000" moves to +0.40 R) | 0 | `gen_twin.py`: `gear`, `program`, `ready` move. `td_gear` re-baked at 92 px (atlas 1024 × 70 instead of × 50, about +20 KB), or `DMNPRS` added to `td_big` |
| 61 | Tick strip with its bright outer line (06) | yes (one ring of codes, 0.924–0.934 R) | 0 | |
| 71 | Needle with the engine's shadow | no | 0 | **This is what the car already draws** (`u_dim.w` = 1 unless the layout says `shadow: false`). The round-1 mockup drew the needle without it. An offset drop shadow like 06's would cost +11. |
| 80 | All of 06 (B + arc + numeral shadow + gear centre + strip line + needle shadow) | yes | +81 | the gear-centre items |
| 81 | K1's middle proposal: C + wedge and arc + numeral shadow + strip line + needle shadow, gear low | yes | +63 | |

The heaviest combination adds about 180 bytes, which brings `tdial` to about 4.6k. The KOMBI has run 12.4k (WBDIAL Comfort) and 25.4k; it reset at 26.7k. Every variant is far below that, and each layer still carries only its own look.

## Hypotheses still open in the looks

- **Band B** is K1's fit on rectified 06, after subtracting 06's black of 20 in linear light (58 % of band pixels kept, rms 0.10 in log). It agrees with §0's colours within a few codes. SD's band law (`dials_v2.json`, not yet published) should replace it.
- **The numerals' shadow** (offset (0.008, 0.020) R, σ 0.009 R, strength 0.70) was read by eye at 6×. 06's shadow looks a little larger and further down.
- **The strip's bright line** (G 124 at 0.931 R against a strip body of 108) was measured by K1 on 06. 06 also has a fainter line at the inner edge (0.898), which is not drawn.
- **Gear-centre positions** are by eye on 06: "P" on the dial centre, cap height about 0.22 R; the program at +0.217 R.
- Not drawn, for the lead:
  - 06 has three minors per 1000 rpm (ours: one).
  - 06's needle rests at −131.5° (ours: −135°).
  - 06 has red marks on the speedometer strip at 30, 50 and 130 km/h.
  - 06's tachometer numerals look smaller and sit further out.
  - SD covers all of these in its report.

## Keep-outs

Every picture leaves BMW's belt group [497, 660, 688, 720] and the gear-letter gap [1380, 660, 1460, 720] black: 0 non-black pixels in all 22 pictures (`checks.json`). The hood line, the lamp holes and the fallback window are drawn on the annotated copies. The dials do not change near them.

Not a K1 change, but worth noting: the digital speed "87" (y 374–444) reaches into the KOMBI's black box (y 342–419) on every picture, today's included.

## What the lead must decide

1. **The red zone's end.** To the band cut (the owner's wish, 05; `01`), just past the "8" with grey after (`24`), or at the scale end as 06 and 08 do (today).
2. **The red zone's form.** Wedge (`20`), red bezel arc (`21`), both (`22`), and whether the rim turns red over the zone as on 08 (`23`).
3. **The band look.** A, B or C (`10`–`12`).
4. **The gear position.** Low as today (`50`) or in the centre (`51`).
5. **Numeral shadow and strip line.** Take or leave each (`41`, `61`).
6. **The owner's message about the inner ring.** It is ours that is longer; the fix makes it thinner and ends it with the band and the bezel.
