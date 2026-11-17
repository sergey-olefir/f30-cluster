# Provenance and licence: design/twin-dial/vt/

Package VT, 2026-11-17. Applies to every file in this folder and its subfolders.

| Path | What | Made from | Licence |
|---|---|---|---|
| `pictograms.js` | The Twin Dial pictograms as distance functions (the `shared/icons.js` contract) and as SVG | Drawn by package VT from primitives (lines, arcs, discs, rounded boxes, polygons), after the shapes ISO 2575 and UN R121 Table 1 standardise and after generic UI symbols (note, phone, arrowhead, cog, mast). Ten drawings are package P's, reused unchanged from `design/strip/pictograms/pictograms.js` (see its PROVENANCE.md). **Nothing was traced, sampled or measured from any maker's artwork, from the references (`reference/vc/`), from a photo of a cluster, or from the car's snapshot or its symbol bitmaps.** | MIT (the repository's `LICENSE`) |
| `pictograms/svg/*.svg` | One vector per pictogram, `currentColor` | Generated from `pictograms.js` by `tools/twin-dial/vt/bake_pictograms.js` | MIT |
| `pictograms/baked/*.png`, `pictograms/baked/index.json` | White ink plus alpha (8-bit grey+alpha), drawn by `shared/icons.js` `paintIcon()` | Same tool; sizes provisional (R = 300 panel px) | MIT |
| `pictograms/sheet.png` | Review sheet, every pictogram at every size | Same tool | MIT |
| `samples.json` | Where on the rectified references the measured text sits, and what it says | Coordinates and strings typed by package VT; no pixels | MIT |
| `typography.json` | The chosen faces, settings, measured deviations and bake sizes | Numbers from `tools/twin-dial/vt/fit.py` | MIT |

## What is NOT here, by rule

- No font file. The chosen faces are SIL OFL 1.1 files from the Google Fonts `ofl/` tree, downloaded only into
  `bake/work/twin-dial/refs/vt-fonts/` (git-ignored) with `SOURCES.json` (URL and licence per file). Round 2 copies the
  one new face (Saira) into `tools/fonts-src/` with its `OFL.txt`, as the repo does for its other faces.
- No maker's font, logo, glyph outline or bitmap; no pixel of the references (glyph measurements are numbers only,
  and the photo crops stay under `bake/work/twin-dial/vt/`).
- No check-control symbol bitmap from the car (`requestDefaultSymbols`): never saved, baked, logged or committed.
