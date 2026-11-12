# Package D report: what stays BMW's in "6WB Dials + G20"

The answer is `docs/POLISH-D-PROPOSAL.md`: one table to approve row by row, plus the mockups, budgets and conflicts. This file only records how it was made.

- **Branches.**
  - `polish/d`: docs only (the proposal, this report, `docs/polish/d/`). It makes no app edit.
  - `polish/d-proto`, commit `d694246`: **not for merge**. It holds `PROTO_D` in `design/gen_6wb.py`, the prototype `wb_dials.json`, and the scripts in `tools/polish_d/`.
- **Evidence.**
  - The bench on port 8084 (`main` 0.7.6), with the G20 simulation, manual signals, and D's own Chrome profile (`bake/work/polish-d/chrome`) driven over CDP.
  - Photo 16, used by eye for the real bottom row.
  - The catalogue polygons (`design/overlay/g20_comfort.json`) for the safety clearances.
  - `shared/hud.js` and `app.json` for which signals we read.
- **Headless note.** Chrome's `--virtual-time-budget` hung on this bench while four agents were running, so the shots wait in real time through the DevTools protocol (`tools/polish_d/cdp.mjs`, port 9284).
- **Budgets.**
  - Today: 14 layers, 10.0 MiB.
  - Prototype: 20 layers, 10.5 MiB, because each patch is its own layer.
  - Built properly: about 16 layers and 10.5 MiB. The patches go in the collar; the new costs are the `wb_gear` and `wb_val` atlases.
  - Uniforms: none new.
- **Open points.**
  - Row 18 waits on `config.limit` (the field is still unknown).
  - Rows 14, 15 and 17 are style calls for the owner.
  - The real car's empty background should be checked against our black patches in a photo after the build: it is assumed black.
