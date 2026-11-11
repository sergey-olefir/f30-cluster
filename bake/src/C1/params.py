"""P1 / C1 speed dial (COMFORT): every number that reproduces the dial's static layers, in R units (R = the bezel's
OUTER edge, 335 px on the G20), cw12 degrees (clockwise from 12 o'clock) and sRGB 0..255 colours.

Where a number comes from (rect crops in bake/work/rect/, C2 crops mirrored into the speedo's handedness):
  12 = 12_speedo_signs (good), 03 = 03_bimmerstop comfort (ok), 04 = 04_mph (ok), 05 = 05_tach close-up (ok, rev
  dial, mirrored), 13 = 13_ticks @4x (rev dial, partial), 14 / 15 close-ups (partial), 17 = 17_physical (good
  geometry, hazy levels), 02 = clean render (different proportions). See bake/report/C1.md for the measurements.
"""

R_PX = 335.0
CENTRE = (412.0, 380.0)                       # panel px (G20 COMFORT)
BOX = (70, 38, 684, 682)                      # panel box of every C1 layer (r <= 1.02 R, clipped at the panel's foot)

# ---- the km/h scale (design/gen_6wb.py: SPD_START 230, SPD_SWEEP 260, 1 deg per km/h); confirmed on 03 / 12:
# majors every 20 km/h at 20.0 deg pitch (12: 259.9 deg over 13 majors, 03: 261.1), minors every 2 km/h (17: 2.0-2.1)
SCALE = dict(start=230.0, deg_per_kmh=1.0, vmax=260, minor_kmh=2, mid_kmh=10, major_kmh=20)

# ---- ticks: radial wedges (trapezoids), r_in..r_out, half widths w_in (at r_in) .. w_out (at r_out)
# radii: majors 0.817 (12) / 0.821 (05) / 0.816 (13); mids 0.855-0.857 (12, 05, 03); minors 0.856-0.866; out 0.898-0.904
# widths: 13 @4x (FWHM at 0.83 / 0.89 R): major 0.019 -> 0.024, mid 0.014 -> 0.016, minor 0.0063-0.0078 (blur ~0.002)
TICKS = {
    "major": dict(r_in=0.820, r_out=0.902, w_in=0.0085, w_out=0.0112, rgb=(236, 238, 240), a=1.0),
    "mid":   dict(r_in=0.856, r_out=0.902, w_in=0.0060, w_out=0.0070, rgb=(236, 238, 240), a=1.0),
    "minor": dict(r_in=0.862, r_out=0.902, w_in=0.0028, w_out=0.0032, rgb=(150, 152, 156), a=1.0),
}
# a cool (cyan) fringe on the outer end of majors and mids (13 @4x: last ~25 % of the length, on the outer edge)
FRINGE = dict(rgb=(120, 215, 255), from_t=0.70, mix_major=0.40, mix_mid=0.25, mix_minor=0.0)
# a blurred light spot just past the outer end of majors and mids (13: max 108 at 0.916, 66 at 0.932, 26 at 0.944;
# 17 shows it at every major and mid, not at minors)
TICK_SPOT = dict(r=0.918, sigma_r=0.012, sigma_t=0.016, rgb=(205, 215, 230), a_major=0.42, a_mid=0.30)
# soft glow around every tick (halo in 13 / 03), exp falloff in R units
TICK_HALO = dict(scale=0.006, a=0.10)

# ---- the tick groove: a recessed dark band between a lit inner rim and the bezel's inner wall
# inner rim (median-profile peak): 05 0.795, 04 0.800, 03 0.810, 12 0.815, 13 0.816-0.82 -> 0.807, peak luma 32-43
GROOVE = dict(
    r_in=0.807,                    # the inner rim's centre line
    rim_w=0.0120, rim_rgb=(27, 31, 37),        # median-profile peak 32-43 luma (05 / 04 / 03)
    spill_to=0.850, spill_rgb=(20, 24, 30),     # 13: 0.824 -> 0.85 the rim's light spills 15 -> 6
    floor_rgb=(1, 2, 7),                        # 05 p10 0.86-0.95: (0, 0-1, 4-7)
    wall_r0=0.964, wall_r1=0.984, wall_rgb=(9, 10, 13),   # 13 med 18-24 (close-up exposure); 05 / 04 medians 7-11
)

# ---- the bezel: a thin bright tube; ridge 0.990-0.993 R (P0 0.99; 13 0.992; 05 0.993), FWHM ~0.012 R
BEZEL = dict(r=0.9915, sigma=0.0058, inner_dark=(0.978, 0.986), rgb=(214, 216, 222),
             # peak brightness (0..1 of rgb) by angle: a base and two lobes (cw12 centre, sigma deg, gain);
             # 04: top 145-223, lower left 200-240 cw12 234, window side 20-35; 05 (mirrored): top 156-217,
             # lower-outer 220-260 cw12 229-234, left 60-90; 03: bottom 140-230 ~230 -> the lobes mirror between the
             # two dials, so they are part of the drawing, not a reflection
             base=0.26, lobes=[(8.0, 22.0, 0.42), (232.0, 32.0, 0.72), (300.0, 40.0, 0.10)],
             outer_fade=1.012)
# a faint second rim on the bezel's inner wall in the lower half (04: 0.966-0.970 R, 80-260 cw12, luma 40-108)
BEZEL_INNER_RIM = dict(r=0.968, sigma=0.0035, rgb=(150, 155, 165), a=0.35, centre=200.0, span_sigma=55.0)

# ---- the face: dark blue-black. Levels from 05 / 04 / 03 (17 is hazed): 0.52-0.78 R (7,10,18) / (6,9,14) / (2,4,6)
FACE = dict(rgb=(7, 10, 17), lift_rgb=(1, 1, 2))
# the inner disc: an ARC open at the bottom, ending on the floor line. Edge radius 0.487 R
# (05 0.48-0.49, 04 0.48-0.49, 03 0.48-0.49, 17 0.47-0.51; theme 0.51 -> P0's ~0.49 confirmed: 0.487)
DISC = dict(r=0.487, fill_rgb=(6, 9, 16), fill_edge_rgb=(10, 13, 22), fill_from=0.30,
            edge_w=0.0120, edge_rgb=(26, 30, 37), halo_scale=0.010, halo_rgb=(26, 30, 38), halo_a=0.30)
# the inner ring: a thin tube at 0.330 R (05 0.32-0.33, 04 0.32, 03 0.33-0.34; theme 0.36), also open at the bottom
RING = dict(r=0.330, w=0.0080, rgb=(17, 21, 28), halo_scale=0.008, halo_a=0.12)
# the floor: a horizontal edge 0.245 R below the centre (17 0.242, 05 0.254, 03 0.254 ; theme 0.26), crisp only
# inside the disc; the disc above it brightens toward it (05 luma 8.5 -> 14, 04 8 -> 23, 03 6 -> 16)
FLOOR = dict(dy=0.245, lip_rgb=(40, 44, 52), lip_w=0.0060, below_rgb=(5, 7, 13), below_r0=0.36, below_r1=0.62,
             glow_rgb=(30, 36, 48), glow_a=0.17, glow_pow=1.8)
# the wide floor shade (P0 z 2.5): below the floor line the face is darker out to ~0.7 R (05 L 7 -> 3)
FLOOR_SHADE = dict(dy=0.245, ramp=0.035, r_out=0.70, r_feather=0.10, a=0.45)
# ambient occlusion inside the bezel (13: 0.944-0.960 darkest, luma 2-4) and a weak shadow outside the disc edge
FACE_SHADOW = dict(r_wall=0.962, scale=0.018, a=0.65, disc_scale=0.025, disc_a=0.22)
# the hub well: a weak dark vignette around the hub (05: none visible, 02: hidden by the red glow) -> weak
HUB_WELL = dict(r_core=0.135, r_out=0.26, a=0.30)
HUB_RING = dict(r=0.133, note="drawn by the dynamic hub layer (red, glow state); not baked here")

# light: see bake/report/C1.md "Light direction". Drawn key from the top / upper left (groove-rim brightness:
# 05 127 deg, 17 122 deg, 02 84 deg math), bezel gloss two-lobed (top + lower outer).
LIGHT = dict(key_dir_deg=115.0, key=1.0, rim_mod=0.35)
