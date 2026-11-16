# Package H: history and claims of the bottom strip

Branch `strip/H` (on `integrate/bottom-row` `3c8ef46`). Read-only for everything outside `tools/strip/H/`,
`design/strip/H/` and this report. No bench, no car, no browser. The data behind every line here:

- `design/strip/H/constants.json`: every strip constant, its commit, photo, stock or not, assumption, ranked.
- `design/strip/H/provenance.json`: every photo in `reference/g20/` and `reference/ours/`, settled by content.
- `design/strip/H/claims.json`: 32 statements from the docs and comments, each with a verdict.
- `design/strip/H/genealogy.json`, `cites.json`: the commit history of each constant, and which file cites which photo.

Geometry from package R's first rects (60–64, `bake/work/strip/rect/`) where they existed, else from package B's
low-resolution rects (`bake/work/overlay/rect/` 08, 09, 10, 14, 17, 39), else from my own provisional SIFT rects of
63–67 (`tools/strip/H/quick_rect.py`, off by up to 5 px at the strip's ends: used only for "is it there", never for a
pixel). Each claim says which.

## 1. Verdicts

1. **Four of the nine "new" photos are not new.** 60 = 10, 61 = 09, 62 = 08, 68 = 39: identity transform, NCC ≥ 0.998,
   grey differences of 1–2 levels, the same capture second. The new exposures are 63, 64, 65, 66, 67, and 63 shares
   62's framing. A "second photo" check between 61 and 09 (or 62 and 08, 68 and 39) is the same observation twice.
2. **39 and 40 are stock.** By content, not by name. In 39: BMW's gear letter and mode label are in the tacho centre and
   **not** in the bottom row (BMW puts them into the row, the gear on top of any theme, whenever a theme is
   connected: 10, 14, 17, 34, 41). 0.7.7, the build on the car that morning, drew neither. There is no black box,
   although 38 (75 s before) and 41 (44 s after) both have it. BMW's crossed start/stop sign shows where our G20
   replica's tacho was opaque. 40 was taken 10 s later in the same state, with BMW's pump-with-arrow icon and the line
   running behind the sign. It shows only the left half, so on its own it cannot rule out a theme.
3. **There are two stock arrangements, and the one that matters is the rarer one.** With a theme connected, BMW
   moves its mode label (x ≥ 1223) and gear letter (x 1395–1424) into the bottom row. Usually it also blacks out the
   tacho hub, but not always (34). The 6WB see-through layouts live with that arrangement. Of the stock-visible
   photos, only **10 = 60, 14 and 17** show it. 61–68 (except 60) show the no-theme arrangement. **17 is not stock**
   in the plain sense, as `measured.json` and the brief say: it is BMW's drawing under a connected theme. 66 and 17
   carry the same message, so they are the pair that can show whether a theme changes the panel's geometry. On B's
   and R's rects the rail top and the symbol's right edge agree within ~1 px between 08/62 and 17 (hypothesis: no
   change).
4. **Standby is not "P with the engine off".** 62 and 63 are P with the engine off (the tacho reads OFF, the
   ready-to-drive message). There BMW draws its full normal row: sign, four belts and the airbag, the panel and the
   marker. Standby (65) is a separate state. `hud.js` closes the sign window on `stage P && rpm < 150`, and the brief
   defines standby as "stage P, rpm 0". Both are wrong. In `allG20` the window then shuts over a sign BMW is
   drawing.
5. **The message has a fill.** A gradient band hangs under the rail, follows its shape and ends at its tips. In
   max(RGB) its median is 91, 102 and 74 (08, 66, 17), against 25–30 just above the rail and 18–35 in the same box
   with no message. It is not bloom: there is nothing like it above the rail. The spec's "no fill" rests on 42 and
   43, two photos of our theme.
6. **The marker is independent of the message** (63 "i", 67 triangle, neither with a panel). **The warning triangle
   is about 42 × 36** (≈ [1241.5, 590.3, 1283.5, 626.4], provisional). That is three times the "i" that the
   catalogue box, `I_WIN`, `SHADE_KO` and the spec's slot were all sized from. The spec's `triangle_43` box is the
   outline of **our own 0.7.7 box window** clipping the triangle (seen by eye on 43).
7. **BMW's sign centre is uncertain by about ±1 px, and `SIGN_WIN` r 40 has no margin for that.** Outer-ring fits
   give x 537.7–539.1 on B's rects and x 537.2–538.0, y 621.9–622.9 on R's rects (r_outer 41.6–42.0). The spec gives
   537.4 ± 1.3 and car3 G gives 537.3. All of them put BMW's red ring outside r 40. On R's centre, r 40 leaves about
   7.5 px of red at the top and 5.7 px at the bottom of a ring about 8.3 px wide. That is my **hypothesis** for the
   owner's lopsided sign; package O tests it on `68.png`. The speedo layer does not clip the ring (box 77–747 ×
   45–715, max reach r 53 at 272 px from the hub, R 334).

## 2. Constants, ranked by how likely they are wrong

| # | Constant | Set by | Rests on (stock?) | Why it is likely wrong | Status |
|---|---|---|---|---|---|
| 1 | `SIGN_WIN` r 40 @ (537.3, 621.3) | `3bfce09` (r), `5979f85`/`8fe3c81` (centre) | car3 G on 34/37/41–43 (ours; valid for an "under" sign) | r < BMW's ring (41.1–42.0 in every source); centre ±1 px between registrations → uneven clip | hypothesis (cause of the asymmetry) |
| 2 | `assist.info_tacho` box → `I_WIN`, `SHADE_KO`, spec slot, `triangle_43` | catalogue (E), `d289700`, `82aa980` | 08 = 62 ("i" only); 43 (ours) | triangle ≈ 42 × 36 round x 1263; 43's box is our window | verified (shape), provisional (numbers) |
| 3 | "standby" = P ∧ rpm < 150 (`hud.js` cut mode 3) | 2026-11-14 | 33 (ours) | 62/63 are P + engine off with BMW's full row and sign | verified |
| 4 | `CC_BOX` [709, 598, 1243, 694] | `729ee63` | 08 = 62, stock **without** theme | mode label at x 1223 under a theme (17-20 px overlap); a box round a rail + fill; left tip 702 (spec) vs 711 (half-max) | verified |
| 5 | `NAV_HOLE` = CC_BOX x, y 666–712 | `ab24414` | inherits 08 | x from CC_BOX; y is the road bar's, not the panel's (ink ends ~691) | verified (arithmetic) |
| 6 | `CC_TOP` [590, 594, 1250, 665] soft 13 | `f59e5f8` | no photo (collar band + old sign centre) | x1 eats the triangle's left ~8 px; soft foot crosses the text band and the fill | verified (arithmetic) |
| 7 | `visible.js` `BELT` [587, 665, 626, 720] | `eefecfd`/`bc2fc0d` | X3 → Nov 11 grid photo | only the driver belt; rear belts and airbag (safety) are unchecked | verified |
| 8 | `COVER` / `COVER_BOX` [588, 598, 1324, 662] | `82aa980` | 09 + 08 (stock, no theme) | keep-out never saw the fill, wide symbols, the triangle, the mode label | verified (sources) |
| 9 | `NAV_BAR` [690, 666, 1250, 712] | `ab24414` | catalogue 08; spec 39/34/09 | x0 holds (airbag ends ~678); x1 into the mode label; covers the panel's foot when the hole is shut | verified / hypothesis |
| 10 | `OWN` range / clock / temp | `82aa980`, `64c2ac0` | catalogue 08/09/10/14 | the anchors (left / centred / right) are guesses; no photo can test them | hypothesis |
| 11 | `SIGN_CLEAR` r 46 @ (539, 622) (baked collar) | `34b06a6` | catalogue 08 | not moved with the window: the collar's black starts at r 44.3 on the left and 47.7 on the right | verified |
| 12 | WBDIAL ring reach 10 px | `3bfce09` | 37 (ours) | fine today; leans on #11 | verified |
| 13 | `ROW_BASE` 697 | `82aa980` | catalogue | spec 698.1 ± 0.6 | verified vs the spec |
| 14 | `CC_TEXT_C`, `CC_LINE_Y`, `CC_TEXT_W` | `d882270` | two-line: 08 only (62 is the same exposure) + 42 (ours) | one stock two-line exposure | hypothesis |
| 15 | `CC_SYM` [700, 628, 757, 690] | `d882270` | spec | fits the "i" (08) and the door (17) | verified |
| 16 | `NAV_CX` / `NAV_BASE` / `NAV_W` | `d882270` | 09/39/34 | 61/68 add nothing; 64/67 are the new tests | not re-measured |
| 17 | `CUT_Y` 656 / 26 | `d30056f` | catalogue 10/14 | design value | verified |
| 18 | dead: `HOOK_STUB`, `I_WIN`, `WIN_SOFT`, three earlier `SIGN_WIN`s | | | read nowhere; delete | verified |
| 19 | spec rail tips (702, 621) / (1221, 621) | spec | 08/17/42/43 | half-max ink ends at 710.5 / 1211.2 (R 62) | conflict |
| 20 | catalogue `cc_panel` / `bottom.street` | E | 08 / 09 | hull of one message / one string, not the field | verified |

## 3. Photo provenance (short; full table in `provenance.json`)

| Photos | Kind | Notes |
|---|---|---|
| 08 = 62, 09 = 61, 39 = 68 | stock, no theme | one exposure each; 08 is dusk, not night |
| 63, 64, 65, 66, 67 | stock, no theme | the only new exposures; 65 standby; 63 shares 62's framing |
| 40 | stock | left half only; 10 s after 39 |
| 10 = 60 | grid over stock + theme | one exposure |
| 14, 17 | stock + theme | 17 is **not** plain stock; 14 is 1024 px with our text in the strip |
| 11, 12, 13, 15, 16 | ours | 13 has 12's capture second |
| 32, 33 | ours, **standby with a theme** | name and CAR3-K say 6WB Comfort, CAR3-G says Dials + G20; content favours a see-through layout |
| 34–38, 41–43 | ours | 43's triangle clipped by our window; 34 has no black box |
| `16_bench…`, `ref_comfort_bench` | bench renders | |

The see-through layouts live with the **stock + theme** arrangement, and only 10 = 60, 14 and 17 show it. Package D's
matte photo would add a fourth, and the first in standby with a theme besides 32/33.

## 4. Document sections to correct

- `docs/G20-DESIGN-SPEC.md` §0 (marker row, rail-tip row, photo counts), §2 (mode label rule; belts "drawn over any
  theme" → only the driver belt is known to be), §3 "When it shows", §4.1 (centre ±1 px; how many independent
  exposures), §5.1 (the fill; the rail tips), §5.5 last sentence and §5.6 (marker independent; triangle size), §6
  item 3 (draw the fill), §7 (39 / 09 / 08 have hi-res originals 68 / 61 / 62; the 39 → 41 → 34/42/43 chain is one
  registration).
- `design/g20-spec/measured.json`: `photos.17.shows`, `right_marker_box.triangle_43`, the rail tips.
- `design/overlay/g20_comfort.json`: `assist.info_tacho` bbox (the "i" only).
- `docs/BOTTOM-ROW-PACKAGE.md` §3 (the sign bullet's standby; "331 px field"; "ccSym x 709–790"; "no fill"), §10.5,
  §12 (name / description lines).
- `design/gen_6wb.py` comments: `SIGN_WIN` ("invisible" loss), `NAV_BAR` ("no fill"), the row-patch comment
  (the mode label is "fully black" from x 1232, but it starts at 1223).
- `shared/hud.js` sign-window comment and the mode-3 condition (P + rpm ≠ standby).
- The brief: §2.1 (four of nine are old frames), §2.2 (39 and 40 settled), §4.2 (ST-MSG1's 17 is with a theme;
  ST-MSG2, ST-DRIVE and GRID are one exposure each; the standby definition), §1.6.

## 5. Privacy

My files hold numbers only. No photo text, no times of day, no odometer. Already in tracked files before this
package, for the lead to decide: `design/g20-spec/measured.json` (`photos.*.shows` and `runs.*.text` quote street
and place names and message texts), `design/overlay/g20_comfort.json` (state notes quote street names, clock and
range readings), `docs/G20-DESIGN-SPEC.md` §3 (street names), `docs/CAR3-I-REPORT.md` §5 and `docs/CAR3-K-REPORT.md`
§1 (a city, capture times).

## 6. Tools (`tools/strip/H/`, run with the repo's uv convention)

`genealogy.py` (git history per constant), `same_frame.py` (are two photos one exposure), `sign_fit.py` (outer and
inner ring circle fit), `inkbox.py` (ink boxes in named windows), `fill_check.py` (inside / outside the panel),
`local_shift.py` (is a difference real or registration), `quick_rect.py` (a provisional SIFT registration),
`cites.py` (who cites which photo).
