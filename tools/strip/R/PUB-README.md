# Package R: what is published and how to use it

Copied to `bake/work/strip/pub/R/README.md`. Status: `bake/work/strip/pub/R/STATUS.json` (version, which photos are
ready, what changed). Files are replaced in place when a better registration lands.

Rasters (in `bake/work/strip/rect/`, git-ignored, photo-derived):

- `<id>_panel_2x.png`: 3840 x 1440, 8-bit sRGB, whole panel.
- `<id>_strip_4x.png`: 7680 x 720, **16-bit LINEAR light** (sRGB EOTF of the photo's 8-bit codes, no exposure
  normalisation; `photometry.json` gives each photo's black level and exposure factor), STRIP y 540..720.
- `<id>_valid_4x.png` (when photometry has run): 7680 x 720, 8-bit, 255 where colour can be trusted.
- `bake/work/overlay/rect/<id>.png`: 1920 x 720, 8-bit sRGB, for the bench dropdown.

Alignment (continuous panel px, brief 4.1): pixel (I, J) of an n x raster covers
`[I/n, (I+1)/n) x [y0 + J/n, y0 + (J+1)/n)`, y0 = 0 (panel) or 540 (strip). A box average of n x n raster pixels is
exactly the 1 x panel pixel; a raster pixel's centre is at continuous `x = (I + 0.5)/n`.

Models: `bake/work/strip/rect/H.json`, in `tools/g20spec/zoom.py`'s schema (`--hjson` that file). The model takes
**OpenCV** panel coordinates (continuous - 0.5). zoom.py's crops are offset: its crop pixel k sits at continuous
`x0 + k/n + 0.5`, not `x0 + (k + 0.5)/n` (0.44 px at n = 8); add `(n - 1)/(2n)` to its crop-pixel positions to get
continuous centres. zoom.py also ignores the residual-field correction (`field` in H.json) that the rasters include,
so prefer the rasters.

Error budget per photo: `registration.json` (per-photo table, verdicts); details in `H.json`.
