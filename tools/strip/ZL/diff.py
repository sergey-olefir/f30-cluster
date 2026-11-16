"""Package ZL: the pixel diff of zone L (x 0-700, y 540-720) - stock light from the photos against OUR coverage
(package O's maps, bake/work/strip/pub/O/maps/<layout>/<mode>/<state>/).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with scipy \
        python -I tools/strip/ZL/diff.py [layout ...]

Stock side (4x, through ZL's local models, atlas.py's element alphas): every state is compared with the photo
of the same stock state - drive / unread / drive-clock / limit-end / limit-none / nopass: 61 (D); park: 63 (P,
belts lit); msg*: 62; limit-unknown: 68 ("---"); standby (O's: P, engine off): 63 - package H
found BMW draws its full row there; 65 is BMW's real standby, which no O state reproduces. Stock light is "lit" where the photo's luminance
minus the display's black is above 4 % of stock white text (the range digits' ink = 1.0); its colour is the
photo's linear RGB minus black, in the same unit.

What must show (owner's decisions, brief 1.2 / 1.3 / 1.5 / 1.6):
  allG20, not standby           range, clock, sign (if the state has one), the belt group
  all6WB, row healthy           the belt group only (range, clock, sign, BMW's dial foot: hidden; the clock is
                                ours in all6WB by decision 1.4, so BMW's clock showing is a LEAK even today)
  all6WB, a row item latched    the whole row goes back to BMW (1.5): as allG20
  standby (P, engine off), both modes: BMW's whole row, sign included (decision 1.6 + package H)
Classes per pixel (counts in panel px = 4x samples / 16):
  CLIP    must show and our alpha > 0.02: count and the summed alpha x stock ink alpha
  LEAK    must be hidden, lit, and (1 - our alpha) x its light > 0.02: count and the summed visible light
  SAFETY  any alpha of ours > 1/255 over the belt group (union over every photo with belts lit) dilated 3 px
  DOUBLE  one of our row texts drawn while BMW's same field is visible (> 5 % of its ink)
  SEAM    every 8 x 8 px tile crossed by our coverage's 0.5 contour: the displayed luminance just outside minus
          just inside (bands 0.5-2.5 px either side), in white-text units, and the CIEDE2000 between the two
Writes bake/work/strip/zone-L/diff_<layout>.json and pub/ZL/diff_<layout>.json (numbers only).
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import atlas as A  # noqa: E402

ZD = A.ZD
OD = os.path.join(A.S.LM.ROOT, 'bake', 'work', 'strip', 'pub', 'O', 'maps')
N = 4
ROW0 = int((540 - A.ZB[1]) * N)        # zone row of panel y 540
XMAX = 700 * N
PHOTO = {'drive': '61', 'unread': '61', 'drive-clock': '61', 'limit-end': '61', 'limit-none': '61', 'nopass': '61',
         'park': '63', 'msg': '62', 'msg-long': '62', 'msg-latched': '62', 'road-latched-msg': '62',
         'limit-unknown': '68', 'standby': '63'}
BELTS = ('bottom.belt_rear', 'bottom.belt_driver', 'bottom.airbag')
BELT_PHOTOS = ('62', '63', '64', '66', '67')


def alpha_el(k, p):
    f = os.path.join(ZD, 'alpha', '%s_%s.png' % (k, p))
    im = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
    return None if im is None else im.astype(np.float32) / 255.0


def belt_group():
    g = None
    for p in BELT_PHOTOS:
        for k in BELTS:
            a = alpha_el(k, p)
            if a is not None:
                g = a if g is None else np.maximum(g, a)
    return g


def lab(rgb):
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = np.clip(rgb, 0, None) @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def de2000(l1, l2):
    L1, a1, b1 = l1
    L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0:
        dh = 0
    elif dh > 180:
        dh -= 360
    elif dh < -180:
        dh += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    else:
        hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = 1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp)) \
        + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63))
    dth = 30 * math.exp(-((hbp - 275) / 25) ** 2)
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


_stock = {}


def stock(p):
    """display-relative stock light of photo p over the zone (rows from y 540): rgb, lum (white text = 1)"""
    if p in _stock:
        return _stock[p]
    at = json.load(open(os.path.join(ZD, 'atlas_%s.json' % p)))
    lin, _ = A.lin_of(p)
    lin = lin[ROW0:, :XMAX + 16]
    W = at['white_text_lum_linear']
    blk = at['black_lum_linear_p20_p50_p80'][0]
    rgb = np.clip(lin - blk, 0, None) / W
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    els = {}
    for k in at['elements']:
        a = alpha_el(k, p)
        if a is not None:
            els[k] = a[ROW0:, :XMAX + 16]
    _stock[p] = (rgb, lum, els, W)
    return _stock[p]


def ours(layout, mode, state):
    d = os.path.join(OD, layout, mode, state)
    a = cv2.imread(os.path.join(d, 'alpha_4x.png'), cv2.IMREAD_UNCHANGED)
    rg = cv2.imread(os.path.join(d, 'rgba_4x.png'), cv2.IMREAD_UNCHANGED)
    if a is None or rg is None:
        return None
    a = a[:, :XMAX + 16].astype(np.float32) / 65535.0
    c = rg[:, :XMAX + 16, :3][..., ::-1].astype(np.float64) / 65535.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    bd = json.load(open(os.path.join(d, 'breakdown.json')))
    return a, lin * a[..., None], bd


def must_show(mode, state, els, belts):
    healthy = state not in ('msg-latched', 'road-latched-msg')
    show = belts > 0.5
    req = []
    # O's 'standby' is P with the engine off (hud.js: P + rpm < 150). Package H (2026-11-16): BMW draws its FULL
    # normal row there (62, 63 are P, engine off); its real standby screen (65) is another vehicle condition.
    # Decision 1.6 makes that state BMW's row in both modes, so it is compared with 63 and must show the sign too.
    if mode == 'allG20' or not healthy or state == 'standby':
        req = ['bottom.range', 'bottom.clock'] + ([] if state == 'limit-none' else ['assist.speed_limit'])
    for k in req:
        if k in els:
            show = show | (els[k] > 0.5)
    return show, req


def run(layout):
    belts_full = belt_group()
    belts = belts_full[ROW0:, :XMAX + 16]
    belt_zone = cv2.dilate((belts > 0.02).astype(np.uint8), np.ones((2 * 3 * N + 1, 2 * 3 * N + 1), np.uint8)) > 0
    res = {'layout': layout, 'zone': [0, 540, 700, 720], 'states': {}}
    for mode in ('allG20', 'all6WB'):
        for state, p in PHOTO.items():
            o = ours(layout, mode, state)
            if o is None:
                continue
            a, prem, bd = o
            rgb, lum, els, W = stock(p)
            h = min(a.shape[0], lum.shape[0])
            a, prem, rgb, lum = a[:h], prem[:h], rgb[:h], lum[:h]
            show, req = must_show(mode, state, {k: v[:h] for k, v in els.items()}, belts[:h])
            show_d = cv2.dilate(show.astype(np.uint8), np.ones((21, 21), np.uint8)) > 0   # 2.5 px: blur + glyph halo belong to the item
            lit = lum > 0.04
            hide = lit & ~show_d
            cols = np.arange(a.shape[1]) < XMAX
            show &= cols
            hide &= cols
            ink = np.zeros_like(lum)
            for k in req:
                if k in els:
                    ink = np.maximum(ink, els[k][:h])
            ink = np.maximum(ink, belts[:h])
            clip = show & (a > 0.02)
            vis = (1 - a) * lum
            leak = hide & (vis > 0.02)
            saf = belt_zone[:h] & (a > 1 / 255.0) & cols
            st = {'photo': p, 'must_show': req + ['belt group'],
                  'CLIP': {'px': round(clip.sum() / 16, 1), 'sum_alpha_x_ink': round(float((a * ink)[clip].sum()) / 16, 2)},
                  'LEAK': {'px': round(leak.sum() / 16, 1), 'sum_visible_light': round(float(vis[leak].sum()) / 16, 2)},
                  'SAFETY': {'px': round(saf.sum() / 16, 1), 'max_alpha': round(float(a[saf].max()) if saf.any() else 0.0, 3)}}
            # where the CLIPs and LEAKs are: by element / blob
            for nm, m in (('CLIP', clip), ('LEAK', leak), ('SAFETY', saf)):
                lab_, n = ndi.label(cv2.dilate(m.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
                blobs = []
                for i, sl in enumerate(ndi.find_objects(lab_)):
                    mm = m[sl] & (lab_[sl] == i + 1)
                    if mm.sum() < 8:
                        continue
                    yy, xx = np.nonzero(mm)
                    cx, cy = (sl[1].start + xx.mean()) / N, 540 + (sl[0].start + yy.mean()) / N
                    owner = [k for k, v in els.items() if (v[:h][sl][mm] > 0.3).any()]
                    blobs.append({'box': [round(sl[1].start / N, 1), round(540 + sl[0].start / N, 1),
                                          round(sl[1].stop / N, 1), round(540 + sl[0].stop / N, 1)],
                                  'px': round(mm.sum() / 16, 1),
                                  'weight': round(float((a if nm != 'LEAK' else vis)[sl][mm].sum()) / 16, 2),
                                  'element': owner[0] if owner else A.region_of(cx, cy)})
                blobs.sort(key=lambda b: -b['weight'])
                st[nm]['where'] = blobs[:12]
            # DOUBLE: our row text over a still-visible BMW field
            dbl = []
            for t in bd.get('texts', []):
                if not t.get('ink_a002') or t['id'] not in ('own_range', 'own_range_u', 'own_range_icon', 'own_clock'):
                    continue
                k = 'bottom.clock' if 'clock' in t['id'] else 'bottom.range'
                if k not in els:
                    continue
                e = els[k][:h] * cols
                frac = float((e * (1 - a)).sum() / max(e.sum(), 1e-6))
                if frac > 0.05:
                    dbl.append({'ours': t['id'], 'bmw': k, 'bmw_visible_fraction': round(frac, 3)})
            st['DOUBLE'] = dbl
            # SEAMS
            disp = prem @ np.array([0.2126, 0.7152, 0.0722]) + (1 - a) * lum
            disp_rgb = prem + (1 - a)[..., None] * rgb
            inside = a > 0.5
            din = ndi.distance_transform_edt(inside) / N
            dout = ndi.distance_transform_edt(~inside) / N
            band_in = inside & (din > 0.5) & (din <= 2.5)
            band_out = ~inside & (dout > 0.5) & (dout <= 2.5)
            edge = (inside & (din <= 0.5)) & cols
            seams = []
            T = 8 * N
            for j0 in range(0, h, T):
                for i0 in range(0, XMAX, T):
                    sl = (slice(max(j0 - 3 * N, 0), j0 + T + 3 * N), slice(max(i0 - 3 * N, 0), i0 + T + 3 * N))
                    if edge[j0:j0 + T, i0:i0 + T].sum() < N:
                        continue
                    bi, bo = band_in[sl], band_out[sl]
                    if bi.sum() < 4 or bo.sum() < 4:
                        continue
                    li, lo = float(disp[sl][bi].mean()), float(disp[sl][bo].mean())
                    ci, co = disp_rgb[sl][bi].mean(0), disp_rgb[sl][bo].mean(0)
                    de = de2000(lab(ci), lab(co))
                    seams.append({'tile': [i0 / N, 540 + j0 / N, (i0 + T) / N, 540 + (j0 + T) / N],
                                  'edge_len_px': round(edge[j0:j0 + T, i0:i0 + T].sum() / N, 1),
                                  'lum_out_minus_in': round(lo - li, 4), 'lum_in': round(li, 4), 'lum_out': round(lo, 4),
                                  'dE2000': round(de, 2),
                                  'owner_near': A.region_of(i0 / N + 4, 540 + j0 / N + 4)})
            seams.sort(key=lambda s: -abs(s['lum_out_minus_in']) * s['edge_len_px'])
            st['SEAM'] = {'tiles': len(seams), 'top': seams[:250],
                          'over_0.02': sum(1 for s in seams if abs(s['lum_out_minus_in']) > 0.02)}
            # semi-transparent coverage over stock light that is neither ink nor intended soft edge: reported by O
            res['states'][mode + '/' + state] = st
            print(layout, mode, state, p, 'CLIP', st['CLIP'], 'LEAK', st['LEAK']['px'], st['LEAK']['sum_visible_light'],
                  'SAFETY', st['SAFETY']['px'], 'DOUBLE', dbl, 'SEAMs>0.02', st['SEAM']['over_0.02'], flush=True)
    json.dump(res, open(os.path.join(ZD, 'diff_%s.json' % layout), 'w'), indent=1)
    pub = os.path.join(A.S.LM.ROOT, 'bake', 'work', 'strip', 'pub', 'ZL')
    os.makedirs(pub, exist_ok=True)
    json.dump(res, open(os.path.join(pub, 'diff_%s.json' % layout), 'w'), indent=1)


if __name__ == '__main__':
    for lay in (sys.argv[1:] or ['wb_dials', 'wb_sport_dials']):
        if os.path.isdir(os.path.join(OD, lay)):
            run(lay)
        else:
            print(lay, ': no maps from O yet')
