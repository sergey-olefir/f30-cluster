# K2 — mockups: the live tabs and their pages (Twin Dial round 3)

Branch `twin-r3/k2`. Tool: `tools/twin-dial/mockup/pages.py` (imports the dial drawing from `mockup.py` unchanged;
`K2_DIALS=<path to a mockup.py>` and `K2_LOOK=<look>` render with K1's dials once they land). Output (git-ignored):
`bake/work/twin-dial/mockup/r3/`: 69 pictures of 1920 × 720 in `tabs/ tab1/ tab2/ tab3/ tab4/ tab5/ limit/`, a
contact sheet for each (`tabs_sheet.png` shows close-ups of the bar, the rest show the centre), the overview
`pages_sheet.png`, `limit/La_120_keepouts.png` (the keep-outs drawn over a limit picture), and `index.json`
(every picture with its data status and source).

## What it was built from

| Input | Used for | State when rendered |
|---|---|---|
| Brief §0, SPEC §6 (today's layout), VG `layout.json`, VF `message_panel.json` | frame, bar, centre grammar, bottom row, fallback polygon | used |
| SF `SEMANTICS-v1.md` | filled = selected; a colour for each tab (1/2 red, 3 amber, 4 green, 5 blue: **hypothesis** except red); the bottom row has two lines only on tab 1; tab 2 may be absent with no message; phone icon with bars / crossed out; mute mark | used |
| SF `tabs.json`, `pages.json` (v2) | measured fill colours, page grammar in px | **not published yet**: the red ramp was measured here on 06 (top sRGB (45, 25, 27) → bottom (150, 38, 43), rule ~ (177, 67, 71), 06's black about 15–20); the other colours are placeholders |
| SM `model.json` | tab 3: M1 now playing, M2 radio, M3 only what is certain, M4 / station list (doubtful), mute mark, one cover-art placeholder | used |
| SP `model.json` | tab 4: P0 idle, P1 incoming (a / b / c), P2 active (our timer), P3 certain, P4 ended, tab lit while a call is on | used |
| SN `model.json` (map, guidance) | tab 5: the W1 vignette and W2 own-edge windows, no title, road bar, navy stand-in, "Маршрут не прокладено" | used for the map; SN's guidance numbers not yet applied to 5C (the arrow page keeps my layout) |
| SV, SC models | other content, speed-limit rectangles, the card and state table | **not published while I worked**: the speed-limit places and the message card are my own proposals (below) |

## The pictures and their data status

Status words: *arrives* (seen on this car), *unseen* (in the catalogue, never logged), *certain* (needs no signal),
*doubtful* (sent only when the head unit asks), *owner* (private text, only if the owner turns it on),
*hypothesis* (the map's visibility).

| Picture | What it shows | Data |
|---|---|---|
| tabs/T1_sel1_clock.png | tab 1 selected: date and time | range: arrives, clock: arrives |
| tabs/T2_sel2_card.png | tab 2 selected: message card (yellow) | cc: arrives |
| tabs/T3_sel3_radio.png | tab 3 selected: radio | media: unseen |
| tabs/T4_sel4_phone.png | tab 4 selected: phone idle | phone: unseen |
| tabs/T5_sel5_map.png | tab 5 selected: BMW's map in the window | map: hypothesis, road: arrives |
| tabs/T6_red_all.png | every tab red (06's ramp), tab 3 selected | media: unseen |
| tabs/T7_flat.png | today's flat red highlight used for selection | range: arrives, clock: arrives |
| tabs/T8_warn_none_dim.png | no message: warning tab dim | range: arrives, clock: arrives |
| tabs/T9_warn_none_hidden.png | no message: warning cell empty | range: arrives, clock: arrives |
| tabs/T10_warn_none_gone.png | no message: no warning tab (maker's rule) | range: arrives, clock: arrives |
| tabs/T11_msg_icon.png | message, tab 1 selected: triangle in severity colour | cc: arrives, range: arrives, clock: arrives |
| tabs/T12_msg_cell.png | message, tab 1 selected: cell in severity colour (today) | cc: arrives, range: arrives, clock: arrives |
| tabs/T13_sel2_sev.png | tab 2 selected, fill in the severity colour | cc: arrives |
| tabs/T14_four_no_phone.png | four tabs: phone removed, media wider | media: unseen |
| tabs/T15_four_no_media.png | four tabs: media removed, phone in the wide cell | phone: unseen |
| tabs/T16_other_icons.png | tab 3 = car (oil text), tab 4 = gauge; tab 3 selected | oil: arrives, coolant: arrives |
| tabs/T17_phone_none.png | tab 4: no phone connected (crossed out) | phone: unseen |
| tab1/1A_clock.png | date and time (page 1 of 3) | clock: arrives |
| tab1/1B_trip_now.png | trip computer: this trip (page 2) | trip: unseen |
| tab1/1C_trip_long.png | trip computer: long term (page 3) | trip: unseen |
| tab1/1D_clock_nodots.png | date and time, no page dots | clock: arrives |
| tab2/2_info_1.png | card info, 1 line | cc: arrives |
| tab2/2_info_2.png | card info, 2 lines | cc: arrives |
| tab2/2_yellow_1.png | card yellow, 1 line | cc: arrives |
| tab2/2_yellow_2.png | card yellow, 2 lines | cc: arrives |
| tab2/2_red_1.png | card red, 1 line | cc: arrives |
| tab2/2_red_2.png | card red, 2 lines | cc: arrives |
| tab2/2_cell_red.png | card, cell layout (today's plate moved up), red | cc: arrives |
| tab2/2_cell_yellow.png | card, cell layout, yellow | cc: arrives |
| tab2/2_list.png | list: shown now + active + stored | cc: arrives |
| tab2/2_empty.png | empty state | cc: arrives |
| tab2/2_window_open.png | message arrives: card painted, window open (BMW's panel visible) | cc: arrives |
| tab2/2_window_closed.png | after CC_SETTLE_MS with our card on screen: bottom row back | cc: arrives |
| tab2/2_left_tab2.png | driver on tab 1 while the message shows: window open again | cc: arrives, clock: arrives |
| tab3/3A_radio.png | SM M2 radio: band, station, radio text, facts | media: unseen |
| tab3/3B_track.png | SM M1 now playing: title, artist, progress, n of m | media: unseen, progress: unseen |
| tab3/3B2_track_cover.png | SM M1 with a cover place (cover art: later, not this round) | media: unseen, progress: unseen |
| tab3/3C_media_certain.png | SM M3 only what is certain: pictogram, no text in the tab | media_icon: certain |
| tab3/3C2_media_source.png | SM M3 + source type (enum, our word) | media_src: unseen |
| tab3/3D_station_list.png | SM M2 list: stations (doubtful) | media_list: doubtful |
| tab3/3E_track_list.png | SM M4 track window (doubtful) | media_list: doubtful |
| tab3/3F_tab_muted.png | tab 3 with the mute mark, tab 1 selected | media: unseen, mute: unseen |
| tab4/4A_phone_idle.png | SP P0 idle: connected, battery, signal, counts | phone: unseen |
| tab4/4A2_phone_certain.png | SP P3 only what is certain | phone_icon: certain |
| tab4/4B_phone_in.png | SP P1 incoming, (a) Контакт (auto: tab 4 selected) | call: unseen, contact_kind: unseen |
| tab4/4B2_phone_in_name.png | SP P1 incoming, (b) the caller's name: owner setting | call: unseen, caller_name: owner |
| tab4/4B3_phone_in_none.png | SP P1 incoming, (c) no caller line | call: unseen |
| tab4/4C_phone_call.png | SP P2 active: our timer, Контакт, mic muted | call: unseen, timer: certain, mic: unseen |
| tab4/4D_phone_ended.png | SP P4 call ended, 3 s then back | call: unseen |
| tab4/4E_tab_in_call.png | tab 4 lit (green icon) during a call, tab 1 selected | call: unseen, clock: arrives |
| tab4/X1_tech.png | alternative: technical page | oil: arrives, coolant: arrives, voltage: unseen, boost: unseen |
| tab4/X2_car_door.png | alternative: car picture, driver door open | doors: unseen |
| tab4/X3_tyres.png | alternative: tyre pressures on the car picture | tyres: unseen |
| tab4/X4_assist.png | alternative: driver assistance, limit large | limit: arrives, cruise: unseen |
| tab4/X5_consumption.png | alternative: consumption with our own history | consumption: unseen, range: arrives |
| tab5/5A_map_title.png | BMW's map in the window, our title and rule over it | map: hypothesis, road: arrives |
| tab5/5B_map_full.png | BMW's map in the whole centre window, no title | map: hypothesis, road: arrives |
| tab5/5A2_map_W1.png | SN W1: map vignette, no title, road bar | map: hypothesis, road: arrives |
| tab5/5A3_map_W2.png | SN W2: BMW's own edge, no title, road bar | map: hypothesis, road: arrives |
| tab5/5C_guidance.png | fallback guidance page: arrow, distance, road label | guiding: arrives, turn: unseen, road: arrives |
| tab5/5D_not_guided.png | navigation tab, no route | guiding: arrives, road: arrives |
| limit/La_bottom_row.png | (a) sign at the bottom row's right end | limit: arrives |
| limit/Lb_scale.png | (b) marker on the speedometer scale | limit: arrives |
| limit/Lc_hub.png | (c) sign under the unit in the hub | limit: arrives |
| limit/Ld_page.png | (d) large on the assistance page | limit: arrives |
| limit/Lab.png | (a) + (b) | limit: arrives |
| limit/Lbc.png | (b) + (c) | limit: arrives |
| limit/Labc_over.png | (a) + (b) + (c), speed above the limit | limit: arrives |
| limit/La_120.png | (a) with a three-digit limit | limit: arrives |

## Design choices in the pictures (all are proposals for the lead)

- **Selection:** the selected cell gets a vertical ramp in the tab's colour, from the cell top to the rule, and the
  rule under it takes the colour (SF v1 §7). Variants: each tab in its own colour (T1–T5), every tab red (T6),
  today's flat red (T7).
- **Tab 2 with no message:** dim icon (T8), empty cell (T9), or no tab and a wider media cell, as the references'
  maker does it (T10). **Severity while another tab is selected:** the triangle in the severity colour (T11) or
  today's filled cell (T12). With tab 2 selected the fill is red (T2) or in the severity colour (T13). This is still
  open (SC).
- **Bottom row:** two lines on tab 1, one line (clock, temperature) on the other tabs (SF v1 §6).
- **Message card (tab 2):** two layouts: the symbol large and centred in the severity colour, with the headline
  under it (Noto 42, 2 lines, 430 px); or "cell", today's plate moved up (a filled cell and 3 lines of 311 px). The
  counter "1/2" sits at the right end of the title row. The list marks the message shown now with 10's selection bar;
  stored entries are grey under "збережені", with a scroll bar. Three frames show the safety sequence: window open
  with our card painted (2_window_open), window closed once our card has been on screen (2_window_closed), and the
  driver leaving tab 2 while the message shows, which opens the window again (2_left_tab2). These are drawings of
  the rule, not SC's state table.
- **Speed limit (my placements; SV's numbers not yet in):** (a) sign r 28 at (1290, 667): 36 px clear of BMW's panel
  bbox (x ≤ 1226), 62 px clear of the gear gap (x ≥ 1380), about 47 px clear of the speedometer ring's end at
  (1364, 643). (b) a red pointer outside the bezel plus a red tick on the strip. (c) sign r 25 at (1540, 524): 80 px
  under the KOMBI's black box (y ≤ 419), 12 px above the rim. (d) large on the assistance page. All clearances are
  computed from the layout numbers (verified as arithmetic); none has been seen on the car.
- **Pictograms:** the repository's own (`shared/twin_icons.js`, parsed and rendered in the same step format), plus
  new drawings in that format inside `pages.py` (`OWN`: car, gauge, clock, road, play, pause, handset, ringing
  phone, mic off, bars, phone with bars, phone crossed out, turn arrow, straight arrow, flag, limit ring, check,
  compass, mute). They would need to move into `design/twin-dial/vt/pictograms.js` before a build.
- **Text:** every string is invented (Радіо Приклад, Гурт Приклад, Контакт, Ім'я Прізвище, вулиця Тестова, Телефон
  1 …). No number has the shape of a phone number, and the map is a procedural grid captioned "заглушка мапи: не
  реальне місце".

## Not done / for the lead

- **Not yet re-rendered:** SF v2 (`tabs.json`, `pages.json`), SV and SC. Re-run `pages.py` once they publish.
  It reads every READY package's JSON but takes nothing from it automatically, so the colours, rectangles and texts
  in `FILL`, `LIMIT_A`, `LIMIT_C` and the page functions have to be edited by hand.
- **The dials are today's `mockup.py`;** K1's changes are not merged. Use `K2_DIALS` to render with them.
- **Choices for the owner:** the colour of each tab (own colour or all red); the warning tab with no message (dim,
  empty or absent); how severity shows; card layout (centred or cell); what tabs 3 and 4 are (SM and SP both say
  nothing is certain today: compare the "only what is certain" pages with X1–X5); map W1 or W2; speed-limit place
  (a) / (b) / (c) / (d) or a combination.
