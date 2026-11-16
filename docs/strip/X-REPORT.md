# Package X: the row's logic and our message

Branch `strip/X`, on `integrate/bottom-row` (`3c8ef46`). Bench only, on port 8164 (each suite starts and stops its own
server). No car, no push, no version bump. Coverage still uses today's rectangles; package M's mask replaces them.

## What changed in behaviour (see-through layouts `wb_dials`, `wb_sport_dials`)

| # | Before | Now | Where |
|---|---|---|---|
| 1 | Each item of the row fell back to BMW's on its own (`_rowFail` per item), which stacked three texts. | **All or nothing.** `_own(item)` is `_rowWhy() === null` for every item. Any failure latches the **whole** row until restart, logged **once**: `bottom row: the whole row is BMW's again until the app restarts - <item>: <why>`. | `hud.js` `_own`, `_rowWhy`, `_rowFail`, `_rowCheck` |
| 2 | The row waited per item (the clock for a zone, the message for a first read). | The **whole** row waits, without a latch, for a time zone and for the car's message to be read once. Then it comes in by itself. `_rowSync`, once a tick, rebuilds when the row's owner changes. | `_rowSync` |
| 3 | `timeZone` setting → car → `utcOffsetMinutes`. Any number was accepted. | **Car first** (`config.clock`), then the `timeZone` setting (retired, still read if present), then `config.utcOffsetMinutes`. Each source is used only if it is a whole number of quarter hours within ±14 h (`tzOk`). A rejected car value is logged once and the next source is used. | `_tzSource`, the `config.clock` watcher |
| 4 | No standby handling for the row. The sign window shut on "P with rpm < 150". | **Standby = `VehicleCondition` 5 (WOHNEN)**, one named constant, `COND_STANDBY`, debounced 1 s. In both modes the row is BMW's then. The sign window shuts only in standby. P with the engine off and condition 7 (photo 63's state) keeps BMW's sign visible in `allG20`. | `_standbyNow`, `_rowSync`, the dial `cut.cover` block |
| 5 | Two lines (`cc_name`, `cc_desc`) beside a window onto BMW's symbol (`ccSym`). | **One line, the headline only**, in the road label's slot. One widget, `cc_line`, draws everything in one raster: variant **A** puts a severity marker (a triangle for red, yellow or orange, an "i" otherwise, in the car's colour) before the headline; variant **B** puts a hairline above it and a coloured segment under it. Too long a headline is cut with "...". The `ccStyle` setting switches A and B live, without a rebuild. The road label hides while the line shows. `ccSym` is gone. | `_ccLinePaint`, `cc_row()`, `app.json` `ccStyle` |
| 6 | BMW's panel was covered whenever the info field was ours, even before our text existed. A 660 × 13 px band (y 652–666) leaked. | **The safety handshake.** `_ccOpen()`: while the row is ours, BMW's panel (u_cc = `CC_BOX` and the road bar's hole) stays open until our text for **that exact headline** was sent in an earlier tick, at least `CC_SETTLE_MS` = 150 ms ago (`_ccOnScreen`). Opening is pushed from the signal handler itself (`_ccPush`), not at the next tick. The road bar now starts at y 650, so the panel is under solid black while ours is drawn. | `_ccOpen`, `_ccOnScreen`, `_ccPainted`, `_ccPush`, `NAV_BAR` |
| 7 | A message with a symbol or id but no readable text, or with a union member we do not know, counted as "no message", so we covered BMW's warning. | It counts as **showing** (`ccUnread`). BMW's panel opens and the row latches. | the `config.ccm` watcher |
| 8 | BMW's marker right of the panel was covered in both modes (cover, collar and our tacho rim). | Visible in both modes while BMW's panel is shut. u_cc = `ccMark` `[1251, 589, 1283, 629]`, and the tacho has a box window there again (WBDIAL mode 2). | `_wbCcSend`, `MARK_WIN` |
| 9 | The check-control log line had no id. | It now carries the id as well (still no text). | |

## The safety cases and how each is tested (`bench/test-bottom-row.js`, each on a fresh app)

Between every two engine ticks, `bench/run-app.js` audits what was **sent**. If a message shows and ours is not on
screen, u_cc must equal `CC_BOX` and the bar's hole must be open. Each case asserts 0 violations over a non-zero
number of frames with a message showing.

| Case | How it is provoked | Asserted |
|---|---|---|
| The gap before our first draw | `POST /fake {hook:"ccHold"}` holds our paint back, then `cc-red`; release after 1.5 s | Every probe in the 1.5 s has BMW's panel open in the backdrop **and** the bar. The renderer's own `u_cc` (read from `GET /events`) is `CC_BOX`. After release the panel is covered and only the marker stays open. The audit is clean. |
| A missing glyph | `cc-uk` (Ukrainian) | The row latches, all of it is BMW's, BMW's panel is open, nothing of ours is built. The audit is clean. |
| A throw while drawing | `{hook:"ccThrow"}`, then a message | The row latches with "drawing threw", the panel is open, and the app stays up. The audit is clean. |
| An unreadable struct | `cc-unread` (a symbol, no text) and `cc-unread-root` (an unknown union member) | Each counts as showing, latches, and opens the panel. The audit is clean. |
| Full cover while ours is drawn | geometry | Every row of `CC_BOX` is under `CC_TOP`'s solid part or the bar. The bar and `MARK_WIN` keep off both belts and the airbag. |

The suites: `test-bottom-row` has 133 passed (91 at the base); `test-native-ui` has 44 passed.

## The clock

Source chain: `config.clock` (KombiIF `timeDateUTC`, factor 15, which is unverified), then the `timeZone` setting,
then `config.utcOffsetMinutes`. Without a zone the row is BMW's. The line to check on the car (logged when the
source or the offset changes):

`clock: ours shows HH:MM, UTC+hh:mm from the car (app.json config.clock) - it must read what the head unit's own clock reads`

## Verified and hypothesis

- **Verified (bench):** everything in the tables above, read from the engine's probe, its sent uniforms and the renderer's scene.
- **Hypothesis:**
  - `VehicleCondition` 5 is the standby row. Every new value is logged as `bottom row: vehicle condition N`.
  - 150 ms after sending is enough for the car's renderer to show our line.
  - The car's "no message" notification has symbol 0 and id 0. If it does not, the row latches at once (the safe side) and the log says why.
  - The mapping from cCColor to severity.
  - The marker box, measured only on low-resolution photo 08.
  - `ccList` / `ccListRiskClass` (getter ids 7 and 16) as the stored-message signal.

## Costs and open points

- u_cc is one box. While BMW's panel is open, the marker is under the collar again. M's mask (`bmw_msg`) lifts that.
- The tacho's box window blacks our bezel below y 589 on its left half (WBDIAL mode 2), so the rim ends at the marker.
  The window may also show short ends of the faint stock lines above the "i" (photo 08).
- The marker: the catalogue has `ccList` and `ccListRiskClass` (risk classes RK10–RK900). They are a likely signal that stored messages exist.
  **Proposal:** once the car logs `check-control list: N messages`, draw our own marker from it and close the window.
  Until then BMW's marker stays visible.
- The `ccStyle` row is always shown in the centre-screen menu (menu.js hides only `bottomRow`). It does nothing in the opaque themes.
- Layouts: only my hunks are grafted onto the committed `wb_dials.json` and `wb_sport_dials.json`. The generator drift is left to F.
