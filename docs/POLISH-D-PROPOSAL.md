# Proposal: in "6WB Dials + G20", what stays BMW's and what we draw (package D)

Brief: `docs/AGENT-BRIEF-polish.md` §6. Status: **proposal**. Nothing in the app changes until the owner approves a row; the rows that need work go to package B (`dials()`, the collar, `u_cut`) or to the lead.

**How to read it.** One row per G20 element seen in `wb_dials` (bench simulation and photo 16). The numbers match `docs/polish/d/key.png`. In the "Do" column:
- **keep**: BMW's own stays, shown through our see-through background;
- **ours**: we draw it in 6WB style;
- **hide**: our black covers BMW's;
- **hidden**: already under our dials today, and it stays so.

| # | G20 element (catalogue id, panel px) | Do | Ours: where · font · signal | Why (style · alignment · data · cost · safety) |
|---|---|---|---|---|
| 1 | Left lamps: brake, TPMS, ABS, DSC (`tt.brake/tpms/abs/dsc`, x 14–85, y 214–429) | **keep** | — | Safety: critical. All four show 100 %; our fuel mini starts at y 538. |
| 2 | Steering-fault lamp (`tt.steering`) | **keep** | — | Safety: critical. |
| 3 | Red (P) (`tt.parking_brake`) | **keep** | — | Safety: critical, and `over` (BMW draws it on top; we cannot hide it). |
| 4 | AUTO H (`tt.auto_h`, 1777–1870 × 179–205) | **keep** | — | Data: we read no auto-hold signal. Style: it is a lamp, not text. Alignment: the left half of the "A" is under our tacho bezel. Accept it: a notch in the chrome ring looks worse. |
| 5 | Driver's belt (`bottom.belt_driver`) | **keep** | — | Safety: critical and `over`. |
| 6 | Rear belts, airbag (`bottom.belt_rear`, `bottom.airbag`) | **keep** | — | Safety: critical. Every black patch below stays above y 668, and the belts start at y 679. |
| 7 | Check-control panel: message, frame, left "i" (`assist.cc_panel`, `bottom.cc_info`, 712–1240 × 601–691) | **keep** | — | Safety: critical (oil-pressure, coolant and "press the brake" messages). Data: the app reads no check-control signal. **Nothing of ours enters this box**, so rows 14, 24 and 25 stop at its edge. |
| 8 | Right "i" (`assist.info_tacho`, through the window 1250–1276 × 585–633) | **keep** | — | Data: none (its meaning is still unknown). The window costs nothing. Package B fixes the 21 % the collar hides. |
| 9 | Map and position arrow (`map.region`, `map.position_arrow`) | **keep** | — | Data: the app cannot read navigation, and the map is the point of this layout. Packages A and B shape its edges. |
| 10 | Street name (`bottom.street`, 795–1126 × 669–709) | **keep** | — | Data: none (navigation). Style: Cyrillic, and our Arimo atlases are Latin only. It sits in the check-control area, where BMW swaps it for the panel. |
| 11 | Range "467 km" with the pump (`bottom.range`, 136–303 × 666–699) | **keep** | (alternative: ours, see mockup 2) | We have the data (`KombiIF.statusRangeTankStatus`), but the bottom row stays BMW's anyway: the belts, airbag, gear and street cannot move. One Arimo item in it clashes. Style: our night colours take whites to ~148, BMW's text stays ~255 (measured on the bench, `nightDim`). Cost: a patch plus a text. It pairs with our fuel mini above it. |
| 12 | Clock (`bottom.clock`, 344–451 × 666–700) | **keep** | (alternative: ours) | Data: ours depends on the `timeZone` setting, because the head unit runs on UTC (photo 14 showed ours 2 h off), while BMW's is always right. Alignment: the 6WB's clock lives in the info bar under the middle display, which is BMW's message area here. |
| 13 | Outside temperature (`bottom.temperature`, 1540–1663 × 666–701) | **keep** | (alternative: ours) | Data: ours rounds to whole degrees (`{{ambient}}` gives "+4 °C" where BMW shows "+3.5 °C"). The other reasons are as for row 12. |
| 14 | "COMFORT PLUS" in the bottom row (`assist.mode_label`, 1226–1359 × 659–711) | **hide** | patch `[1226, 659, 1366, 716]`, soft edge ≤ 3 px | Style: two-line condensed caps 50 px tall, the loudest G20 text, right under our tacho. Safety: the patch clears the check-control outline (0 px at a 3 px margin; the outline ends at x ≤ 1211 for y ≥ 659) and BMW's gear (x ≥ 1398). Cost: drawn in package B's collar, so 0 layers, 0 assets, 0 uniforms. |
| 15 | (ours) the drive-mode label that replaces row 14 | **ours** | Tacho, centred (1508, 527), above our gear tray; `wb_capb` (Arimo Bold 22, already loaded for READY); `fg`; `{{mode}}` from `FES.statusFESVehicleDynamicSwitchHMI` (read today: COMFORT, COMFORT PLUS, SPORT, ECO PRO…) | Style: the 6WB puts the mode label exactly there (ref 03: "ECO PRO", "SPORT+" above the gear box). Cost: one text widget on connection 2 and no new atlas. Option: drop it, since the 6WB's Comfort shows no label (ref 03, middle). |
| 16 | Gear letter in the bottom row (`assist.gear`) | **keep** | — | `over`: BMW draws it on top, and we cannot hide it. |
| 17 | (ours) our empty gear tray (baked in `tacho_d`, 1424–1591 × 552–609) | **ours** | Inside the tray, centred (1508, 583); `wb_gear` (Arimo Bold 46); `{{gear}}` ("P", "D4", "S3") from `VehicleInformation.statusGearboxDrive` (read today; S/M from `MDrive`) | Style: the tray is drawn but empty today, which reads unfinished. The 6WB shows the gear there (ref 06). Data: ours adds the gear number, while BMW's row-16 letter has none. Cost: +1 glyph atlas (1024 × 36, ≈ 0.28 MiB) and 1 text widget. It reverses "we draw no gear letter" (comment in `design/gen_6wb.py`) for this layout only. Option: `{{stage}}` for the letter alone, or take the empty tray out of the bake. |
| 18 | Speed-limit sign (`assist.speed_limit`, round window at (539, 622)) | **ours, once we have the data** | Under the speed hub, as in `wb_comfort`: `wbsign` with the baked `sign_limit` / `sign_nopass` at (305, 460, 214 × 93), and the figure in `wb_val`. Signals `config.limit` / `config.nopass` | **Data: `app.json` `config.limit` and `config.nopass` are `null`** (the field is not known yet), so on the car our sign never shows. If BMW's window is closed now, the car shows **no** limit at all. So: keep BMW's window open while our limit is unknown, and close it, with BMW's sign covered down to y 668, only while `limitKmh` is set. This is one value in the existing `u_cut` (round radius 46 → 0), with no new uniform. Package B builds it. Cost: the sign textures are already used by `wb_comfort` (≈ 0.1 MiB each), plus the `wb_val` atlas (≈ 0.25 MiB). |
| 19 | Digital speed "0 km/h" (`assist.digital_speed`) | **hidden** | — | Under our speedo face (0 % visible). Our needle shows the speed. |
| 20 | "1/min x1000" (`assist.rpm_label`) | **hidden** | ours is already drawn (`rpm_cap`, `wb_cap`) | Our tacho says the same. |
| 21 | OFF and the tacho "0" (`assist.off`) | **hidden** | ours is already drawn (`off`, `wb_cap`, dim), with our READY (the G20 has none) | Our tacho says the same. |
| 22 | COLD (`assist.cold`) | **hidden** | — | Under the collar. Our oil gauge's blue zone carries it (oil temperature from `CDS.statusEngineTemperature`). |
| 23 | Stock dials: scales, numerals, pointers, rev band, glows, minis (`structure.*`) | **hidden** | — | Under our dials and the collar. That is the layout's idea. |
| 24 | The stock dials' straight bottom lines (x 277–602 and 1318–1638, y 640–654) | **hide** | in B's cut: black, not see-through, between y ≈ 634 and 658 inside the dials' feet | Style: the stock frame shows through our cut's fade and breaks at the sign window. With our dials it reads as a leftover. Safety: outside the check-control box. Cost: 0 (collar or `u_cut`). |
| 25 | The stock lines' curved end hooks (x 696–748 and 1168–1239, y 604–650; drawn only with no message), and the "grey dash" at 1224–1239 × 643–650 | **keep** | — | Safety: they lie inside the check-control box (row 7), and no signal tells us when a message shows, so covering them would cover the panel's corners. Accept them as the frame of BMW's message area. |
| 26 | The black area over our tacho hub (`overlay.black_box`) | **keep** | — | `over`: we cannot hide it. |
| 27 | The G20 background (`panel.background`) | **keep** | — | Pure black (owner's colour rule; package C does the simulation's). |

## The mockups

Everything shown is our own drawing (the app's layers and the bench's G20 simulation), with no photo pixels. Two compromises:
- the empty space is pulled to black outside our dials, as packages B and C will make it;
- our sign is pasted from a demo frame of the same layout, because the bench has no limit signal in manual mode.

- `docs/polish/d/before.png`: today's `wb_dials`, driving and at rest.
- `docs/polish/d/mockup_recommended.png`: the table as proposed.
- `docs/polish/d/mockup_alternative.png`: the same, but with our range, clock and temperature in Arimo in place of BMW's (rows 11–13 as "ours"). It shows the font and brightness clash and the rounded "+4 °C".
- `docs/polish/d/key.png`: the row numbers on the panel.

The renders come from the prototype branch `polish/d-proto` (commit `d694246`, **not for merge**): `PROTO_D=rec|max python3 design/gen_6wb.py …`, then `tools/polish_d/shots.sh rec max` and `compose.py`.

## Budgets (bench, layout "6WB Dials + G20")

| | Widgets | Layers (connections) | Pixel memory | Glyph atlases |
|---|---|---|---|---|
| Today (`main`) | 32 | 14 (5 + 5 + 4) | 10.0 of 16 MiB | 6 |
| Prototype `rec`, with the patches as separate `box` layers | 40 | 20 (5 + 6 + 5 + 4) | 10.5 MiB | 8 |
| The proposal built properly (estimate) | 36 | about 16 on 3 connections | about 10.5 MiB | 8 (`wb_gear` from row 17, `wb_val` from row 18) |

- **Do not build the patches as `box` layers.** With them on the default connection, the planner ran out of layers and went to unlimited sheets: 15.7 of 16 MiB. They belong in package B's collar texture, which costs nothing extra.
- Uniforms: none new. Row 18 reuses `u_cut`.
- Assets: +2 sign textures while a sign shows (row 18, the same ones as in `wb_comfort`).

## Conflicts with packages A–C

1. **B §4.3, our signs.** Closing the round window and covering BMW's sign unconditionally leaves the car with no speed-limit sign, because `config.limit` is `null`. B should gate it on `limitKmh` (row 18). The cover below the cut (y 656–668, x 494–586) must follow the same switch, so it cannot live in the static collar.
2. **B §4.1, the seams.** The end hooks and the grey dash right of the message panel are inside the check-control box. They must not be covered (row 25). The straight bottom lines can be (row 24).
3. **B §4.2, the collar.** Add the COMFORT PLUS patch (row 14) and the bottom-line strips (row 24), and keep B's 3 px clearance from the check-control outline.
4. **B owns `dials()`.** Rows 15 and 17 are two text widgets there. They are B's or the lead's to add once approved.
5. **Packages A and C:** no conflict. A's work is in `wb_comfort` and `wb_comfort_map`; the middle of `wb_dials` stays BMW's map (row 9). C's black background is assumed by every "hide" row.
