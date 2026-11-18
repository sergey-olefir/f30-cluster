# KB: the tabs and their pages in the final look (Twin Dial round 3b)

Branch `twin-r3b/kb` (from `twin-r3/k2`, with `twin-r3/k1` merged in first). Mockups only: nothing under `apps/`, `shared/`, `bench/`,
`design/gen_twin.py` or `tools/twin-dial/bake_*.py` changed. The design authority is `docs/twin-dial/SPEC-R3.md`; the task is
`docs/twin-dial/MOCKUP-SPEC-R3B.md` §4. Code: `tools/twin-dial/mockup/pages.py` (the pictures) and `tools/twin-dial/mockup/pictos_r3.py`
(KB's new pictograms at the end of the file). Pictures (git-ignored): `bake/work/twin-dial/mockup/r3b/kb/`.

Re-render (from the worktree root):

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/pages.py
    # with KA's published dials:  KB_DIALS=<KA's mockup.py> KB_LOOK=<KA's look name> ... (see "The dials" below)

Output: 72 entries in `index.json` (every picture with its id, what it shows, variant, data status, spec section, the keep-out pixel count,
the ink boxes that come nearer than 6 px, the ink that leaves its place, the tab cells' margins, and K2's equivalent picture), the folders
`tabs/ tab1/ … tab5/`, a contact sheet per folder (`tabs_sheet.png` … `tab5_sheet.png`), a close-up (2× of the relevant area, the bar at 3×)
`<id>_<name>_close.png` beside every picture whose point is small, and annotated copies `<id>_<name>_annotated.png` (hood line, belt group,
gear gap, BMW's gear letter, the fallback window, the lamps, **the G20 black box [1420, 320, 1611, 440]**, BMW's stored-message marker
[1240, 588, 1288, 630]) for T01, 2S4, 2T. Every file name starts with the picture's id. The pictures carry no label: the id and name are the file
name, the labels (caption, data status as coloured dots) are on the contact sheets and in `index.json`.

## The dials

The base look is `look_06` with SPEC-R3 §2's corrections. **Status of the dial drawing in these pictures:** K1's `look_06` from
`mockup.py` (band B, red bezel arc to 143.6°, rings ending together, thin inner ring, strip line, needle shadow, gear in the hub's centre)
with **SD's measured drop shadow** ((+0.010, +0.012) R, σ 0.008, 0.35) in place of K1's by-eye shadow. Not yet in this render, because they are
KA's (package KA owns `mockup.py` in this round): SD's *outline* term of the numeral shadow (0.008 R at 0.75), the 0.010 R major lines across the band,
the exact hub numbers (gear cap 0.222 R at (0, 0), program Saira 24 at +0.209 R). `pages.py` takes the dials through `KB_DIALS` / `KB_LOOK` and
was tried against KA's working copy (`r3b_base`): same page code, no change needed. The final render is made with KA's published module (the
READY note names it); see the line at the end of this report for which render the folder holds.

## What changed against K2's set (`r3/` → `r3b/kb/`)

| Area | K2 | 3b |
|---|---|---|
| Numbering | `T1_sel1`, `1A_clock`, `2J_opening` … | the ids of MOCKUP-SPEC-R3B §4 (`T01`, `1B`, `2S2` …); `index.json` carries `k2_equivalent` for every picture that has one |
| Dials | `r3_fixed` (wedge, flat numerals) | `look_06` with SD's shadow (above) |
| Tab 1's label | placed by the text's advance boxes: the unit sat 11 px further out, 3 px from the separator | placed by ink as SF's budget says (icon ink 18 px in, 36 px wide, 7 px, value, 6 px, unit, 14 px): "412 км" has 14.3 px to the separator; the unit is dropped when it would come nearer than 14 px (T07) |
| Bottom row | one line on tab ≥ 2 | unchanged (clock 846, temperature 1153, baseline 655); the rule takes the severity colour while our card covers BMW's panel |
| Technical data | tab-4 alternative V1 | page of tab 1 (1D–1G), the bar's fill red *from the warning value* (K2 painted the whole track tail); the tyres page 1H / 1I |
| Cycle, dots | – | 1J (with and without "Технічні дані"), 1K (dots or none) |
| Messages | 2D counter at baseline 334 (SC's card.json) | counter baseline **326** (SPEC-R3 §5.1 wins); card samples: one line white, two lines amber, three lines red, cut, green; rows sorted by severity (red, amber, others) |
| Sequence | three single frames | six frames `2S1`–`2S6` and one sheet `2S`, each labelled none / window / ours; `2T` the D7 pointer page |
| Pointer symbol | `cc_warn` for amber | SC: `cc_warn` for red, amber **and unknown**, `cc_info` otherwise (2T uses the unknown case: grey cell, warning symbol) |
| Media / phone | SM, SP pages | SPEC-R3 §4.3 / §4.4 geometry: radio pictogram 54 at y 344, station Noto 41 at 424, radio text Noto 29 at 471, footer 565; track 400 / 444, progress x 800–1120 at y 500; phone line 1 Noto 39 at 424, line 2 Noto 29 at 471, handset 66 at (960, 372), timer Saira 72 at 410, name Noto 39 at 478. **No missed-call count**. The CarPlay source has its own tab icon (`td_projection`) |
| Navigation | 568 footer, hub variant | SPEC-R3 §4.5: footer baseline 560, road bar baseline 590, lanes centred at 34 px pitch, roundabout / fork / destination-left pictograms (ours), the distance rule (5G) |
| Dropped from K2 | – | tab 4's V2–V4 alternatives, today's separators (T7), "ended" call card, the "no caller line" variant, the hub arrow (the black box), W2 |

## Pictures

Data status words: **arrives** = seen on this car; **unseen** = in the catalogue, never logged; **after probe** = specified, switched on only when
the car session has shown the signal; **certain** = needs no signal. Detail per key in `index.json` (`source`).

| Picture | What it shows | Data | Spec |
|---|---|---|---|
| `T01_sel1` | tab 1 selected (red): date and time, two-line bottom row | range: arrives, clock: arrives | §3.2, §3.5 |
| `T02_sel2` | tab 2 selected (red): an amber card; severity in the cell, not in the fill | cc: arrives, cc_now: unseen | §3.2, §5.1 |
| `T03_sel3` | tab 3 selected (amber): radio | media: after probe | §3.2, §4.3 |
| `T04_sel4` | tab 4 selected (green): phone idle | phone: after probe | §3.2, §4.4 |
| `T05_sel5` | tab 5 selected (blue): the map window W1 | map: after probe, road: arrives | §3.2, §4.5 |
| `T06_bar_measured` | the bar measured: separators 780 / 848 / 1168 / 1237, 18 px inset, icon 36, text cap 24, 3 px rule; beside rectified 06 | range: arrives | §3.1 |
| `T07_range_values` | range values 8 / 87 / 412 / 1024 / 10240 in tab 1: where the unit goes and where "…" starts | range: arrives | §3.1 |
| `T08_tab2_icon` | tab 2 icon: white, red, amber, white on the fill | cc: arrives | §3.3, §5.3 |
| `T09_tab3_variants` | tab 3: tuner + long name, player + title, CarPlay, icon only, mute mark | media: after probe, media_src: after probe, mute: after probe | §3.3 |
| `T10_tab4_variants` | tab 4: plain, with bars, crossed out, lit during a call | phone: after probe, phone_icon: certain, call: after probe | §3.3 |
| `T11_tab5_variants` | tab 5: arrow, turn arrow | guiding: arrives, dart: after probe | §3.3 |
| `1A_clock` | date and time (the large Saira clock of the approved mockup) | clock: arrives | §4.1.1 |
| `1B_trip` | trip: 02 table grammar, the stacked consumption unit, the meta line, the footer | trip: unseen | §4.1.2 |
| `1C_trip_dashes` | trip with a silent field: only the average speed is dashed | trip: unseen | §4.1.2 |
| `1D_tech` | technical data: normal values (oil 104, coolant 92, boost 0.42, outside +7.5) | oil: arrives, coolant: arrives, boost: arrives, outside: arrives | §4.1.3 |
| `1E_tech_oil_hot` | oil at 134 °C: the bar turns red from 130 | oil: arrives, coolant: arrives, boost: arrives, outside: arrives | §4.1.3 |
| `1F_tech_boost` | boost under load: 1.10 бар | oil: arrives, coolant: arrives, boost: arrives, outside: arrives | §4.1.3 |
| `1G_tech_no_value` | a row with no value: a dash and an empty bar (boost silent) | oil: arrives, coolant: arrives, boost: arrives, outside: arrives | §4.1.3 |
| `1H_tyres` | tyres: our outline, four pressures and temperatures (after probe) | tyres: after probe | §4.1.3 |
| `1I_tyres_low` | tyres: one corner amber (0.3 bar under its target) | tyres: after probe | §4.1.3 |
| `1J_cycle` | the cycle with and without "Технічні дані" | setting: certain, trip: unseen, oil: arrives, tyres: after probe | §4.1, §10 |
| `1K_dots` | page dots or none | setting: certain | §4.1 |
| `1Ka_trip_nodots` | 1K, no page dots: the trip page | trip: unseen | §4.1 |
| `1Kb_trip_dots` | 1K, four page dots (2 of 4): the trip page | trip: unseen | §4.1 |
| `2A_card_1_white` | card, one line, white (grey cell) + two rows | cc: arrives, cc_now: unseen | §5.1 |
| `2B_card_2_amber` | card, two lines, amber + one row | cc: arrives, cc_now: unseen | §5.1 |
| `2C_card_3_red` | card, three lines, red (no rows; the scroll line says more exist) | cc: arrives, cc_now: unseen | §5.1 |
| `2D_card_cut_red` | a name too long: cut with "…" on line 3 | cc: arrives, cc_now: unseen | §5.1 |
| `2E_card_green` | card, green | cc: arrives, cc_now: unseen | §5.1, §5.3 |
| `2F_card_counter` | card + counter "2/3" (needs the frame count, P1) | cc: arrives, cc_now: unseen, cc_counter: unseen | §5.1 |
| `2G_card_1_rows` | card (one line) + two rows | cc: arrives, cc_now: unseen | §5.1 |
| `2H_card_2_row` | card (two lines) + one row | cc: arrives, cc_now: unseen | §5.1 |
| `2I_list` | list only: six rows of mixed severity + the scroll line | cc: arrives | §5.1 |
| `2J_pointer` | the pointer page: a message shows (amber) but ours cannot be drawn; BMW panel open, our fixed words | cc: arrives, cc_now: unseen | §5.1, §5.4 step 6 |
| `2K_empty` | the empty page | cc: arrives | §5.1 |
| `2S1_rest` | state none: rest on tab 1 | clock: arrives | §5.4 |
| `2S2_arrives` | state window: the message arrives, BMW panel through the window, the bottom row gone, tab 2, our card painted | cc: arrives, cc_now: unseen | §5.4 step 1 |
| `2S3_settled` | state ours: >= 150 ms later, window closed, the bottom row back in one line, the rule amber | cc: arrives, cc_now: unseen | §5.4 step 2 |
| `2S4_left_tab2` | state window: the driver selects tab 1 while the message shows; window open, the clock page, the warning icon amber | cc: arrives, cc_now: unseen, clock: arrives | §5.4 step 4 |
| `2S5_back_on_tab2` | state window: back on tab 2: our card is painted again, the window closes only after 150 ms (then as 2S3) | cc: arrives, cc_now: unseen | §5.4 step 4 |
| `2S6_ended` | state none: the message ends, tab 1 again | clock: arrives | §5.4 step 5 |
| `2S_sequence` | the six frames of the message sequence | cc: arrives, cc_now: unseen | §5.4 |
| `2T_pointer_d7` | D7 not yet confirmed (the first messages after an install): the pointer page, severity not known (grey cell, generic warning symbol), BMW panel open | cc: arrives, cc_now: unseen | §5.4 step 6 |
| `3A_certain_only` | M3 certain only: the source pictogram, nothing else | media_icon: certain | §4.3 |
| `3B_radio_fm` | radio, FM: station, radio text, footer (after probe) | media: after probe | §4.3 |
| `3C_radio_dab` | radio, DAB | media: after probe | §4.3 |
| `3D_usb` | now playing over USB: title, artist, progress, 4 / 12 (after probe) | media: after probe, progress: after probe | §4.3 |
| `3E_carplay` | now playing over CarPlay (the owner uses CarPlay) | media: after probe, media_src: after probe, progress: after probe | §4.3 |
| `3F_muted` | muted: the mute mark in the tab and on the page (after probe) | media: after probe, mute: after probe | §4.3 |
| `3G_long` | a very long title and artist: the "…" rule | media: after probe, progress: after probe | §4.3 |
| `4A_idle_carplay` | idle, connected over CarPlay with battery and signal, no missed-call count | phone: after probe | §4.4 |
| `4B_idle_bt` | idle, Bluetooth | phone: after probe | §4.4 |
| `4C_no_phone` | no phone: the crossed-out icon in the tab, "Телефон не підключено" | phone: after probe | §3.3, §4.4 |
| `4D_no_data` | no data: "Немає даних" (until the probe) | phone_icon: certain | §4.4 |
| `4E_incoming_contact` | incoming call, "Контакт" (the caller is in the contacts) | call: after probe, contact_kind: after probe | §4.4 |
| `4F_incoming_number` | incoming call, "Номер" (an unknown caller) | call: after probe, contact_kind: after probe | §4.4 |
| `4G_incoming_name` | incoming call with the name setting on (an invented name) | call: after probe, caller_name: after probe | §4.4 |
| `4H_active` | active call with the timer | call: after probe, timer: certain | §4.4 |
| `4I_active_muted` | active call, microphone muted | call: after probe, timer: certain, mic: after probe | §4.4 |
| `4J_call_during_message` | a call while a message shows: tab 2 wins, the call only as tab 4 lit | call: after probe, cc: arrives, cc_now: unseen | §3.4 rule 1-2 |
| `5A_map_w1` | the map window W1: the drawn stand-in, fading at the box edges; the road bar at the foot | map: after probe, road: arrives | §4.5 |
| `5B_map_noroad` | the same without a road | map: after probe | §4.5 |
| `5C_guided_right` | guidance page: a right turn in 350 м, next road, lanes, arrival | guiding: arrives, dart: after probe | §4.5 |
| `5D_roundabout` | a roundabout, exit 3 | guiding: arrives, dart: after probe | §4.5, §7 |
| `5E_fork` | a fork, keep right | guiding: arrives, dart: after probe | §4.5, §7 |
| `5F_destination_left` | the destination on the left | guiding: arrives, dart: after probe | §4.5, §7 |
| `5G_distances` | distances 30 м / 350 м / 1.2 км / 14 км | guiding: arrives, dart: after probe | §4.5 |
| `5K_map_box_annotated` | BMW's map box over 5A: the 10 % edge, the 90 % area, our window W1's zero box | map: after probe | §4.5 |
| `5H_calculating` | calculating the route | guiding: arrives | §4.5 |
| `5I_no_route_road` | no route, the road is known | guiding: arrives, road: arrives | §4.5 |
| `5J_nothing` | nothing: no route, no road | guiding: arrives | §4.5 |
| `P01_new_pictograms` | the pictograms KB adds | setting: certain | §7 |

(`2G` and `2H` repeat `2A` and `2B` with their rows named in the spec's list: one line + two rows, two lines + one row. `2J` is the pointer page with a *known* severity
and the window open; `2T` the same with an *unknown* one, the first-install case. `1K` is the pair of choices; `1Ka` / `1Kb` the same as full frames.
`5K` is the annotated copy of `5A` and sits in its own file because the spec numbers it.)

## Findings: where the spec's numbers collide, measured

Overlap = how far ink goes past where it may be; every figure is read from the recorded ink boxes of the render (`index.json` `edges` and
`close_pairs`, and the `measured` block of T07), in panel px.

1. **Tab 1's range budget holds only when the label is placed by ink.** SF's sum (18 inset + 36 icon + 7 + 56 digits + 6 + 25 unit + 14 = 162) is the
   ink of the references' type. With Noto 34 / 21 the digits' *advance* is 58 px and the unit's 28 px; placing by advance (K2) put the unit 11 px
   further and left 3 px. By ink: "412 км" ends at x 765.7, **14.3 px** from the separator at 780: the spec's number is met exactly, with no spare. "87 км": 34.7 px.
   "8 км": 54.0. **"1024 км" does not fit**: with the unit the ink would end at x 785 (5 px past the separator); the proposal (T07): drop the unit
   when it would come nearer than 14 px, "1024" ends at 753.3 (26.7 px). The spec's literal rule ("a text that does not fit ends in …") gives the same picture,
   because even "…" alone needs 9 px and 5 are left. **"…" starts only when the value itself is too long:** "10240" shows "102…" (20.3 px). A 5-digit range is not
   expected (a diesel's range is below 1100 km).
2. **The unit "бар" on the technical page (1D–1G) overhangs the window:** value right-aligned at 1150, unit 6 px after it, "бар" is 35.7 px wide: ink to x 1192.7,
   **1.7 px past the window's edge 1191** (SF allows content 10 px beyond the title rule's ends, to 1191), 11.7 px past the rule's end 1181 and 17.7 px past the
   bars' end 1175. The other units ("°C") end at 1180. Proposal: unit Noto 19 for "бар" (32 px, ends 1188), or the third row's value at x 1146. SV's V1 has the same numbers.
3. **Row names are cut often.** SC's own sample rows "Акумулятор розряджається" (450 px at Noto 33) and "Потрібне сервісне обслуговування" (564 px) exceed the 399 px
   column (x 781–1180) and end in "…" (2A, 2G, 2H, 2I). Under SC's rule a cut row never counts as our text for its message, so with real names
   more messages than the samples suggest will keep BMW's panel open when they come as rows (the card, three lines and about 17 letters a line, is the safe place).
   Noto 31 does not help (423 px). The names seen on the car so far are 14–37 characters.
4. **"Телефон не підключено" at Noto 39 is 459.7 px wide:** it ends 1.2 px inside the window on each side (730.2–1189.8) and is 9 px wider than the title rule. "Підключено · Bluetooth" is 442.7 px (1.7 over the body
   width 441, still inside the window). Proposal: Noto 36 (424 px) for line 1 of tab 4's idle page, or "Немає телефону".
5. **"Охолоджувальна рідина" (373 px) against a value from x 1073** overlaps by 45 px; "Охолодження" (211 px) is used, as K2 found.
6. **The map page's road name (5A).** SPEC-R3 §4.5 puts the name at baseline 590 on a dark bar at the window's foot; the zero box ends at 564 and
   BMW's full-brightness area at 557, so at 590 the name stands in black *below* the map and the bar (drawn [760, 556, 1160, 600], black 60 %) darkens nothing visible.
   SN's own numbers (bar [760, 540, 1160, 584], Noto 31, baseline 572) put the name on the map's foot. Choice for the owner / lead; the spec's number is drawn.
   Also: the descenders of "вулиця" reach y 597, **about 1.3 px into BMW's fallback window** (top 595.75) whenever the window is open on tab 5.
7. **Tab 3's cell:** "Радіо Приклад" (245 px) fills the media cell to 10.2 px from the separator; the 320 px cell holds about 19 letters of Noto 34 before "…" (T09). Longer names are cut, as intended.
8. **06's separators are not ours.** SF measured 06's at x 786.6 / 854.1 / 1165.2 / 1232.7 (u = −0.578, −0.353, 0.684, 0.909); the spec's 780 / 848 / 1168 / 1237 are 6.6, 6.1, 2.8 and 4.3 px away
   (06's tab 1 is 168.6 px wide, ours 162; the media cell 311 against 320). T06 draws our lines through the rectified 06 so this is visible. No change proposed: the 06 numbers belong to its own icon and text sizes.
9. **One pixel of the dials inside a lamp hole.** (1774, 207), value 142, lies in the 3 px-dilated side-lamp rectangle [1774, 176, 1873, 208] in every picture (the speedometer's bezel at the rectangle's corner). The undilated hole is clear;
   the audit of `index.json` (`keepout_nonblack_px`) counts it. It is the dial drawing's, not a page's; KA / KC should decide whether the dilated rectangle is the test.
   Belt group and gear gap: 0 non-black pixels in all 69 single frames.
10. **Sequence frame 5 (back on tab 2) looks like frame 2.** At the moment the card is painted again the window is still open (it may close only 150 ms after our card is on screen), so the two frames are the same picture; the
    difference is the history (frame 4 before it). After 150 ms it is frame 3. Drawn as the spec lists it, labelled `window`.
11. **The new pictograms are first drawings.** The roundabout by exit number (a fixed angle per exit 1…6: 90°, 45°, 0°, −45°, −90°, −135° counter-clockwise, my proposal, SN fixes none) has a visible join between the stem and the ring at 36 px; the
    build round's pictogram step refines them (`P01_new_pictograms.png` shows all ten at 240 and 36 px).

## What the owner decides from KB's pictures

- **1K page dots or none** (`1K_dots`, `1Ka` / `1Kb`): four small dots under the title rule (r 3.2, pitch 15, 7 px under the rule; active white, others grey 88; three dots until the tyres page exists) or nothing. The dots are four small
  discs on the centre sheet (no new layer); without them nothing tells the driver that the cycle will change the page by itself.
- **1J: the setting.** The strip shows what "Технічні дані = сховати" removes (technical data **and** tyres: one choice for both pages).
- **Tab 2 card with rows** (2A, 2G, 2H): rows under a one- or two-line card are the car's other listed entries, shown with their severity colour; finding 3 says a name of 24+ characters is cut.
- **Tab 4 idle line (finding 4)** and **the road-name place on the map page (finding 6)** are small design choices that the pictures expose.

## Not done / limits

- Day only; night is KC's. No picture draws the speed-limit sign, the limit marker, the red strip or cruise: they are KA's and meet the pages in KC's `Z01`–`Z04`.
- The map is a drawn stand-in (labelled "заглушка мапи: не реальне місце"), the texts are invented, the names neutral ("Абонент Приклад").
- Reference pixels appear only in `T06_bar_measured.png` (rectified 06 under our bar, labelled "not ours"); the file is git-ignored.
- Which dial render the folder holds: see the READY note in `bake/work/twin-dial/r3b/pub/KB/`.
