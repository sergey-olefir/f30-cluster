"""Package O's pixel audit, for twin_dial (docs/twin-dial/SPEC.md sections 3.3, 8.4, 13.2, 15; package E of round 2).

    import twin_audit as TA
    res = TA.audit(alpha, prem, layers, cc_state, pixels_bytes)     # alpha: H x W float 0..1, our layers' coverage

What our layers put on the pixels BMW draws: from the replay (tools/strip/O/render.py compose()), at scale 1, i.e. the
panel's own 1920 x 720 pixels. Every check is a number against a limit, from the SPEC's own geometry (design/twin-dial):

  belt        BMW's belt + airbag group [497, 660, 688, 720]: our alpha 0 in every state
  gear        the gear-letter gap [1380, 660, 1460, 720]: alpha 0, and no layer rectangle of ours touches it
  lamps       BMW's seven side lamps (box + 3 px): alpha 0
  marker      BMW's stored-message marker [1240, 588, 1288, 630]: covered (alpha 1) until a signal for it is confirmed (D7)
  strip       the telltale strip above the tab bar [564, 58, 981, 115]: stays black (our rgb ~ 0, never BMW's lamps there)
  panel       BMW's message panel (zc.panel dilated 3 px, VF message_panel.json fallback_window.polygon_px):
                cc.state "window": the real panel (the polygon eroded 3 px) is entirely open, alpha 0 (nothing of ours
                                   inside it, no ink, no half of a plate)
                cc.state "ours" / "none": the whole polygon is covered, alpha >= 0.98 (BMW's panel is never half visible)
  layers      <= 8 layers per connection, 12 of 24 at most (SPEC 13.2), pixel memory <= 6 MiB steady (counted twice)
  drawn       no layer the replay could not draw (a shader that does not compile, an unbound sampler)

The polygon is the baked window of SPEC section 8.4; the stand-in or the real app opens it as a rectangle or a mask,
the check is the same. Needs numpy and Pillow. No reference image is read.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
W, H = 1920, 720
EPS = 1.5 / 255.0           # "alpha 0": under one and a half codes of 8 bit

_geo = {}


def geometry():
    if not _geo:
        lay = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vg', 'layout.json')))
        mp = json.load(open(os.path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))
        ko = lay['keep_outs']
        _geo.update({
            'belt': ko['belt_group']['rect'], 'gear': ko['gear_gap']['rect'], 'lamps': ko['telltales_holes']['rects_plus_3px'],
            'marker': [1240, 588, 1288, 630], 'strip': [564, 58, 981, 115],
            'polygon': mp['fallback_window']['polygon_px'], 'plate': mp['M2_px']['plate'],
        })
    return _geo


def rect_mask(r):
    m = np.zeros((H, W), bool)
    x0, y0, x1, y1 = [int(round(v)) for v in r]
    m[max(0, y0):min(H, y1), max(0, x0):min(W, x1)] = True
    return m


def polygon_mask(poly, erode=0):
    """The window polygon as a boolean mask (pixels whose centre lies inside), eroded by `erode` px."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.new('L', (W, H), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in poly], fill=255)
    if erode > 0:
        im = im.filter(ImageFilter.MinFilter(2 * erode + 1))
    return np.asarray(im) > 127


def audit(alpha, prem, layers, cc_state, pixels_bytes=None, notes=None, cc_expect=None):
    """-> {checks: [{name, ok, value, limit, note}], ok: bool}. layers: the scene's layer list (bench /events)."""
    g = geometry()
    A = np.asarray(alpha, np.float32)
    checks = []

    def add(name, ok, value, limit, note=''):
        checks.append({'name': name, 'ok': bool(ok), 'value': value, 'limit': limit, 'note': note})

    def mx(m):
        return float(A[m].max()) if m.any() else 0.0

    def mn(m):
        return float(A[m].min()) if m.any() else 1.0

    v = mx(rect_mask(g['belt']))
    add('belt group open', v <= EPS, round(v, 4), '<= %.4f' % EPS, "BMW's belt and airbag group, every state")
    v = mx(rect_mask(g['gear']))
    add('gear gap open', v <= EPS, round(v, 4), '<= %.4f' % EPS, "the gap over BMW's gear letter")
    hit = [l['key'] for l in layers if l.get('kind') != 'asset' and l.get('visible', True) and l.get('state') != 'waiting'
           and l['x'] < g['gear'][2] and l['x'] + l['w'] > g['gear'][0] and l['y'] < g['gear'][3] and l['y'] + l['h'] > g['gear'][1]]
    add('no layer rect in the gear gap', not hit, hit, 'none', 'SPEC 3.3: the background is split in three')
    lm = np.zeros((H, W), bool)
    for r in g['lamps']:
        lm |= rect_mask(r)
    v = mx(lm)
    add('side lamps open', v <= EPS, round(v, 4), '<= %.4f' % EPS, "BMW's seven lamps, box + 3 px")
    v = mn(rect_mask(g['marker']))
    add('stored-message marker covered', v >= 0.98, round(v, 3), '>= 0.98', 'D7: covered until a signal for it is confirmed')
    sm = rect_mask(g['strip'])
    ink = float(np.asarray(prem)[sm].max()) if sm.any() else 0.0
    add('telltale strip stays black', ink <= 0.02, round(ink, 3), '<= 0.02', 'our colour there; BMW draws its lamps at the sides')
    if cc_state in ('window', 'ours', 'none'):
        full, real = polygon_mask(g['polygon']), polygon_mask(g['polygon'], 3)
        if cc_state == 'window':
            v = mx(real)
            add("message window open over BMW's panel", v <= EPS, round(v, 4), '<= %.4f' % EPS, 'the real panel (window eroded 3 px): nothing of ours in it')
        else:
            v = mn(full)
            add("BMW's panel covered (%s)" % cc_state, v >= 0.98, round(v, 3), '>= 0.98', 'never half visible: our plate or our black over all of it')
        if cc_state == 'ours':
            pl = g['plate']
            xs, ys = [q[0] for q in g['polygon']], [q[1] for q in g['polygon']]
            margin = min(min(xs) - pl[0], min(ys) - pl[1], pl[2] - max(xs), pl[3] - max(ys) + 0.01)
            add('plate rectangle covers the window', margin >= 1.5, round(margin, 2), '>= 1.5 px', 'SPEC 8.1: [694.5, 592, 1230, 720]')
    else:
        add('message window', True, None, 'n/a', 'the engine does not say its message state (hud.cc), so no window check')
    per = {}
    for l in layers:
        if l.get('kind') in ('image', 'effect') and l.get('visible', True):
            per[l.get('conn', 1)] = per.get(l.get('conn', 1), 0) + 1
    worst = max(per.values()) if per else 0
    add('layers per connection', worst <= 8, per, '<= 8', 'cluster-render draws 8 per connection')
    total = sum(per.values())
    add('layers in all', total <= 12, total, '<= 12', 'SPEC 13.2: 12 of 24')
    if pixels_bytes is not None:
        add('pixel memory', pixels_bytes <= 6 * 1048576, round(pixels_bytes / 1048576, 2), '<= 6 MiB', 'steady, each image counted twice (bench scene.pixels)')
    nd = [n for n in (notes or []) if 'not drawn' in (n.get('note') or '') or 'does not compile' in (n.get('note') or '')]
    add('every layer drawn', not nd, [n['key'] + ': ' + n['note'] for n in nd], 'none', 'a shader that does not compile / an unbound sampler is not drawn on the car')
    return {'checks': checks, 'ok': all(c['ok'] for c in checks)}
