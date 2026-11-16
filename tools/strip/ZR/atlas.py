"""Package ZR: the stock atlas of the right zone of the strip (x 1240-1920, y 540-720).

Reads 4x crops of the right zone (x 1180-1920, y 520-720, crop index j <-> continuous panel x = 1180 + j/4 + 0.5),
either package ZR's provisional ones (bake/work/strip/zone-R/lreg/<id>_R4.png) or crops cut from package R's
rects (--src R: bake/work/strip/rect/<id>_strip_4x.png, x 0-1920, y 540-720, 16-bit).

For every element and every photo it appears in:
  ink   = linear luminance minus the local background (a grey opening wider than any stroke), so text on BMW's
          red face glow is measured the same way as text on black;
  edge  = the 50 % contour of the ink (threshold at half the element's robust peak), sub-pixel from the 4x grid;
  blur  = 10-90 % edge-spread width across the element's own sharpest vertical edges, panel px;
  colour= mean linear RGB of the core (ink > 0.8 peak), also as sRGB, and its luminance relative to the
          temperature text's core in the same photo (stock white text = 1.0);
  halo  = mean ink against the distance outside the 50 % contour, 0-12 panel px;
  glyphs= the connected parts of the 50 % mask, each with its ink box (for the text metrics).

Writes design/strip/ZR/atlas.json (numbers only) and, git-ignored, bake/work/strip/zone-R/atlas/<elem>_<id>_a4.png
(the 4x alpha mask) and the polygons. No photo pixel goes into a tracked file.
"""
import argparse
import json
import os

import cv2
import numpy as np

MAIN = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
N = 4

# element id -> (search window [x0, y0, x1, y1] panel, background kind, photos it is lit in)
ELEMENTS = {
    'assist.info_tacho#info': ([1240, 582, 1290, 634], 'black', ['62', '63']),
    'assist.info_tacho#warn': ([1236, 582, 1294, 634], 'black', ['66', '67']),
    'assist.rpm_label':       ([1414, 568, 1510, 630], 'face', ['60', '61', '62', '63', '64', '66', '67']),
    'assist.msa':             ([1396, 562, 1512, 624], 'face', ['68']),
    'assist.off':             ([1511, 574, 1572, 608], 'face', ['62', '63', '65']),
    'structure.tacho.num0':   ([1514, 566, 1551, 616], 'face', ['61', '64', '66', '67', '68']),
    'bottom.temperature':     ([1528, 658, 1676, 708], 'black', ['60', '61', '62', '63', '64', '65', '66', '67', '68']),
    'assist.mode_label':      ([1212, 652, 1366, 716], 'black', ['60', '65', '14', '17']),
    'assist.gear':            ([1388, 660, 1432, 708], 'black', ['60', '14', '17']),
    'assist.cold':            ([1834, 626, 1914, 666], 'black', ['60', '65', '66']),
    'structure.oil_mini.icon': ([1840, 598, 1914, 634], 'black', ['61', '62', '63', '64', '65', '66', '67', '68']),
}


def srgb_to_lin(v):
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255


class Crop:
    """A 4x crop. `half` is where sample 0 sits: ZR's crops sample continuous x0 + j/4 + 0.5 (half = 0.5),
    package R's rasters are centred, continuous x0 + (j + 0.5)/4 (half = 0.125). R's 16-bit strips are already
    linear light (sRGB EOTF of the photo's codes); 8-bit crops are decoded here."""

    def __init__(self, path, x0, y0, half=0.5):
        im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        if im is None:
            raise SystemExit('missing ' + path)
        if im.dtype == np.uint16:
            self.lin = im[..., ::-1].astype(np.float64) / 65535.0
        else:
            self.lin = srgb_to_lin(im[..., ::-1].astype(np.float64))
        self.x0, self.y0, self.half = x0, y0, half
        self.lum = self.lin @ np.array([0.2126, 0.7152, 0.0722])
        self.ink_lum = self.lum

    def grid_safe(self):
        """Photo 60 carries our green grid and yellow labels: measure ink on min(R, G, B), which keeps BMW's white
        and drops both (colour is then not reported for 60)."""
        self.ink_lum = self.lin.min(-1).copy()
        self.grid = True
        # our grid's lines (major [100k, 100k+2), minor [100k+50, 100k+51), plus 1 px of bloom each side) carry
        # no information about BMW's ink under them: zero them, and record that they were not observed
        H, W = self.ink_lum.shape
        xs = self.x0 + np.arange(W) / N + self.half
        ys = self.y0 + np.arange(H) / N + self.half

        def band(v):
            m = np.mod(v, 50.0)
            return (m < 3.0) | (m > 49.0)
        self.ink_lum[:, band(xs)] = 0
        self.ink_lum[band(ys), :] = 0
        return self

    def j(self, x):
        return int(round((x - self.x0 - self.half) * N))

    def i(self, y):
        return int(round((y - self.y0 - self.half) * N))

    def cx(self, j):
        return self.x0 + j / N + self.half

    def cy(self, i):
        return self.y0 + i / N + self.half


def ink_of(c, box, kind):
    x0, y0, x1, y1 = box
    pad = 16
    H, W = c.lum.shape
    j0, i0 = max(c.j(x0 - pad), 0), max(c.i(y0 - pad), 0)
    j1, i1 = min(c.j(x1 + pad), W), min(c.i(y1 + pad), H)
    lum = c.ink_lum[i0:i1, j0:j1]
    rgb = c.lin[i0:i1, j0:j1]
    k = 61 if kind == 'face' else 81
    bg = cv2.morphologyEx(lum.astype(np.float32), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    bg = cv2.GaussianBlur(bg, (0, 0), 6)
    ink = lum - bg
    inner = np.zeros_like(ink, bool)
    inner[c.i(y0) - i0:c.i(y1) - i0, c.j(x0) - j0:c.j(x1) - j0] = True
    return ink, rgb, bg, inner, (j0, i0)


def poly_of(mask, c, off):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for cc in cs:
        if cv2.contourArea(cc) < 16:
            continue
        a = cv2.approxPolyDP(cc, 1.0, True).reshape(-1, 2)
        out.append([[round(c.cx(off[0] + p[0]), 2), round(c.cy(off[1] + p[1]), 2)] for p in a])
    return out


def edge_spread(ink, mask, peak):
    """10-90 % rise across vertical edges: walk rows, find left edges of ink runs, fit the rise in px of the 4x
    crop, return the median in panel px."""
    w = []
    for r in range(0, ink.shape[0], 2):
        row = ink[r] / peak
        for jj in range(4, len(row) - 12):
            if row[jj - 1] < 0.5 <= row[jj] and row[min(jj + 8, len(row) - 1)] > 0.95 and row[max(jj - 9, 0)] < 0.05:
                seg = row[jj - 9:jj + 9]
                try:
                    a = np.where(seg >= 0.1)[0][0]
                    b = np.where(seg >= 0.9)[0][0]
                except IndexError:
                    continue
                w.append((b - a) / N)
    return (round(float(np.median(w)), 2), len(w)) if w else (None, 0)


def halo(ink, mask, peak):
    d = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5) / N
    prof = []
    for k in range(0, 13):
        sel = (d > k) & (d <= k + 1)
        prof.append(round(float(ink[sel].mean() / peak), 4) if sel.any() else None)
    return prof


def measure(c, name, box, kind, white_ref=None):
    ink, rgb, bg, inner, off = ink_of(c, box, kind)
    win = ink.copy()
    win[~inner] = 0
    peak = float(np.percentile(win[inner], 99.7))
    # two passes: parts found at 25 % of the element's peak, each then cut at 50 % of its OWN peak, so thin or
    # dim strokes (the degree ring, 'C') are not lost to the bright digits' bloom
    low = (win > 0.25 * peak) & inner
    n, lab, st, cen = cv2.connectedComponentsWithStats(low.astype(np.uint8), 8)
    mask = np.zeros_like(low)
    for q in range(1, n):
        if st[q, cv2.CC_STAT_AREA] < 20:
            continue
        part = lab == q
        pk = float(np.percentile(win[part], 99))
        mask |= part & (win > 0.5 * pk)
    ys, xs = np.nonzero(mask)
    core = win > 0.8 * peak
    col = rgb[core].mean(0)
    lum_core = float(ink[core].mean())
    bb = [round(c.cx(off[0] + xs.min()) - 0.5 / N * 0 - 0.125, 2), round(c.cy(off[1] + ys.min()) - 0.125, 2),
          round(c.cx(off[0] + xs.max()) + 0.125, 2), round(c.cy(off[1] + ys.max()) + 0.125, 2)]
    glyphs = []
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    for q in range(1, n2):
        x, y, w, h, a = st2[q]
        glyphs.append({'box': [round(c.cx(off[0] + x) - 0.125, 2), round(c.cy(off[1] + y) - 0.125, 2),
                               round(c.cx(off[0] + x + w - 1) + 0.125, 2), round(c.cy(off[1] + y + h - 1) + 0.125, 2)],
                       'area_px': round(a / N / N, 1)})
    glyphs.sort(key=lambda g: g['box'][0])
    es, ne = edge_spread(win, mask, peak)
    # local black level just outside the element (2-6 px from the contour), linear
    d = cv2.distanceTransform((~mask).astype(np.uint8), cv2.DIST_L2, 5) / N
    ring = (d > 3) & (d < 8) & inner
    out = {
        'ink_box': bb,
        'polygon': poly_of(mask, c, off),
        'peak_ink_lin': round(peak, 4),
        'core_rgb_lin': None if getattr(c, 'grid', False) else [round(float(v), 4) for v in col],
        'core_srgb': None if getattr(c, 'grid', False) else [int(round(float(v))) for v in lin_to_srgb(col)],
        'core_lum_lin': round(lum_core, 4),
        'rel_white': round(lum_core / white_ref, 3) if white_ref else None,
        'bg_lum_lin_ring_3_8px': round(float(np.median(c.lum[off[1]:off[1] + ink.shape[0], off[0]:off[0] + ink.shape[1]][ring])), 5),
        'bg_rgb_lin_ring_3_8px': [round(float(v), 5) for v in np.median(rgb[ring], 0)],
        'edge_spread_10_90_px': es, 'edge_samples': ne,
        'halo_rel_0_12px': halo(win, mask, peak),
        'glyphs': glyphs,
    }
    return out, mask, off


def A_DIR():
    return os.path.join(MAIN, 'bake/work/strip/zone-R/atlas')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='lreg', help="'lreg' (ZR provisional) or 'R' (package R's strips)")
    ap.add_argument('--out', default=os.path.join(REPO, 'design', 'strip', 'ZR', 'atlas.json'))
    ap.add_argument('--photos', nargs='*', default=None, help='only these photo ids (default: all that exist)')
    a = ap.parse_args()
    adir = os.path.join(MAIN, 'bake/work/strip/zone-R/atlas', a.src)
    os.makedirs(adir, exist_ok=True)
    crops = {}

    def crop(k):
        if k not in crops:
            if a.src == 'R':
                crops[k] = Crop(os.path.join(MAIN, 'bake/work/strip/rect/%s_strip_4x.png' % k), 0, 540, half=0.125)
            else:
                crops[k] = Crop(os.path.join(MAIN, 'bake/work/strip/zone-R/%s/%s_R4.png' % (a.src, k)), 1180, 520)
            if k == '60':
                crops[k].grid_safe()
        return crops[k]

    res = {'source': a.src, 'convention': 'continuous panel px, pixel (i, j) covers [i, i+1) x [j, j+1)',
           'elements': {}}
    white = {}
    def have(k):
        if a.photos is not None and k not in a.photos:
            return False
        if a.src == 'R':
            return os.path.exists(os.path.join(MAIN, 'bake/work/strip/rect/%s.READY' % k))
        return os.path.exists(os.path.join(MAIN, 'bake/work/strip/zone-R/%s/%s_R4.png' % (a.src, k)))

    for k in ELEMENTS['bottom.temperature'][2]:
        if not have(k):
            continue
        m, _, _ = measure(crop(k), 'bottom.temperature', *ELEMENTS['bottom.temperature'][:2])
        white[k] = m['core_lum_lin']
    for name, (box, kind, photos) in ELEMENTS.items():
        res['elements'][name] = {}
        for k in photos:
            if not have(k):
                continue
            try:
                m, mask, off = measure(crop(k), name, box, kind, white.get(k))
            except Exception as e:  # noqa: BLE001
                res['elements'][name][k] = {'error': str(e)}
                continue
            cv2.imwrite(os.path.join(adir, '%s_%s_a4.png' % (name.replace('#', '-'), k)), (mask * 255).astype(np.uint8))
            res['elements'][name][k] = m
            print(name, k, m['ink_box'], 'rgb', m['core_srgb'], 'relW', m['rel_white'], 'blur', m['edge_spread_10_90_px'],
                  'bg', m['bg_lum_lin_ring_3_8px'], flush=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    # the traced 50 % outlines are a vector copy of BMW's artwork: they stay git-ignored (bake/work, pub/ZR);
    # the tracked file keeps boxes, glyph boxes, metrics and colours only
    full = os.path.join(A_DIR(), 'atlas_%s.json' % a.src)
    json.dump(res, open(full, 'w'), indent=1)
    slim = json.loads(json.dumps(res))
    for per in slim['elements'].values():
        for m in per.values():
            m.pop('polygon', None)
    slim['polygons'] = 'git-ignored: bake/work/strip/zone-R/atlas/atlas_%s.json' % a.src
    json.dump(slim, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
