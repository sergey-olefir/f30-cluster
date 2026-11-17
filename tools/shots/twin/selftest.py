"""tools/shots/twin: does the harness fail when it should? (a green audit is trusted only if it goes red on a leak)

    UV_CACHE_DIR=... uv run -q --no-project --with numpy --with pillow --with moderngl python -I tools/shots/twin/selftest.py [--no-bench]

1. no bench: measure.needle_angle on drawn needles, compare.py on identical / shifted pictures, twin_audit.py on
   synthetic alpha images (a belt leak, a lamp leak, a half-open window, a covered window, a layer in the gear gap).
2. with the stand-in on a bench (STANDIN_LEAK): the same four leaks made by an app, run through run.py: each must turn
   exactly its own check red, and the clean run must be all green. Uses ports 8205 and up; slow (about a minute each).
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..'), os.path.join(HERE, '..', '..', 'strip', 'O')):
    sys.path.insert(0, p)
import compare as CP    # noqa: E402
import measure as MS    # noqa: E402
import twin_audit as TA  # noqa: E402

n_ok = n_bad = 0


def ok(c, what):
    global n_ok, n_bad
    if c:
        n_ok += 1
        print('  ok   ' + what)
    else:
        n_bad += 1
        print('  FAIL ' + what)


def needle_img(c, ang, width=5):
    img = np.zeros((720, 1920, 3), np.float32)
    t = math.radians(ang)
    for r in np.arange(0.465 * 300, 0.99 * 300, 0.5):
        x, y = c[0] + r * math.sin(t), c[1] - r * math.cos(t)
        img[int(y) - width // 2:int(y) + width // 2 + 1, int(x) - width // 2:int(x) + width // 2 + 1] = 1.0
    return img


def alpha_all():
    A = np.ones((720, 1920), np.float32)
    g = TA.geometry()
    for r in [g['belt'], g['gear']] + g['lamps']:
        A[int(r[1]):int(r[3]), int(r[0]):int(r[2])] = 0
    return A


def checks(A, cc, layers=None):
    r = TA.audit(A, np.zeros((720, 1920, 3), np.float32), layers or [], cc)
    return {c['name']: c['ok'] for c in r['checks']}


def fails(r):
    return sorted(c['name'] for e in r for c in e['checks'] if not c['ok'] and not c.get('warn'))


def unit():
    print('measure.py')
    for ang in (-125, -50.3, 0, 31.2, 125):
        a, conf = MS.needle_angle(needle_img(MS.CT, ang), MS.CT)
        ok(a is not None and abs(a - ang) < 0.6, 'needle at %.1f measured %s' % (ang, None if a is None else round(a, 2)))
    a, _ = MS.needle_angle(np.zeros((720, 1920, 3), np.float32), MS.CT)
    ok(a is None, 'no needle in a black picture')
    ok(abs(MS.speed_angle(100)) < 1e-9 and MS.speed_angle(300) == 125 and MS.tach_angle(8000) == 125 and MS.tach_angle(0, True) == -135, 'the laws: 100 km/h at 0, 300 and 8000 at +125, OFF at -135')
    print('compare.py')
    a = np.zeros((720, 1920, 3), np.float32)
    a[300:340:8, 1000:1100] = 1; a[300:340, 1000:1003] = 1; a[300:340, 1097:1100] = 1      # thin lines, as a dial is
    m = CP.compare(a, a)['whole']
    ok(m['mae'] == 0 and m['rec2'] == 1 and m['prec2'] == 1 and m['d_centroid'] == [0.0, 0.0], 'identical pictures: no difference, geometry 1.0 / 1.0')
    b = np.roll(a, 6, axis=1)
    m = CP.compare(b, a)['whole']
    ok(abs(m['d_centroid'][0] - 6) < 0.01 and m['prec2'] < 0.8, 'shifted by 6 px: centroid +6, precision at 2 px drops (%s)' % m['prec2'])
    b = np.roll(a, 1, axis=1)
    ok(CP.compare(b, a)['whole']['rec2'] > 0.95, 'shifted by 1 px: still within 2 px')
    print('twin_audit.py')
    A = alpha_all()
    ok(all(checks(A, 'none', [{'kind': 'image', 'x': 0, 'y': 0, 'w': 100, 'h': 100, 'conn': 1}]).values()), 'a clean picture, no message: every check green')
    B = A.copy(); B[700, 600] = 1
    ok(not checks(B, 'none')['belt group open'], 'one pixel on the belt group turns "belt group open" red')
    B = A.copy(); B[230, 1800 + 0] = 1; B[230, 40] = 0.5
    ok(not checks(B, 'none')["side lamps: BMW's own boxes clear"], 'half-covered pixel in a lamp box turns "side lamps: BMW\'s own boxes clear" red')
    B = A.copy(); B[207, 1774] = 1
    ok(checks(B, 'none')["side lamps: BMW's own boxes clear"] and not checks(B, 'none')['side lamps: the 3 px margin clear'], 'a pixel only in the 3 px margin: the box check stays green, the margin check is red (a warning)')
    B = A.copy(); B[700, 1400] = 1
    ok(not checks(B, 'none')['gear gap open'], 'a pixel in the gear gap turns "gear gap open" red')
    lay = [{'kind': 'image', 'x': 1390, 'y': 664, 'w': 40, 'h': 40, 'conn': 2, 'key': '2:7'}]
    ok(not checks(A, 'none', lay)['no layer rect in the gear gap'], 'a layer rectangle in the gear gap turns that check red')
    full, real = TA.polygon_mask(TA.geometry()['polygon']), TA.polygon_mask(TA.geometry()['polygon'], 3)
    W = A.copy(); W[full] = 0
    ok(checks(W, 'window')["message window open over BMW's panel"], 'an open window: green in state window')
    ok(not checks(W, 'none')["BMW's panel covered (none)"], 'the same open window with no message: red (BMW panel would show)')
    H = A.copy(); H[real] = 0; H[640, 900] = 0.6
    ok(not checks(H, 'window')["message window open over BMW's panel"], 'ink inside the open window: red')
    H = A.copy(); H[600:700, 1000:1100] = 0
    ok(not checks(H, 'ours')["BMW's panel covered (ours)"], 'a plate with a hole in it: red')
    ok(checks(A, 'ours')["BMW's panel covered (ours)"], 'a plate that covers: green')


def bench_leaks():
    out = tempfile.mkdtemp(prefix='twin-selftest-')
    only = 'M3_door'                       # window + ours of the door message
    cases = [('', None), ('belt', 'belt group open'), ('gear', ['gear gap open', 'no layer rect in the gear gap']), ('window', "message window open over BMW's panel"), ('half', "message window open over BMW's panel")]
    for leak, want in cases:
        o = os.path.join(out, leak or 'clean')
        env = dict(os.environ, STANDIN_LEAK=leak)
        r = subprocess.run([sys.executable, '-I', os.path.join(HERE, 'run.py'), '--standin', '--only', only, '--benches', '1', '--render', '1', '--out', o],
                           env=env, capture_output=True, text=True)
        if r.returncode:
            ok(False, 'run with leak "%s" failed: %s' % (leak, r.stderr[-300:]))
            continue
        res = json.load(open(os.path.join(o, 'results.json')))['pictures']
        red = sorted(set(c['name'] for e in res for c in e['checks'] if not c['ok'] and not c.get('warn')))
        if want is None:
            ok(not red and len(res) == 2, 'clean stand-in: %d pictures, no check red %s' % (len(res), red))
        else:
            want = want if isinstance(want, list) else [want]
            ok(red == sorted(want), 'leak "%s": exactly %s goes red (red: %s)' % (leak, want, red))


if __name__ == '__main__':
    unit()
    if '--no-bench' not in sys.argv:
        print('stand-in leaks on a bench')
        bench_leaks()
    print('\n%d passed, %d failed' % (n_ok, n_bad))
    sys.exit(1 if n_bad else 0)
