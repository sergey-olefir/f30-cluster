#!/usr/bin/env python3
"""Tests of the REAL tdial fragment shader on the Mac's GPU (package B1): the red arc, the limit marker and the strip's red
(L1 / L2 / L3), the hollow marker, the cruise marker, the night multipliers, and the shader against the numpy decode
(tools/twin-dial/face_shade.py). Each guard is also broken on purpose (a state 0, a missing arc) and must notice.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/twin-dial/test_shader.py

Headless (moderngl standalone context), no browser, no bench. Precision: the Mac's GPU is fp32; the car's mediump is fp16
(the shader asks for highp and normalises every length by R: bench/test-twin-budget.js checks that statically).
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402

import _bakecommon as bc                               # noqa: E402
import face_shade as fs                                # noqa: E402
import render_dials as rd                              # noqa: E402

passed = failed = 0


def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
        print('  ok   ' + what)
    else:
        failed += 1
        print('  FAIL ' + what)


SRC = rd.shader_source()
CACHE = {}


def img(kind, **st):
    key = (kind, repr(sorted(st.items())))
    if key not in CACHE:
        CACHE[key] = rd.over_black(rd.render_dial(kind, st, fs=SRC)).astype(int)
    return CACHE[key]


def at(im, th, rho, kind='speed'):
    cx, cy = rd.DIALS[kind]['cx'] - rd.DIALS[kind]['x'], 400 - rd.DIALS[kind]['y']
    t = math.radians(th)
    x, y = int(round(cx + rho * 300 * math.sin(t) - 0.5)), int(round(cy - rho * 300 * math.cos(t) - 0.5))
    return tuple(int(v) for v in im[y, x])


def redness(c):
    return c[0] - max(c[1], c[2])


def spd(v, **kw):
    return dict(deg=rd.spd_deg(v), fill=0.5, **kw)


def main():
    print('the shader and the numpy decode agree (no markers, no needle in the compared area)')
    for kind in ('tach', 'speed'):
        st = rd.tach_state(2400) if kind == 'tach' else spd(87)
        im = img(kind, **st).astype(np.float64)
        face = rd.load_face(kind)
        reg = __import__('json').load(open(os.path.join(bc.SCENE, rd.DIALS[kind]['face'] + '.regions.json')))
        dec = fs.shade(face, reg, 6500.0, 1.0, {'n': 0.54 * 5 if kind == 'tach' else 0.52 * 5}).astype(np.float64)
        d = rd.DIALS[kind]
        sub = im[0:560, 2:618]                                 # the face's box inside the layer (face x 72 - layer x 70, y 90 - 90)
        valid = ~rd.needle_mask(kind, st['deg'], 0.07)[0:560, 2:618]
        ys, xs = np.mgrid[0:560, 0:616]
        rho = np.hypot(xs + 0.5 - 308, ys + 0.5 - 310) / 300
        valid &= (rho < 1.0) & (ys < 480) & (rho > 0.53)       # not the bars (filled differently by the stand-in state), not the hub
        diff = np.abs(sub - dec).max(axis=2)
        ok(float(np.abs(sub - dec)[valid].mean()) < 1.0 and np.percentile(diff[valid], 99.5) < 40,
           '%s: mean abs diff %.3f codes, 99.5 %% under 40 (%.0f)' % (kind, float(np.abs(sub - dec)[valid].mean()), np.percentile(diff[valid], 99.5)))

    print('the red arc on the bezel (SPEC-R3 2.5)')
    t = img('tach', **rd.tach_state(2400))
    redl = rd.tach_state(2400)['deg']
    a_red = rd.tach_deg(6500)
    ok(redness(at(t, a_red + 10, 1.0, 'tach')) > 150 and redness(at(t, 130.0, 1.0, 'tach')) > 150, 'tachometer: the bezel is red from the redline (78.1) to 130 deg: %s %s' % (at(t, a_red + 10, 1.0, 'tach'), at(t, 130.0, 1.0, 'tach')))
    ok(min(at(t, a_red - 10, 1.0, 'tach')) > 200 and min(at(t, 0.0, 1.0, 'tach')) > 200, 'tachometer: the bezel is white below the redline')
    c = at(t, 100.0, 1.0, 'tach')
    ok(abs(c[0] - 210) <= 3 and abs(c[1] - 18) <= 6 and c[2] <= 12, 'the arc is (210, 20, 21) less the panel\'s black floor, (210, 18, 6): %s' % (c,))
    ok(max(at(t, 100.0, 0.915, 'tach')) < 200 and redness(at(t, 100.0, 0.80, 'tach')) < 30, 'the band under the arc stays grey (no wedge)')
    s = img('speed', **spd(87))
    ok(all(redness(at(s, th, 1.0)) < 10 for th in (-100, 0, 60, 100, 130)), 'speedometer: no red arc on its bezel')
    t0 = img('tach', **dict(rd.tach_state(2400), redline=7000))
    ok(min(at(t0, 85.0, 1.0, 'tach')) > 200 and redness(at(t0, 100.0, 1.0, 'tach')) > 150, 'a redline of 7000 moves the arc start (85 deg white, 100 deg red)')

    print('the limit marker and the red strip (SPEC-R3 8)')
    lim = rd.spd_deg(50)                                       # -62.5
    off = lim + 3.125                                          # between two ticks
    base = img('speed', **spd(30))
    body = at(base, off, 0.915)
    ok(abs(body[0] - 98) <= 6 and abs(body[1] - 109) <= 6 and abs(body[2] - 109) <= 8, 'the strip body is (98, 109, 111) less the black floor: %s' % (body,))
    ok(redness(at(base, lim, 0.915)) < 10, 'no limit: no marker')
    m1 = img('speed', **spd(30, lim=(lim, 1, 0, 1)))
    c = at(m1, lim, 0.915)
    ok(abs(c[0] - 181) <= 6 and c[1] <= 40 and c[2] <= 12, 'the marker is red (181, 26, 17) less the floor: %s' % (c,))
    m0 = img('speed', **spd(30, lim=(lim, 1, 0, 0)))
    ok(redness(at(m0, lim + 0.8, 0.915)) > 100 and redness(at(m0, lim - 0.8, 0.915)) > 100 and redness(at(m0, lim + 1.6, 0.915)) < 10 and redness(at(m0, lim - 1.6, 0.915)) < 10, 'strip mode 0 (marker only): the marker is 2 deg wide (red at +-0.8, none at +-1.6) and no strip beyond it')
    ok(redness(at(m1, lim, 0.885)) < 30 and redness(at(m1, lim, 0.95)) < 10, 'the marker is across the strip only (rho 0.893-0.94)')
    dim = at(m1, 40.0, 0.915)
    ok(100 < dim[0] < 150 and dim[1] < 40, 'L1, needle below the limit: the strip beyond it is dim red (0.45): %s' % (dim,))
    ok(redness(at(m1, lim - 12.5 + 3.125, 0.915)) < 10, 'L1: the strip below the limit is untouched')
    ok(redness(at(m1, 130.0, 0.915)) < 10, 'L1: the red ends with the scale (+125.5 deg): 130 deg is grey')
    ov = img('speed', **dict(spd(80), lim=(lim, 1, 0, 1)))
    full = at(ov, 40.0, 0.915)
    ok(full[0] > dim[0] * 1.3 and abs(full[0] - 181) <= 8, 'L1, needle past the limit: full red %s (was dim %s)' % (full, dim))
    wn = img('speed', **dict(spd(30), lim=(lim, 1, 1, 1)))
    ok(abs(at(wn, 40.0, 0.915)[0] - full[0]) <= 4, 'L1: the car\'s warning level 1 also makes it full')
    l2b = img('speed', **dict(spd(30), lim=(lim, 1, 0, 2)))
    ok(redness(at(l2b, 40.0, 0.915)) < 10 and redness(at(l2b, lim, 0.915)) > 100, 'L2, below the limit: the marker only, no strip')
    l2o = img('speed', **dict(spd(80), lim=(lim, 1, 0, 2)))
    nd = rd.spd_deg(80)
    ok(redness(at(l2o, (lim + nd) / 2 + 1.0, 0.915)) > 100 and redness(at(l2o, nd + 20.0, 0.915)) < 10, 'L2, over: red between the marker and the needle only (%.1f .. %.1f deg)' % (lim, nd))
    l3 = img('speed', **dict(spd(30), lim=(lim, 1, 0, 3)))
    ok(abs(at(l3, 40.0, 0.915)[0] - full[0]) <= 6, 'L3: always full red, even below the limit: %s' % (at(l3, 40.0, 0.915),))
    print('conditional and hollow markers, states')
    cnd = img('speed', **dict(spd(30), lim=(lim, 2, 0, 1)))
    ok(redness(at(cnd, 40.0, 0.915)) < 10, 'state 2 (conditional): the strip is NOT red')
    ok(redness(at(cnd, lim + 0.9, 0.9165)) > 100 and redness(at(cnd, lim, 0.9165)) < 40, 'state 2: the marker is hollow (red edge, the strip colour in the middle)')
    hl3 = img('speed', **dict(spd(30), lim=(lim, 3, 0, 1)))
    ok(redness(at(hl3, 40.0, 0.915)) > 30 and redness(at(hl3, lim, 0.9165)) < 40, 'state 3: hollow marker and the red strip')
    ok(np.array_equal(img('speed', **dict(spd(30), lim=(lim, 0, 0, 1))), base), 'state 0: the picture is the picture without a limit, pixel for pixel')
    ok(not np.array_equal(m1, base), 'a limit changes the picture (the guard notices)')

    print('the cruise marker (SPEC-R3 9)')
    cr = rd.spd_deg(110)
    cm = img('speed', **dict(spd(30), cru=(cr, 1)))
    c = at(cm, cr, 0.972)
    ok(c[1] > 120 and c[0] < 60 and abs(c[1] - 155) <= 12, 'active: a green (59, 155, 26) marker in the dark gap at 110 km/h: %s' % (c,))
    ok(max(at(cm, cr, 0.95)) > 40 and max(at(base, cr, 0.972)) < 8, 'the marker has its tip inward (gap lit at rho 0.95), the gap is black without it')
    ok(max(at(cm, cr + 6.0, 0.972)) < 8, 'the marker is a point, not a band (6 deg away: black)')
    both = img('speed', **dict(spd(30), lim=(cr, 1, 0, 1), cru=(cr, 1)))
    ok(redness(at(both, cr, 0.915)) > 100 and at(both, cr, 0.972)[1] > 120, 'limit and cruise at the same speed: both markers readable (red on the strip, green in the gap)')
    ok(np.array_equal(img('speed', **dict(spd(30), cru=(cr, 0))), base), 'cruise state 0 (standby, off): nothing drawn')

    print('night (SPEC-R3 6)')
    tn = img('tach', **dict(rd.tach_state(2400), night=True))
    day, ngt = at(t, 100.0, 1.0, 'tach'), at(tn, 100.0, 1.0, 'tach')
    ok(0.5 < ngt[0] / day[0] < 0.95, 'the red arc is dimmer by night: %s -> %s' % (day, ngt))
    mn = img('speed', **dict(spd(30), lim=(lim, 1, 0, 1), night=True))
    ok(at(mn, lim, 0.915)[0] < at(m1, lim, 0.915)[0] - 8, 'the limit marker is dimmer by night')
    print('%d passed, %d failed' % (passed, failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
