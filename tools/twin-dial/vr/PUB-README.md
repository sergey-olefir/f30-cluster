# Package VR: rectified references (bake/work/twin-dial/pub/VR/)

Photo-derived, git-ignored. Never copy these pixels into a tracked file.

- `<id>_rect.png` — the reference warped to the frontal **dial frame**: x right, y down, the line through the two
  dial centres horizontal, the LEFT dial's bezel radius **R = 400 px**. Magenta (255, 0, 255) = outside the source.
  8-bit sRGB codes as in the source (no exposure normalisation; `index.json` gives black level and white per id).
- `<id>_valid.png` — 255 where colour can be trusted (glare < 2 % of white, not near a clipped pixel, inside source).
- `<id>_model.json` — `H_src_to_dial` (3x3, OpenCV source px -> OpenCV dial px), `k1` radial term (applied to
  source px first: u = c + (q - c)(1 + k1 |q - c|^2 / s^2), c = `k1_centre`, s = `k1_scale`), the canvas.
- `index.json` — per id: canvas (`left_centre`, `right_centre`, `centre_distance_R`), ring radii in R, residuals,
  source px per R (resolution), line checks, sharpness (bezel line FWHM, outer-edge 10-90 width), photometry (black
  level, white, glare, clipped shares) and the verdicts `usable_geometry` / `usable_colour`.
- `web/` (when present) — further references found on the web, same files, sources in `index.json` "web".

Pixel convention: OpenCV, a pixel's index is its centre. Dial units: (x - left_centre.x) / 400 etc.; for the right
dial use `right_centre`. Angles: degrees clockwise from 12 o'clock.

**R is the centre line of the thin outer white ring** (the outermost bright line of the dial). The inner disc's
rim is the second ring fitted (radius in `radii_R.*_inner`). The scale band's outer white rim between them was NOT
used for the model; VD measures it in the rectified frame.

Accuracy: ring residual rms (dial px at R = 400) per id; reference 02: 0.35 px, the rule above the bottom row
straight to 0.11 px rms and level to 0.003 deg. See docs/twin-dial/VR-REPORT.md on the branch twin-dial/vr.
