#!/usr/bin/env python3
"""KC (round 3b): how close are our pictures to the rectified references, as numbers.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/mockup/compare_r3b.py
        [--pics <dir with A02.png A03.png ...>] [--out bake/work/twin-dial/mockup/r3b/kc/compare.json]

A region of our picture and the same region of a rectified reference (VR 02, SD 06: git-ignored, photo-derived; no reference
pixel is written anywhere but the git-ignored contact sheets) are brought to one scale (the reference's R = 400 px is our
R = 300 px: 0.75; a dial about its own centre, the frame about the midpoint of the two centres) and compared:
  ink ratio        bright-or-red pixels of ours / of the reference (ink = max channel >= 150, or red);
  centroid shift   ours minus reference, panel px (dx, dy) of the ink's centre of mass;
  recall 2 px      share of the reference's ink with our ink within 2 px;   precision 2 px  the converse;
  colour dE        CIE76 between the mean colours of (a) the ink pixels and (b) the non-ink pixels of the region (the band);
  row profile r    Pearson correlation of the rows' ink sums (layout similarity that does not depend on the glyphs).
A dial is compared on the annulus rho 0.55..1.04, |angle| <= 146 deg, the needle's sector (+-6 deg, found in each picture) and
the hub excluded. The known, deliberate differences are named in `deliberate` per comparison.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
WORK = os.path.join(ROOT, 'bake', 'work', 'twin-dial')
KC = os.path.join(WORK, 'mockup', 'r3b', 'kc')
R = 300.0
S = 0.75                                         # ours / reference (300 / 400)
CT, CS = (380.0, 400.0), (1540.0, 400.0)
M_OURS = (960.0, 400.0)
REFS = {'06': os.path.join(WORK, 'r3', 'pub', 'SD', '06_rect.png'), '02': os.path.join(WORK, 'pub', 'VR', '02_rect.png'),
        '08': os.path.join(WORK, 'r3', 'pub', 'SD', '08_rect.png'), '04': os.path.join(WORK, 'pub', 'VR', '04_rect.png')}
MODELS = {'06': os.path.join(WORK, 'r3', 'pub', 'SD', '06_model.json'), '02': os.path.join(WORK, 'pub', 'VR', '02_model.json'),
          '08': os.path.join(WORK, 'r3', 'pub', 'SD', '08_model.json'), '04': os.path.join(WORK, 'pub', 'VR', '04_model.json')}


def load_ref(rid):
    img = np.asarray(Image.open(REFS[rid]).convert('RGB'))
    cv = json.load(open(MODELS[rid]))['canvas']
    return img, cv['left_centre'], cv['right_centre']


def to_ours(ref_img, anchor_ref, anchor_ours, box_ours):
    """The reference region that lands on box_ours (x0, y0, x1, y1 panel px), resampled to ours' pixel grid."""
    x0, y0, x1, y1 = box_ours
    rx0, ry0 = anchor_ref[0] + (x0 - anchor_ours[0]) / S, anchor_ref[1] + (y0 - anchor_ours[1]) / S
    rx1, ry1 = anchor_ref[0] + (x1 - anchor_ours[0]) / S, anchor_ref[1] + (y1 - anchor_ours[1]) / S
    im = Image.fromarray(ref_img)
    out = im.transform((int(x1 - x0), int(y1 - y0)), Image.EXTENT, (rx0, ry0, rx1, ry1), Image.BICUBIC, fillcolor=(0, 0, 0))
    return np.asarray(out)


def ink_of(a):
    a = a.astype(int)
    mx = a.max(-1)
    red = (a[..., 0] >= 150) & (a[..., 1] <= 90) & (a[..., 2] <= 90)
    return (mx >= 150) | red


def dilate(m, r=2):
    p = np.pad(m, r)
    out = np.zeros_like(m)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + 0.5:
                out |= p[r + dy:r + dy + m.shape[0], r + dx:r + dx + m.shape[1]]
    return out


def lab(rgb):
    c = np.asarray(rgb, float) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    X = c @ np.array([[0.4124, 0.2126, 0.0193], [0.3576, 0.7152, 0.1192], [0.1805, 0.0722, 0.9505]])
    X = X / np.array([0.95047, 1.0, 1.08883])
    f = np.where(X > 0.008856, np.cbrt(X), 7.787 * X + 16 / 116)
    return np.array([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])])


def dE(a, b):
    return float(np.linalg.norm(lab(a) - lab(b)))


def metrics(ours, ref, mask):
    io, ir = ink_of(ours) & mask, ink_of(ref) & mask
    n_o, n_r = int(io.sum()), int(ir.sum())
    res = dict(ink_px_ours=n_o, ink_px_ref=n_r, ink_ratio=round(n_o / max(n_r, 1), 3))
    if n_o and n_r:
        yo, xo = np.nonzero(io)
        yr, xr = np.nonzero(ir)
        res['centroid_shift_px'] = [round(float(xo.mean() - xr.mean()), 2), round(float(yo.mean() - yr.mean()), 2)]
        res['recall_2px'] = round(float((ir & dilate(io)).sum() / n_r), 3)
        res['precision_2px'] = round(float((io & dilate(ir)).sum() / n_o), 3)
        res['dE_ink'] = round(dE(ours[io].mean(0), ref[ir].mean(0)), 1)
    bo, br = (~ink_of(ours)) & mask & (ours.max(-1) > 12), (~ink_of(ref)) & mask & (ref.max(-1) > 12)
    if bo.sum() > 50 and br.sum() > 50:
        res['dE_background'] = round(dE(ours[bo].mean(0), ref[br].mean(0)), 1)
        res['background_mean_ours'] = [int(v) for v in ours[bo].mean(0)]
        res['background_mean_ref'] = [int(v) for v in ref[br].mean(0)]
    ro, rr = io.sum(1).astype(float), ir.sum(1).astype(float)
    if ro.std() > 0 and rr.std() > 0:
        res['row_profile_r'] = round(float(np.corrcoef(ro, rr)[0, 1]), 3)
    return res


def needle_angle(img, c):
    """The needle's angle by the white ink in rho 0.47..0.53 (inside the rim, outside the hub text)."""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    X, Y = xs + 0.5 - c[0], ys + 0.5 - c[1]
    rho = np.hypot(X, Y) / R
    ang = np.degrees(np.arctan2(X, -Y))
    sel = ink_of(img) & (rho >= 0.47) & (rho <= 0.53) & (np.abs(ang) <= 146)
    if sel.sum() < 15:
        return None
    a = np.radians(ang[sel])
    return float(np.degrees(np.arctan2(np.sin(a).mean(), np.cos(a).mean())))


def compare_dial(ours_img, ref_id, side):
    ref, lc, rc = load_ref(ref_id)
    c_o = CT if side == 'tach' else CS
    c_r = lc if side == 'tach' else rc
    box = (int(c_o[0] - 1.04 * R), int(c_o[1] - 1.04 * R), int(c_o[0] + 1.04 * R), int(c_o[1] + 1.04 * R))
    o = ours_img[box[1]:box[3], box[0]:box[2]]
    r = to_ours(ref, c_r, c_o, box)
    h, w = o.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    X, Y = xs + 0.5 - (c_o[0] - box[0]), ys + 0.5 - (c_o[1] - box[1])
    rho = np.hypot(X, Y) / R
    ang = np.degrees(np.arctan2(X, -Y))
    mask = (rho >= 0.55) & (rho <= 1.04) & (np.abs(ang) <= 146)
    cn = (c_o[0] - box[0], c_o[1] - box[1])
    ao, ar = needle_angle(o, cn), needle_angle(r, cn)
    for a in (ao, ar):
        if a is not None:
            mask &= np.abs(((ang - a + 180) % 360) - 180) > 6
    res = metrics(o, r, mask)
    res.update(needle_ours_deg=None if ao is None else round(ao, 1), needle_ref_deg=None if ar is None else round(ar, 1))
    return res, o, r


def compare_box(ours_img, ref_id, box, mask_fn=None):
    ref, lc, rc = load_ref(ref_id)
    mref = ((lc[0] + rc[0]) / 2.0, (lc[1] + rc[1]) / 2.0)
    o = ours_img[box[1]:box[3], box[0]:box[2]]
    r = to_ours(ref, mref, M_OURS, box)
    mask = np.ones(o.shape[:2], bool) if mask_fn is None else mask_fn(o.shape[:2])
    return metrics(o, r, mask), o, r


def sel_fill(ours_img, ref_id, cell_ours, rows=(158, 168)):
    """The selected tab's fill at the bottom of its cell: ours against the reference's selected tab 1 (median colour)."""
    ref, lc, rc = load_ref(ref_id)
    mref = ((lc[0] + rc[0]) / 2.0, (lc[1] + rc[1]) / 2.0)
    box = (cell_ours[0] + 6, rows[0], cell_ours[1] - 6, rows[1])
    o = ours_img[box[1]:box[3], box[0]:box[2]].reshape(-1, 3)
    r = to_ours(ref, mref, M_OURS, box).reshape(-1, 3)
    mo, mr = np.median(o, 0), np.median(r, 0)
    return dict(ours_rgb=[int(v) for v in mo], ref_rgb=[int(v) for v in mr], dE=round(dE(mo, mr), 1))


def sheet_pair(o, r, path, scale=1.0):
    """git-ignored contact sheet: ours | reference (labelled 'reference, not ours') | |difference| of the ink maps."""
    from PIL import ImageDraw
    h, w = o.shape[:2]
    io, ir = ink_of(o), ink_of(r)
    diff = np.zeros((h, w, 3), np.uint8)
    diff[io & ir] = (200, 200, 200)
    diff[io & ~ir] = (60, 160, 255)
    diff[~io & ir] = (255, 150, 40)
    pad = 24
    out = Image.new('RGB', (w * 3 + 40, h + pad), (20, 20, 20))
    for k, (im, t) in enumerate(((o, 'ours'), (r, 'reference, not ours'), (diff, 'both grey / ours blue / reference orange'))):
        out.paste(Image.fromarray(im), (k * (w + 20), pad))
        ImageDraw.Draw(out).text((k * (w + 20) + 4, 6), t, fill=(230, 230, 230))
    if scale != 1.0:
        out = out.resize((int(out.width * scale), int(out.height * scale)), Image.LANCZOS)
    out.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pics', default=os.path.join(KC, 'pictures'))
    ap.add_argument('--r3', default=os.path.join(WORK, 'mockup', 'r3'))
    ap.add_argument('--out', default=os.path.join(KC, 'compare.json'))
    ap.add_argument('--tab-bar', default=None, help='our picture of the tab bar with tab 1 selected (KB T01)')
    ap.add_argument('--clock', default=None, help='our date and time page (KB 1A)')
    ap.add_argument('--trip', default=None, help='our trip page (KB 1B)')
    ap.add_argument('--dials', default=None, help='our full picture with both dials in the base look (KA A01)')
    a = ap.parse_args()
    res, sheets = {}, os.path.join(KC, 'compare_sheets')
    os.makedirs(sheets, exist_ok=True)

    def load(p):
        return np.asarray(Image.open(p).convert('RGB'))
    if a.dials and os.path.exists(a.dials):
        img = load(a.dials)
        for side, pid in (('tach', 'A02'), ('speed', 'A03')):
            for rid in ('06', '02'):
                m, o, r = compare_dial(img, rid, side)
                m['deliberate'] = ['our needle and hub text differ (masked)', "06's red arc ends at 125.2 deg, ours at 143.6",
                                   'our numeral shadow is SD\'s measured model, 06\'s is the photograph', 'our small numerals 10 30 50 70 160 200 240 280 only']
                res['%s_vs_%s' % (pid, rid)] = m
                sheet_pair(o, r, os.path.join(sheets, '%s_vs_%s.png' % (pid, rid)))
    if a.tab_bar and os.path.exists(a.tab_bar):
        img = load(a.tab_bar)
        m, o, r = compare_box(img, '06', (618, 127, 1302, 172))
        m['selected_fill_tab1'] = sel_fill(img, '06', (618, 780))
        m['deliberate'] = ['our tab texts and icons differ (range text, our pictograms)', 'separators 780 / 848 are ours, 06 has the maker\'s own widths',
                           'our fifth tab is the navigation tab, 06\'s sixth does not exist']
        res['T06_vs_06'] = m
        sheet_pair(o, r, os.path.join(sheets, 'T06_vs_06.png'))
    for name, path, rid in (('1A', a.clock, '06'), ('1B', a.trip, '02')):
        if path and os.path.exists(path):
            img = load(path)
            m, o, r = compare_box(img, rid, (729, 172, 1191, 613))
            m['deliberate'] = ['our large Saira clock (the owner keeps it), our language (Ukrainian), no side gauges']
            res['%s_vs_%s' % (name, rid)] = m
            sheet_pair(o, r, os.path.join(sheets, '%s_vs_%s.png' % (name, rid)))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(dict(generator='tools/twin-dial/mockup/compare_r3b.py', scale='ours R 300 = reference R 400 (0.75)', comparisons=res),
              open(a.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(res, indent=1, ensure_ascii=False)[:3000])


if __name__ == '__main__':
    main()
