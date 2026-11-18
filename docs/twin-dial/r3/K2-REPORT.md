# K2 — mockups: the live tabs and their pages (Twin Dial round 3), v2

Branch `twin-r3/k2`. Tools: `tools/twin-dial/mockup/pages.py` (the pictures) and `tools/twin-dial/mockup/pictos_r3.py`
(K2's 25 new pictograms as data in VT's step format: the build round moves them into `design/twin-dial/vt/pictograms.js`).
`mockup.py` is untouched; the dials come from K1's `mockup.py` (branch `twin-r3/k1`, commit 4d0eae2):

    K2_DIALS=<t3-k1>/tools/twin-dial/mockup/mockup.py K2_LOOK=r3_fixed \
    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/pages.py

Output (git-ignored) in `bake/work/twin-dial/mockup/r3/`:
- 74 pictures (1920 × 720) in `tabs/ tab1/ tab2/ tab3/ tab4/ tab5/ limit/`, each with its name and data status top right.
- Contact sheets: `tabs_sheet.png` (bar close-ups), `tab1_sheet.png` … `tab5_sheet.png`, `limit_sheet.png`.
- The overview `pages_sheet.png` (K1 look `r3_fixed`), and `pages_sheet_lookC.png`: the same 14 pictures with K1's
  `look_C_both`, drawn into `lookC/`.
- Annotated keep-out copies `*_keepouts.png` (2M_left, 5H_hub, Lc, Lab). They draw the G20 KOMBI black box
  **[1420, 320, 1611, 440]**, the lead's correction of the brief's X3 box.
- `index.json`: every picture with its data status and source.
- The first pass's sheets are kept in `r3/v1/` for comparison.

## What changed since v1 (and from whom)

| Area | v1 | v2 | Source |
|---|---|---|---|
| Dials | today's `mockup.py` (0.1.0) | K1's `r3_fixed` (red to the band cut, rings end together, thin rim); overview also in `look_C_both` | K1, SD |
| Selected tab | my 06 sample, my colours | SF's fill law: tab colour (linear) × the neutral ramp ÷ 0.16, white content; colours 1/2 (176, 10, 37), 3 (240, 150, 10) H, 4 (60, 155, 34) H, 5 (30, 150, 200); rule in the selected cell = colour + 0.15 × the white rule | SF tabs.json |
| Bar | 1.5 px rule, 38 px icon box, Noto 31/33, separators 744 / 812 | 3 px rule y 170-173 code 230; icons 36 px tall (46 box); Noto 34; tab 1's icon 18 px in; separators **780 / 848** / 1168 / 1237 so tab 1 holds icon + "412 км" (T7 shows today's 744 / 812: "км" runs into tab 2); separator = dark column + lighter line 3 px right | SF tabs.json ours_today_wrong |
| Dimmed icons | tab 2 / phone / navigation dimmed | **no dimming anywhere** (lead + SF): tab 2 without a message is white and unfilled (T8) or absent (T9); no phone = crossed out (T16) | SF, lead |
| Severity | could fill the tab | never the fill: the card's symbol cell, the warning triangle in the severity colour while tab 2 is not selected (SC W2: T10, T11, 2M), the bottom rule y 611-615 while our card covers BMW's panel; SC's S2 (fill in severity) kept as one variant (T12) | SC card.json |
| Page grammar | today's | title rule 2.5 px y 295-297.5 code 205; meta line (right, y 326) for duration / band / source; table page as 02 (rows 384 / 455, columns right 896 / 1109, icon column at 729, stacked consumption unit, footer at 565); SF list grammar (pitch 44, Noto 33-34, icon 32 at 741, text 781, selection bar in the tab colour, scroll indicator x 1188-1191); 06's value page as an option (1B) | SF pages.json |
| Bottom row | two lines on tab 1, one line elsewhere at 680 | one line on line 1's baseline (655) | SF |
| Tab 2 | my card | SC's card: centred cell [922, 306, 998, 382] + symbol 54, headline Noto 42 centred ≤ 3 lines (424 / 471 / 518, cut with "…"), counter top right (one picture, needs P1), 2 / 1 / 0 rows of the other listed entries under it, the list page (6 rows), the empty page, the pointer page (D7), opening (150 ms with BMW's panel), covered, left-tab-2 | SC card.json, model.json |
| Tabs 3 / 4 | SM, SP | unchanged content; SF list grammar for the lists; SV's alternatives with SV's geometry: V1 technical (title "Технічні дані"), V1b tyres, V2 car picture, V3 assistance, V4 consumption | SM, SP, SV |
| Tab 5 | W1 / W2 first cut | SN: BMW's map box [700, 138, 1217, 594] with its soft edge, W1 (zero box [750, 180, 1170, 564], fades 120 / 80 / 80), W2 [700, 173, 1220, 600]; no title; road bar [760, 540, 1160, 584]; the fallback pages guided / road only / calculating / idle; the turn arrow in tab 5; the hub variant (07) | SN model.json |
| Speed limit | my places | SV: (a) (1300, 672) r 33; (b) a 2° marker across the strip, red strip from the limit to the needle when over; (c) (1540, 526) r 34; (d) (858, 432) r 80 on the assistance page; states unknown / end / conditional; three digits | SV model.json |

## The pictures and their data status

Status words (from the models): *arrives* (seen on this car), *arrives-other-app*, *arrives-brief* (listed by the brief,
no log line), *derived* (we compute it), *certain* (needs no signal), *unseen* (in the catalogue, never logged; the
probe decides), *doubtful* (sent only when the head unit asks), *owner* (private text, only if the owner turns it on),
*hypothesis* (the map's visibility through our window).

| Picture | What it shows | Data |
|---|---|---|
| tabs/T1_sel1.png | tab 1 selected (red): date and time; two-line bottom row | range: arrives, clock: arrives |
| tabs/T2_sel2.png | tab 2 selected (red): the amber card; severity in the cell, not the fill | cc: arrives, cc_now: unseen |
| tabs/T3_sel3.png | tab 3 selected (amber, H): radio | media: unseen |
| tabs/T4_sel4.png | tab 4 selected (green, H): phone idle | phone: unseen |
| tabs/T5_sel5.png | tab 5 selected (blue): map W1 | map: hypothesis, road: arrives |
| tabs/T6_all_red.png | variant: every tab red when selected (tab 3) | media: unseen |
| tabs/T7_today_seps.png | today's separators 744 / 812 (SF: tab 1 too narrow) | range: arrives, clock: arrives |
| tabs/T8_no_msg_white.png | no message: tab 2 white, unfilled (SF a; SC W1; no dimming) | cc: arrives |
| tabs/T9_no_msg_absent.png | no message: tab 2 absent (maker's rule; needs movable separators) | cc: arrives |
| tabs/T10_msg_amber_icon.png | message, tab 1 selected: triangle amber (SC W2), BMW panel open | cc: arrives, cc_now: unseen |
| tabs/T11_msg_red_icon.png | message, tab 3 selected: triangle red (SC W2), BMW panel open | cc: arrives, media: unseen |
| tabs/T12_s2_amber.png | SC variant S2: tab 2 fill in the severity colour (amber, black icon) | cc: arrives, cc_now: unseen |
| tabs/T13_four_no_phone.png | four tabs: phone removed, media wider | media: unseen |
| tabs/T14_four_no_media.png | four tabs: media removed, phone in the wide cell | phone: unseen |
| tabs/T15_other_icons.png | tab 3 = technical (engine, oil text), tab 4 = tyres | oil: arrives, tyres: arrives-other-app |
| tabs/T16_phone_none.png | no phone connected: tab 4 crossed out (SF, SP) | phone: unseen |
| tabs/T17_nav_arrow.png | guided, turn within 300 m: the turn arrow in tab 5 (SN variant) | guiding: arrives, dart: unseen |
| tabs/T18_muted.png | tab 3 with the mute mark | media: unseen, mute: unseen |
| tabs/T19_in_call.png | tab 4 lit green during a call, tab 1 selected | call: unseen |
| tab1/1A_clock.png | date and time, today's big clock (owner's mockup 1) | clock: arrives |
| tab1/1B_clock_06.png | date and time in 06's grammar (time cap 44, symbol before it) | clock: arrives |
| tab1/1C_trip_short.png | trip: this journey (02 table grammar, meta line, stacked unit) | trip: unseen |
| tab1/1D_trip_long.png | trip: long term | trip: unseen |
| tab2/2A_white_1.png | card white, 1 line + 2 rows | cc: arrives, cc_now: unseen |
| tab2/2B_white_2.png | card white, 2 lines + 1 row | cc: arrives, cc_now: unseen |
| tab2/2C_amber_1.png | card amber, 1 line + 2 rows | cc: arrives, cc_now: unseen |
| tab2/2D_amber_2_counter.png | card amber, 2 lines, counter 2/3 (needs P1), 1 row, scroll | cc: arrives, cc_now: unseen, cc_counter: unseen |
| tab2/2E_red_3.png | card red, 3 lines, no rows (scroll says more) | cc: arrives, cc_now: unseen |
| tab2/2F_red_cut.png | card red, cut with '…' on line 3 | cc: arrives, cc_now: unseen |
| tab2/2G_card_left.png | card, left variant (rejected by SC, for comparison) | cc: arrives, cc_now: unseen |
| tab2/2H_list.png | list: nothing shows now, six stored rows + scroll | cc: arrives |
| tab2/2I_empty.png | empty: nothing listed | cc: arrives |
| tab2/2J_opening.png | opening: card painted, BMW panel still open (first 150 ms) | cc: arrives, cc_now: unseen |
| tab2/2K_covered.png | after 150 ms with our card on screen: bottom row back, rule amber | cc: arrives, cc_now: unseen |
| tab2/2L_pointer.png | pointer (D7: 'shown now' never seen): our words + BMW panel | cc: arrives, cc_now: unseen |
| tab2/2M_left.png | driver left tab 2 during the message: clock, BMW panel, amber triangle | cc: arrives, clock: arrives |
| tab3/3A_radio.png | SM M2 radio: band (meta), station, radio text, facts | media: unseen |
| tab3/3B_track.png | SM M1 now playing: title, artist, progress, n of m | media: unseen, progress: unseen |
| tab3/3C_track_cover.png | SM M1 with a cover place (cover art: later) | media: unseen, progress: unseen |
| tab3/3D_certain.png | SM M3 only what is certain: pictogram, no tab text | media_icon: certain |
| tab3/3E_source.png | SM M3 + source type (enum, our word) | media_src: unseen |
| tab3/3F_stations.png | SM station list (doubtful), SF list grammar + selection bar | media_list: doubtful |
| tab3/3G_tracks.png | SM M4 track window (doubtful) | media_list: doubtful |
| tab4/4A_idle.png | SP P0 idle: connected, battery, signal, counts | phone: unseen |
| tab4/4B_certain.png | SP P3 only what is certain | phone_icon: certain |
| tab4/4C_incoming_a.png | SP P1 incoming, (a) Контакт; auto-selected | call: unseen, contact_kind: unseen |
| tab4/4D_incoming_b.png | SP P1 incoming, (b) the caller's name (owner setting) | call: unseen, caller_name: owner |
| tab4/4E_incoming_c.png | SP P1 incoming, (c) no caller line | call: unseen |
| tab4/4F_active.png | SP P2 active: our timer, Контакт, mic muted | call: unseen, timer: certain, mic: unseen |
| tab4/4G_ended.png | SP P4 call ended, 3 s then back | call: unseen |
| tab4/V1_tech.png | SV V1 technical: oil, coolant, boost, outside | oil: arrives, coolant: arrives, boost: arrives-other-app, outside: arrives |
| tab4/V1b_tyres.png | SV V1b tyres: pressure and temperature per wheel | tyres: arrives-other-app |
| tab4/V2_car.png | SV V2 car picture, driver door open (may belong to tab 2) | doors: unseen |
| tab4/V3_assist.png | SV V3 assistance: sign, plate, no passing, set speed, gap, next limit | limit: arrives-brief, assist: unseen |
| tab4/V4_consumption.png | SV V4 consumption: now, our history, average, range | cons_now: unseen, cons_hist: derived, range: arrives |
| tab5/5A_map_W1.png | SN W1: soft-edged window, no title, road bar | map: hypothesis, road: arrives |
| tab5/5B_map_W2.png | SN W2: wider than BMW's box (its own edge shows) | map: hypothesis, road: arrives |
| tab5/5C_map_W1_noroad.png | SN W1 without the road bar | map: hypothesis |
| tab5/5D_guided.png | SN fallback, guided: arrow, distance, next road, lanes, arrival | guiding: arrives, dart: unseen |
| tab5/5E_road_only.png | SN fallback: road only, no route | guiding: arrives, road: arrives |
| tab5/5F_calculating.png | SN fallback: calculating | guiding: arrives |
| tab5/5G_idle.png | SN fallback: idle | guiding: arrives |
| tab5/5H_hub.png | SN hub variant (07): arrow + lanes in the speedometer hub - NOT recommended | dart: unseen |
| limit/La.png | (a) bottom row, right end: (1300, 672) r 33 | limit: arrives-brief |
| limit/Lb.png | (b) marker on the strip at 90, needle 87 | limit: arrives-brief |
| limit/Lb_over.png | (b) over the limit: strip red from 90 to the needle (104) | limit: arrives-brief |
| limit/Lc.png | (c) in the hub under the unit: (1540, 526) r 34 | limit: arrives-brief |
| limit/Ld.png | (d) large on the assistance page | limit: arrives-brief, assist: unseen |
| limit/Lab.png | (a) + (b): SV recommendation | limit: arrives-brief |
| limit/Lab_tab1.png | (a) + (b) with tab 1 (two-line bottom row) | limit: arrives-brief |
| limit/La_unknown.png | (a) unknown: three dashes, no marker | limit: arrives-brief |
| limit/La_end.png | (a) end of restrictions | limit: arrives-brief |
| limit/Lab_cond.png | (a) + (b) conditional: dot under the sign, hollow marker | limit: arrives-brief |
| limit/La_130.png | (a) three digits (130) at 112 km/h | limit: arrives-brief |

## Findings while drawing (for the lead)

1. **SN's hub variant runs into the G20 black box.** The arrow box [1498, 248, 1582, 332] overlaps the corrected
   box [1420, 320, 1611, 440] by 12 px (5H_hub_keepouts). The box also covers the speed digits whenever the KOMBI
   draws it. Speed-limit place (c) at (1540, 526) r 34 is clear: its top (492) is 52 px under the box. Place (a) is
   47 px from the gear gap and 41 px from BMW's panel (SV's numbers; checked against the annotated copy).
2. **Today's separators cannot hold SF's tab 1.** At the maker's sizes the unit of "412 км" runs into tab 2 (T7). SF's
   780 / 848 fixes it but makes the media cell 320 px. "Радіо Приклад" (248 px at Noto 34) fits with 10 px margins;
   longer names are cut with "…".
3. **SV's label "Охолоджувальна рідина" (377 px at Noto 31) collides with its value at x 1150.** V1 says
   "Охолодження"; SV should choose the word or the geometry.
4. **SC's W0 (dim triangle with no message) is overridden by the lead's no-dimming rule.** The pictures show white
   unfilled (T8) and absent (T9).
5. **The tab colours of 3, 4 and 5 are SF's hypotheses.** On the bar they read clearly as "selected" without saying
   anything about severity (T1–T5). T6 shows the alternative: every tab red.

## Choices for the owner (each has its pictures)

- Tab colours: own colour per tab (T1–T5) or always red (T6).
- Tab 2 with no message: white unfilled (T8) or absent (T9; needs movable separators).
- Severity when tab 2 is selected: SC's red selection fill (T2), or variant S2 (T12).
- Clock page: today's big clock (1A) or 06's grammar (1B).
- Tabs 3 and 4: media (3A–3G) and phone (4A–4G), against the alternatives V1–V4. SM and SP: nothing in media or phone
  is certain today.
- Map window: W1 (5A) or W2 (5B).
- Speed limit: (a) + (b) as SV recommends (Lab), or (c) or (d).
- Dial look: `r3_fixed` (pages_sheet) or `look_C_both` (pages_sheet_lookC).
