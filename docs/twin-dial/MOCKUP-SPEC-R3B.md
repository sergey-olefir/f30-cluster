# Twin Dial round 3b — the mockup specification (what still has to be drawn before the build)

Audience: three mockup agents, packages **KA, KB, KC**, in parallel, each in its own git worktree. The lead draws nothing. This file says exactly which pictures to make, from which numbers, in which variants, and what each picture must let the owner decide. The design authority is `docs/twin-dial/SPEC-R3.md`; read it end to end first. Where it marks a choice as "the lead's reading" or "variants in the mockup round", this file lists the variants.

## 0. Why another mockup round

The owner approved the round-3 pictures (the dial look `80_look_06`, tabs 1–4 as drawn) and then added things no picture shows yet:

1. the speed limit as **(a) sign + (b) marker + the tick strip red from the limit** — the red strip has never been drawn, and its exact behaviour is the lead's reading of four words;
2. **cruise control and the speed limiter in the speedometer's lower opening** (reference 12) — never drawn;
3. **technical data as a page of tab 1 that a setting can hide** — drawn so far only as a tab-4 alternative;
4. **the 06 look on every page** — K2's sheets were rendered with the look `r3_fixed`; only one overview used another look, and none used `look_06`;
5. numbers that changed after K1 and K2 rendered: SD's measured numeral shadow (K1's was by eye), the gear in the hub's centre with its exact positions, the separators at 780 / 848, the 3 px rule, 36 px icons, the bottom row in one line off tab 1, the three-line message card, the corrected black-box rectangle.

Nothing is built until the owner has chosen from these pictures.

## 1. Rules

- **Branch and worktree:** `git worktree add <main checkout>/.claude/worktrees/k3-<pkg> -b twin-r3b/<pkg> twin-r3/k2` for KB and KC, `… twin-r3/k1` for KA (K2's branch has `pages.py`; K1's has the dial drawing with looks; KB merges `twin-r3/k1` into its branch first so both are present). Symlink `reference` and `bake/work`. Commit on your branch. No push, no merge into `main`, no version bump.
- **Mockups only:** no change under `apps/`, `shared/`, `bench/`, `design/gen_twin.py`, `tools/twin-dial/bake_*.py`. Your code lives in `tools/twin-dial/mockup/` (`mockup.py` = the dials, owned by KA in this round; `pages.py` = tabs and pages, owned by KB; `checks_r3b.py` and `sheets_r3b.py` = KC). The old pictures stay reproducible (K1 proved its change byte-identical by hash; keep that test).
- **Numbers, not eyes:** every position, size and colour comes from `SPEC-R3.md` or the JSON it names (`design/twin-dial/r3/{sd,sf,sc,sv,sn,sm,sp,k1}/…` on the `twin-r3/*` branches; `git show twin-r3/<pkg>:<path>`). If a number is missing, say so in your report and propose one — never draw "about right" silently. If the spec and a JSON disagree, the spec wins (its §16 lists the overrides).
- **The references are never copied:** no reference pixel in a tracked file; reference crops appear only in git-ignored contact sheets, labelled "reference, not ours". No maker's name, logo, font or bitmap anywhere. Fonts: Saira and Noto Sans as the app's atlases use them. Pictograms: our own, in `tools/twin-dial/mockup/pictos_r3.py` (KB owns the file; KA adds the cruise and limiter symbols and the sign's parts through KB or in a clearly separate `pictos_r3b.py`).
- **Sample text is invented and neutral:** no real station, track, person, phone number, road or place; Ukrainian labels as in the spec; the map is a drawn stand-in, visibly not a real place.
- **Format:** every picture 1920 × 720 PNG, drawn at 3× and reduced; output under `bake/work/twin-dial/mockup/r3b/` (git-ignored) in the folders named below; a close-up (2× of the relevant area) beside every picture whose point is small; a file name that starts with the picture's id in this document.
- **Keep-outs on every picture** (0 non-black pixels of ours inside): BMW's belt group [497, 660, 688, 720], the gear-letter gap [1380, 660, 1460, 720], the seven side-lamp holes (`design/twin-dial/vg/layout.json`). Annotated copies also draw the fallback window [696, 595.75, 1226, 704], the hood line, BMW's stored-message marker [1240, 588, 1288, 630] and **the G20's black-box area [1420, 320, 1611, 440]**.
- **Python:** `UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I <script>`; no home-directory path in a tracked file.
- **Outputs:** the pictures; contact sheets; `index.json` (per picture: id, what it shows, the variant, the data status of everything on it — arrives / unseen / after probe — and the spec section); `docs/twin-dial/r3b/<PKG>-REPORT.md`; a `READY` note in `bake/work/twin-dial/r3b/pub/<PKG>/`. Finish with a short final message: branch, last commit, the choices your sheets put to the owner.

## 2. The base look for every picture

Unless a picture says otherwise: **look `look_06` with SPEC-R3 §2's corrections** —

- rings: bezel to 143.6°, band 0.5795–0.9375 R to 143.0°, inner ring r 0.544, width 0.008, to 143.55°;
- band B: `Y = 0.0188·exp(4.60(ρ−0.60))·exp(0.59(1−cos θ))`, tint 0.76 : 1 : 1.064, symmetric; major lines 0.010 R;
- strip (98, 109, 111) with the bright line ρ 0.924–0.934 (115, 124, 126);
- numerals with **SD's shadow model** (outline 0.008 R at 0.75; drop shadow offset (+0.010, +0.012) R, σ 0.008 R, 0.35);
- the red zone as an arc on the bezel from 6500 rpm to 143.6°, sRGB (210, 20, 21), red ticks from the redline, red 7 and 8; no wedge;
- white needle with the engine's shadow;
- tachometer hub: gear at (0, 0) cap 0.222 R, program at (0, +0.209) cap 0.058 R, READY at (0, −0.29), "1/хв × 1000" at (0, +0.40), OFF unchanged;
- speedometer: small numerals kept (10 30 50 70 160 200 240 280);
- tab bar: separators 780 / 848 / 1168 / 1237, 3 px rule, icons 36 px, text cap 24 px, no dimmed icon, the selected tab filled in its colour (1 red, 2 red, 3 amber, 4 green, 5 blue);
- bottom row: two lines on tab 1, one line (clock, temperature) elsewhere;
- driving state: 87 km/h, 2400 rpm, D3, COMFORT, READY, fuel 3.2 of 5, coolant 2.6 of 5, 14:43, +7.5 °C, 48 215 км, range 412 км — the values of the approved mockups, so pictures compare.

## 3. Package KA — the dials, the speed limit, cruise and the limiter

Folder `r3b/ka/`.

### KA-1 The final dial look (confirmation, not a choice)
- `A01` the full picture in the base look, tab 1, date and time.
- `A02` tachometer and `A03` speedometer close-ups (R drawn at 600 px) beside the rectified 06 crops at the same R.
- `A04` **the numeral shadow**: three tachometer close-ups side by side — no shadow, K1's by-eye shadow ((0.008, 0.020) R, σ 0.009, 0.70), SD's measured model — and the 06 crop. The owner saw K1's; say plainly how SD's differs.
- `A05` the lower ends of both dials (the strip view SD used: θ 110–160°, ρ 0.50–1.04) for ours-new, ours-0.1.0 and 06: the three rings ending together.
- `A06` the gear states in the centre: P, R, N, D, D3, M4, S2, "–" (eight small hubs in one picture) with the program under each (COMFORT, SPORT, SPORT+, ECO PRO, ADAPTIVE, none), READY on and off — to see that the widest value ("M4", "D3" at cap 0.222 R) clears the inner ring and the program line.
- `A07` engine off: the needle on OFF, no READY, gear P.
- `A08` redline settings 5000, 6500 and 7500 rpm: the arc's start; which numerals turn red.

### KA-2 The speed limit: (a) + (b) + the strip red from the limit
The sign (a): centre (1300, 672), outer r 33, red ring 7.6 px, white disc, the number in Saira bold. The marker (b): across the strip, ρ 0.893–0.94, 2° wide, red (181, 26, 17), at the limit's angle (SPEC-R3 §8).

**The red strip — draw all three readings; the owner chooses:**
- **L1 (the spec's reading):** the strip's body red from the limit's angle to the scale's end (+125°); **dim** (0.45 of the marker's red) while the needle is below the limit, **full** when over; ticks in it white.
- **L2:** the strip red **only between the limit and the needle**, and only while over the limit (nothing but the marker when below).
- **L3:** as L1 but always full red, like a fixed red zone.

Pictures (each as a full frame and a speedometer close-up):
- `L01`–`L03` limit 50, speed 42 (below): L1, L2, L3.
- `L04`–`L06` limit 50, speed 63 (over): L1, L2, L3.
- `L07` limit 90 at 87; `L08` limit 130 at 112; `L09` limit 30 at 28; `L10` limit 110 at 135 — in L1 (and one sheet row each for L2, L3), to see the strip's length at low and high limits and where the marker meets the small numerals (30, 50, 70) and a major tick (the marker at 100 = 0° sits on a major tick: show it).
- `L11` unknown limit: the empty sign with three dashes, no marker, no red.
- `L12` end of restrictions: the derestriction sign (white disc, five diagonal stripes, our own drawing), no marker.
- `L13` nothing received: no sign at all.
- `L14` a conditional limit: the sign with a dot under it, the marker hollow.
- `L15` mph: the sign shows 30 (mph), the marker at 48 km/h.
- `L16` the sign with the bottom row in two lines (tab 1) and `L17` in one line (tab 3): spacing to the temperature and to the right dial.
- `L18` the fallback window open (a message, D7 not confirmed): the sign stays, BMW's panel beside it (draw BMW's panel as the bench does), the clearance in px written on the annotated copy.
- `L19` three-digit and two-digit numbers in the disc (30, 50, 100, 130): the shrink rule.
- `L20` annotated: every clearance of SPEC-R3 §8 (10.7 px to the stored marker, 26 to our ink, 41 to the window, 47 to the gear gap, 15 to the panel's bottom) measured on your render and compared with SV's numbers.

### KA-3 Cruise control and the limiter in the speedometer's lower opening
Reference 12 shows: the set speed in green with its unit, the function's symbol beside it, in the dial's lower opening; a marker on the bezel at the set speed. **Draw both places; the owner chooses:**
- **C1 (the spec's reading):** the hub's lower part — the free disc centred (1540, 528), r 45: the set speed Saira 40 green (60, 155, 34), right-aligned at x 1536, baseline 540; "км/год" Noto 19 at baseline 560; the symbol 36 px centred (1572, 528). The coolant bar stays where it is.
- **C2:** in the opening itself, in the coolant bar's place (y 590–650, x 1470–1650, clear of the gear-letter gap at x ≤ 1460), the coolant bar hidden while cruise or the limiter is on (coolant remains on the technical page).
- **C3:** in the opening **beside** a shortened coolant bar (the bar x 1414–1540, the readout x 1556–1666) — only if it fits with ≥ 6 px between every pair of items; if it does not, say so with the numbers and draw no picture.

Our own symbols (three, 36 px, white on black, in the icon format): **cruise** (a dial arc with a pointer and an arrow on it), **adaptive cruise** (the same with a car outline ahead), **limiter** ("LIM" in a rounded frame). Draw them large once (`C00`, 6×) for review.

The second marker: green, at the set speed, in the dark gap outside the strip (ρ 0.94–0.985), pointing inward, so it never hides the limit's red marker.

Pictures (C1 and C2 each; C3 if it fits):
- `C01` cruise active, set 110, speed 108. `C02` adaptive cruise active, set 110, speed 87 (a car ahead). `C03` standby (grey number and symbol, no marker). `C04` limiter active, set 90, speed 87. `C05` off (nothing).
- `C06` three-digit speeds everywhere: set 130, speed 128, limit 130 — digits, readout and sign together.
- `C07` **everything at once:** limit 90 (sign, red marker, red strip in the owner's eventual variant — use L1), cruise set 110 (green marker), speed 103: both markers and the red strip readable together.
- `C08` set speed equal to the limit (110 / 110): the two markers at the same angle.
- `C09` annotated: the black-box area [1420, 320, 1611, 440] over C1 and C2 — which parts of the digits, the unit and the readout it would cover if it appeared.
- `C10` night (SPEC-R3 §6's multipliers) for C01 and C07.

### KA report
For each of L1–L3 and C1–C3: what it costs to build (shader bytes by `tools/twin-dial/r3/k1/shader_cost.js` on a sketch patch; layers; whether a face re-bake or a new sheet is needed), every clearance, and what you would choose and why — as a recommendation, not a decision.

## 4. Package KB — the tabs and their pages in the final look

Folder `r3b/kb/`. Re-render K2's set with the base look of §2, then add what is new. Keep K2's picture ids where the content is the same, so the owner can compare old and new sheets (`r3/` against `r3b/kb/`).

### KB-1 The tab bar
- `T01`–`T05` each tab selected (its own colour), full frame + a bar close-up at 3×.
- `T06` the bar measured: an annotated close-up with the separators (780, 848, 1168, 1237), the 18 px inset, icon and text sizes, the 3 px rule, the selected cell's rule in the lightened tab colour — and the same close-up of rectified 06 beside it.
- `T07` range values "8 км", "87 км", "412 км", "1024 км" in tab 1 (fits? where does "…" start?).
- `T08` tab 2's icon: white (nothing), red, amber (a message while another tab is selected), white on the fill (selected).
- `T09` tab 3's variants: tuner icon + a long station name clipped with "…"; player icon + a title; CarPlay icon; icon only (no data); the mute mark.
- `T10` tab 4's variants: plain phone (no data), phone with bars 0–4, crossed-out phone.
- `T11` tab 5: arrow; the turn-arrow variant near a manoeuvre.

### KB-2 Tab 1 — the on-board computer
- `1A` date and time. `1B` trip (02's table grammar, the stacked consumption unit, the meta line, the footer). `1C` trip with dashes (a silent field) — only the silent value dashed.
- `1D` **technical data** (SPEC-R3 §4.1): four rows with bars — normal values; `1E` oil at 134 °C (bar red from 130); `1F` boost under load (1.1 бар); `1G` a row with no value (dash, empty bar).
- `1H` **tyres** (after probe): the outline with four pressures and temperatures; `1I` one corner amber (0.3 bar under target).
- `1J` the cycle as a strip of small frames: with "Технічні дані = показувати" (clock → trip → technical → tyres) and with "сховати" (clock → trip) — to show what the setting does.
- `1K` page dots or no page dots under the title rule (K2 drew small dots): both, the owner chooses.

### KB-3 Tab 2 — messages in the centre
From SC's `card.json` (sizes, baselines, colours) and its samples:
- `2A` card, one line, white (grey cell). `2B` two lines, amber. `2C` three lines, red. `2D` a name too long: cut with "…" on line 3. `2E` green.
- `2F` card + counter "2/3". `2G` card (one line) + two rows; `2H` card (two lines) + one row.
- `2I` list only: six rows of mixed severity + the scroll line. `2J` the pointer page ("Повідомлення / на панелі внизу"). `2K` the empty page.
- **The sequence, as six frames in one sheet** (`2S1`–`2S6`): (1) rest on tab 1; (2) the message arrives: BMW's panel through the window, the bottom row gone, tab 2 selected, our card painted; (3) ≥ 150 ms later: the window closed, the bottom row back in one line, the rule in the severity colour; (4) the driver selects tab 1 while the message still shows: the window open again, the clock page, the warning icon in the severity colour; (5) back on tab 2; (6) the message ends: tab 1 again. Label each frame with the machine's state (`none` / `window` / `ours`).
- `2T` D7 not yet confirmed: the pointer page with the window open (what the owner will see on the first messages after an install).

### KB-4 Tab 3 — media
`3A` M3 certain-only. `3B` radio (FM; station, radio text, footer). `3C` radio DAB. `3D` now playing over USB (title, artist, progress, 4 / 12). `3E` now playing over CarPlay. `3F` muted. `3G` a very long title and artist (the "…" rule). Each labelled with its data status (everything but 3A is after probe).

### KB-5 Tab 4 — phone
`4A` idle, connected over CarPlay with battery and signal — **without** a missed-call count. `4B` idle, Bluetooth. `4C` no phone (crossed icon in the tab, "Телефон не підключено"). `4D` no data ("Немає даних"). `4E` incoming call, "Контакт". `4F` incoming, "Номер". `4G` incoming with the name setting on (an invented neutral name, e.g. "Абонент Приклад"). `4H` active call with the timer; `4I` active, microphone muted. `4J` a call while a message shows: tab 2 wins — the call only as tab 4's icon lit.

### KB-6 Tab 5 — navigation
`5A` the map window W1 (the drawn stand-in under it, fading at the box's edges as SPEC-R3 §4.5), the road bar at the foot. `5B` the same without a road. `5C` guidance page: a right turn in 350 м, next road, lanes, arrival. `5D` a roundabout, exit 3. `5E` a fork. `5F` the destination on the left. `5G` distances: 30 м, 350 м, 1.2 км, 14 км (the format rule). `5H` calculating. `5I` no route, road known. `5J` nothing. `5K` annotated: BMW's map box (10 % edge x 700–1217, y 138–594; full x 794–1150, y 209–557) over 5A.

### KB report
Every picture with its data status and spec section; what changed against K2's set; any place where the spec's numbers collide (text over text, a label that does not fit — as K2 found with "Охолоджувальна рідина"), each with the measured overlap and a proposal.

## 5. Package KC — checks, night, and the sheets the owner chooses from

Folder `r3b/kc/`. KC draws no new design; it proves and assembles.

1. **Automatic checks on every KA and KB picture** (`tools/twin-dial/mockup/checks_r3b.py`, output `checks.json`, a failing check listed by picture): the keep-outs of §1 (0 non-black pixels); every text inside its cell or page (no ink crossing a separator, the title rule, the window's sides); minimum gaps (≥ 4 px between any two ink boxes on a dial; ≥ 6 px in the bottom row and round the sign); nothing of ours inside the fallback window while it is drawn open; the sign's and the readout's clearances against SPEC-R3's numbers; the two scale markers never overlapping when 2° or more apart; the numeral-clearance rule of SPEC rev 2 §5.3.
2. **Against the references:** for the dials (A02, A03), the tab bar (T06) and the pages with a reference (1A against 06's date page, 1B against 02's trip page), the same region numbers K2's `compare.py` gave (ink ratio, centroid shift, 2 px recall and precision, colour ΔE) between ours and the rectified reference — reported as "how close", with the known deliberate differences named (our large clock, our language, no side gauges).
3. **Night:** the night versions (SPEC-R3 §6) of A01, T01–T05, 1D, 2B, 2C, 3D, 4E, 5A, 5C, C07, L04 — one sheet, day above night.
4. **"Everything on"** (`Z01`–`Z04`, composed from KA's and KB's code): driving at 103 with limit 90 and cruise 110 while a two-line amber message has just arrived (window open) → 150 ms later (card on, window closed) → tab 5 with the map, over the limit → an incoming call on tab 4 with cruise in standby.
5. **The choice sheets** (`sheets_r3b.py`), one page per decision, each with the variants side by side, labelled in Ukrainian for the owner, with the cost of each from KA's and KB's reports:
   - `S1_red_strip.png` — L1 / L2 / L3 (below and over the limit);
   - `S2_cruise_place.png` — C1 / C2 (/ C3);
   - `S3_shadow.png` — the numeral shadow: K1's / SD's;
   - `S4_tech_page.png` — technical data and tyres in tab 1, the cycle with and without the setting, dots or no dots;
   - `S5_overview.png` — one frame per tab and state in the final look (the replacement of `r3/pages_sheet.png`);
   - `S6_sequence.png` — the message sequence;
   - `index.html` linking every picture, sheet and check result.
6. **`docs/twin-dial/r3b/KC-REPORT.md`:** the failed checks (with the picture and the px), the comparison tables, and the list of decisions the owner must make with what each one unblocks in the build.

## 6. Order and hand-offs

KA and KB start at once (KB first merges K1's branch for the dial code; KA exposes any new drawing function — the sign, the markers, the readout — in `mockup.py` and tells KB through `pub/KA/` so the pages can show them). KC starts with its check tool on K1's and K2's existing pictures and runs on KA's and KB's as they publish; its sheets come last.

## 7. What the lead does with it

Shows the owner the six sheets, records the choices in `SPEC-R3.md` (§8 the red strip, §9 the cruise place, §2.4 the shadow, §4.1 the page dots), and only then writes the build brief for 0.1.1.
