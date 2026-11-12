"""P10 step 3: the 6WB's own LCD black per reference, vs the black P0 normalised with.

For every reference dial crop (bake/work/rect/<stem>.<mode>.<C>.raw.png: P0's geometry, no exposure step), in the
dial frame (R = bezel outer edge), per channel, in photo code values and linear light:
  - p0_black          P0's anchor (refs.json exposure.black, a luminance code value): 5th pct of 1.0-1.08 R
  - ring_out_sectors  the 1.0-1.08 R ring split into 12 sectors: p5 / p50 per sector -> where P0's p5 came from
  - groove            the tick groove floor between ticks, 0.925-0.955 R (p10): display black by design
  - outside           the 1.03-1.10 R ring, sectors that are inside the LCD (median over sectors whose p50 is
                      within the display cluster, see below)
  - face              0.55-0.75 R upper half (median): the dial face
  - white             P0's white (mean of the top 0.5 % luminance inside 0.95 R)
The LCD floor = the groove floor (p10), the darkest thing the display draws on purpose, with a low-frequency
veiling-glare map from every display-black sample (groove ring by angle, minis' grooves) where it varies.
Writes bake/work/P10/floors.json and a sheet.
    ./P10/py.sh -m P10.floors
"""
import json, os
import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RECT = os.path.join(ROOT, 'bake', 'work', 'rect')
OUT = os.path.join(ROOT, 'bake', 'work', 'P10')
REFS = json.load(open(os.path.join(ROOT, 'bake', 'manifest', 'refs.json')))['images']
BOX = {'C1': (50, 18, 724, 702), 'C2': (1146, 18, 724, 702), 'C3': (4, 552, 152, 152), 'C4': (1764, 552, 152, 152)}
CEN = {'C1': (412, 380, 335.0), 'C2': (1508, 380, 335.0), 'C3': (80, 628, 70.0), 'C4': (1840, 628, 70.0)}
KEY = ['17_physical-cluster_full', '04_comfort_whole-cluster_mph', '05_comfort_tach-closeup', '03_three-modes_photo_bimmerstop',
       '02_three-modes_clean-render', '07_physical-cluster_all-lamps-lit', '13_ticks_closeup', '15_hub-needle_closeup',
       '12_speedo_signs_overspeed-wedge', '06_comfort_wide_with-wheel', '14_inner-rings_closeup']


def s2l(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(np.asarray(c, np.float64), 0, 1)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def load(stem, mode, cl):
    base = os.path.join(RECT, '%s.%s.%s' % (stem, mode, cl))
    sfx = ''
    if not os.path.exists(base + '.raw.png'):
        for k in ('@4x', '@2x'):
            if os.path.exists(base + k + '.raw.png'):
                sfx = k
                break
        else:
            return None
    raw = cv2.imread(base + sfx + '.raw.png')[..., ::-1].astype(np.float64)
    bits = cv2.imread(base + sfx + '.maskbits.png', cv2.IMREAD_UNCHANGED)
    meta = json.load(open(base + sfx + '.json')) if os.path.exists(base + sfx + '.json') else {}
    k = 1.0 if not sfx else float(sfx[1:-1])
    x0, y0 = BOX[cl][:2]
    if 'box' in meta:
        x0, y0 = meta['box'][:2]
    h, w = raw.shape[:2]
    jj, ii = np.mgrid[0:h, 0:w].astype(np.float64)
    px = x0 + (ii + 0.5) / k; py = y0 + (jj + 0.5) / k
    cx, cy, R = CEN[cl]
    rr = np.hypot(px - cx, py - cy) / R
    th = (np.degrees(np.arctan2(px - cx, -(py - cy))) + 360) % 360       # cw12
    return raw, bits, rr, th


def stats(raw, m, q):
    if m.sum() < 30:
        return None
    v = raw[m]
    return [float(np.percentile(v[:, c], q)) for c in range(3)]


def main():
    out = {}
    for stem in KEY:
        rec = REFS.get(stem + '.png')
        if not rec:
            continue
        for mode, sec in rec['sections'].items():
            if mode != 'comfort' and not stem.startswith(('03_', '02_')):
                continue
            e = sec['exposure']
            r = {'p0_black_luma': e['black'], 'p0_white_luma': e['white'], 'p0_gain': e['gain'], 'p0_wb': e['wb_gain_rgb'], 'dials': {}}
            for cl in ('C1', 'C2', 'C3', 'C4'):
                L = load(stem, mode, cl)
                if L is None:
                    continue
                raw, bits, rr, th = L
                use = bits == 0
                lum = luma(raw)
                d = {}
                ring = use & (rr >= 1.0) & (rr <= 1.08)
                if ring.sum() > 50:
                    d['ring_1.0-1.08_p5_luma'] = float(np.percentile(lum[ring], 5))
                    sec12 = []
                    for s in range(12):
                        m = ring & (th >= s * 30) & (th < s * 30 + 30)
                        if m.sum() > 20:
                            sec12.append([s * 30 + 15, float(np.percentile(lum[m], 5)), float(np.percentile(lum[m], 50)), int(m.sum())])
                    d['ring_sectors_cw12_p5_p50_n'] = sec12
                # groove floor: between the ticks; p10 per 30-degree sector, then the median over sectors
                big = cl in ('C1', 'C2')
                gm = use & ((rr >= 0.925) & (rr <= 0.955) if big else (rr >= 0.60) & (rr <= 0.70))
                gs = []
                for s in range(12):
                    m = gm & (th >= s * 30) & (th < s * 30 + 30)
                    if m.sum() > 20:
                        gs.append([s * 30 + 15] + [float(np.percentile(raw[m][:, c], 10)) for c in range(3)])
                if gs:
                    g = np.array([x[1:] for x in gs])
                    d['groove_p10_rgb_median'] = [float(v) for v in np.median(g, 0)]
                    d['groove_p10_rgb_min'] = [float(v) for v in g[np.argmin(luma(g))]]
                    d['groove_sectors'] = gs
                fm = use & (rr >= 0.55) & (rr <= 0.75) & ((th >= 270) | (th <= 90))
                fs = stats(raw, fm, 50)
                if fs:
                    d['face_upper_p50_rgb'] = fs
                    d['face_upper_p10_rgb'] = stats(raw, fm, 10)
                if d:
                    r['dials'][cl] = d
            # display-black samples: groove sectors (0.925-0.955 R between the ticks, p10) that lie on the LCD. A sector
            # whose groove is under 40 % of its dial's median is the housing (the dial runs off the LCD there: 17, 07
            # bottom) and is dropped. Regions: each dial; the window side (C1 45-135, C2 225-315 cw12); the outer
            # sides (minis: C1 225-315, C2 45-135). The spread over sectors is the veiling-glare variation.
            samp = {}
            for c in ('C1', 'C2'):
                gs = r['dials'].get(c, {}).get('groove_sectors')
                if not gs:
                    continue
                g = np.array(gs)
                lu = luma(g[:, 1:4])
                ok = lu >= 0.4 * np.median(lu)
                r['dials'][c]['groove_sectors_on_lcd'] = [int(a) for a in g[ok, 0]]
                r['dials'][c]['groove_sectors_housing'] = [int(a) for a in g[~ok, 0]]
                samp[c] = g[ok]
            def med(rows):
                rows = [x for x in rows if len(x)]
                if not rows:
                    return None
                a = np.concatenate(rows)
                return [float(v) for v in np.median(a[:, 1:4], 0)]
            def sel(c, a0, a1):
                if c not in samp:
                    return np.zeros((0, 4))
                g = samp[c]
                return g[(g[:, 0] >= a0) & (g[:, 0] <= a1)]
            reg = {'C1': med([samp.get('C1', np.zeros((0, 4)))]), 'C2': med([samp.get('C2', np.zeros((0, 4)))]),
                   'window': med([sel('C1', 45, 135), sel('C2', 225, 315)]),
                   'outer': med([sel('C1', 225, 315), sel('C2', 45, 135)])}
            allf = med(list(samp.values()))
            for k in reg:
                if reg[k] is None:
                    reg[k] = allf
            if allf is not None:
                r['lcd_floor_rgb_code'] = allf
                r['lcd_floor_rgb_lin'] = [float(v) for v in s2l(np.array(allf))]
                r['lcd_floor_luma_code'] = float(luma(np.array(allf)))
                r['floor_by_region_rgb_code'] = reg
                a = np.concatenate(list(samp.values()))
                r['floor_glare_range_luma_code'] = [float(luma(a[:, 1:4]).min()), float(luma(a[:, 1:4]).max())]
            out[stem if mode == 'comfort' else stem + '@' + mode] = r
    json.dump(out, open(os.path.join(OUT, 'floors.json'), 'w'), indent=1)
    for k, r in out.items():
        fl = r.get('lcd_floor_rgb_code')
        print('%-40s P0 black %6.2f white %6.1f | LCD floor %s glare range %s | by region %s' % (k, r['p0_black_luma'], r['p0_white_luma'],
              fl and [round(v, 1) for v in fl], r.get('floor_glare_range_luma_code') and [round(v) for v in r['floor_glare_range_luma_code']],
              {a: b and [round(v) for v in b] for a, b in r.get('floor_by_region_rgb_code', {}).items()}))


if __name__ == '__main__':
    main()
