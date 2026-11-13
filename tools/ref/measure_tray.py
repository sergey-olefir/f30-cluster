"""car4 L (docs/CAR4-L-REPORT.md): measure the gear tray under the tacho in an image in panel px (a rectified reference
crop from bake/work/rect, or a bench shot of the panel at 1920 x 720). Prints numbers only.
    uv run -q --no-project --with numpy --with pillow python -I tools/ref/measure_tray.py <name> <png> [box_x box_y]
box: the crop's panel origin (the crop's .json "box"); left out for a bench shot.
Prints JSON: tray centre, shelf y / half-width, shoulder angles, shoulder/arc junction, arc radius / span, line levels
(luma; a rectified crop's white is 235). G20 geometry: tacho centre y 380, R 335. The gear letter's columns are kept
out of the arc fit and the shoulder search."""
import sys, json, math, numpy as np
from PIL import Image
name, f = sys.argv[1], sys.argv[2]
bx, by = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0.0, 0.0)
a = np.asarray(Image.open(f).convert('RGB'), dtype=float)
Y = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
def L(x, y):
    """luma at panel (x, y), bilinear"""
    x, y = x - bx - 0.5, y - by - 0.5
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    return (Y[y0, x0] * (1 - fx) * (1 - fy) + Y[y0, x0 + 1] * fx * (1 - fy) + Y[y0 + 1, x0] * (1 - fx) * fy + Y[y0 + 1, x0 + 1] * fx * fy)
def col(x, y0, y1):     # luma along a column, per px
    return np.array([L(x, y) for y in np.arange(y0, y1, 1.0)])
def row(y, x0, x1):
    return np.array([L(x, y) for x in np.arange(x0, x1, 1.0)])
def peak(v, o):          # sub-px centroid of the max (3 samples)
    i = int(np.argmax(v)); s = v[max(i - 1, 0):i + 2]; w = np.arange(max(i - 1, 0), max(i - 1, 0) + len(s))
    return o + float((s * w).sum() / max(s.sum(), 1e-6)), float(v[i])
CY = 380.0
# the arc's bottom: brightest y in columns near x 1508 +- 60, y 595..618
pts = []
for x in [x for x in np.arange(1436, 1584, 2.0) if abs(x - 1508) > 42]:     # off the gear letter
    yy, v = peak(col(x, 585, 620), 585)
    if v > 60: pts.append((x, yy, v))
P = np.array(pts)
# circle fit with the centre's y fixed at the dial's (380): (x-cx)^2 + (y-380)^2 = r^2 -> linear in cx, c
A = np.c_[2 * P[:, 0], np.ones(len(P))]; bb = P[:, 0] ** 2 + (P[:, 1] - CY) ** 2
(cx, c), *_ = np.linalg.lstsq(A, bb, rcond=None); r = math.sqrt(c + cx * cx)
arc_peak = max(float(P[:, 2].max()), max(peak(col(x, 595, 620), 595)[1] for x in (1506.0, 1508.0, 1510.0)))
# the shelf: the brightest row in y 535..562 over cx +- 25
ys = np.arange(530, 562, 0.5)
mean = [np.mean(row(y, cx - 25, cx + 25)) for y in ys]
sy = float(ys[int(np.argmax(mean))])
prof = np.array([max(L(x, sy - 0.5), L(x, sy), L(x, sy + 0.5)) for x in np.arange(cx - 80, cx + 80, 1.0)])
shelf_peak = float(prof.max()); xpk = cx - 80 + float(np.argmax(prof))
# half-max of the shelf line's brightness bump
hm = shelf_peak / 2
xl = next(x for x in np.arange(xpk, cx - 80, -0.5) if max(L(x, sy - .5), L(x, sy), L(x, sy + .5)) < hm)
xr = next(x for x in np.arange(xpk, cx + 80, 0.5) if max(L(x, sy - .5), L(x, sy), L(x, sy + .5)) < hm)
# the shelf's end: going out from the centre, the last x where the line is still at the shelf's y (its max within
# sy-2..sy+10 stays within 1.5 px of sy)
def shelf_end(sign):
    last = cx
    for x in np.arange(cx, cx + sign * 90, sign * 1.0):
        yy, v = peak(col(x, sy - 2, sy + 5), sy - 2)
        if v < 6: break
        if abs(yy - sy) <= 1.5: last = x
        else: break
    return last
el, er = shelf_end(-1), shelf_end(1)
# the shoulders: per row from sy+5 to the junction, the brightest x on each side, away from the centre's letter
def shoulder(sign):
    pts = []
    for y in np.arange(sy + 6, sy + 32, 1.0):
        xs0, xs1 = (cx - 112, cx - 45) if sign < 0 else (cx + 45, cx + 112)
        v = row(y, xs0, xs1)
        xx, pv = peak(v, xs0)
        rr = math.hypot(xx - cx, y - CY)
        if pv > 6 and rr < r - 4: pts.append((xx, y, pv))
    p = np.array(pts)
    b, a0 = np.polyfit(p[:, 1], p[:, 0], 1)     # x = a0 + b y
    ang = math.degrees(math.atan2(1.0, abs(b)))
    # junction with the arc circle: (a0 + b y - cx)^2 + (y - CY)^2 = r^2
    qa = b * b + 1; qb = 2 * b * (a0 - cx) - 2 * CY; qc = (a0 - cx) ** 2 + CY * CY - r * r
    yj = (-qb + math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa); xj = a0 + b * yj
    return ang, xj, yj, float(np.median(p[:, 2])), len(p)
sl, sr = shoulder(-1), shoulder(1)
# the arc's span: along the circle, the luma max within +-2.5 px radially; the ends where it falls under 10 % of the peak
def arc_at(deg):
    t = math.radians(deg)
    return max(L(cx + (r + d) * math.sin(t), CY + (r + d) * math.cos(t)) for d in np.arange(-2.5, 2.6, 0.5))
def arc_end(sign):
    last = 0
    for d in np.arange(0, 45, 0.25):
        if arc_at(sign * d) >= 0.10 * arc_peak: last = d
        elif d > 5: break
    return last
al, ar = arc_end(-1), arc_end(1)
# brightness along the arc at a few angles, as fractions of its peak
arc_prof = {d: round(arc_at(d) / arc_peak, 2) for d in (-25, -20, -15, -10, 0, 10, 15, 20, 25)}
Rpx = 335.0
out = dict(name=name, centre_x=round(cx, 1), arc_r_px=round(r, 1), arc_r_R=round(r / Rpx, 3), arc_bottom_y=round(CY + r, 1),
           arc_span_deg=[round(-al, 1), round(ar, 1)], arc_half_chord_px=round(r * math.sin(math.radians((al + ar) / 2)), 1),
           arc_peak=round(arc_peak), arc_profile=arc_prof,
           shelf_y=sy, shelf_v_R=round((sy - CY) / Rpx, 3), shelf_height_px=round(CY + r - sy, 1),
           shelf_ends_px=[round(el - cx, 1), round(er - cx, 1)], shelf_half_w_R=round((er - el) / 2 / Rpx, 3),
           shelf_peak=round(shelf_peak), shelf_peak_rel_arc=round(shelf_peak / arc_peak, 2),
           shelf_fwhm_px=round(xr - xl, 1), shelf_peak_at_px=round(xpk - cx, 1),
           shoulder_deg=[round(sl[0], 1), round(sr[0], 1)],
           junction_px=[round(sl[1] - cx, 1), round(sr[1] - cx, 1)], junction_y=[round(sl[2], 1), round(sr[2], 1)],
           junction_half_R=round((sr[1] - sl[1]) / 2 / Rpx, 3),
           shoulder_level=[round(sl[3]), round(sr[3])], shoulder_level_rel_arc=round((sl[3] + sr[3]) / 2 / arc_peak, 2))
out['shelf_over_arc_chord'] = round((er - el) / (2 * out['arc_half_chord_px']), 2)
out['shelf_over_junction'] = round((er - el) / (sr[1] - sl[1]), 2)
print(json.dumps(out))
