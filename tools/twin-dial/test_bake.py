#!/usr/bin/env python3
"""Tests of the Twin Dial bake (package R2-A2): faces, regions JSON, panel mask, the decode against the mockup.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/test_bake.py

Each test that guards a rule also breaks the rule on purpose and expects the guard to notice (a green test only counts if it
fails when the feature is broken). Needs the VT fonts (tools/fonts-src or bake/work/twin-dial/refs/vt-fonts) and the mockup.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402

import _bakecommon as bc                               # noqa: E402
import bake_face as bf                                 # noqa: E402
import bake_mask as bm                                 # noqa: E402
import compare_face as cf                              # noqa: E402
import face_shade as fs                                # noqa: E402

passed = failed = 0


def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
        print('  ok   ' + what)
    else:
        failed += 1
        print('  FAIL ' + what)


def scene(name):
    return bc.read_scene(os.path.join(bc.SCENE, name + '.json'))


def regions(name):
    return json.load(open(os.path.join(bc.SCENE, name + '.regions.json')))


def raises(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


def test_files():
    print('committed scene files')
    man = json.load(open(bc.MANIFEST))['files']
    for kind in ('tach', 'speed'):
        name = bf.NAMES[kind]
        j, a = scene(name)
        ok(j['format'] == 'r8' and (j['w'], j['h']) == (616, 560) and j['sampling'] == 'bilinear', name + ': R8 616 x 560, bilinear')
        ok(a.shape == (560, 616) and a.dtype == np.uint8, name + ': payload is w*h bytes')
        ok(j['mask']['rect'] == [CENTRE_X[kind] - 308, 90, CENTRE_X[kind] + 308, 650], name + ': rect [cx-308, 90, cx+308, 650]')
        ok(int(a[:3, :3].max()) == 0 and int(a[-3:, -3:].max()) == 0, name + ': black corners')
        ok(man[name]['sha256_r8'] == __import__('hashlib').sha256(a.tobytes()).hexdigest(), name + ': manifest sha256 = the file')
        r = regions(name)
        ok(r['w'] == 616 and r['centre_face_px'] == [308.0, 310.0] and r['R_px'] == 300.0, name + ': regions: size, centre, R')
        ok(r['rect_panel'][3] <= 657, name + ': face rect ends above the furniture limit y 657 (SPEC 3.3)')
        ok(not r['clearance']['violations'], name + ': clearance record has no violation')
    j, a = scene('panel_mask')
    ok(j['format'] == 'r8' and (j['w'], j['h']) == (536, 112) and j['mask']['rect'] == [694, 592, 1230, 704], 'panel_mask: R8 536 x 112 at [694, 592, 1230, 704]')
    ok(man['panel_mask']['sha256_r8'] == __import__('hashlib').sha256(a.tobytes()).hexdigest(), 'panel_mask: manifest sha256 = the file')


CENTRE_X = {'tach': 380, 'speed': 1540}


def test_reproducible():
    print('reproducible from the repo')
    with tempfile.TemporaryDirectory() as t:
        for kind in ('tach', 'speed'):
            name = bf.NAMES[kind]
            bf.bake(kind, 1.06, t, record=False)
            _, new = bc.read_scene(os.path.join(t, name + '.json'))
            _, old = scene(name)
            d = int(np.abs(new.astype(int) - old.astype(int)).max())
            ok(d == 0, '%s regenerates byte for byte (max diff %d%s)' % (name, d, '' if d == 0 else '; other Pillow build?'))
            ok(json.load(open(os.path.join(t, name + '.regions.json'))) == regions(name), name + ': regions JSON regenerates')
        bm.bake(t, record=False)
        ok(np.array_equal(bc.read_scene(os.path.join(t, 'panel_mask.json'))[1], scene('panel_mask')[1]), 'panel_mask regenerates byte for byte')


def test_numerals():
    print('numerals (SPEC 5.3)')
    rs = regions('face_speedo')
    vals = [n['value'] for n in rs['numerals']]
    ok(set(vals) >= set(bf.SPD_LARGE) and 90 not in vals and 120 not in vals, 'speedometer: the large set, no 90, no 120')
    ok(sorted(vals) == sorted(bf.SPD_LARGE + bf.SPD_SMALL), 'speedometer: large + the 8 small numerals (%d)' % len(vals))
    ok(sorted(n['value'] for n in regions('face_tacho')['numerals']) == list(range(1, 9)), 'tachometer: 1-8, no 0')
    ok(rs['clearance']['min_numeral_numeral'] >= 4 and rs['clearance']['min_numeral_tick'] >= 4, 'speedometer: >= 4 px between numerals and to every tick')
    # the guard must notice: 90 and 120 crowd 100 / 140 and are dropped by the 4 px rule; a rule of 0 px would keep them
    old = bf.SPD_SMALL
    try:
        bf.SPD_SMALL = old + (90, 120)
        _, dropped = bf.speed_numerals(1.06)
        ok(120 in [v for v, _ in dropped], 'the 4 px rule drops a 120 added to the set (%s); 90 is dropped by the owner, not by the rule' % (dropped,))
        old_gap = bf.MIN_GAP
        bf.MIN_GAP = 0.0
        _, dropped0 = bf.speed_numerals(1.06)
        bf.MIN_GAP = old_gap
        ok(not dropped0, 'with the rule off nothing is dropped (the check is what drops them)')
    finally:
        bf.SPD_SMALL = old
    # clearance() must report a numeral that touches a tick: draw a face and move one numeral onto the ticks
    fc, *_ = bf.draw_face('speed', 1.06)
    ok(not bf.clearance(fc)['violations'], 'clearance(): none on the real face')
    fc.ctext(bf.polar(bf.spd_angle(100), 0.9 * bf.R), '100', bf.font('saira', 28, bf.SS) if hasattr(bf, 'font') else bc.font('saira', 28, bf.SS),
             stretch=1.06, label=('numeral', 100, bf.spd_angle(100)))
    ok(bool(bf.clearance(fc)['violations']), 'clearance(): a numeral put on the ticks is reported')
    ok(any(t.get('theta_deg') for t in regions('face_tacho')['ticks']) and len(regions('face_tacho')['ticks']) == 17, 'tachometer: 17 ticks (every 500 rpm)')


def test_faces():
    print('face content')
    for kind in ('tach', 'speed'):
        name = bf.NAMES[kind]
        r = regions(name)
        a = scene(name)[1].astype(int)
        ys, xs = np.mgrid[0:560, 0:616]
        rho = np.hypot(xs + 0.5 - 308, ys + 0.5 - 310) / 300
        th = np.degrees(np.arctan2(xs + 0.5 - 308, -(ys + 0.5 - 310)))
        ok(a[(rho > 0.994) & (rho < 1.006) & (np.abs(th) < 140)].min() >= 245, name + ': the bezel ring is solid white (>= 245)')
        ok(a[(rho > 0.95) & (np.abs(th) > 148) & (rho < 1.05)].max() == 0 or a[(rho > 0.95) & (np.abs(th) > 148) & (rho < 1.05)].max() < 8, name + ': the bezel is open at the bottom')
        ok(np.percentile(a[(rho > 0.60) & (rho < 0.88) & (np.abs(th) < 130)], 10) >= 15, name + ': the band is lit everywhere between the rim and the ticks (its thin dark major lines aside)')
        inner = a[(rho > 0.50) & (rho < 0.53)]
        ok(inner.max() < 8, name + ': a black gap inside the rim')
        strip = a[(rho > 0.905) & (rho < 0.925) & (np.abs(th) < 140)]
        ok(abs(float(np.median(strip)) - bf.STRIP_CODE) <= 2 or float(np.median(strip)) > 100, name + ': the tick strip level (137) or white ticks')
        ok(r['bar']['segments'] == 5 and len(r['bar']['segment_rects_face_px']) == 5, name + ': 5 bar segments')
        sx0, sy0, sx1, sy1 = [int(round(v)) for v in r['bar']['segment_rects_face_px'][1]]
        ok(abs(int(a[(sy0 + sy1) // 2, (sx0 + sx1) // 2]) - bf.FRAME_CODE) <= 2, name + ': bar frame code 47 inside segment 2')
        gap_x = int(round(r['bar']['segment_rects_face_px'][1][2])) + 1
        ok(int(a[(sy0 + sy1) // 2, gap_x]) < 12, name + ': a black gap between segments')
    # the tach face has no red anywhere: it is luma only (colour is the shader's)
    ok(scene('face_tacho')[0]['format'] == 'r8', 'faces carry luma only (R8): no wedge, no needle baked')


def test_decode_against_mockup():
    print('decode against the approved mockup (K1 80_look_06; Saira 1.00 like the mockup; needs bake/work/twin-dial/mockup/r3)')
    if not os.path.exists(cf.MOCKUP):
        ok(False, 'the mockup picture %s is missing' % cf.MOCKUP)
        return
    from PIL import Image
    mock = Image.open(cf.MOCKUP)
    with tempfile.TemporaryDirectory() as t:
        res = {k: cf.compare(k, 1.0, mock, t) for k in ('tach', 'speed')}
        for k, r in res.items():
            n = r['face']
            ok(r['decoded_to_mockup']['beyond_2px'] <= 40 and r['mockup_to_decoded']['beyond_2px'] <= 60,
               '%s: bright ink edges within 2 px of the mockup (beyond 2 px: %d / %d of %d)' % (n, r['decoded_to_mockup']['beyond_2px'], r['mockup_to_decoded']['beyond_2px'], r['decoded_to_mockup']['ink_px']))
            ok(r['mean_abs_diff_per_channel'] < 3.0 and r['px_over_96'] < 300,
               '%s: mean abs diff %.2f, px over 96: %d (the spec\'s wider major lines and its arc colour differ from the mockup by design)' % (n, r['mean_abs_diff_per_channel'], r['px_over_96']))
            ok(r['by_zone']['strip']['mean_abs_diff'] < 1.0 and r['by_zone']['gap 0.94-0.97']['mean_abs_diff'] < 0.5, '%s: the tick strip (with its bright line) within 1 code of the mockup' % n)
        # the check must notice a moved dial: shift the face by 3 px and compare again
        orig = bf.reduce_face
        try:
            bf.reduce_face = lambda fc: __import__('PIL.ImageChops', fromlist=['offset']).offset(orig(fc), 3, 0)
            r = cf.compare('speed', 1.0, mock, t)
            ok(r['decoded_to_mockup']['beyond_2px'] > 1000, 'a face shifted by 3 px fails the 2 px geometry check (%d px beyond)' % r['decoded_to_mockup']['beyond_2px'])
        finally:
            bf.reduce_face = orig


def test_r3_faces():
    print('SPEC-R3 2: rings, band, strip, hub')
    for kind in ('tach', 'speed'):
        name = bf.NAMES[kind]
        a = scene(name)[1].astype(int)
        ys, xs = np.mgrid[0:560, 0:616]
        rho = np.hypot(xs + 0.5 - 308, ys + 0.5 - 310) / 300
        th = np.degrees(np.arctan2(xs + 0.5 - 308, -(ys + 0.5 - 310)))
        ath = np.abs(th)

        def last(mask, ymax=540):                                  # the largest |theta| (lower right, th > 90) with a lit px
            sel = mask & (th > 90) & (th < 175) & (ys < ymax)
            return float(th[sel].max()) if sel.any() else None
        be = last((rho > 0.985) & (rho < 1.015) & (a >= 128), 558)
        re_ = last((rho > 0.538) & (rho < 0.55) & (a >= 128))
        bd = last((rho > 0.62) & (rho < 0.85) & (a >= 20) & (ys < 480))
        ok(be is not None and abs(be - 143.6) < 0.7, '%s: the bezel ends at 143.6 (%.2f)' % (name, be))
        ok(re_ is not None and abs(re_ - 143.55) < 0.7, '%s: the rim ends at 143.55 (%.2f)' % (name, re_))
        ok(bd is not None and abs(bd - 143.0) < 0.7, '%s: the band ends at 143.0 (%.2f)' % (name, bd))
        ok(abs(be - re_) < 0.7 and abs(be - bd) < 1.2, '%s: the three rings end on one radial line' % name)
        rim = a[(rho > 0.538) & (rho < 0.55) & (ath < 100)]
        w_rim = (rim >= 128).sum() / max(1, (ath < 100).sum() and ((rho > 0.538) & (rho < 0.55) & (ath < 100)).sum()) * 0.012 * 300
        ok(1.8 <= w_rim <= 3.0, '%s: the inner ring is thin (%.2f px; 0.008 R = 2.4 px)' % (name, w_rim))
        strip = a[(rho > 0.8985) & (rho < 0.9215) & (ath < 100) & (a < 200)]
        line = a[(rho > 0.926) & (rho < 0.932) & (ath < 100) & (a < 200)]
        ok(abs(float(np.median(strip)) - 109) <= 1 and abs(float(np.median(line)) - 124) <= 2, '%s: the strip is G 109 with a bright line G 124 (%d, %d)' % (name, np.median(strip), np.median(line)))
        r = regions(name)
        ok(r['regions']['band']['tint_linear'] == [0.76, 1.0, 1.064] and r['regions']['band']['rho'] == [0.5795, 0.9375] and r['regions']['band']['theta_abs_max_deg'] == 143.0, '%s: regions JSON: band 0.5795-0.9375, to 143.0, tint 0.76 : 1 : 1.064' % name)
        ok('wedge' not in r and r['numeral_shadow']['model'] == bf.SHADOW_MODEL, '%s: regions JSON has no wedge and names the shadow model' % name)
        ok(a[217:403, 218:398].max() < 8 or kind == 'speed', '%s: the hub\'s centre (gear, program, READY) is free of ink' % name)
    # the shadow darkens the band next to a numeral (and the strip is untouched); with no model nothing is darkened
    fc_sd, *_ = bf.draw_face('tach', 1.0)
    old = bf.SHADOW_MODEL
    try:
        bf.SHADOW_MODEL = None
        fc_no, *_ = bf.draw_face('tach', 1.0)
    finally:
        bf.SHADOW_MODEL = old
    a1, a0 = np.asarray(fc_sd.img).astype(int), np.asarray(fc_no.img).astype(int)
    ys, xs = np.mgrid[0:a1.shape[0], 0:a1.shape[1]]
    rr = np.hypot((xs + 0.5) / bf.SS - bf.CX, (ys + 0.5) / bf.SS - bf.CY) / bf.R
    ok(((a1 < a0) & (rr > 0.6) & (rr < 0.85)).sum() > 20000 and not ((a1 != a0) & (rr >= 0.893)).any(), 'the numerals\' shadow darkens the band (%d px at 3x) and never the strip' % ((a1 < a0) & (rr > 0.6) & (rr < 0.85)).sum())
    ok(bf.SHADOW_MODELS['SD']['outline'] == (0.008, 0.75) and bf.SHADOW_MODELS['SD']['drop'] == (0.010, 0.012, 0.008, 0.35), 'SHADOW_MODEL "SD" is SD\'s measured model (outline 0.008 R at 0.75; drop (+0.010, +0.012) R, sigma 0.008, 0.35)')


def test_mask():
    print('fallback-window mask')
    j, a = scene('panel_mask')
    x0, y0 = j['mask']['rect'][:2]
    at = lambda x, y: int(a[y - y0, x - x0])               # noqa: E731
    ok(at(960, 650) == 255 and at(960, 620) == 255 and at(1100, 690) == 255, 'inside BMW panel: 255 (the window)')
    ok(at(694, 592) == 0 and at(1229, 703) == 0 and at(700, 598) == 0 and at(1220, 600) == 0, 'outside the outline (box corners, arc corners): 0')
    ck = bm.checks(a)
    ok(ck['plate_margin_px']['left'] >= 1.5 and min(ck['plate_margin_px'].values()) >= 1.5, 'the plate [694.5, 592, 1230, 720] covers the window, margin >= 1.5 px %s' % ck['plate_margin_px'])
    ok(all(not v['intersects'] for k, v in ck['keep_outs'].items() if k != 'side_lamp_holes_intersected'), 'the window clears the belt group, the gear gap and the marker')
    ok(ck['keep_outs']['side_lamp_holes_intersected'] == [], 'the window clears the side-lamp holes')
    poly = bm.window_polygon()
    ok(len(poly) == 41 and abs(min(p[0] for p in poly) - 696) < 1e-6, 'the polygon is the 41-vertex fallback_window.polygon_px')
    full = (a > 0).sum()
    ok(52000 < a.astype(float).sum() / 255 < 53000 and full > 0, 'window area %.0f px (the 530 x 108 outline less its corners)' % (a.astype(float).sum() / 255))
    # break it: a window dilated 12 px past the plate must be refused by the plate check
    old = bm.window_polygon
    try:
        bm.window_polygon = lambda: [[x - 10.0, y] for x, y in old()]
        ok(raises(lambda: bm.checks(a)), 'a window 10 px too far left is refused (plate does not cover it)')
    finally:
        bm.window_polygon = old
    wide = np.zeros((112, 536), np.uint8)
    wide[0:5, 0:1] = 255                                    # a px at (694, 592): left of the plate's 694.5
    ok(raises(lambda: bm.checks(wide)), 'a window pixel left of the plate edge 694.5 is refused')


if __name__ == '__main__':
    for t in (test_files, test_reproducible, test_numerals, test_faces, test_r3_faces, test_mask, test_decode_against_mockup):
        t()
    print('%d passed, %d failed' % (passed, failed))
    sys.exit(1 if failed else 0)
