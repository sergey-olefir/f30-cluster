"""Package O, brief items 2, 5 and 6, plus the sign CLIP check: read the maps (maps.py) and snapshots (states.py) and
write one table per state.

    uv run ... --with numpy --with scipy python -I tools/strip/O/analyse.py <snap root> <maps root> <out json>

Per state:
  * budgets: live layers per connection (assets apart), assets, image pixel memory as the service counts it (each image
    twice), and the bytes of each effect layer's fragment source (the KOMBI rule: one look per source);
  * see-through regions of the STRIP (coverage < 0.5), as connected components with their box and area;
  * wide semi-transparent bands: components of 0.02 < alpha < 0.98 at least 3 px across (distance transform), i.e.
    not an anti-aliased edge, with the layer that makes most of them. An intended soft edge is named as such when it is
    one (the dial cut's fade, a patch's soft foot, the collar's baked feather); everything else is listed as a defect;
  * BMW's sign: our coverage over BMW's sign disc (r 41.4 round the window centre, and round the centres the old
    photos give), mean and the share of the disc more than half covered.
"""
import json
import os
import sys

import numpy as np
from scipy import ndimage

STRIP_Y0 = 540
SIGN = (537.3, 621.3)
SIGN_R = 41.4
SIGN_ALT = {'photo08': (539.2, 621.4), 'photo17': (537.9, 621.4)}


def budgets(meta):
    per = {}
    assets = 0
    fs = []
    for l in meta['layers']:
        if l['kind'] == 'asset':
            assets += 1
            continue
        c = l['key'].split(':')[0]
        per[c] = per.get(c, 0) + 1
        if l['kind'] == 'effect':
            fs.append({'key': l['key'], 'rect': [l['x'], l['y'], l['w'], l['h']], 'bytes': len((l.get('fs') or '').encode()),
                       'head': (l.get('fs') or '').split('\n')[0][:40]})
    return {'layers_per_connection': per, 'layers': sum(per.values()), 'assets': assets,
            'pixel_bytes': meta.get('pixels'), 'pixel_mib': round((meta.get('pixels') or 0) / 1048576.0, 3), 'effects': fs}


def components(mask, minarea=4):
    lab, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        area = int((lab[sl] == i).sum())
        if area < minarea:
            continue
        out.append({'box': [sl[1].start, sl[0].start + STRIP_Y0, sl[1].stop, sl[0].stop + STRIP_Y0], 'area': area})
    out.sort(key=lambda r: -r['area'])
    return out, lab


def disc_cover(alpha, c, r):
    ys, xs = np.mgrid[0:alpha.shape[0], 0:alpha.shape[1]]
    d = np.hypot(xs + 0.5 - c[0], ys + 0.5 + STRIP_Y0 - c[1])
    m = d < r
    a = alpha[m]
    return {'mean': round(float(a.mean()), 4), 'share_gt_half': round(float((a > 0.5).mean()), 4), 'px': int(m.sum())}


def intended(box, layer_role):
    x0, y0, x1, y1 = box
    if 'WBDIAL' in layer_role and y0 >= 600 and y1 <= 660:
        return "the dial's cut fade (u_cut: 26 px above layer y 611 = panel y 630-656), by design"
    if 'WBBACK' in layer_role and x0 >= 585 and x1 <= 1255 and y0 >= 648 and y1 <= 668:
        return None    # CC_TOP's 13 px soft foot: the known defect (the y 652-666 band), not a soft edge
    if 'WBBACK' in layer_role:
        return "WBBACK: the collar's baked feather / the dials' rim shade (u_shade), by design unless it sits over a row item"
    return None


def main():
    snaproot, mapsroot, outf = sys.argv[1:4]
    rows = []
    for lay in sorted(os.listdir(mapsroot)):
        for mode in sorted(os.listdir(os.path.join(mapsroot, lay))):
            for st in sorted(os.listdir(os.path.join(mapsroot, lay, mode))):
                d = os.path.join(mapsroot, lay, mode, st)
                meta = json.load(open(os.path.join(snaproot, lay, mode, st, 'scene.json')))
                bd = json.load(open(os.path.join(d, 'breakdown.json')))
                z = np.load(os.path.join(d, 'maps_1x.npz'))
                A = z['alpha']
                clear, _ = components(A < 0.5, 20)
                semi = (A > 0.02) & (A < 0.98)
                dist = ndimage.distance_transform_edt(semi)
                lab, n = ndimage.label(semi)
                wide = []
                layer_alpha = {k[2:].replace('_', ':', 1): z[k].astype(np.float32) for k in z.files if k.startswith('a_')}
                roles = {l['key']: l['role'] for l in bd['layers']}
                for i, sl in enumerate(ndimage.find_objects(lab), 1):
                    if sl is None:
                        continue
                    m = lab[sl] == i
                    th = float(dist[sl][m].max())
                    if th < 1.5:       # a 1-2 px anti-aliased edge
                        continue
                    # the layer whose own semi pixels overlap this component most
                    best, bc = None, 0
                    for k, a in layer_alpha.items():
                        s = a[sl][m]
                        cnt = int(((s > 0.02) & (s < 0.98)).sum())
                        if cnt > bc:
                            best, bc = k, cnt
                    box = [sl[1].start, sl[0].start + STRIP_Y0, sl[1].stop, sl[0].stop + STRIP_Y0]
                    role = roles.get(best, '?')
                    if 'image' in role:
                        continue      # glyph anti-aliasing of our own text
                    wide.append({'box': box, 'area': int(m.sum()), 'max_width_px': round(2 * th, 1), 'mean_alpha': round(float(A[sl][m].mean()), 3),
                                 'layer': best, 'role': role[:60], 'intended': intended(box, role)})
                wide.sort(key=lambda r: -r['area'])
                sign = {'window_centre': disc_cover(A, SIGN, SIGN_R)}
                for k, c in SIGN_ALT.items():
                    sign[k] = disc_cover(A, c, SIGN_R)
                rows.append({'layout': lay, 'mode': mode, 'state': st, 'own': bd['probe']['signs'].get('own'),
                             'budget': budgets(meta), 'total': bd['total'], 'see_through': clear[:25],
                             'semi_wide': wide, 'bmw_sign_cover': sign})
                print('%-15s %-6s %-17s layers %s px %.2f MiB | clear>=20px comps %d | wide semi %d (unintended %d) | sign cover %.3f'
                      % (lay, mode, st, rows[-1]['budget']['layers_per_connection'], rows[-1]['budget']['pixel_mib'], len(clear),
                         len(wide), sum(1 for w in wide if not w['intended']), sign['window_centre']['mean']), flush=True)
    json.dump(rows, open(outf, 'w'), indent=1)


if __name__ == '__main__':
    main()
