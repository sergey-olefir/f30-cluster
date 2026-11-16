"""Package O: render every snapshot (states.py) into the STRIP maps the zone packages diff against, and publish them.

    uv run ... --with moderngl --with numpy --with opencv-python-headless python -I tools/strip/O/maps.py \
        <snap root> <out root> [layout/mode/state ...]

Per state, in <out>/<layout>/<mode>/<state>/ (STRIP = panel x 0-1920, y 540-720; half-open boxes; continuous panel
coordinates, pixel (i, j) covers [i, i+1) x [j, j+1)):
  alpha_1x.png   uint16 grey 1920 x 180: our total coverage (0..65535 = 0..1), the display's own pixels
  alpha_4x.png   uint16 grey 7680 x 720: the same at 4 x 4 samples per panel px (effects re-evaluated at the
                 sample centres (i + (k + 0.5) / 4); image layers replicated)
  rgba_1x.png    uint16 RGBA (straight colour as the display gets it, sRGB-coded, and the coverage)
  rgba_4x.png    the same at 4x
  maps_1x.npz    float32 alpha, prem (premultiplied sRGB-coded rgb), lin (premultiplied linear-light rgb), and
                 a_<layer key> for each layer that reaches the strip (float16)
  breakdown.json each layer: role, rect, coverage sum, bbox of alpha > 0.02, semi-transparent pixel count; each text
                 widget of the layout in the strip: its box and its real ink box (from the engine's own pixels)
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as RD   # noqa: E402

STRIP = (0, 540, 1920, 720)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def role(l, widgets):
    fs = l.get('fs') or ''
    u = l.get('uniforms') or {}
    if l['kind'] == 'effect':
        if 'u_cc' in u:
            return 'WBBACK (backdrop: collar u_t0, cover u_t1, patches u_pat0..3, u_cc)'
        if 'u_cut' in u:
            return 'WBDIAL %s (cut u_cut, window u_cutW)' % ('speedo' if l['x'] < 960 else 'tacho') if l['w'] > 300 else \
                'WBDIAL mini %s' % ('fuel' if l['x'] < 960 else 'oil')
        if 'u_msa' in u:
            return 'WBMSA (our start/stop sign)'
        if 'u_s0' in u or 'WBSIGN' in fs[:200]:
            return 'WBSIGN (our road signs)'
        if 'u_hole' in u and 'u_holeR' in u:
            for w in widgets:
                if w.get('type') == 'fill' and w['x'] == l['x'] and w['y'] == l['y']:
                    return 'FILL %s (hole u_hole)' % w.get('id')
            return 'FILL'
        return 'effect'
    inside = [w['id'] for w in widgets if w.get('type') in ('text', 'icon') and w['x'] >= l['x'] - 1 and w['y'] >= l['y'] - 1
              and w['x'] + w.get('w', 0) <= l['x'] + l['w'] + 1 and w['y'] + w.get('h', 0) <= l['y'] + l['h'] + 1]
    return 'image sheet [%s]' % ', '.join(inside)


def bbox(mask, region, s):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    x0, y0 = region[0], region[1]
    return [round(x0 + xs.min() / s, 2), round(y0 + ys.min() / s, 2), round(x0 + (xs.max() + 1) / s, 2), round(y0 + (ys.max() + 1) / s, 2)]


def write16(path, arr):
    import cv2
    a = np.clip(np.round(arr * 65535.0), 0, 65535).astype(np.uint16)
    if a.ndim == 3:
        a = a[..., [2, 1, 0, 3]]     # cv2 wants BGRA
    cv2.imwrite(path, a)


def do_state(R, snapdir, out):
    S = RD.Snapshot(snapdir)
    # the layout FILE drawn: the snapshot's label names it (6WB Sport + G20 runs under the name wb_dials, states.py override())
    layout = (S.meta.get('label') or '').split('/')[0] or (S.meta['probe'] or {}).get('activeName')
    lj = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts', (layout or 'wb_dials') + '.json')
    widgets = json.load(open(lj))['widgets'] if os.path.exists(lj) else []
    os.makedirs(out, exist_ok=True)
    r1 = R.compose(S, STRIP, 1, per_layer=True)
    r4 = R.compose(S, STRIP, 4, per_layer=False)
    A1, P1 = r1['alpha'], r1['prem']
    with np.errstate(divide='ignore', invalid='ignore'):
        C1 = np.where(A1[..., None] > 0, P1 / np.maximum(A1[..., None], 1e-9), 0)
        C4 = np.where(r4['alpha'][..., None] > 0, r4['prem'] / np.maximum(r4['alpha'][..., None], 1e-9), 0)
    write16(os.path.join(out, 'alpha_1x.png'), A1)
    write16(os.path.join(out, 'alpha_4x.png'), r4['alpha'])
    write16(os.path.join(out, 'rgba_1x.png'), np.dstack([np.clip(C1, 0, 1), A1]))
    write16(os.path.join(out, 'rgba_4x.png'), np.dstack([np.clip(C4, 0, 1), r4['alpha']]))
    lin = srgb_to_lin(np.clip(C1, 0, 1)) * A1[..., None]
    arrs = {'alpha': A1.astype(np.float32), 'prem': P1.astype(np.float32), 'lin': lin.astype(np.float32)}
    rows = []
    for e in r1['layers']:
        l = S.by_key[e['key']]
        ent = {'key': e['key'], 'kind': e['kind'], 'role': role(l, widgets), 'rect': [l['x'], l['y'], l['x'] + l['w'], l['y'] + l['h']],
               'class': l['class'], 'z': l['z'], 'note': e.get('note')}
        if e.get('alpha') is not None:
            a = e['alpha']
            arrs['a_' + e['key'].replace(':', '_')] = a.astype(np.float16)
            semi = (a > 0.02) & (a < 0.98)
            ent.update({'sum_alpha': round(float(a.sum()), 1), 'px_opaque': int((a >= 0.98).sum()), 'px_semi': int(semi.sum()),
                        'bbox_a002': bbox(a > 0.02, STRIP, 1), 'bbox_semi': bbox(semi, STRIP, 1)})
            if l['kind'] == 'effect':
                ent['uniforms'] = {k: v['v'] for k, v in (l.get('uniforms') or {}).items()
                                   if k in ('u_cc', 'u_pat0', 'u_pat1', 'u_pat2', 'u_pat3', 'u_patSoft', 'u_r0', 'u_r1', 'u_cut', 'u_cutW',
                                            'u_hole', 'u_holeR', 'u_color', 'u_shade', 'u_wbox', 'u_fade', 'u_foot', 'u_hasTex', 'u_show', 'u_baseR')}
                ent['binds'] = l.get('binds')
                ent['fs_bytes'] = len((l.get('fs') or '').encode())
        rows.append(ent)
    np.savez_compressed(os.path.join(out, 'maps_1x.npz'), **arrs)
    # text widgets: their box and their real ink (image layers only, i.e. text and icons of ours)
    img = np.zeros_like(A1)
    for e in r1['layers']:
        if e['kind'] == 'image' and e.get('alpha') is not None:
            img = e['alpha'] + img * (1 - e['alpha'])
    texts = []
    built = set(((S.meta['probe'] or {}).get('signs') or {}).get('widgets') or [])
    for w in widgets:
        if w.get('type') not in ('text', 'icon') or w['y'] + w.get('h', 0) <= 540:
            continue
        x0, y0, x1, y1 = w['x'], max(w['y'], 540), w['x'] + w['w'], min(w['y'] + w['h'], 720)
        sub = img[y0 - 540:y1 - 540, x0:x1]
        bb = bbox(sub > 0.02, (x0, y0), 1)
        texts.append({'id': w['id'], 'type': w['type'], 'font': w.get('font'), 'align': w.get('align'), 'box': [w['x'], w['y'], w['x'] + w['w'], w['y'] + w['h']],
                      'ink_a002': bb, 'ink_sum': round(float(sub.sum()), 1), 'row_widget_built': (w['id'] in built) if w['id'] in ('nav', 'nav_bg', 'cc_name', 'cc_desc', 'own_clock', 'own_range', 'own_temp') else None})
    semi_all = (A1 > 0.02) & (A1 < 0.98)
    info = {'state': S.meta.get('label'), 'layout': layout, 'probe': S.meta['probe'], 'pixels_bytes': S.meta.get('pixels'),
            'total': {'sum_alpha': round(float(A1.sum()), 1), 'px_opaque': int((A1 >= 0.98).sum()), 'px_clear': int((A1 <= 0.02).sum()),
                      'px_semi': int(semi_all.sum())},
            'layers': rows, 'texts': texts}
    json.dump(info, open(os.path.join(out, 'breakdown.json'), 'w'), indent=1)
    return info


def main():
    snaproot, outroot = sys.argv[1], sys.argv[2]
    sel = sys.argv[3:]
    R = RD.Renderer()
    todo = []
    for lay in sorted(os.listdir(snaproot)):
        if not os.path.isdir(os.path.join(snaproot, lay)):
            continue
        for mode in sorted(os.listdir(os.path.join(snaproot, lay))):
            for st in sorted(os.listdir(os.path.join(snaproot, lay, mode))):
                key = '%s/%s/%s' % (lay, mode, st)
                if sel and not any(key.startswith(s) for s in sel):
                    continue
                todo.append(key)
    for key in todo:
        info = do_state(R, os.path.join(snaproot, key), os.path.join(outroot, key))
        R.texcache.clear()
        t = info['total']
        print('%-40s opaque %6d semi %5d clear %6d' % (key, t['px_opaque'], t['px_semi'], t['px_clear']), flush=True)


if __name__ == '__main__':
    main()
