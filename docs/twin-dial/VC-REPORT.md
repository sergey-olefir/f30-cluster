# Package VC: colour, material, night

Tools: `tools/twin-dial/vc/` (`common.py`, `fit_dials.py`, `unwrap.py`, `profiles.py`, `texture.py`,
`materials.py`, `gradients.py`, `palette.py`). Numbers: `design/twin-dial/vc/palette.json`. Photo-derived
work files (unwraps, profiles, samples) are git-ignored in `bake/work/twin-dial/VC/`. The palette is published
to `bake/work/twin-dial/pub/VC/palette.json` (with `README.md` and `READY`).

Units: **linear light relative to the design's white text** (1.0 = panel code 255), with sRGB codes for
convenience. Dial positions are given in dial units (rho = 1 on the bezel's **centre line**, which is VR's
convention). Angles are degrees clockwise from 12. **Verified** means measured, with the references agreeing
within the stated uncertainty. **Hypothesis** means chosen between references that disagree, or not measurable.

## Method

1. **Geometry.** I started on the original references, using my own bezel ellipses (`fit_dials.py`: rays, the
   outer edge at half maximum, trimmed fit; 0.16 to 0.5 px rms on 02, 04 and 05). Once VR published
   (`pub/VR/READY`, index v1), everything was re-run in **VR's rectified frames** (`common.frame`). Every number
   below comes from VR's frames. The provisional ellipses set rho = 1 on the bezel's outer edge, about 1 % larger
   than VR's convention; none of their numbers remain.
2. **Polar unwraps** (`unwrap.py`) of each dial: theta -150..150 at 0.25 deg, rho 0.45..1.05 at 0.001 R, with
   VR's valid mask kept beside each one.
   - Flat materials use only valid pixels: no glare, no clipping.
   - Thin bright lines (bezel, rings, ticks, numerals) cannot use the mask, because it removes them. They are
     sampled as per-theta peaks over all pixels, and their clipped share is reported.
3. **Samples** (`materials.py`):
   - dial materials as rho and theta windows;
   - tab bar, texts, rules and red or green fills as boxes in original photo pixels.
   Per reference: black is the LCD surround; white is the 99.5th percentile of the big numerals (clipped on every
   reference). L = (Y - black) / (white - black).
4. **Shading, needle, centre** (`gradients.py`):
   - a log-linear fit of the band in rho and cos(theta);
   - the needle located automatically, with its cross-profile against the band 10 to 14 deg away;
   - the centre window's row profile.
5. **Texture** (`texture.py`): the band divided by a 6-deg running median per row. From that: relative rms,
   10th and 90th percentiles, spectrum along theta, and correlation lengths along rho and along theta.
6. **Palette** (`palette.py`): the choice per material, with the rule used, the measured values, the
   uncertainty, the G20 panel code and the night value.

## Which references count

| ref | what it is (VR) | used for | weight |
|---|---|---|---|
| 02 | facelift, in car, phone, daylight | structure, hues, shading shape | **lead**. The phone's tone curve lifts mid-greys (track 0.34 to 0.39 against 05's 0.20), and whites are clipped. |
| 05 | facelift, seller render or composite | levels (no camera curve), shading | high for levels. JPEG chroma subsampling desaturates thin reds. |
| 04 | facelift-style unit on a bench (aftermarket) | reds (wedge), needle | the band is flat (0.03), the tab bar is lit, and there is no track ring: **this unit differs from 02 and 05** |
| 01, 03 | classic generation | red hue check; night (03) | not used for facelift levels |

## Palette (day)

Uncertainty is a multiplicative factor on linear light: the spread of the references, or my judgement when
fewer than two references agree.

| material | linear RGB | sRGB | uncertainty | status | references (photo sRGB, L) |
|---|---|---|---|---|---|
| white text, numerals | 1, 1, 1 | 255 255 255 | x1.0 | verified | clipped on 02, 05 and 04 |
| bezel ring | 1, 1, 1 | 255 | x1.15 | verified | 02: 0.87, 79 % clipped. 05: 1.0, 95 % clipped. 04: 0.66, but only 1.6 photo px wide, so blur-limited |
| inner disc rim | 1, 1, 1 | 255 | x1.1 | verified | 02: 0.92. 04: 0.997. 05: 0.96 |
| ticks | 1, 1, 1 | 255 | x1.4 | hypothesis | peaks 0.60 (02) and 0.30 (05) on 1 to 2 px strokes; 04's track line 0.79 |
| track (lighter ring under the ticks) | .241 .251 .271 | 135 137 142 | x1.6 | hypothesis | 02: 0.39 / 0.34. 05: 0.20 / 0.19. 04: none (white line only) |
| gap between track and bezel | 0 | 0 | — | verified | L 0.001 to 0.002 |
| band, inner edge (rho 0.60, top) | .0096 .0100 .0108 | 25 26 27 | x1.7 | hypothesis | 02: 0.030. 05: 0.009. 04: 0.029 |
| band, mid (0.72, top) | .023 .024 .026 | 42 43 45 | x1.7 | hypothesis | 02: 0.077. 05: 0.014. 04: 0.028 |
| band, outer (0.88, top) | .079 .082 .089 | 79 81 84 | x1.7 | hypothesis | 02: 0.31. 05: 0.084. 04: 0.027 |
| band, outer at ±110° | .246 .257 .277 | 136 139 144 | x1.8 | hypothesis | fits: 02 0.44 to 0.52, 05 0.18 to 0.19 |
| band ends ("feet") | .116 .120 .130 | 95 97 101 | x2.0 | hypothesis | 05: sRGB 86 to 131. 02: 35 to 85 |
| hub disc, LCD surround | 0 | 0 | — | verified | L ≤ 0.003 everywhere |
| **red** (wedge numerals, red marks, red line) | .700 .005 .030 | 218 16 48 `#DA1030` | x1.3 | hue verified, level hypothesis | 04 numerals: 226 10 38. 02 tab: 175 14 44. 01: 243 6 10. 05: 176 70 77 (JPEG-desaturated) |
| red wedge fill | .077 .0006 .0033 | 78 2 11 | x1.6 | hypothesis | 04 only (79 3 14, which is 0.11 of the red); 02 and 05 draw no fill |
| red wedge edge, red bezel arc | = red | 218 16 48 | x1.3 | hypothesis | 04 edge, 05 bezel arc (blur-mixed peaks) |
| needle (lead: white) | 1, 1, 1 | 255 | x1.0 | verified | 02 and 04: core clipped, half-width at half maximum 1.0 to 1.5 deg at rho 0.75 (0.013 to 0.02 R) |
| needle (option: red) | = red | 218 16 48 | x1.3 | hypothesis | 05 and the classic 01/03 |
| needle glow | 0.02 x needle | 39 | x2 | hypothesis | none measurable on 02 or 04; 05 shows 0.02 to 0.03 of the core |
| needle shadow | multiply 0.85 | — | — | hypothesis | 02: the band is 10 to 15 % darker out to about 0.05 R beside the needle |
| tab body (ramp bottom) | .16 | 111 | x1.5 | hypothesis | ramp from 0.002 (top) to 0.16 (02) or 0.24 (05); 04 is lit (0.5), an outlier |
| tab rule (under the bar) | .85 | 237 | x1.15 | hypothesis | 05: 0.83 to 0.85. 04: 0.93 |
| tab highlight, warning (red) | .434 .003 .019 | 176 10 37 | x1.4 | hue verified | 02: 175 14 44. 04: 214 52 76 |
| tab highlight, selected (green) | .11 .42 .02 | 93 173 39 | x1.4 | hypothesis | 05 only |
| white rules (heading, bottom row) | .80 | 231 | x1.3 | hypothesis | 02: 0.73 and 0.98. 05: 0.31 to 0.91, all 1 to 2 px lines |
| secondary text | .77 (or white) | 227 | x1.3 | hypothesis | 05 small labels 0.77, trip 0.95; no distinct grey text level exists |
| green READY | .045 .33 .016 | 60 155 34 | x1.4 | hypothesis | 02 |

**Brightness relative to white text.** Every line element (bezel, inner rim, ticks, numerals, needle) is white.
The light greys are the track (about 0.25), the band's lit lower ends (about 0.25) and the tab bar's ramp bottom
(about 0.16). Everything else is below 0.1, and the hub and surround are black. Grey text appears nowhere: the
small labels in the references are white strokes that the blur dims.

## Gradients and vignettes

- **The scale band** is two separable ramps (02 and 05 agree on the shape; 04 is flat):

  `Y = 0.010 · exp(7.5 · (rho − 0.60)) · exp(−0.85 · (cos θ − 1))`, for rho 0.585..0.89.

  | | radial rate k_r (per R) | angular rate k_t | fit rms (log) |
  |---|---|---|---|
  | 02 | 7.8 to 8.4 | 0.66 to 0.90 | 0.42 to 0.44 |
  | 05 | 7.0 to 7.4 | 0.88 to 0.99 | 0.24 to 0.45 |

  - Outer against inner edge: ×8 in linear.
  - The lower ends (±110°) are ×3.1 brighter than 12 o'clock.
  - The tint is slightly cool (0.96, 1.0, 1.08): 05 is cool (B/G 1.15), 02 neutral.
  - The levels sit between 05 and 02, because 02 is lifted by the phone.
  - Hypothesis: the shape is consistent, the absolute level is uncertain by about x1.7.
- **The tab bar** is a vertical ramp, near black at the top to 0.16 at the bottom, roughly exponential
  (02: 0.002 → 0.16 over the bar's height; 05: 0.002 → 0.24). A white rule of about 0.85 sits under it.
- **The centre window** is black on 02 and 04. 02's lower haze is the steering wheel's reflection (glare, not
  design). 05 rises smoothly from 0 at the centre line to L 0.05 (sRGB 64) at +0.92 R: a "floor glow". It is
  offered as an option, not taken.
- **The band's ends** are lighter grey cut-outs (05: L 0.09 to 0.23), less clear on 02.

## Texture

**No texture is resolved in any reference (verified).**
- The band's relative modulation is 0.06 to 0.08 rms on 02 and 0.04 to 0.10 on 05.
- Its correlation length is 1 photo px along both rho and theta (0.005 to 0.009 R): isotropic, with no streaks
  and no period.
- That is the same as the noise floor on 05's black hub (0.03 to 0.06).
- 04 reads 0.11 to 0.28, which is LCD moiré and JPEG artefacts.

So any "grey texture" is finer or weaker than the photos can show. **Proposal (hypothesis):** either no texture,
or a fine isotropic grain whose two tones are band × (1 ∓ 0.04), with cells of 0.005 R or less (about 1.5 panel
px at R ≈ 300).

## Check against the G20 panel (strip round and bake P10)

- **Black floor.** The panel's black is F = 0.12 % / 0.09 % / 0.56 % of white in R / G / B: neutral in R and G,
  blue in B.
  - The darkest tinted materials reach the floor in blue. At the band's inner edge (target B 0.0108), the floor
    is 52 % of the target, so the dark band turns cooler on the car.
  - `palette.json` gives, per entry, the panel code that lands on the target after the floor is added:
    `srgb((L − F)/(1 − F))`. For the band's inner edge that is 23 24 16 instead of 25 26 27.
  - The red wedge fill's G and B are **below the floor** (unreachable). On the car it reads slightly purple:
    78 0 0 plus the blue floor. Either accept this, or raise the fill to about 0.15 of the red.
  - The hub and surround are 0, and the car shows its own black there.
- **Overexposure.** Phone photos of the G20 clip white text at about 0.92 and lift mid-greys. When a car photo of
  this theme is compared with the bench, compare the mid-tones only:
  - the band (0.01 to 0.25);
  - the track and the tab ramp;
  - the reds, which are not clipped at about 0.7.

  Do not judge the whites. The references have the same bias, which is why the track and band are taken nearer
  05 than 02.

## Night

**What the references show.** No facelift night frame exists: VR's `web` list is empty. 03 (classic generation,
at night) keeps white text white and the band dark (34 38 42). Its reds and needle photograph as orange (249 130
71) only because the R channel saturates, which is a camera effect, not a design tint. So the design keeps its
hues by night.

**Proposal (hypothesis).**
- No tint.
- A per-material multiplier in linear light, applied on top of the car's own backlight dimming
  (`statusDayNightChangeOver` / `destinationLCDLuminance`). It shapes contrast; it is not a second dimmer.

| group | multiplier | night sRGB |
|---|---|---|
| white text, numerals | 0.80 | 231 |
| bezel, inner rim | 0.70 | 218 |
| ticks | 0.75 | 225 |
| rules, tab rule | 0.70 | 197 to 203 |
| track | 0.55 | 102 104 108 |
| band | 0.6 (inner, mid), 0.55 (outer), 0.5 (lit ends) | 17 / 31 / 59 / 98 |
| tab ramp bottom | 0.55 | 84 |
| red | 0.85 | 203 14 44 |
| red wedge fill | 0.8 | 70 1 9 |
| green | 0.75 to 0.8 | 81 152 33 |

Glare in a dark cabin comes from the large lit areas (the band's lower ends, the track), so those drop most.
Warnings (red) barely drop. This fits `shared/hud.js`'s night-look mechanism: one colour transform, with no
layer rebuilt.

## Open points

- The absolute band and track levels: 02 and 05 differ by about x2. A car photo of a test patch at fixed
  exposure settles it (P10 §8 asks for the same photo).
- A white needle (02, in car) or a red one (05, render): the spec should take white and offer red.
- Whether the facelift draws a red wedge fill (04 only) or a red bezel arc (05): both are listed.
- Night: there is no facelift reference. Treat the table as a proposal.
