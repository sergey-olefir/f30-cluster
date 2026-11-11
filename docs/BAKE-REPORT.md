# 6WB bake: integration readiness (P9)

Brief: `docs/AGENT-BRIEF-bake-6wb.md`. Per-cluster detail: `bake/report/<cluster>.md`. Numbers: `bake/work/P9/p9_results.json`.
Proposed scene: `bake/manifest/P9-composition.json`. **Nothing is wired into the theme.**
All links below point into `bake/work/` (git-ignored, local). Run the regenerate commands at the end to rebuild them.

## 1. Summary

The fits are for the whole composed panel: every layer of every package over the C10 background, cut to the cluster. "Delivered" means every file in `apps/f30_cluster/hud/baked/<cluster>/`. "Proposed" means the package's composition, after the P9 decisions below.

| Cluster | Layers (entries) | baked / procedural / dynamic | Delivered files, w·h·8 | Proposed images, w·h·8 | Best fit in the stack (SSIM / ΔE / edge px) | Worst fit in the stack |
|---|---|---|---|---|---|---|
| C1 speed dial (P1) | 12 | 6 / 6 / 0 | 7 files, 4.32 MiB | 2 (base + glow), 1.51 MiB | vs 05 mirrored, inside 0.79 R: 0.739 / 2.68 / – | vs 17: 0.194 / 22.2 (veiling glare) |
| C2 rev dial (P2) | 17 | 7 / 10 / 0 | 8 files, 3.54 MiB | 1 (static), 0.82 MiB | vs 05: 0.657 / 4.86 / 4.36 | vs 17: 0.210 / 16.9 |
| C3 fuel mini (P3) | 7 | 7 / 0 / 0 | 8 files, 0.54 MiB | 1 (merged), 0.16 MiB | vs 04: 0.630 / 6.12 / 1.56 | vs 17: 0.204 / 21.6 |
| C4 oil mini (P3) | 7 | 7 / 0 / 0 | 8 files, 0.58 MiB | 1 (merged), 0.16 MiB | vs 04: 0.562 / 5.62 / 1.57 | vs 17: 0.252 / 15.8 |
| C5 window (P4) | 2 | 2 / 0 / 0 | 2 files, 0.65 MiB | 2, 0.65 MiB | vs 17: 0.778 / 7.92 / 3.78 | vs 07: 0.606 / 18.6 (level, §3.3) |
| C6 bar + arcs (P4) | 8 | 6 / 0 / 2 | 6 files, 0.98 MiB | 6 assets, 0.98 MiB | range arc vs 07: 0.618 / 8.84 / 3.23 | ED arc vs 17: 0.349 / 14.1 / 2.75 |
| C7 signs + icons (P5) | 9 | 9 / 0 / 0 | 9 files, 0.19 MiB | 2 icons, 0.04 MiB (signs stay WBSIGN) | signs alone (P5): edge 0.63 px | pictograms: edge 1.1–2.0 px |
| C8 Sport (P6) | 9 | 7 / 2 / 0 | 7 files, 1.97 MiB | 3, 1.65 MiB | speedo band, opacity 0.30, real stack: 0.858 / 4.10 | wings with the window as delivered: 0.045 / 33.1 |
| C8 Eco Pro (P7) | 16 | 6 / 5 / 5 | 7 files, 2.17 MiB | 4, 0.89 MiB | speedo parts: 0.579 / 7.53 / 4.63 | tacho parts, P0 crops: 0.342 / 16.5 / 4.71 |
| C9 housing + overlays (P8) | 12 | 0 / 1 / 11 | none (documentation only) | 0 | – | – |
| C10 background (P8) | 1 | 1 / 0 / 0 | 1 file, 2.64 MiB | 0 (fold into WBBACK) | P8: 0.869 / 0.86 on 02 | – |

**Budget per mode for the proposed scene.** These are baked assets only, w·h·8, with C10 folded into WBBACK.

| Mode | Baked | Budget per mode | + current theme (re-counted) | Budget in total | Layers, asset route | Layers, image route |
|---|---|---|---|---|---|---|
| Comfort | **4.31 MiB** | ≤ 8 ✓ | 7.36 MiB | ≤ 16 ✓ | **20** (8/6/6) | 29 |
| Sport | **5.96 MiB** | ≤ 8 ✓ | 9.07 MiB | ≤ 16 ✓ | 13 | 25 |
| Eco Pro | **5.20 MiB** | ≤ 8 ✓ | 8.05 MiB | ≤ 16 ✓ | 15 | 28 |

If every mode is preloaded, the baked assets total 6.85 MiB. With the Comfort theme on top that is 9.91 MiB. Sport-specific bases (§3.6) would add 1.68 MiB.

Comparison with the current theme (A/B, same refs and ROIs): our stack scores SSIM 0.61–0.66 and ΔE 4.8–5.3 on C1/C2 against 04/05. The current WBDIAL scores 0.23–0.32 and ΔE 5.7–8.7. On the minis it is 0.56–0.63 against 0.17–0.26.

## 2. Previews and QC sheets

These show our layers only: no numerals, needle or live text.

- Comfort: [preview_comfort.png](../bake/work/P9/preview_comfort.png). With the proposed window gain: [preview_comfort__window-gain.png](../bake/work/P9/preview_comfort__window-gain.png).
- Sport: [preview_sport.png](../bake/work/P9/preview_sport.png), at the default opacity 0.48 and with individual layers.
  - [__level03](../bake/work/P9/preview_sport__level03.png): band 0.30 and bridge 0.28.
  - [__comfort-bases-reused](../bake/work/P9/preview_sport__comfort-bases-reused.png).
  - [__window-gain](../bake/work/P9/preview_sport__window-gain.png).
- Eco Pro: [preview_eco.png](../bake/work/P9/preview_eco.png) and [__window-gain](../bake/work/P9/preview_eco__window-gain.png).
- Stacks, giving the exact order, file, position, opacity and tint of every preview layer: `bake/work/P9/stack_<mode>.json`.
- QC sheets. Each sheet shows the reference, ours and the diff at 2×. The folder holds 99 sheets, named `bake/work/P9/qc_<variant>.<cluster>__<ref>.png`. Key ones:
  - C1: [vs 05 mirrored](../bake/work/P9/qc_comfort.C1-mirrored-079__05_comfort_tach-closeup.comfort.C2.png), [vs 04](../bake/work/P9/qc_comfort.C1__04_comfort_whole-cluster_mph.comfort.C1.png).
  - C2: [vs 05](../bake/work/P9/qc_comfort.C2__05_comfort_tach-closeup.comfort.C2.png).
  - Minis: [C3 vs 04](../bake/work/P9/qc_comfort.C3__04_comfort_whole-cluster_mph.comfort.C3.png), [C4 vs 04](../bake/work/P9/qc_comfort.C4__04_comfort_whole-cluster_mph.comfort.C4.png).
  - Window: [C5 vs 17](../bake/work/P9/qc_comfort.C5__17_physical-cluster_full.comfort.C5.png), [C5 vs 04 with the gain](../bake/work/P9/qc_comfort-wingain.C5__04_comfort_whole-cluster_mph.comfort.C5.png).
  - Arcs: [range arc vs 07](../bake/work/P9/qc_comfort.C6-range__07_physical-cluster_all-lamps-lit.comfort.C1.png), [ED arc vs 17](../bake/work/P9/qc_comfort.C6-ed__17_physical-cluster_full.comfort.C2.png).
  - Sport: [band C1](../bake/work/P9/qc_sport-level03.C1-band__03_three-modes_photo_bimmerstop.sport.C1.png), [C2](../bake/work/P9/qc_sport-level03.C2__03_three-modes_photo_bimmerstop.sport.C2.png), [bridge with the gain](../bake/work/P9/qc_sport-level03-wingain.bridge__03_three-modes_photo_bimmerstop.sport.PANEL.png).
  - Eco Pro: [C2](../bake/work/P9/qc_eco.C2__03_three-modes_photo_bimmerstop.eco.C2.png), [C1](../bake/work/P9/qc_eco.C1__03_three-modes_photo_bimmerstop.eco.C1.png).
  - A/B against the current theme: [C1 vs 04](../bake/work/P9/qc_AB_bench.C1__04_comfort_whole-cluster_mph.comfort.C1.png), [C2 vs 05](../bake/work/P9/qc_AB_bench.C2__05_comfort_tach-closeup.comfort.C2.png).

## 3. Reconciliation decisions

### 3.1 Light model (P1 vs P2): consistent once mirrored; one model for both dials

I measured each dial in its own frame (`bake/src/P9/light.py`). On photos that show both dials, I correlated the speedo's bezel-ridge profile with the tacho profile taken as is ("same light") and mirrored θ → 360−θ ("mirrored").

| Photo | Ridge corr, same / mirrored | Speedo lobes (cw12) | Tacho lobes (cw12) | Groove-rim key, speedo / tacho (math °) |
|---|---|---|---|---|
| 04 | 0.22 / **0.93** | 23, 219 | 337, 139 | 39 / 137 |
| 06 | 0.20 / **0.99** | 23, 221 | 337, 145 | 38 / 96 |
| 03 | 0.80 / **0.91** | 213, 29 | 337 (weak), 197 | noise |
| 17 | 0.24 / **0.67** | 89, 157, 7 | 271, 139, 29 | 117 / 57 |
| 02 render | 0.51 / 0.54 | 329, 23 | 275, 63 | 97 / 74 |
| 05 tacho only | – | – | 337, 127 | – / 131 |

**What the measurements show:**
- **The bezel gloss mirrors between the dials** in every real photo.
- **P1 and P2 describe the same gloss.**
  - P1's speedo lobes are at 8° and 232°. Mirrored, those are 352° and 128°.
  - P2's tacho lobes are at 340° and 148°.
  - The two agree to 12–20°, which is inside the lobe widths (σ 22–32°).
- **The two key angles are what disagree.** P1 gives a key of 115° for the speedo and says to use 65° on the rev dial. P2 gives 125° for the rev dial.
- **The groove-rim key is not stable across photos.**
  - 04 and 06 light the window side; 17 lights the outer side.
  - Where both dials can be measured (04, 17), the rim direction is also mirrored, not shared.
  - The photos average out to about straight up (math ~90°).

**Decision: one mirror-symmetric model.**
- **Bezel gloss:**
  - Narrow lobe at cw12 **22°** on the speedo and **338°** on the tacho (σ 22°, gain 0.42).
  - Broad lobe at cw12 **219°** on the speedo and **141°** on the tacho (σ 32°, gain 0.72).
  - Base 0.26.
  - A third lobe toward the window (90° on the speedo, 270° on the tacho) appears only in the bench photos 17 and 07. Leave it **off**; it is weak evidence.
- **Groove rims and tube edges:** key at math **90°** on both dials, with ±35 % modulation. A vertical key is mirror-symmetric by construction, and it is the mean of the photos. Neither "upper left" (P2) nor "115/65" (P1) is supported across the photo pairs.
- **Nothing needs re-baking.** The bezel and rims are procedural in both packages (shader uniforms). P1 moves its lobes by +14° and −13°; P2 moves its lobes by −2° and −7°.

### 3.2 Pictograms (P3 vs P5): P5's set, placed inside P3's mini images

Both sets were placed over P3's own face and bezel and compared on the same ROIs (ignore bits 15):

| Ref / gauge | P3 (SSIM / ΔE / edge) | P5 (SSIM / ΔE / edge) |
|---|---|---|
| 04 C3 | 0.587 / 6.8 / 0.91 | 0.464 / 10.1 / 0.89 |
| 04 C4 | 0.418 / 8.7 / 1.40 | **0.489 / 7.4 / 1.18** |
| 17 C3 | 0.119 / 29.7 / 1.56 | **0.195 / 25.7 / 1.11** |
| 17 C4 | 0.107 / 22.7 / 1.95 | 0.092 / 24.5 / 1.97 |
| 07 C3 | 0.231 / 21.1 / 2.07 | **0.325 / 15.0 / 1.60** |

**Decision: use P5's set.**
- P5 has the better edge error in 4 of 5 cases and the better SSIM in 3 of 5.
- Its icons are SVG-backed and share one style with the other C7 icons.
- P3 itself labels its pictograms "a simple rendering; the standalone icon set is P5's".

**How:** re-merge P3's layers without `fuel.pictogram` / `oil.pictogram`, with `mini.fuel-pump` / `mini.oil-can` instead. This is the same 144×144 image, so the memory does not change. The P9 previews already do this in memory. P3's `*.static.merged.png` must be regenerated that way; I did not edit P3's files.

The P5 pump on 04 is a bit bright (luma bias +9.8), so dim it to about 0.85.

### 3.3 Window level (P4) vs face levels (P1/P2): inconsistent; gain about 0.24

I compared window-background luma with face luma inside each photo. The crops were exposure-normalised, with one black and gain per photo, so each ratio is the photo's own.

| Photo | Face | Window bg | Floor | Window / face |
|---|---|---|---|---|
| 17 (hazed) | 63.1 | 51.0 | 112.6 | 0.81 |
| 04 | 7.3 | 17.4 | 46.1 | 2.39 |
| 07 | 19.7 | 25.5 | 147.7 | 1.29 |
| 06 | 15.2 | 24.8 | 43.8 | 1.63 |
| 03 | 6.4 | 2.9 | 27.2 | 0.46 |
| 02 render | 7.3 | 4.0 | 37.6 | 0.55 |
| **Ours, as delivered** | **8.4** | **51.3** | **110.7** | **6.10** |

**Why the window is too bright:** P4 took absolute levels from 17, where veiling glare lifts the face to luma 63. P1/P2 took their face levels from 05 and 04. In our panel, the window is therefore about 4× too bright for our faces. The previews show it plainly.

**Proposal:** a code-value gain of **0.24** on `window.base`, `window.horizon` and `infobar.line`. Not on the dark `infobar.body`.
- The gain is the median ratio of the real photos (04, 07, 06, 03 → 1.46) divided by ours.
- After the gain, the window bg is 12.3 and the floor 26.5 against a face of 8.4.
- The photos themselves span gains of 0.08–0.39, so this needs the user's eye or a car photo (Q3).

**Effect in QC:**
- C5 vs 04: SSIM 0.52 → 0.66, ΔE 16.3 → 8.4.
- Sport bridge vs 03: SSIM 0.24 → 0.61, ΔE 19.5 → 5.2.
- Sport wings: ΔE 33 → 14.
- C5 vs 17 and 07 get worse (17 is hazed; 07 is lit from behind on a bench).

**How to apply it:** as a uniform in the sampling shader, or ask P4 to re-fit its levels anchored to the face (better).

### 3.4 Gear letter vs the ED arc (P4): accept, and mask inside BMW's box

I measured the overlap on the composed panel:
- `tacho.ed-arc.track` puts **60 px** inside `GEAR_P` (visible.js) and **8 px** inside P8's measured letter box. These are only the outer tips (y 664–672, x 1410–1427) of the "0" major and its two neighbours.
- Most of what sits under the letter is the face and the bezel, which are fine to cover.

**Decision:**
- Keep the measured ED-arc geometry; rotating it would break its fit.
- The tacho shader skips the arc's track and fill inside `GEAR_P` + 2 px. The "0" major loses about 8 px of its outer tip.
- BMW's letter draws on top anyway. Masking avoids half-covered segments showing around the glyph.

### 3.5 Sport and Eco opacity and tint defaults

**Sport.** I re-ran the QC that P6 could only run on a flat stand-in face, this time with the real P1/P2 stack and the `sport_shared_layers` opacities:

| Sport vs 03 | Opacity 0.48 (default) | Opacity 0.30 (03 level) | P6 stand-in, opacity 0.30 |
|---|---|---|---|
| Speedo band (0.45–0.88 R) | 0.817 / 7.72 | **0.858 / 4.10** | 0.855 / 3.51 |
| Tacho band | 0.793 / 6.80 | 0.782 / 5.29 | 0.841 / 3.93 |
| Whole C1 / C2 (0–0.97 R) | 0.729 / 7.71 · 0.616 / 7.77 | 0.748 / 6.03 · 0.605 / 7.62 | – |
| Bridge (with the window gain) | – | 0.607 / 5.22 | 0.697 / 3.26 (alone) |

**Decision for Sport:**
- Default band opacity **0.35**, bridge **0.30**. This sits between 03 (0.30, the only good-alignment photo, best QC) and 01 (0.48). It also makes up for our faces being slightly darker than P6's stand-in.
- 02 (0.92) is a render, so it is not used.
- The shared-layer opacities stay as P6 set them (ticks, groove, inner disc, inner ring and hub ring at 0).
- **P9 addition:** `speedo.soft-glow` and `tacho.tick-spots` also go to 0. They are the tick and ring halos, and their sources are hidden in Sport.

**Eco Pro.** Keep P7's `eco.tint-shared`:
- face gain (0.55, 0.60, 0.80)
- ticks ×0.61
- groove rim (0.46, 0.52, 0.62)
- hub ring recoloured to (0.30, 0.34, 0.49)

The evidence for it is mixed:
- **Tint vs no tint:** C1 vs 03 eco improves (ΔE 8.29 → 7.71), but C2 vs 01 drops (SSIM 0.396 → 0.320). 01 is a 447 px image, so it carries little weight.
- **P0 crops vs P7's own:** the tacho Eco parts score SSIM 0.34 / ΔE 16.5 on P0's crops, against P7's 0.76 / 6.1 on its re-centred crops. The parallax P7 measured, 0.01–0.05 R, explains most of the gap.

Two Eco items are unresolved:
- **Eco tint delivery:** image layers have only opacity, no tint. The tint therefore needs either the asset route (§4) or Eco-specific re-merged bases.
- **Comfort red zone under the Eco band:** the Comfort red zone and OFF arc still show under the Eco band (90–135° cw12). Open question Q10.

### 3.6 Further decisions found while composing

- **Sport cannot reuse the Comfort merged bases.**
  - `speedo.base` has the tick groove baked in; `tacho.static` has the inner disc and the tick spots baked in.
  - With the Comfort bases reused, the speedo's outer ring (0.86–0.97 R) vs 03 sport drops from SSIM 0.762 to 0.538.
  - **Decision:** Sport loads its own re-merged bases, built from the same P1/P2 layers with the Sport opacities. They are the same size and replace the Comfort bases in the Sport layout, so the Sport total does not change; preloading all modes adds 1.68 MiB.
  - On the asset route, a shader uniform could instead zero a separate groove asset; that costs about the same memory.
- **The speedo has no hub ring.** P1 classed it as dynamic and did not deliver it; P2 delivers a procedural one (0.128 R). **Decision:** procedural in both dial shaders, using P2's numbers mirrored. The glow state stays dynamic.
- **BMW's black area hides the tacho hub.** It covers the whole tacho hub ring (3,323 px) and the hub well on the G20. Everything we draw at r < ~0.3 R around the rev hub is invisible. Keep it for parity with the speedo, but spend no effort there.
- **Window chamfers.** They run under the dial bezels (x 657 / 1263). The dial faces are opaque there, so the composition is clean. Keep them.

## 4. Proposed composition per mode (not applied)

**Recommended: the asset route.** Every baked file becomes an RGBA8 *asset* (`cluster_render_client.asset`), sampled by the effect layers the theme already has. hud.js counts assets as pixel memory (w·h·bpp·2), not as layers. Inside one shader the original z order is kept, and Eco tints and Sport opacities are uniforms.

**Current theme**, re-counted from `apps/f30_cluster/hud/layouts/wb_comfort.json`: I re-implemented `shared/hud.js` `_plan()` read-only (`bake/src/P9/budget.py`).
- **HEAD:** 45 widgets, **21 layers**: 7 effects plus 14 text and icon sheets, **8 / 6 / 7 on connections 0 / 1 / 2**, **3.06 MiB**.
- **The brief's "18 layers, ~4.3 MiB"** matches older versions: c117c76 had 18 layers and 3.8 MiB; eefecfd had 4.38 MiB.
- **Other layouts:** wb_sport has 13 layers and 3.12 MiB; wb_eco has 15 layers and 2.85 MiB.

| Existing layer | What it samples / replaces in Comfort | Assets | w·h·8 |
|---|---|---|---|
| `speedo` WBDIAL | face gradient, groove, floor shade, hub well, tick and ring glow → `speedo.base@0.5x` + `soft-glow@0.5x`, range arc track + mask, P2's hub ring mirrored. Crisp ticks, rings, bezel and the 3.1 light model stay as shader code. | 4 | 2,012,816 |
| `tacho` WBDIAL | face, shadows, inner disc, floor, tick spots → `tacho.static@0.5x`, ED arc track + mask, battery icon. Crisp parts, red zone, OFF arc, P box and hub ring stay as shader code. | 4 | 1,303,712 |
| `fuel` / `oilt` WBDIAL mini | the mini face, bezel, ticks and zones → `fuel/oil.static.merged` (with P5 pictograms); the needle stays in the shader | 2 | 331,776 |
| `bg` WBBACK | window base, horizon, bar body and line, range icon; C10 as 4 numbers | 5 | 866,584 |
| `signs` WBSIGN | P5's new numbers (r 0.1248 R, field 0.811, centres ±0.1823 R, 0.3777 R below the hub) | 0 | 0 |
| `fuel_icon`, `oil_icon`, `range_icon` widgets | removed; now drawn by the assets. `oil_icon` had its own sheet, so that layer goes. | – | −6,240 |

- **Comfort:** 15 assets, 4.31 MiB, **20 layers (8 / 6 / 6)**.
- **Sport:** Comfort + 3 assets (2 bands, bridge) + Sport bases in place of Comfort's = 5.96 MiB. The wings and hairlines are WBBACK / WBDIAL code; same layer count.
- **Eco Pro:** Comfort + 4 assets (eco-static, 2 glows, speedo eco-arc) = 5.20 MiB. The fill, marks and thin ring are shader code; same layer count.

**Caveats on the asset route:**
- The eco glows' tails reach 7 px outside the dial effect boxes (690–754 vs 77–747; 1166 vs 1173). Clip them, or draw them in WBBACK.
- Up to 4 samplers per shader (GLSL ES 1.00 guarantees 8).

**Fallback: the image route.** These are the packages' own proposals, with image layers.
- **New layers:** C1 +2, C2 +1, C3 +1, C4 +1, C5 +2, C6 +2 arc effects; Sport +3; Eco +4.
- **Comfort: 29 layers.** That is within 32, but connection 0 is already full, so the new layers must go on connections 1–3 (2 + 1 + 8 free). It fits, with no headroom.
- **Eco tint and Sport hiding** then need per-mode re-baked bases.

**Cuts, if anything has to give:**
1. C10 must stay procedural. As a bitmap it puts Sport at 8.6 MiB (> 8); at @0.25x it costs 0.66 MiB.
2. Merge each C6 arc's track and mask into one data texture: −0.43 MiB.
3. Drop the separate `speedo.soft-glow` asset by baking it into the base: −0.65 MiB. This loses Sport's ability to hide it, unless Sport gets its own base anyway.
4. Do not preload modes: the per-mode layouts already rebuild.

## 5. Open questions

[U] = the user decides. [C] = a car photo or a bench test on the car settles it.

1. [U][C] Sport default level: band and bridge opacity 0.35 / 0.30 (proposed) vs 0.48 (P6 default). The references disagree by 3×.
2. [U] Sport red hue: (236, 35, 35) vs the desaturated photos; also the hub's red glow (01/02 only) and red ticks (02 only). Both are currently off.
3. [U][C] Window gain 0.24 (photos span 0.08–0.39), or have P4 re-fit to 04/07 anchored to the face.
4. [U] Window chamfers: keep them running under the dials (x 657/1263), or start them 0.84 R from the dial centres (x 694/1226) as the 6WB does?
5. [C] Eco: which signal drives the CHARGE/POWER fill bounds? Is the Eco speed arc's end 130 km/h?
6. [U] Curved live text (CHARGE, POWER, EfficientDynamics): can the text widget set text on an arc, or should glyphs be pre-rotated?
7. [C] Eco tint strength (face gain, ticks 0.61): only 03 measures it.
8. [U] Sign placement: level and symmetric (proposed) or tilted −1.7° as in 12? Three-digit limits need a condensed font.
9. [U] C4: oil temperature (04, 17, 07) or coolant (02)? Both are delivered.
10. [C] Eco: are the Comfort red zone, OFF arc and ticks hidden under the CHARGE/POWER band? They overlap at 90–135° cw12.
11. [C] Minis: does the needle pivot at the bezel centre or the scale centre (+0.046 R)? Is "1/1" text or a double tick?
12. [U] Minis: keep the bezel gap on the main-dial side (faithful) or close the ring (the G20 minis don't touch the dials)?
13. [C] Tick ring, arcs and Eco face sit 0.01–0.05 R off the bezel centre in 03/04/05/17: parallax, or a real offset? Everything is drawn concentric.
14. [C] Red-zone band: inner (17) or outer (05)? OFF-arc radius and OFF mark (17 only)?
15. [U] The cyan fringe on the ticks (probably lens CA): keep it faint (0.35) or set 0?
16. [U] Range-arc tick style: 17 (long ends and centre) or 07 (long quarters)?
17. [C] Are the stock telltales (AUTO H overlaps the rev bezel by ~14 px) and the check-control panel drawn over a custom theme? Does the black area always appear?
18. [U] `shared/visible.js` BLACK_BOX right edge is measured at 1611, not 1597. Change it? The path is forbidden here.
19. [U] Relightable (separate shadow/highlight/glow layers, about +3.5 MiB) or the merged bases (proposed)?
20. [C] Asset route: confirm on the car that sampled RGBA8 assets do not count toward the 8 layers per connection, and that 4 samplers per effect work.
21. [U] Sport and Eco layouts still use the OLD geometry (R 290 at 496/1424). Move them to the G20 Comfort geometry the bakes use, or re-bake at R 290? The code is parametric in R.
22. [U] `bar.warning`: draw it only if the theme gets its own check-control row?

## 6. Weak evidence

- **C1:** floor-shade (α 0.45; refs disagree), hub-well (α 0.30), groove rim radius (0.795–0.815).
- **C2:** inner ring (0.33 R), floor edge, hub well, the left bezel lobe, OFF mark, red-zone band position, cool fringe.
- **C3/C4:** both pictograms, the 04 C4 inner arc (SSIM 0.01), the "1/1" mark.
- **C5/C6:** the floor's side walls, the unlit arc segment colours, the arcs' centring.
- **C7:** coolant icon (02 only), amber warning triangle.
- **C8 Sport:** default level (3× spread), tacho hairline pitch, wing violet tint (not used).
- **C8 Eco:** thin ring, fill bounds, ED ticks (pitch assumed), the 0° split, tint strength, Eco speed.
- **C9:** glass reflections, telltale columns, check-control.
- **C10:** the cool halo (02 only).
- **P9:**
  - **Light model:** the groove-rim direction (photos disagree).
  - **Window gain:** a spread of 0.08–0.39.

## 7. Issues with P0 and the shared tools (from the packages, deduplicated)

- **`qc.run()` without `out_dir`** writes its sheets to `bake/work/<cluster>/`, which can be another package's folder (P4, P7). P9 always passes `out_dir`.
- **README `$PY`** does not word-split in zsh (P4). Use a wrapper: `bake/src/P9/py.sh` or `bake/src/C8-sport/py.sh`.
- **`validate_manifest.py`** does not count composition files (P2).
- **The banding check** gives false positives next to thin features and on steep ramps (P3, P7).
- **Masks:**
  - The minis have no needle or text masks (P3); PANEL crops have no text mask (P4).
  - Glare bit 2 is wrong on 12: it flags the white sign fields (P5).
- **Alignment:**
  - 03 C1 centre off by a few px; 12 C1 roll +1.67° (likely wrong, P5); 13 groove ~1.5 % large (P1).
  - 07 C4 is misaligned by 4–5 px (P3, P5); 07 C2 is poor (P4).
  - 08 rectification is degenerate (P8 re-derived it in `C9/align08.py`); 11's 4-point fix is off by up to 15 px at the bottom; 10 has a local error of 1–3.3 px.
  - Per-dial alignment does not fit the face features: parallax of 0.01–0.05 R (P7).
  - 01 wing positions are off by ~0.13 R (P6).
  - The 6WB PANEL crops do not put the dials at our positions (P8).
- **`p0/overrides.json`** exists now; P6 reported it missing at the time.
- **17 is hazed** (face luma 52–72). Its absolute levels are not targets, and that is the source of the window-level conflict.
- **New in P9:**
  - **The brief's "18 layers / 4.3 MiB"** is out of date; HEAD is 21 / 3.06 MiB.
  - **QC refs disagree with each other:** the P1/P2 stack scores are limited by edges (3.8–4.9 px). The cause is blur, numerals and the needle in the refs, not drawing errors (see the per-element fits).

## 8. Per-element table (condensed; full tables in `bake/report/<cluster>.md`)

| Cluster | Element | Class | Evidence | Fit (own ref) |
|---|---|---|---|---|
| C1 | face / face-shadow / floor-shade / groove / hub-well → base | baked @0.5x | strong / ok / weak | base vs 04: 0.804 / 2.26; hub-well 0.92 |
| C1 | soft-glow | baked @0.5x | ok | 0.245 (tick blur) |
| C1 | ticks, groove rim, disc, ring, floor lip, bezel | procedural | strong–ok | edges 2.7–4 px (photo blur) |
| C2 | face, shadows, disc, floor, hub well, tick spots → static | baked @0.5x | ok | floor 0.92, disc 0.88, hub-well 0.93 |
| C2 | ticks, groove, red zone, OFF arc, disc rim, ring, P box, hub ring, bezel | procedural | ok–weak | 13 @4x ring: 0.77 / 5.4 / 1.20 px |
| C3/C4 | face, bezel, ticks, zones, inner arc (+ pictogram) | baked, merged 1x | ok / weak | 0.71 / 0.58 vs 04; edges < 1 px |
| C5 | window base, horizon | baked | ok | base 0.968; stack vs 17: 0.901 / 2.43 |
| C6 | bar body and line, range arc, ED arc (fills dynamic) | baked / dynamic | ok / weak | edges 1.15–2.27 px |
| C7 | signs (WBSIGN numbers), pictograms | procedural / baked | ok | signs 0.63 px; icons 1.05–2.5 px |
| C8 Sport | bands, bridge (wings, hairlines procedural) | baked / procedural | ok / weak | band 0.858 / 4.1 in the real stack |
| C8 Eco | eco-static, glows, speedo arc (fill, marks, ring procedural) | baked / procedural / dynamic | ok / weak | P7: tacho 0.76 / 6.1, speedo 0.72 / 3.8 |
| C10 | background | → WBBACK params | ok / weak halo | 0.869 / 0.86 |

## 9. Risks

- **Level mismatches between packages.** The window is the clear case (§3.3). Faces come from 05/04, the window from 17, Sport and Eco from 03. Check one car photo of our own render against 04 before tuning further.
- **Mode switching.** Sport needs its own bases and Eco needs tints. Plan for per-mode assets (asset route) from the start.
- **Asset-route assumptions are unverified on the car:** that assets are not layers, the sampler count, and memory at w·h·8 for RGBA8 assets.
- **Layer headroom.** On the image route Comfort reaches 29 of 32, and connection 0 is already at 8.
- **Geometry.** Sport and Eco layouts still use R 290 / OLD geometry. Every bake assumes the G20 Comfort geometry (R 335).
- **BMW overlays** hide the tacho hub (black area) and the ED arc's "0" tip (gear letter). Whether the stock telltales draw over a custom theme is unknown.
- **Weak references for Sport and Eco:** one good photo each (03). A 3× spread in Sport brightness.

## 10. Regenerate (in order)

Run from `bake/src`. Any of the wrappers works, because each one changes to `bake/src` and sets `UV_CACHE_DIR`:

```sh
cd /Users/solefir/projects/f30-cluster/bake/src
PY=./P9/py.sh            # = UV_CACHE_DIR=../work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python
$PY -m p0.run                                   # P0: refs.json, rect crops (~1 min)
$PY -m C1.build                                 # P1 (~25 s): C1 files, bake/work/C1/proc/ (P9 needs it)
$PY -m C2.build                                 # P2 (~35 s): C2 files, bake/work/C2/proc/ (P9 needs it)
$PY -m C3.build && $PY -m C3.qc_run             # P3: C3 + C4
$PY -m C5.refs                                  # P4, once
UV_CACHE_DIR=../work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with pillow --with scipy python -m C5.fit   # P4, once
$PY -m C6.build --all                           # P4: C5 + C6
$PY -m C7.build                                 # P5
./C8-sport/py.sh C8-sport/build.py              # P6 (writes the hairline rasters P9 uses)
$PY C8-eco/fit.py && $PY C8-eco/build.py        # P7 (~2 min + 8 s; writes the ROI masks P9 uses)
$PY -m C9.build && $PY -m C10.build             # P8
$PY -m P9.run                                   # P9 (~40 s): bake/work/P9/*, bake/manifest/P9-composition.json
$PY validate_manifest.py ../manifest/C1.json    # any package manifest
```
