"""Adopted parameters of the Sport (C8 Sport) parts, in dial-R units / cw12 degrees, with their sources.

Fits (re-run to check): fit_band.py (band radial profile), fit_wing3.py (wing centreline), measure_wings.py,
measure_mid.py, measure_bridge.py. Numbers marked "03" come from 03_three-modes_photo_bimmerstop (sport panel,
alignment good 0.63 / 0.54 px), the best-aligned real photo of Sport; 02 (clean render) has other proportions
(disc 0.568 R, floor 0.134 R) and is used for colour / profile cross-checks only; 01 is 5.8x upsampled (weak).
"""

# Colours (sRGB 0..1). The layers are emissive glows over a near-black face: colour * alpha.
TINT = {
    "default": (236 / 255, 35 / 255, 35 / 255),   # photos 03 / 01: G/R 0.18 / 0.11, B/R 0.16 / 0.14 above the face
    "02_render": (236 / 255, 0.0, 4 / 255),        # 02: pure red (G/R 0.0, B/R 0.02)
    "theme_accent": (236 / 255, 22 / 255, 26 / 255),  # shared/hud_themes.js wb_sport accent
}
WHITE = (1.0, 1.0, 1.0)

# Layer opacity that reproduces each reference's level (the files are baked with peak alpha 1.0).
OPACITY = {
    "band": {"03": 0.30, "01": 0.48, "02": 0.92, "default": 0.48},
    "bridge": {"03": 0.28, "01": 0.80, "02": 0.75, "default": 0.48},
    "wing": {"03": 1.0, "01": 1.0, "02": 1.0, "default": 1.0},
}

# ---- the band between the inner disc and the (hidden in Sport) tick ring, radial level profile, fitted to 03
#      (C1 sector 280..60, C2 unlit sectors 280..340 + 20..80), Gaussian PSF sigma 0.012 R, rms 2.9 code values.
BAND = {
    "r_in": 0.47,          # fade-in centre (0.012 R wide); 03 inner-disc edge 0.47-0.49
    "a0": 0.02,            # level at r_in (of the peak)
    "a1": 0.52,            # level at r1, the end of the linear ramp
    "r1": 0.765,
    "rim0": 0.74,          # smoothstep up to the full-level rim
    "rim1": 0.80,
    "r_out": 0.850,        # crisp outer edge (03 fit 0.845 + half the PSF bias; 01 ~0.87, 02 0.99 in 02's frame)
    "speedo_sweep": (230.0, 260.0),        # cw12 start, span: 03 band ends at 229-230 / 129-130
    "tacho_sweep": (230.0, 261.25),        # from OFF (250.5 - 20.5) to 7.5k (250.5 + 7.5 * 32.1 = 131.25)
    "end_soft_deg": 0.0,   # radial ends are crisp in 03 (transition ~2 deg = the photo blur)
}

# ---- the radial hairlines (procedural: the theme shader draws them; rasterised here for QC only)
HAIRLINES = {
    "speedo_angles": [230.0 + 20.0 * k for k in range(1, 13)],    # every 20 km/h; 03: 310, 330, 350.5, 11, 31.3, 51
    "tacho_angles": [250.5 + 32.1 * k for k in range(0, 8)],       # every 1000 rpm (03 C2 too cluttered: weak)
    "width_px_at_R335": 2.0,   # crisp width; with darkness 0.7 its integral (1.4 px) matches 03's 5 px / 28 % dip
    "darkness": 0.70,          # alpha of the black line over the band
    "r0": 0.47, "r1": 0.850,   # the whole band
    "minor_pitch_note": "02 also shows minor hairlines (every minor step, ~0.2 dark); 03 and 01 do not: off",
}

# ---- the bridge: a horizontal glow between the dials, uniform in x (01, 02, 03 agree), plus a faint collar next
#      to each bezel on the inner side. 03: centre +0.12 R, 01: +0.10 R (02: -0.05 R in its own proportions).
BRIDGE = {
    "v_c": 0.11,            # centre below the dial centres, R units
    "sigma": 0.092,         # Gaussian sigma, R units (03 0.089, 01 0.095; 02 0.072)
    "collar_amp": 0.17,     # of the bridge peak, at the bezel (r = 1.0 R), inner side only
    "collar_len": 0.05,     # exponential decay away from the bezel, R units
    "collar_v": 0.45,       # vertical half extent of the collar about the dial centre line, R units
    "collar_v_soft": 0.08,
    "clip_r": 1.0,          # nothing inside the dials (soft 1 px), so the layer can sit above or below them
}

# ---- the wings: a white tapered stroke leaving each bezel tangentially at the upper / lower inner side, bending at
#      uc into a straight tail that slopes toward the dial centre line. Upper-left dial frame (u toward the middle,
#      v up = negative); the other three are mirror images. 03 fit rms 2.8 px (L/R of 03 differ by 4.8 px).
WING = {
    "v0": 0.0,              # mirror axis (03 fit +0.0025 R)
    "vt": 0.457,            # |v| of the tail line at u = 1
    "s": 0.25,              # tail slope (|v| falls by s per R toward the middle)
    "m": 1.30,              # extra slope before the corner
    "uc": 0.880,            # corner
    "b": 0.020,             # corner roundness
    "u_tip": 1.13,          # 03 fades out at 1.10-1.12, 02 at 1.10-1.12, 01 (weak) 1.25
    # crisp full width (px at R 335) along u, and level along u (fitted against 03 with the QC tool)
    "width": [(0.76, 7.0), (0.84, 11.0), (0.88, 10.0), (0.92, 5.0), (0.98, 3.4), (1.06, 2.4), (1.13, 1.2)],
    "level": [(0.76, 0.80), (0.84, 1.0), (0.90, 1.0), (0.96, 0.80), (1.02, 0.62), (1.08, 0.40), (1.13, 0.0)],
    "tip_tint_02": (0.88, 0.67, 1.0),   # 02's fading tail goes violet; 03 stays neutral: not used
}

# ---- what Sport changes in the SHARED (Comfort) dial layers of P1 / P2: per-layer opacity / tint, no re-bake.
#      Evidence: radial profiles of 03 sport vs 03 comfort (same car, same camera), 01 sport vs comfort, 02.
SHARED_IN_SPORT = {
    "<dial>.face": {"opacity": 1.0, "tint": None,
                    "evidence": "ok", "why": "03 sport face 0.30-0.45 R (8,9,11) vs comfort (2,3,5) + haze: unchanged"},
    "<dial>.face-shadow": {"opacity": 1.0, "tint": None, "evidence": "weak"},
    "<dial>.floor-shade": {"opacity": 1.0, "tint": None, "evidence": "weak",
                           "why": "02 sport keeps the darker floor; 03 band continues below the horizon unchanged"},
    "<dial>.tick-groove": {"opacity": 0.0, "evidence": "ok",
                           "why": "03 sport 0.87-0.97 R is black (1-12) where comfort shows the groove rims / ticks"},
    "<dial>.ticks": {"opacity": 0.0, "evidence": "ok",
                     "why": "no ticks in 03 / 01 sport; 02 draws red segments in its outer strip (render, disagrees)"},
    "<dial>.inner-disc": {"opacity": 0.0, "evidence": "ok",
                          "why": "03 comfort lit edge at 0.49 R (21 vs 5 around) is absent in sport (11-13, smooth); the band starts there"},
    "<dial>.inner-ring": {"opacity": 0.0, "evidence": "weak", "why": "no 0.33 R ring in 03 / 01 sport"},
    "<dial>.floor": {"opacity": 1.0, "evidence": "weak", "why": "02 sport shows the floor edge; 03 too blurred"},
    "<dial>.hub-well": {"opacity": 1.0, "evidence": "weak"},
    "<dial>.hub-ring": {"opacity": 0.0, "evidence": "ok",
                        "why": "03 comfort red ring at 0.13 R (19,10,14); sport flat (7-8). 01/02 sport: a red glow at < 0.2 R instead (not delivered)"},
    "<dial>.bezel": {"opacity": 1.0, "tint": None, "evidence": "ok",
                     "why": "03 sport ridge 0.99 R neutral grey (50 / 64), same as comfort; 01 sport darker (weak), 02 red (render)"},
    "<dial>.red-zone": {"note": "dynamic: in 03 the band from the shift point is x2.2 brighter (157 vs 70 at 0.76-0.84 R)"},
    "<dial>.lit-fill": {"note": "dynamic: in 03 the band from OFF to the needle is x2.9 brighter (160 vs 55); existing WBDIAL 'lit' term"},
}
