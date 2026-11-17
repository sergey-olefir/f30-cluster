# Twin Dial, package VR: references and normalisation

Round 1, 2026-11-17. Branch `twin-dial/vr`. Tools `tools/twin-dial/vr/`, numbers `design/twin-dial/vr/`,
pixels only in `bake/work/twin-dial/` (published in `bake/work/twin-dial/pub/VR/`, `READY` touched, index version 2).

## Answer

All five references are rectified to a frontal **dial frame** at R = 400 px. The three facelift ones fit to
**0.35–0.56 px rms** (dial px). In reference 02 a straight rule of the design comes out level to 0.003° and straight to
0.11 px. The web search found **no further usable facelift reference** (§4). So the round works from 02 (sharp,
in-car, power meter), 04 (real tachometer with the red wedge, low resolution, clean colour) and 05 (real tachometer,
low resolution, drawn as a render). Reference 02 has no tachometer. The brief's target of three sharp frontal facelift
frames with a tachometer is **not met**: we have two tachometer frames, both at about 107 source px per R.

## 1. Reference table

R is the radius of the centre line of the thin outer white ring of the LEFT dial. Residual = rms of the ring points
about the fitted circles, in dial px (R = 400). "src px/R" is the resolution (source px per R, left / right).

| ref | source kind | generation, state | source size | src px/R | residual (dial px) | geometry | colour |
|---|---|---|---|---|---|---|---|
| 02 | phone photo in a car, daylight | facelift; hybrid power meter left, trip computer, tab bar, bottom row, rev strip | 2160 × 1620 | 210 / 202 | **0.35** (with k1; 1.04 plain) | **yes** (the reference for geometry) | partial: bezel white clipped on 26 % of the ring, phone tone curve crushes black to code ~1 |
| 04 | phone photo of a unit on a bench, dark room | facelift; tachometer, red wedge 7–8, fuel / coolant bars, car picture | 1080 × 608 | 107 / 104 | 0.56 | yes, low-res | **yes**: no glare (p95 0.02 % of white), bezel not clipped, black 0.0011 of white |
| 05 | seller image: exact circles, a render or screen grab composited into a product shot | facelift; tachometer (red arc, not a wedge), settings list, tab bar, bottom labels | 1000 × 472 | 108 / 108 | 0.36 | yes, low-res; the layout differs, see §3 | partial: synthetic colours, bezel clipped 56 %, vignette (glare-like field p95 1.5 %) |
| 01 | press photo in a car | classic; map, tab bar, gear in hub | 1280 × 720 | 177 / 184 | 1.76 (with k1; 4.05 plain) | check only (chrome bezel: soft ridge) | classic |
| 03 | photo in a car, night | classic; date panel, bottom row, LED bars | 1920 × 1280 | 298 / 294 | 1.16 | check only | classic, night |

Residual per ring (dial px), bezel / inner disc rim: 02 L 0.38 / 0.26, R 0.46 / 0.23; 04 L 0.66 / 0.44, R 0.64 / 0.46;
05 L 0.32 / 0.39, R 0.34 / 0.39; 01 L 2.43 / 0.88, R 2.62 / 0.80; 03 L 1.55 / 0.75, R 1.17 / 1.09. **Verified.**

## 2. Method (tools/twin-dial/vr/)

1. `rings.py`: for each dial, rays from a rough centre every 0.5° over −140…140° (clockwise from 12). On each ray the
   linear-light luminance profile, 0.1 px steps, Gaussian σ 0.6 px. The bezel is the **outermost** ridge above 35 % of
   the window's strongest; the inner disc rim is the strongest ridge. The line centre is the midpoint of the two
   half-maximum crossings. Then an ellipse fit, refitted on points within 3 MAD.
   Ridge selection matters. In the facelift dials the thin outer ring (2–5 source px) is followed, after a dark gap,
   by a second, brighter ring: the scale band's outer rim. A plain "brightest ridge" picks either one, ray by ray.
   That rim is not used for the model. VD measures it in the rectified frame.
2. `rectify.py`: the rings are circles on one plane. The model is H = similarity · H_A · H_P, where H_A and H_P hold
   4 free parameters (circles fix a homography up to a similarity). Each dial has one centre (bezel and inner rim
   concentric) and two radii. Robust least squares on (|p′ − c| − r) / R. A single radial lens term k1 about the image
   centre is tried and kept only if it cuts the rms by more than 25 %. It is kept for 02 (k1 = −0.062: 1.04 → 0.35 px)
   and 01 (k1 = +0.107: 4.05 → 1.76 px).
   Gauge: the centre line horizontal, R_left = 400, the left centre at (760, 700) of the canvas. The canvas runs from
   1.9 R left of the left centre to 1.9 R right of the right centre, and from 1.75 R above to 1.55 R below the centres.
3. `photometry.py`: bezel line FWHM and outer-edge 10–90 % width from the median radial profile. Black level is the
   median of the darkest half of the empty 8 × 8 tiles. Glare is a degree-2 surface over those tiles, relative to
   white. White is the 99th percentile of Y on the bezel line. A pixel is clipped when any code is ≥ 250. `valid.png`
   is glare < 2 % of white, not within 3 px of a clipped pixel, and inside the source.
4. `publish.py`: `pub/VR/index.json`, per-reference `*_model.json`, `README.md`, `READY`. It also writes
   `design/twin-dial/vr/references.json` (numbers only).

### Checks and limits

- **Concentricity** (verified): each ring fitted alone after rectification has its centre within 0.2 px (02),
  0.5 px (04) and 0.3 px (05) of the shared centre. Classic: up to 2.2 px.
- **Straight lines** (verified, 02): the rule above the bottom row is tilted −0.003° to the centre line and is
  straight to 0.11 px rms over 850 px. The tab bar's top edge: −0.11°, 1.9 px rms (the icons disturb the edge
  finder). In 04 the red rule under the car is −0.20°, 3.0 px rms (a thick, blurred line at 107 px/R). In 05 the rule
  under the title is +0.33°, 1.5 px. The 05 "tab bar top" value (−6.4°) is an edge-finder failure, not geometry.
- **Where the model is limited.** In 02 the display sits behind a curved cover glass and the phone lens is wide. The
  k1 term absorbs most of it: the plain homography leaves 1.04 px with a radial pattern. The residual 0.35 px is at the
  level of the ring-finding noise. Away from the dials (the top telltales, the frame outline) the k1 model is
  extrapolated: expect 1–2 px there (hypothesis). 04's bench unit may be tilted against the camera; there is no lens
  term (k1 would reach 0.43 px, under the 25 % rule).
- **Blur** (verified; dial px at R = 400, then source px):

  | ref | bezel FWHM L / R | outer-edge 10–90 % L / R |
  |---|---|---|
  | 02 | 8.6 / 9.3 (4.5 / 4.7 src px) | 2.6 / 3.2 (1.3 / 1.6 src px) |
  | 04 | 6.7 / 6.3 (1.8 / 1.6 src px) | 5.3 / 4.9 (1.4 / 1.3 src px) |
  | 05 | 8.6 / 9.2 (2.3 / 2.5 src px) | 3.8 / 3.6 (1.0 / 1.0 src px) |

  All three sources have an edge width of about 1–1.6 source px, so they are sharp at their own scale. Detail finer than
  about 400/107 ≈ 4 dial px is lost in 04 and 05. 02 resolves about 2 dial px.

## 3. Numbers the fits give directly (for VD, VF and VG)

These are verified as fits. The reading of what they mean is labelled.

| quantity | 02 | 04 | 05 | 01 (classic) | 03 (classic) |
|---|---|---|---|---|---|
| right bezel / left bezel | 0.9986 | 0.9983 | 1.0016 | 1.0018 | 1.0140 |
| inner disc rim radius, L / R (R) | 0.5450 / 0.5439 | 0.5315 / 0.5306 | 0.5313 / 0.5322 | 0.5339 / 0.5386 | 0.5477 / 0.5561 |
| centre distance D (R) | **3.875** | 3.796 | 3.625 | 3.595 | 3.875 |
| bezel line FWHM (R) | 0.021–0.023 | 0.016 | 0.021–0.023 | 0.017–0.018 | 0.016–0.017 |

- **Both dials are the same size** to 0.2 % in every facelift reference. Spec: equal radii. Uncertainty ±0.2 %.
- **The references disagree on the layout.** 02 and 03 (two different real cars, two generations) both give
  D = 3.875 R and an inner rim near 0.545 R. 04 and 05 give D = 3.80 and 3.62 R and an inner rim of 0.531 R.
  Hypothesis: 04 and 05 are a different unit or software (bench unit, seller image) rather than the car's own cluster.
  **Recommendation: VG takes D and the inner rim from 02 (cross-checked by 03), and takes the tachometer face (wedge,
  numerals) from 04, scaled by dial units.** 05 is for the look only, not for positions.
- The bezel line FWHM is an upper bound on the true line width (blur adds to it): about 0.016 R. 04 and 03 are the
  narrowest, so the true line is probably at or under that.
- R in source px is 107–298, so the references hold detail down to 0.004–0.01 R at best.

## 4. Web search (design/twin-dial/vr/web_search.json)

Generic terms only. Every candidate is recorded with its URL and licence under `bake/work/twin-dial/refs/<folder>/`
(untracked). Nothing was accepted:

- **Public media library** (20 queries, 36 interior photos from 2019–2023, CC BY-SA): every one is a whole-dashboard
  shot from the seat or the door. The cluster is under 150 px wide and oblique.
- **The maker's press-site search**: three studio photos at 4961 × 3721, all of the newer panoramic-display
  generation. Rejected and the pixels deleted.
- **Car-image galleries**: HTTP 403, or no image index reachable without a browser (forbidden here).
- **Owner's-manual diagrams**: none found. Press texts give the large cluster as 12.3 in, **1920 × 720 px**, and the
  small one as 1440 × 540. **Hypothesis for VG:** the references' large cluster has the G20 panel's pixel grid, so a
  rectified reference scaled to the right D maps almost 1:1 to panel pixels.
- The public sources are rate-limited (HTTP 429). A further pass is worth it only with a different source, such as
  owner photos from forums or video frames.

The night and warning states, and the reduced "small dials" view, were **not found** in any accepted source. 03 is
the only night frame, and it is the classic generation.

## 5. What is published (bake/work/twin-dial/pub/VR/, git-ignored)

- `<id>_rect.png` for 01–05. The dial frame at R = 400, 3070 × 1320 for 02. Magenta marks pixels outside the source.
- `<id>_valid.png`: where colour can be trusted.
- `<id>_model.json`: `H_src_to_dial` (OpenCV px to OpenCV px), `k1`, and the canvas with `left_centre`,
  `right_centre` and `centre_distance_R`.
- `index.json`: everything above per reference, with the verdicts.
- `README.md`: the conventions.
- `READY`: index version 2.

Conventions: OpenCV pixel centres; angles clockwise from 12 o'clock; dial units = (p − centre) / 400.

## 6. Open points

- Get a sharp frontal facelift frame with a tachometer, 04's layout or the car's own. Until then the tachometer face
  rests on 04 and 05 at about 107 px/R (hypothesis grade for anything under 0.01 R).
- Find out which layout the car's own facelift tachometer uses: 02's D = 3.875 R, or 04's 3.80 R.
