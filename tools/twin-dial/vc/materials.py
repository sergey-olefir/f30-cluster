"""Package VC: colour of every material on every reference, in linear light, before and after normalisation.

Two kinds of sample:
- DIAL samples, in dial units on the polar unwraps (unwrap.py: VR's rectified frames, rho = 1 on the bezel's centre
  line), a rho range and a theta range; 'flat' = median of VR's valid pixels after dropping numerals / ticks (Y over 2 x the median) and
  dark gaps; 'peak' = the per-theta maximum over the rho range (thin bright lines: bezel, inner ring, ticks, needle),
  then the median over theta, which is what a blurred photo leaves of a line's true level (a lower bound for lines
  narrower than ~3 photo px);
- BOX samples, in original photo px (x0, y0, x1, y1; continuous coords), with the same two kinds; 'ink' = the 98th
  percentile of Y in the box and the median RGB of the pixels above the box's 95th percentile (text and rules);
  'mask' = a colour selector (e.g. 'red': R > 2.2 G) for a fill with icons in it.

Per reference: LCD black (median Y of rho 1.03..1.10 outside both dials, lower 50 %), white text level (the 99.5th
percentile of Y over the big numerals' rows, its clipped fraction), and every sample also as L = (Y - black) /
(white - black) and as linear RGB scaled the same way. Writes bake/work/twin-dial/VC/materials.json.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from profiles import NEEDLE  # noqa: E402

# (name, dial, kind, rho0, rho1, th0, th1); theta deg cw from 12, signed
DIAL = {
    '02': [
        ('bezel', 'speedo', 'peak', 0.975, 1.025, -120, 120),
        ('bezel', 'tacho', 'peak', 0.975, 1.025, -125, -100),
        ('inner_ring', 'speedo', 'peak', 0.525, 0.565, -120, 120),
        ('inner_ring', 'tacho', 'peak', 0.525, 0.565, -60, 60),
        ('track', 'speedo', 'flat', 0.900, 0.930, -120, 120),
        ('track', 'tacho', 'flat', 0.900, 0.930, -120, 120),
        ('ticks', 'speedo', 'peak', 0.895, 0.935, -120, 120),
        ('gap', 'speedo', 'flat', 0.955, 0.978, -120, 120),
        ('band_in', 'speedo', 'flat', 0.585, 0.610, -120, 120),
        ('band_mid', 'speedo', 'flat', 0.700, 0.730, -120, 120),
        ('band_out', 'speedo', 'flat', 0.855, 0.885, -120, 120),
        ('band_in', 'tacho', 'flat', 0.585, 0.610, -120, 120),
        ('band_mid', 'tacho', 'flat', 0.700, 0.730, -120, 120),
        ('band_out', 'tacho', 'flat', 0.855, 0.885, -120, 120),
        ('hub', 'speedo', 'flat', 0.15, 0.45, -180, 180),
        ('needle', 'tacho', 'needle', 0.62, 0.88, 0, 0),
        ('needle', 'speedo', 'needle', 0.62, 0.88, 0, 0),
        ('outside', 'speedo', 'flat', 1.04, 1.05, -120, 120),
        ('outside', 'tacho', 'flat', 1.04, 1.05, -120, 120),
    ],
    '04': [
        ('bezel', 'speedo', 'peak', 0.975, 1.025, -120, 120),
        ('bezel', 'tacho', 'peak', 0.975, 1.025, -120, 80),
        ('inner_ring', 'speedo', 'peak', 0.51, 0.56, -120, 120),
        ('inner_ring', 'tacho', 'peak', 0.51, 0.56, -120, 60),
        ('inner_ring_shoulder', 'speedo', 'flat', 0.552, 0.567, -120, 120),
        ('track_line', 'speedo', 'peak', 0.89, 0.915, -120, 120),
        ('track_line', 'tacho', 'peak', 0.89, 0.915, -120, 60),
        ('gap', 'speedo', 'flat', 0.945, 0.978, -120, 120),
        ('band_in', 'speedo', 'flat', 0.590, 0.615, -120, 120),
        ('band_mid', 'speedo', 'flat', 0.640, 0.665, -120, 120),
        ('band_out', 'speedo', 'flat', 0.830, 0.875, -120, 120),
        ('band_in', 'tacho', 'flat', 0.590, 0.615, -120, 70),
        ('band_mid', 'tacho', 'flat', 0.640, 0.665, -120, 70),
        ('band_out', 'tacho', 'flat', 0.830, 0.875, -120, 70),
        ('wedge_fill', 'tacho', 'red', 0.58, 0.88, 92, 128),
        ('wedge_edge', 'tacho', 'redpeak', 0.87, 0.93, 92, 128),
        ('wedge_numeral', 'tacho', 'redpeak', 0.66, 0.84, 92, 128),
        ('hub', 'speedo', 'flat', 0.15, 0.45, -180, 180),
        ('needle', 'tacho', 'needle', 0.62, 0.88, 0, 0),
        ('needle', 'speedo', 'needle', 0.62, 0.88, 0, 0),
        ('outside', 'speedo', 'flat', 1.04, 1.05, -120, 120),
    ],
    '05': [
        ('bezel', 'speedo', 'peak', 0.975, 1.025, -120, 120),
        ('bezel', 'tacho', 'peak', 0.975, 1.025, -120, 40),
        ('bezel_red', 'tacho', 'redpeak', 0.975, 1.025, 70, 130),
        ('inner_ring', 'speedo', 'peak', 0.515, 0.55, -120, 120),
        ('inner_ring', 'tacho', 'peak', 0.515, 0.55, -120, 120),
        ('track', 'speedo', 'flat', 0.905, 0.940, -120, 120),
        ('track', 'tacho', 'flat', 0.905, 0.940, -120, 40),
        ('ticks', 'speedo', 'peak', 0.90, 0.945, -120, 120),
        ('gap', 'speedo', 'flat', 0.96, 0.978, -120, 120),
        ('band_in', 'speedo', 'flat', 0.575, 0.610, -120, 120),
        ('band_mid', 'speedo', 'flat', 0.700, 0.730, -120, 120),
        ('band_out', 'speedo', 'flat', 0.860, 0.890, -120, 120),
        ('band_in', 'tacho', 'flat', 0.575, 0.610, -120, 120),
        ('band_mid', 'tacho', 'flat', 0.700, 0.730, -120, 120),
        ('band_out', 'tacho', 'flat', 0.860, 0.890, -120, 120),
        ('red_numeral', 'tacho', 'redpeak', 0.70, 0.84, 95, 135),
        ('red_ticks', 'tacho', 'redpeak', 0.90, 0.95, 70, 125),
        ('hub', 'speedo', 'flat', 0.15, 0.45, -180, 180),
        ('needle', 'tacho', 'needle', 0.60, 0.88, 0, 0),
        ('needle', 'speedo', 'needle', 0.60, 0.88, 0, 0),
        ('outside', 'speedo', 'flat', 1.04, 1.05, -60, 60),
    ],
    '01': [
        ('bezel', 'speedo', 'peak', 0.975, 1.025, -120, 120),
        ('band_mid', 'speedo', 'flat', 0.70, 0.73, -120, 120),
        ('hub', 'speedo', 'flat', 0.15, 0.45, -180, 180),
        ('needle', 'speedo', 'needle', 0.60, 0.88, 0, 0),
        ('needle', 'tacho', 'needle', 0.60, 0.88, 0, 0),
        ('red_zone', 'tacho', 'redpeak', 0.86, 1.0, 95, 135),
        ('red_numeral', 'tacho', 'redpeak', 0.66, 0.84, 95, 135),
    ],
    '03': [
        ('bezel', 'speedo', 'peak', 0.975, 1.025, -120, 120),
        ('band_mid', 'speedo', 'flat', 0.70, 0.73, -120, 120),
        ('hub', 'speedo', 'flat', 0.15, 0.45, -180, 180),
        ('needle', 'speedo', 'needle', 0.60, 0.88, 0, 0),
        ('needle', 'tacho', 'needle', 0.60, 0.88, 0, 0),
        ('red_zone', 'tacho', 'redpeak', 0.86, 1.0, 95, 140),
        ('red_numeral', 'tacho', 'redpeak', 0.66, 0.84, 85, 140),
        ('outside', 'speedo', 'flat', 1.04, 1.05, -60, 60),
    ],
}
# (name, kind, x0, y0, x1, y1)
BOX = {
    '02': [
        ('tab_body', 'rows', 1006, 600, 1048, 632),
        ('tab_body_warn', 'rows', 953, 600, 960, 632),
        ('tab_red', 'red', 862, 600, 948, 632),
        ('text_heading', 'ink', 970, 688, 1235, 712),
        ('text_body', 'ink', 995, 886, 1195, 906),
        ('text_value', 'ink', 968, 938, 1045, 964),
        ('rule_heading', 'ink', 950, 716, 1250, 724),
        ('rule_bottom', 'ink', 880, 928, 1310, 936),
        ('lcd_black', 'flat', 1000, 842, 1100, 872),
        ('green_ready', 'green', 495, 762, 555, 778),
        ('rev_red', 'red', 752, 935, 790, 962),
    ],
    '04': [
        ('tab_body', 'rows', 495, 202, 520, 220),
        ('tab_red', 'red', 460, 202, 487, 221),
        ('rule_red', 'redpeak', 420, 360, 650, 368),
        ('bar_red', 'red', 293, 366, 373, 374),
        ('text_value', 'ink', 530, 350, 560, 362),
        ('text_trip', 'ink', 410, 384, 462, 398),
        ('lcd_black', 'flat', 460, 330, 560, 350),
    ],
    '05': [
        ('tab_body', 'rows', 450, 127, 465, 148),
        ('tab_green', 'green', 594, 127, 614, 148),
        ('tab_rule', 'ink', 300, 145, 590, 150),
        ('text_heading', 'ink', 466, 186, 525, 202),
        ('text_value', 'ink', 470, 230, 520, 248),
        ('text_trip', 'ink', 366, 310, 428, 324),
        ('text_small', 'ink', 280, 320, 315, 330),
        ('rule_heading', 'ink', 425, 204, 562, 210),
        ('rule_vertical', 'ink', 572, 170, 580, 270),
        ('rule_under_dial', 'ink', 250, 311, 345, 318),
        ('lcd_black', 'flat', 430, 260, 560, 300),
    ],
}


def stats(px):
    px = px.reshape(-1, 3)
    Y = C.lum(px)
    return {'n': int(len(px)), 'rgb': np.median(px, axis=0), 'Y': float(np.median(Y)),
            'Y10': float(np.percentile(Y, 10)), 'Y90': float(np.percentile(Y, 90)),
            'clip': float((px.max(axis=1) >= C.s2l(250)).mean())}


def flat_select(px):
    Y = C.lum(px)
    med = np.median(Y)
    keep = (Y < 2.0 * med + 0.003) & (Y > 0.5 * med - 0.001)
    return px[keep]


def colour_select(px, kind):
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    if kind.startswith('red'):
        return px[(r > 2.2 * g) & (r > 2.2 * b) & (r > 0.01)]
    if kind == 'green':
        return px[(g > 1.6 * r) & (g > 1.6 * b) & (g > 0.01)]
    return px


def dial_sample(u, ok, rh, th, kind, r0, r1, t0, t1, nd):
    rsel = (rh >= r0) & (rh <= r1)
    found = None
    if kind == 'needle':
        # find it: the column (within 25 deg of the table's guess) whose median over rho of max(Y, R - G) is highest
        sub = u[rsel]
        score = np.median(np.maximum(C.lum(sub), sub[..., 0] - sub[..., 1]), axis=0)
        near = np.abs(th - nd[0]) <= 25
        found = float(th[near][np.argmax(score[near])])
        t0, t1 = found - 1.5, found + 1.5
    tsel = (th >= t0) & (th <= t1)
    if nd is not None and kind != 'needle':
        tsel &= np.abs(((th - nd[0]) + 180) % 360 - 180) > nd[1]
    sub = u[rsel][:, tsel]
    oks = ok[rsel][:, tsel]
    if kind == 'flat':  # VR's valid pixels only (glare / clipping out)
        px = sub[oks] if oks.sum() >= 30 else sub.reshape(-1, 3)
        return stats(flat_select(px))
    if kind in ('peak', 'redpeak', 'needle'):
        Y = C.lum(sub)
        if kind == 'redpeak':
            red = (sub[..., 0] > 2.2 * sub[..., 1]) & (sub[..., 0] > 0.01)
            Y = np.where(red, sub[..., 0], -1)
        if kind == 'needle':  # the needle runs along rho: per row, the max over its sector
            j = np.argmax(Y, axis=1)
            pk = sub[np.arange(sub.shape[0]), j]
        else:
            j = np.argmax(Y, axis=0)
            pk = sub[j, np.arange(sub.shape[1])]
            if kind == 'redpeak':
                pk = pk[Y.max(axis=0) > 0]
        res = stats(pk)
        if found is not None:
            res['theta'] = found
        return res
    px = colour_select(sub.reshape(-1, 3), kind)
    return stats(px) if len(px) else None


def box_sample(lin, kind, x0, y0, x1, y1):
    sub = lin[y0:y1, x0:x1]
    px = sub.reshape(-1, 3)
    if kind == 'flat':
        return stats(flat_select(px))
    if kind == 'rows':  # a fill with a vertical gradient: per-row median of the non-ink pixels
        res = stats(flat_select(px))
        rows = []
        for row in sub:
            fs = flat_select(row)
            rows.append(C.lum(np.median(fs, axis=0)) if len(fs) else float('nan'))
        res['rows_Y'] = rows
        return res
    if kind in ('ink', 'redpeak'):
        Y = C.lum(px)
        if kind == 'redpeak':
            m = (px[:, 0] > 2.2 * px[:, 1]) & (px[:, 0] > 0.01)
            Y = np.where(m, px[:, 0], -1)
        t = np.percentile(Y, 95)
        sel = px[Y >= t]
        res = stats(sel)
        res['Y98'] = float(np.percentile(C.lum(px), 98))
        res['bg_Y'] = float(np.percentile(C.lum(px), 20))
        return res
    sel = colour_select(px, kind)
    return stats(sel) if len(sel) else None


def ref_levels(rid, out):
    """LCD black and the white text level of one reference."""
    blk = [v['Y'] for k, v in out.items() if k.startswith(('outside', 'lcd_black'))]
    black = float(np.median(blk)) if blk else 0.0
    # white: big numerals in the band (rho 0.66..0.82) -> the 99.5 % of Y, and how much of it is clipped
    Ys, clips = [], []
    for name in ('tacho', 'speedo'):
        u = np.load(os.path.join(C.WORK, 'unwrap_%s_%s.npy' % (rid, name))).astype(np.float64)
        rh = np.linspace(0.45, 1.05, u.shape[0])
        th = -150 + np.arange(u.shape[1]) / 4.0
        sub = u[(rh > 0.66) & (rh < 0.82)][:, (th > -110) & (th < 110)]
        Y = C.lum(sub).ravel()
        Ys.append(np.percentile(Y, 99.5))
        top = sub.reshape(-1, 3)[Y >= np.percentile(Y, 99)]
        clips.append((top.max(axis=1) >= C.s2l(250)).mean())
    white = float(np.max(Ys))
    return black, white, float(np.mean(clips))


def main():
    res = {}
    for rid in sorted(set(DIAL) | set(BOX)):
        lin = C.s2l(C.imread(rid))  # box samples: original photo px
        flin, fvalid, dials, src = C.frame(rid)  # dial samples: VR's rectified frame (or provisional ellipses)
        out = {}
        for name, dial, kind, r0, r1, t0, t1 in DIAL.get(rid, []):
            u = np.load(os.path.join(C.WORK, 'unwrap_%s_%s.npy' % (rid, dial))).astype(np.float64)
            ok = np.load(os.path.join(C.WORK, 'unwrap_%s_%s_valid.npy' % (rid, dial)))
            rh = np.linspace(0.45, 1.05, u.shape[0])
            if r0 < 0.45:  # the hub lies inside the unwrap: sample the frame directly
                rho, tt = C.dial_coords(flin.shape, dials[dial])
                m = (rho > r0) & (rho < r1) & fvalid
                s = stats(flat_select(flin[m]))
            else:
                th = -150 + np.arange(u.shape[1]) / 4.0
                s = dial_sample(u, ok, rh, th, kind, r0, r1, t0, t1, NEEDLE.get((rid, dial)))
            if s is not None:
                out['%s.%s' % (name, dial)] = s
        for name, kind, x0, y0, x1, y1 in BOX.get(rid, []):
            s = box_sample(lin, kind, x0, y0, x1, y1)
            if s is not None:
                out[name] = s
        black, white, wclip = ref_levels(rid, out)
        for k, s in out.items():
            s['L'] = (s['Y'] - black) / max(white - black, 1e-6)
            s['rgb_rel'] = (np.asarray(s['rgb']) - black) / max(white - black, 1e-6)
        res[rid] = {'frame': src, 'black_Y': black, 'white_Y': white, 'white_clip_frac': wclip, 'samples': out}
        print('== %s black %.4f white %.3f (clipped %.0f %%)' % (rid, black, white, 100 * wclip))
        for k, s in out.items():
            print('  %-22s Y %.4f L %.3f clip %.2f n %5d srgb %s' % (
                k, s['Y'], s['L'], s['clip'], s['n'], [int(round(x)) for x in C.l2s(s['rgb'])]))
    C.jdump(res, os.path.join(C.WORK, 'materials.json'))


if __name__ == '__main__':
    main()
