"""Package VC: gradients, vignettes and the needle's cross-section.

1. Band shading model: on the valid band pixels (rho 0.60..0.88, numerals out), a fit of
       Y(rho, theta) = exp(a0 + a1 * (rho - 0.74) + a2 * c(theta)),   c = cos(theta)  (1 at 12 o'clock, -0.7 at +-135)
   i.e. a radial exponential ramp times an angular one, per reference and dial; the fit's rms (log units) says how
   well two separable ramps describe it. Also the band's inner and outer level at theta 0 and at +-110.
2. The scale band's lower ends ('feet', theta beyond the scale) and the inner disc's rim shading.
3. The needle: located (as materials.py) and its cross-profile: for offsets 0..8 deg (as arc length in R at
   rho 0.75) the median over rho 0.65..0.85 of linear RGB minus the band at the same rho 10..14 deg away; the core's
   half-width at half maximum and the glow's level at 2 / 4 / 6 core widths.
4. The centre window's background: the median Y per row between the dials (x from the left dial's centre + 1.15 R
   to the right one's - 1.15 R, text out), from the tab bar to the bottom row, as a vertical profile.

Writes bake/work/twin-dial/VC/gradients.json.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from profiles import NEEDLE, load  # noqa: E402

FACELIFT = ('02', '04', '05')


def band_fit(u, ok, rh, th, nd):
    rsel = (rh >= 0.60) & (rh <= 0.88)
    tsel = (th >= -125) & (th <= 125)
    if nd is not None:
        tsel &= np.abs(((th - nd[0]) + 180) % 360 - 180) > nd[1]
    sub = u[rsel][:, tsel]
    oks = ok[rsel][:, tsel]
    R, T = np.meshgrid(rh[rsel], th[tsel], indexing='ij')
    Y = C.lum(sub)
    # numerals out: brighter than 1.6 x the running median of their row
    med_row = np.median(np.where(oks, Y, np.nan), axis=1, keepdims=True)
    m = oks & (Y > 1e-4) & (Y < 1.6 * np.nan_to_num(med_row, nan=1.0) * np.exp(1.2))
    # a two-pass robust fit (the second drops > 2.5 sigma)
    A = np.c_[np.ones(m.sum()), R[m] - 0.74, np.cos(np.radians(T[m]))]
    y = np.log(Y[m])
    keep = np.ones(len(y), bool)
    for _ in range(3):
        coef = np.linalg.lstsq(A[keep], y[keep], rcond=None)[0]
        r = y - A @ coef
        sd = np.std(r[keep])
        keep = np.abs(r) < 2.5 * sd
    rgb = np.median(sub[m], axis=0)
    return {'a0': coef[0], 'a1_per_R': coef[1], 'a2_cos': coef[2], 'rms_log': float(np.std(r[keep])),
            'n': int(keep.sum()), 'chroma_rgb_over_Y': rgb / max(C.lum(rgb), 1e-6),
            'Y_at': {'%s@%d' % (k, t): float(np.exp(coef[0] + coef[1] * (rv - 0.74) + coef[2] * np.cos(np.radians(t))))
                     for k, rv in (('in0.60', 0.60), ('out0.88', 0.88)) for t in (0, 110)}}


def feet(u, ok, rh, th):
    res = {}
    for side, (t0, t1) in (('left', (-146, -138)), ('right', (138, 146))):
        rsel = (rh >= 0.62) & (rh <= 0.86)
        tsel = (th >= t0) & (th <= t1)
        sub = u[rsel][:, tsel]
        oks = ok[rsel][:, tsel]
        if oks.sum() < 30:
            continue
        px = sub[oks]
        Y = C.lum(px)
        px = px[Y < 2 * np.median(Y) + 0.003]
        res[side] = {'rgb': np.median(px, axis=0), 'Y': float(np.median(C.lum(px))), 'n': int(len(px))}
    return res


def needle(u, rh, th, nd):
    rsel = (rh >= 0.65) & (rh <= 0.85)
    sub = u[rsel]
    score = np.median(np.maximum(C.lum(sub), sub[..., 0] - sub[..., 1]), axis=0)
    near = np.abs(th - nd[0]) <= 25
    t_n = float(th[near][np.argmax(score[near])])
    deg_per_R = np.degrees(1 / 0.75)
    offs = np.arange(0, 8.01, 0.25)
    prof = []
    for o in offs:
        vals = []
        for sgn in (-1, 1):
            j = np.argmin(np.abs(th - (t_n + sgn * o)))
            vals.append(sub[:, j])
        prof.append(np.median(np.concatenate(vals), axis=0))
    prof = np.array(prof)
    bg_cols = [np.argmin(np.abs(th - (t_n + s * d))) for s in (-1, 1) for d in (10, 12, 14)]
    bg = np.median(sub[:, bg_cols].reshape(-1, 3), axis=0)
    ex = prof - bg
    exY = C.lum(ex)
    core = exY[0]
    hw = next((offs[i] for i in range(len(offs)) if exY[i] < 0.5 * core), offs[-1])
    out = {'theta': t_n, 'core_rgb': prof[0], 'bg_rgb': bg, 'core_excess_Y': float(core),
           'hwhm_deg': float(hw), 'hwhm_R': float(np.radians(hw) * 0.75),
           'profile_deg': offs, 'excess_Y': exY, 'excess_rgb': ex}
    for k in (2, 4, 6):
        o = k * hw
        i = np.argmin(np.abs(offs - o))
        out['glow_at_%dhw' % k] = float(exY[i] / max(core, 1e-6))
        out['glow_rgb_at_%dhw' % k] = ex[i]
    return out


def centre_column(rid):
    lin, valid, dials, _ = C.frame(rid)
    (lx, ly, lr, _, _), (rx, ry, rr, _, _) = dials['tacho'], dials['speedo']
    x0, x1 = int(lx + 1.15 * lr), int(rx - 1.15 * rr)
    if x1 - x0 < 20:
        return None
    y0, y1 = int(ly - 1.0 * lr), int(ly + 1.0 * lr)
    rows = []
    for y in range(max(0, y0), min(lin.shape[0], y1), 4):
        px = lin[y, x0:x1][valid[y, x0:x1]]
        if len(px) < 10:
            rows.append(None)
            continue
        Y = C.lum(px)
        q = np.percentile(Y, 30)  # text and pictures out: the darker part of the row is the background
        bgp = px[Y <= q]
        rows.append({'y_R': (y + 0.5 - ly) / lr, 'Y30': float(q), 'rgb30': np.median(bgp, axis=0)})
    return {'x_R': [(x0 - lx) / lr, (x1 - lx) / lr], 'rows': rows}


def main():
    out = {}
    for rid in sorted(C.REFS):
        out[rid] = {}
        for name in ('tacho', 'speedo'):
            u, ok, rh, th = load(rid, name)
            nd = NEEDLE.get((rid, name))
            e = {'needle': needle(u, rh, th, nd)}
            if rid in FACELIFT:
                e['band_fit'] = band_fit(u, ok, rh, th, nd)
                e['feet'] = feet(u, ok, rh, th)
            out[rid][name] = e
            bf = e.get('band_fit')
            n = e['needle']
            print(rid, name, 'needle th %.1f core %s hwhm %.2f deg glow2/4/6 %.3f %.3f %.3f' % (
                n['theta'], [int(x) for x in C.l2s(n['core_rgb'])], n['hwhm_deg'], n['glow_at_2hw'],
                n['glow_at_4hw'], n['glow_at_6hw']))
            if bf:
                print('   band: a1 %.2f /R  a2(cos) %.2f  rms %.2f  Y %s' % (
                    bf['a1_per_R'], bf['a2_cos'], bf['rms_log'],
                    {k: round(v, 4) for k, v in bf['Y_at'].items()}), 'feet',
                    {k: [int(x) for x in C.l2s(v['rgb'])] for k, v in e['feet'].items()})
        out[rid]['centre'] = centre_column(rid)
        cc = out[rid]['centre']
        if cc:
            print('   centre x_R %s:' % [round(x, 2) for x in cc['x_R']],
                  ' '.join('%.2f:%d' % (r['y_R'], int(C.l2s(r['Y30']))) for r in cc['rows'][::6] if r))
    C.jdump(out, os.path.join(C.WORK, 'gradients.json'))


if __name__ == '__main__':
    main()
