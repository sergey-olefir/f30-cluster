# CF3 — Twin Dial's media, phone and CarPlay-route pages, switched on for what the car sends

Branch `car-fix/3` from `twin-b/integrate` (b10b8e4). Brief: `docs/AGENT-BRIEF-car-fix.md` §2 CF3. No version bump, nothing pushed, f30_cluster untouched.

## What the car showed (read from `reference/car/2026-11-18-collect1/`, numbers / enums / lengths only)

| Source | What arrived | Where read |
|---|---|---|
| `HmiMediaState` (HMI_CID) `playerMetadata` | sink FRONT, uiType TWO_LINES, **line 1 ARTIST (17 chars), line 2 ALBUM (16), no TITLE line**, three-row text empty | signal_probe.log l. 223 |
| `HmiMediaState` `trackProgress` | hasProgress true, **elapsed / total not plain numbers** (Int64, printed "?") | l. 224 |
| `HmiMediaState` `menu` | 7 entries (MUSIC_COLLECTION, BLUETOOTH, PRESETS, FM, AM, MIRACAST, CARPLAY), **selected icon CARPLAY**; ids and selected id **not plain numbers** (Int64) | l. 226 |
| `TunerFmAmDab.currentStationFmDabAm` | WB_FM, ANALOG, frequency in the FM range in kHz, position 0, TPS_NO_TP, short / long name 8, radio text 64 | l. 230 |
| `MediaPlayer` (CarPlayMedia) | playerState PLAYER_STATE_PLAY; position 0 of 0; **currentItemMetadata: ARTIST 17, ALBUM 16, TITLE 16, COVER_FILE 59**; **currentItemTime 25583 of 184785** (ms: +~10 400 every 10.4 s); deviceInfo BT_IAP | l. 232–236, 247–326 |
| `ConnectivityAggregator.aggregatedCallState` | DISCONNECTED → DIALING → ACTIVE (+10 s) → DISCONNECTED (+8.5 min) | twin_dial.log.1 l. 1755, 2716, 2741, 2831 |
| DevicePresentation, VoiceCall, VoiceCallManager | **nothing**: the probe's phone set S5 was never switched on in this session (sets S1–S4, S6–S8, S10 only); answers.json P9 = "not-yet" | signal_probe.log l. 128–527 |
| `Guidance` (Main_Instance) | guidingProvider CAR_PLAY; guidanceState INACTIVE; **nextDestinationInfo travel 660, raw 5700, unit KM, text length 3, ETA 20:41 (valid), tz 120 not valid**; currentRoad 0 elements at that moment (the lead reads text later); isOnGuidableRoad false; dart kind pointOfInterest raw 0 unit NONE; lanes rows 0; CarPlay projectedGuidanceActive true | l. 307–324 |

Also confirmed by a log line (B4's hypothesis in `docs/twin-dial/r3b/B4-REPORT.md`): Twin Dial **0.1.0 failed to subscribe HmiMediaState** ("Instance not available in 'instances' section", twin_dial.log.1 l. 1665 and 3095) because it asked for instance 1. The integration branch already sets `$instance: HMI_CID` (B4), so 0.1.1 subscribes the right instance.

## Decisions

1. **Distance scaling: `FormattedDistance.rawDistance` is METRES, whatever its unit.** The car: raw 5700, unit KM, a 3-character text, travel time 660 s, arrival 11 min after the read. 5.7 km in 11 min is 31 km/h in town; 57 km or 5700 km in 11 min is impossible. The unit names only the formatted text's unit. `metres()` no longer multiplies by the unit (this also changes the guidance page's manoeuvre distance, same type; its test now feeds metres). 0 is "no distance" (the CarPlay route's empty manoeuvre: raw 0, unit NONE).
2. **Arrival time is local** (18:31 UTC + 660 s gave 20:41, the zone UTC+2; `includedTimeOffset.valid` false): drawn as it comes.
3. **Media: CarPlay first.** With CarPlay the HMI lines are ARTIST + ALBUM and carry no title, so title / artist / time come from `MediaPlayer` on CarPlayMedia (`currentItemMetadata` keys TITLE / ARTIST / ALBUM, `currentItemTime` ms). Any other source reads the HMI lines (by their types) and the HMI progress. No TITLE key with CarPlay → the certain page (never the album or the artist as a title).
4. **Source:** the HMI menu's selected entry, ids compared by value whatever their shape (`idKey`, `int64`: number, digit string, `{low, high}`, 8-byte buffer); exactly one match or none. The old code compared `x.id === sel`, which with two missing ids took the **first** entry (MUSIC_COLLECTION → "USB"). With no menu source, the CarPlay player PLAYING says CarPlay.
5. **Tab 3's text** = the station on the radio page, the title on the now-playing page, nothing on the certain page (B2's `paintMedia` cuts it with "…"). `config.twin.media` (twin_tokens.js "second line, else first") stays off: with CarPlay it would show the album.
6. **Phone:** the call card from `aggregatedCallState` only: title by state ("Виклик…", "Розмова", "Вхідний дзвінок"), our own timer from the ACTIVE edge. The unseen sources stay dark behind two new keys: `config.pages.phoneDevices` (DevicePresentation: the idle page's "Підключено · …" lines, battery / signal, the call card's path, tab 4's icon variant) and `config.pages.callDetail` (VoiceCall state / contact / name, micMuted; the caller's name is not even kept without it). Idle page: "Немає даних" (as SPEC-R3 4.4 says until P9).
7. **`config.tabs.callSelects` → true** (rule 2: a call selects tab 4, a message still outranks it). The tabs config said "OFF until the car session has shown the call state (probe P9)"; Twin Dial's own log shows it. A one-line revert if the owner prefers the call card only by hand.
8. **Navigation: a new page `route`** ("route by CarPlay", `config.pages.route`), shown on tab 5 when `guidingProvider` = CAR_PLAY, BMW's own guiding is neither ACTIVE nor CALCULATING_ROUTE, and a destination came within the last 60 s (`ROUTE_FRESH_MS`; the car sends it every few s). Title "Навігація", meta "CarPlay", the remaining distance Saira 72 + unit (the guidance page's sizes, centred), "прибуття 20:41 · 11 хв" Noto 33 at 466, the current road Noto 31 grey at 512, footer "Поза дорогою" when `isOnGuidableRoad` is false. No arrow, no lanes. Android Auto and the other providers have not been seen: no page. BMW's own guidance keeps the arrow page (`config.pages.guidance` false: untested).
9. **Logs:** lengths, enums and "which parts came" only. The destination's distance, travel and arrival time are not logged (they say where the car goes): `nav page: destination distance yes, travel time yes, arrival yes`.

Not done (out of scope, for the lead): tab 5's auto rule 3 still follows BMW's `guidingState` only, so a CarPlay route does not select tab 5 (a one-line rule on `routeLive` if wanted); `isOnGuidableRoad`'s meaning with CarPlay is a hypothesis ("on a road the navigation knows"; it read false at the start of a CarPlay route — the footer may then say "Поза дорогою" while CarPlay guides; watch it on the car).

## Declarations added (all read only, `check_signals.py` passes)

| Interface | Field | Flags | Getter / notifier |
|---|---|---|---|
| `de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer` (CarPlayMedia) | `currentItemMetadata` | rs | 10 / 32778 |
| same | `currentItemTime` | rs | 15 / 32783 |
| `de.bmw.infotainment.navigation.guiding.Guidance` (Main_Instance) | `guidingProvider` | rs | 27 / 32789 |
| same | `isOnGuidableRoad` | rs | 24 / 32786 |

No new interface (both already subscribed), no setter, no method, no event. `COVER_FILE` is never read. Budget: no new layer or sheet (the route page is one more item list of the ONE `tdpage` layer); the layout grows by one page (+76 lines of JSON); `test-twin-budget` 95/95.

## Config (apps/twin_dial/app.json)

`pages`: media **true**, phone **true**, phoneDevices false (new), callDetail false (new), guidance false, route **true** (new), tyres false; `_carFix` explains. `tabs.callSelects` **true**. `_about` of the media / phone / navigation interfaces now say what was seen.

## Tests

| Suite | Result | Note |
|---|---|---|
| test-twin-centre | 218 / 0 (was 163) | new: media with the car's shapes (CarPlay title / time, menu Int64 ids, no first-entry pick, ambiguity, radio switch, Int64 shapes), phone (call card from the aggregator, DIALING / ACTIVE / DISCONNECTED, VoiceCall and devices dark, name not kept), route (5700 → 5.7 км, 660 s → 11 хв, freshness, provider NONE / ANDROID_AUTO, BMW active, switch off, empty destination), privacy canaries (texts, distance, times); app.json pages; the dart test now feeds metres |
| test-twin-layout | 106 / 0 | the five new car states render inside the window, every glyph in its font, no Cyrillic in Saira |
| test-twin-tabs | 199 / 0 | rule 2 tested with callSelects false explicitly; app.json now callSelects true |
| test-diag | 99 / 0 (+1) | tab bridge: phone connected only with phoneDevices |
| test-twin-pages 100, twin-probe 115, twin-cc 249, twin-sim 39, twin-budget 95, twin-trip 89, twin-limit 152, twin-fonts 327, twin-bake 37 | all green | unchanged counts where comparable (pages 100 and tabs 199 at b10b8e4 too) |

Every suite run alone, `BENCH_PORT=8943`. Mutation checks: undoing each of metres-in-metres, the CarPlay title, the one-match menu, the devices gate and the route page makes test-twin-centre fail (4, 6, 4, 1, 4 failures).

States for review (invented text, the car's lengths): `bake/work/car-fix/pub/CF3/states/car_*.png` (git-ignored), rendered by `tools/twin-dial/r3b/b4_gallery.js`.

## Files

`shared/twin_pages.js`, `design/gen_twin.py` → `apps/twin_dial/hud/layouts/twin.json`, `apps/twin_dial/app.json`, `bench/twin-centre-states.js`, `bench/test-twin-centre.js`, `bench/test-twin-tabs.js`, `bench/test-diag.js`, this report. No hunk in `shared/hud.js`.
