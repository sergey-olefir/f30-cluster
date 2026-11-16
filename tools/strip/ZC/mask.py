"""Package ZC: the mask proposal for zone C (x 690-1250) per channel of the brief's section 4.4, its 4x raster
preview, and its check against the stock photos (CLIP / LEAK with the same element masks as diff.py).

Shapes are written to design/strip/ZC/mask_proposal.json (numbers only, derived from measured geometry):
    {id, channel, kind: hole | cover, polygon (continuous panel px), feather_in_px / feather_out_px per edge,
     reason, evidence, clearance}
Alpha convention of the preview: 1 = our opaque cover, 0 = BMW shows. A hole's feather_out ramps the cover from
0 at the polygon edge to 1 at feather_out outside; feather_in lets the cover start at feather_in inside the edge.
Preview: bake/work/strip/zone-c/mask_<channel>_4x.png (uint16, 2240 x 720 = x 690-1250, y 540-720).
Run from the repo root:  (uv line of atlas.py, plus --with scipy)
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402
import diff as D  # noqa: E402

N = 4
X0, X1, Y0, Y1 = 690, 1250, 540, 720
COVER_TOP = 596.0     # above this the existing map-window foot (collar) decides; the mask does not
OUT_JSON = os.path.join(Z.ROOT, 'design', 'strip', 'ZC', 'mask_proposal.json')
GEO = json.load(open(os.path.join(Z.WORK, 'zone-c', 'geometry.json')))


def arc_top_offset(clear=2.0):
    """Top 50 % edge of the panel's arc, mean of photos 62 and 66, pushed `clear` px outward along the normal."""
    tops = []
    for pid in ('62', '66'):
        p = np.array(GEO[pid]['arc']['polyline_every_2px'])          # x, centre, top50, bot50, rel
        tops.append(p)
    xs = np.arange(711.5, 1212.0, 4.0)
    t = np.mean([np.interp(xs, p[:, 0], p[:, 2]) for p in tops], 0)
    dx, dy = np.gradient(xs), np.gradient(t)
    nx, ny = dy / np.hypot(dx, dy), -dx / np.hypot(dx, dy)            # normal pointing up (y down frame)
    return np.c_[xs + nx * clear, t + ny * clear]


def shapes():
    top = arc_top_offset(2.0)
    panel = ([[699.0, 625.0], [699.0, 620.0], [704.0, 616.5]] + [[round(float(a), 2), round(float(b), 2)] for a, b in top]
             + [[1217.0, 616.5], [1223.0, 620.0], [1223.0, 625.0], [1210.0, 640.0], [1186.0, 660.0],
                [1184.0, 701.0], [708.0, 701.0], [708.0, 628.0]])
    n_top = len(top) + 2
    fe = ([[0, 1.5]] * 3 + [[0, 1.0]] * (n_top - 2) + [[0, 1.5]] * 3 + [[3, 3], [3, 3], [2, 2], [2, 2], [0, 2], [0, 2]])
    sh = [
        {'id': 'zc.cover', 'channel': ['ours', 'bmw', 'bmw_msg', 'standby'], 'kind': 'cover',
         'polygon': [[690, COVER_TOP], [1250, COVER_TOP], [1250, 720], [690, 720]], 'feather_in_px': 0,
         'feather_out_px': 0,
         'reason': 'zone C is opaque ours in every channel except the holes below: BMW\'s rails, the centre hooks, '
                   'the odometer ghost and the panel when it must not show are all hidden (section 1.2, 1.3)',
         'evidence': 'O maps: our cover in the strip is RGB black (median linear Y 0 on opaque pixels)',
         'clearance': 'above y 596 the map-window foot of the existing collar is left as it is'},
        {'id': 'zc.panel', 'channel': ['bmw_msg'], 'kind': 'hole', 'polygon': panel,
         'feather_per_edge_in_out_px': fe,
         'reason': 'BMW\'s check-control panel: arc rail, the gradient fill under it, the symbol slot and one or two '
                   'text lines; same outline for one and two lines',
         'evidence': 'arc and fill measured on 62 (two lines) and 66 (one line), independent captures; '
                     'cross-checked on 17 (theme connected) within 1.1 px',
         'clearance': 'top: 2.0 px outside the arc\'s 50 % edge (about the 5 % level of its edge spread); '
                      'tips: the arc\'s faint tail ends at (701, 621) / (1220, 621), hole to 699 / 1223; '
                      'left: 3 px left of the widest symbol (45 px, right-aligned at 753-756), 13 px right of the '
                      'speedo rail end (686 in the message state); right: 9 px left of the tacho rail start '
                      '(1232.5), 18 px left of the marker (ZR, 1241.5); slanted right side follows the fill\'s '
                      '0.5 %-of-white contour (y 640: 1205, y 660: 1177) and stays 6 px right of the widest text '
                      '(1177.5); bottom: 3 px under the deepest descender of line 2 (690.25 + ~7.5)'},
        {'id': 'zc.street', 'channel': ['bmw'], 'kind': 'hole',
         'polygon': [[703, 665.25], [1219, 665.25], [1219, 711.5], [703, 711.5]], 'feather_in_px': 0,
         'feather_out_px': 1.5,
         'reason': 'BMW\'s road label, centre-anchored at x 961; the hole follows the widest string seen (509 px, '
                   'photo 34 in design/g20-spec/measured.json) plus 3.5 px a side',
         'evidence': 'centre 960.6 / 962.1 / 960.5 / 960.6 on 61, 64, 67, 68 (three different strings); tall top '
                     '667.75-669.75, descender bottom 707.25-709.0',
         'clearance': 'left 24 px to the airbag (ZL, 679); right 4 px to the mode label in the theme-connected row '
                      '(1223, photo 17); BMW draws only black around it, so the edge is invisible on the car'},
        {'id': 'zc.odometer', 'channel': ['standby'], 'kind': 'hole',
         'polygon': [[793, 661.5], [1095, 661.5], [1095, 701], [793, 701]], 'feather_in_px': 0, 'feather_out_px': 1.5,
         'reason': 'BMW\'s standby odometer (label, six digits centred on x 960.5, unit); one more digit allowed '
                   'each way (advance 23.2 px)',
         'evidence': 'photo 65 only (one string); position confirmed by the ghost in 63 (digits within 1.75 px)',
         'clearance': 'label left edge 808 - 15, unit right edge 1080.25 + 15; 128 px to the standby mode label'},
    ]
    return sh


def dist_poly(poly, fe_list):
    """Per 4x sample: signed distance to the polygon (+ outside) and the feather (in, out) of the nearest edge."""
    P = np.asarray(poly, float)
    ys, xs = np.mgrid[0:(Y1 - Y0) * N, 0:(X1 - X0) * N]
    px, py = X0 + (xs + 0.5) / N, Y0 + (ys + 0.5) / N
    best = np.full(px.shape, np.inf)
    fin = np.zeros(px.shape)
    fout = np.zeros(px.shape)
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        ab = b - a
        t = np.clip(((px - a[0]) * ab[0] + (py - a[1]) * ab[1]) / max(1e-9, ab @ ab), 0, 1)
        d = np.hypot(px - a[0] - t * ab[0], py - a[1] - t * ab[1])
        m = d < best
        best[m] = d[m]
        fin[m], fout[m] = fe_list[i]
    inside = np.zeros(px.shape, np.uint8)
    cv2.fillPoly(inside, [np.round((P - [X0, Y0]) * N * 16).astype(np.int32)], 1, shift=4)
    return np.where(inside > 0, -best, best), fin, fout


def raster(channel, sh):
    a = np.zeros(((Y1 - Y0) * N, (X1 - X0) * N))
    a[int((COVER_TOP - Y0) * N):, :] = 1.0
    for s in sh:
        if s['kind'] != 'hole' or channel not in s['channel']:
            continue
        P = s['polygon']
        fe = s.get('feather_per_edge_in_out_px') or [[s['feather_in_px'], s['feather_out_px']]] * len(P)
        d, fin, fout = dist_poly(P, fe)
        w = np.maximum(fin + fout, 1.0 / N)
        cov = np.clip((d + fin) / w, 0, 1)
        a = np.minimum(a, cov)
    return a


def main():
    sh = shapes()
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    chans = ['ours', 'bmw', 'bmw_msg', 'standby']
    check = {}
    inks = {pid: D.ink_masks(pid) for pid in D.STATE}
    rules = {'ours': ('all6WB', 'drive', ['61', '64', '67', '68', '63']),
             'bmw': ('allG20', 'drive', ['61', '64', '67', '68', '63']),
             'bmw_msg': ('allG20', 'msg', ['62', '66']),
             'standby': ('allG20', 'standby', ['65'])}
    for ch in chans:
        a = raster(ch, sh)
        cv2.imwrite(os.path.join(Z.WORK, 'zone-c', 'mask_%s_4x.png' % ch), np.round(a * 65535).astype(np.uint16))
        mode, state, pids = rules[ch]
        if ch == 'ours':
            mode, state = 'all6WB', 'msg'
        res = {}
        for pid in pids:
            ink = inks[pid]
            r = {}
            for el, m in ink['masks'].items():
                want = D.must(mode, state if pid not in ('62', '66') or ch != 'ours' else 'msg', el)
                if want is None or not m.any():
                    continue
                v = a[m]
                if want:
                    r[el] = {'must': 'show', 'CLIP_px': round(float((v > 0.02).sum()) / 16, 1),
                             'CLIP_sum_alpha_px': round(float(v[v > 0.02].sum()) / 16, 2),
                             'CLIP_light': round(float((v * ink['Yn'][m])[v > 0.02].sum()) / 16, 3),
                             'CLIP_peak_Yn': round(float(ink['Yn'][m][v > 0.02].max()), 4) if (v > 0.02).any() else 0}
                else:
                    r[el] = {'must': 'hide', 'LEAK_px': round(float((v < 0.98).sum()) / 16, 1),
                             'LEAK_light': round(float(((1 - v) * ink['Yn'][m])[v < 0.98].sum()) / 16, 2)}
            res[pid] = r
        check[ch] = res
        print(ch, json.dumps(res))
    out = {'_about': 'Package ZC mask proposal for zone C (x 690-1250, y 540-720), continuous panel px. '
                     'Channels as in docs/AGENT-BRIEF-strip.md 4.4. Alpha 1 = our opaque cover. Numbers from '
                     'tools/strip/ZC/{atlas,geometry,texts}.py on the 2026-11-16 photos; no photo pixels here.',
           'registration': {pid: inks[pid]['tag'] for pid in inks},
           'shapes': sh, 'check_against_photos': check}
    json.dump(out, open(OUT_JSON, 'w'), indent=1)


if __name__ == '__main__':
    main()
