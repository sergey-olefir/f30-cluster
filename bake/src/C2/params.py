"""P2 / C2 rev dial (COMFORT): every number that reproduces the layers, in R units (R = bezel OUTER edge) and cw12
degrees (clockwise from 12 o'clock). Levels are sRGB code values / 255 of the exposure-normalised references
(white -> 235/255). Sources and evidence per block; see bake/report/C2.md for the measurements behind them.
"""
W = 235.0 / 255.0                       # the references' normalised white

# ---------------------------------------------------------------------------------------------------- the rev scale
SCALE = dict(
    rpm0_cw12=250.5,                    # 0 rpm (READY tick). 05/04/17/03 fits: 250.10 / 250.82 / 250.44 / 250.49
    deg_per_1000=32.05,                 # fits 32.12 / 32.01 / 32.05 / 32.06 (theme 32.1: within the error, keep either)
    minor_rpm=100, half_rpm=500, major_rpm=1000, max_rpm=7500,
)

# ---------------------------------------------------------------------------------------------------- z 1 face
FACE = dict(
    r_out=0.975,                        # under the bezel's inner band (opaque disc, the bezel draws over it)
    base=(2 / 255, 6 / 255, 13 / 255),  # 05 / 04 upper-right face (0..1, 4..6, 9..14)
    lit_add=(5 / 255, 5 / 255, 6 / 255), lit_dir_cw12=300.0, lit_pow=2.0,      # faint lift toward the upper left
    horizon_add=(9 / 255, 10 / 255, 12 / 255), horizon_v=0.25, horizon_h=0.13,  # brighter just above the floor line
    horizon_u_fall=0.55,                # ... fading sideways (u = 0.6: ~1/3)
)
# ---------------------------------------------------------------------------------------------------- z 2 face shadow
FACE_SHADOW = dict(r0=0.845, r1=0.955, a_max=0.60, r_fade_out=0.965)   # AO toward the bezel (05: L 5 -> 1-2)

# ---------------------------------------------------------------------------------------------------- z 2.5 floor shade
FLOOR_SHADE = dict(v_line=0.25, edge_soft=0.006, a_line=0.45, a_deep=0.88, v_deep=0.45, r_out=0.79, r_soft=0.03)

# ---------------------------------------------------------------------------------------------------- z 3 groove
GROOVE = dict(
    r_lip=0.8195, lip_rise=0.004, lip_decay=0.022,        # 13 @4x: rises at 0.811, peak 0.82, back to base by ~0.86
    lip_L=dict(base=5.0, a_narrow=12.0, k_narrow=8.0, a_wide=48.0, k_wide=1.0, dir_cw12=318.0),  # L code values; 04: 43-58 over 260-340, 05 up to ~95 (flare)
    r_outer_rim=0.925, outer_rim_L=3.0, outer_rim_w=0.006,
    gap_r=(0.952, 0.961),               # the dark gap just inside the bezel (13: L 2)
    color=(0.86, 0.90, 1.0),
)

# ---------------------------------------------------------------------------------------------------- z 4 red zone
RED = dict(
    start_rpm=7000, end_rpm=7500,        # start is a SETTING (shift point); end = max
    band_r=(0.896, 0.914), band_rgb=(232 / 255, 20 / 255, 16 / 255),          # 05: R 220-235, G 13-25
    fill_r=(0.866, 0.896), fill_R=(25 / 255, 75 / 255),                        # dim red, brighter toward the end
    pad_deg=0.55,                       # the band starts / stops this far from the start tick / end mark
    gap_deg=0.55, gap_rpm=[7200],       # 05 shows ONE dark gap (7.2k); evidence weak for the count
    minors_hidden=True,                 # no minor ticks inside the red zone (05)
)

# ---------------------------------------------------------------------------------------------------- z 5 ticks
TICKS = dict(
    r_out=0.903,                        # white end; 13 @4x majors 0.9035 half-max; 05/04/03 means 0.907-0.913 incl. spot
    major=dict(r_in=0.8165, hw_in=0.0057, hw_out=0.0063, level=1.0),           # FWHM 3.8 -> 4.2 px @ R 335
    half=dict(r_in=0.853, hw_in=0.0058, hw_out=0.0062, level=1.0),             # 13: length 0.050, as wide as majors
    minor=dict(r_in=0.866, hw_in=0.0033, hw_out=0.0033, level=0.60),           # 13: length 0.037, FWHM 2.2 px, L 140
    tip_round=0.0,                      # square ends (13)
    fringe=dict(rgb=(0.25, 0.55, 0.75), r0=0.897, r1=0.909, k=0.35),           # cool fringe at the outer end: LIKELY lens CA
    color=(1.0, 1.0, 1.0),
)
SPOTS = dict(                           # the blurred light spot just past the bright ticks' ends (13 @4x)
    dr=0.014, s_along=0.011, s_across=0.0095, level_major=0.42, level_half=0.36, level_minor=0.03,
    rgb=(0.85, 0.88, 0.95),
)

# ---------------------------------------------------------------------------------------------------- z 5.7 OFF arc, OFF mark
OFF = dict(
    arc_r=0.8265, arc_from_cw12=232.7,  # to the 0 rpm tick (250.5); 05: centre 0.826, FWHM 0.0085 -> 0.0065 R
    hw_at_ready=0.0042, hw_at_off=0.0032, level_at_ready=1.0, level_at_off=0.80,
    mark_cw12=233.0, mark_r=(0.82, 0.905), mark_hw=0.0058,                    # 17 only (05: not visible): weak
    needle_park_cw12=230.0,             # dynamic: where the needle rests (05 229.5, 04 / 03 ~230-231)
)

# ---------------------------------------------------------------------------------------------------- z 6 inner disc
DISC = dict(
    r_edge=0.484,                       # 05 0.480-0.488 rim peak (P0 0.473-0.51); open at the bottom: v < floor line
    fill_add=(1 / 255, 2 / 255, 3 / 255),
    ramp_r=(0.40, 0.476), ramp_add=(7 / 255, 9 / 255, 10 / 255),             # brighter toward the rim (convex)
    rim_hw=0.0042, rim_rgb=(0.17, 0.20, 0.25), rim_lit=(0.65, 1.0),           # rim level min / max over angle
    halo_add=(4 / 255, 5 / 255, 6 / 255), halo_decay=0.018,                   # soft glow just outside the rim
)
# ---------------------------------------------------------------------------------------------------- z 7 inner ring
RING = dict(r=0.330, hw=0.0035, rgb=(0.08, 0.10, 0.13), lit=(0.6, 1.0))       # weak: 05 only (+4..6 L)

# ---------------------------------------------------------------------------------------------------- z 8 floor
FLOOR = dict(
    v_line=0.25, edge_hw=0.0022, edge_rgb=(0.20, 0.22, 0.26),                # crisp edge inside the disc only
    below_top=(3 / 255, 5 / 255, 9 / 255), below_bot=(0.5 / 255, 1 / 255, 2 / 255), v_bot=0.45,
)
# ---------------------------------------------------------------------------------------------------- z 8.5 P box
PBOX = dict(
    top_v=0.515, top_hw=0.145, corner_r=0.035,
    bot_r=0.683, bot_half_deg=27.5,     # bottom edge: an arc CONCENTRIC with the dial (05: r 0.680-0.688)
    side_end_u=0.300,                   # sides run from the top corners down-out to the bottom arc's ends
    fill_top=(12 / 255, 13 / 255, 16 / 255), fill_bot=(5 / 255, 6 / 255, 8 / 255),
    top_rim=dict(hw=0.0022, peak=0.90, u0=0.025, s=0.075, floor=0.12),
    side_rim=dict(hw=0.0018, level=0.12),
    bot_rim=dict(hw=0.0035, peak=1.0, flat_deg=15.0, fade_deg=12.0, floor=0.10, glow=0.10, glow_decay=0.010),
    rim_rgb=(0.93, 0.96, 1.0),
)
# ---------------------------------------------------------------------------------------------------- z 9 hub
HUB = dict(well_r=(0.14, 0.30), well_a=0.25,
           ring_r=0.128, ring_hw=0.0045, ring_rgb=(0.88, 0.12, 0.08), ring_glow=0.25, ring_glow_decay=0.02)

# ---------------------------------------------------------------------------------------------------- z 11 bezel
BEZEL = dict(
    ridge_r=0.991, s_in=0.0048, s_out=0.0110,                                 # 13 @4x profile
    band=(0.959, 0.972, 0.978, 0.983), band_level=0.155,                       # grey inner flank, 13: 21 / 146
    rgb=(0.96, 0.975, 1.0),
    # brightness over angle: b + a1 * exp(k1 (cos(t - t1) - 1)) + a2 * exp(k2 (cos(t - t2) - 1)), / 235, clipped 1
    gloss=dict(b=8.0, a1=155.0, t1=340.0, k1=8.0, a2=228.0, t2=148.0, k2=1.0,   # fit to 05 + 06 (rms 21 L)
               a3=150.0, t3=272.0, k3=4.0),   # left lobe: 17 / 07 (L 220-230 at 265-285), 05 by eye; weak (housing glare)
)
