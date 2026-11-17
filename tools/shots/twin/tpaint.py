"""tools/shots/twin: the render pool. Turns a snapshot (tdrive.py) into the gallery's pictures and numbers, replaying it
the way the bench draws it (tools/strip/O/render.py through tools/shots/paint.py: the app's real fragment shaders on
the Mac's GPU, stacked as bench/page.html stacks them) at the panel's own 1920 x 720 pixels. No browser.

Per snapshot, into <out>/<set>/:
  <name>.png         the "car" view: our layers over BMW's parts (backdrop.py), BMW's gear letter over us
  <name>.ours.png    our layers alone, over black (what the mockup is: the comparison's input)
  <name>.cmp.png     ours | mockup | difference, for the four mockup scenes
  <name>.t.jpg       480 x 180 thumbnail of the car view
and the numbers: the pixel audit (tools/strip/O/twin_audit.py), the needles' angles against SPEC 5.1 / 5.2, READY, the
warning tab, and per-region numbers against the mockup (compare.py).
"""
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, '..')
for p in (os.path.join(HERE), SHOTS, os.path.join(SHOTS, '..', 'strip', 'O')):
    if p not in sys.path:
        sys.path.insert(0, p)
import paint            # noqa: E402  (tools/shots/paint.py: SnapZ, Painter)
import twin_audit as TA  # noqa: E402
import backdrop as BD    # noqa: E402
import measure as MS     # noqa: E402
import compare as CP     # noqa: E402
import scenes as SC      # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MOCKUP_DIR = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup')
# the mockup's four pictures and the scene that is fed to match each (scenes.py): M1 and M4 are matrix cells
MOCKUP_OF = {'A/day_none_clock_driving': '1_clock.png', 'B/M2_trip': '2_trip.png', 'B/M3_door_info': '3_message_info.png',
             'A/day_ours_trip_driving': '4_message_warning.png'}
NEEDLE_TOL = 2.5          # degrees: SPEC 5 laws, needle settled (0.7.14 smoothing)


def save(arr, path, thumb=None):
    from PIL import Image
    im = Image.fromarray(np.round(np.clip(arr, 0, 1) * 255).astype(np.uint8), 'RGB')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = '%s.%d.tmp.png' % (path, os.getpid())
    im.save(tmp, compress_level=6)
    os.replace(tmp, path)
    if thumb:
        t = im.resize((480, 180), Image.LANCZOS)
        tt = '%s.%d.tmp.jpg' % (thumb, os.getpid())
        t.save(tt, quality=84)
        os.replace(tt, thumb)


def content_checks(prem, st, probe_cc):
    """The state's content, read off our own picture: the needles, READY, the warning tab. -> list of check dicts."""
    out = []
    sig = SC.signals_of(st)

    def add(name, ok, value, limit, note=''):
        out.append({'name': name, 'ok': bool(ok), 'value': value, 'limit': limit, 'note': note})
    ready = sig.get('condition') in (8, 10)
    off = sig['rpm'] < 150 and not (ready or sig.get('engine') == 2)
    for kind, c, want in (('tach', MS.CT, MS.tach_angle(sig['rpm'], off)), ('speed', MS.CS, MS.speed_angle(sig['speed']))):
        a, conf = MS.needle_angle(prem, c)
        if a is None:
            add('%s needle angle' % kind, False, None, '%.1f deg +-%.1f' % (want, NEEDLE_TOL), 'no needle found (white along the ray: %.2f)' % conf)
        else:
            add('%s needle angle' % kind, abs(a - want) <= NEEDLE_TOL, round(a, 2), '%.1f deg +-%.1f' % (want, NEEDLE_TOL), 'measured %.2f, law %.2f' % (a, want))
    # READY (green, SPEC 5.1) iff the car is ready to drive
    x0, y0, x1, y1 = 270, 315, 490, 365
    box = prem[y0:y1, x0:x1]
    green = int(((box[..., 1] > 0.3) & (box[..., 1] > box[..., 0] * 1.5) & (box[..., 1] > box[..., 2] * 1.5)).sum())
    add('READY shown iff ready to drive', (green > 40) == ready, green, 'green px %s 40' % ('>' if ready else '<='), 'VehicleCondition %s' % sig.get('condition'))
    # the warning tab (SPEC 6.1): flat severity colour while a message shows; day look, the amber message
    if st['look'] == 'day' and st['msg'] in ('ours', 'window', 'none') and (st.get('message') or SC.TYRE)['color'] == 'yellow':
        cell = prem[130:170, 746:757].reshape(-1, 3)
        med = np.median(cell, axis=0) * 255
        lit = (med.max() - med.min()) > 60
        add('warning tab lit while a message shows' if st['msg'] != 'none' else 'warning tab not lit with no message',
            lit == (st['msg'] != 'none'), [int(v) for v in med], 'saturated' if st['msg'] != 'none' else 'neutral', 'cell x 746-757 (SPEC 8.2: amber)')
    return out


def paint_one(P, item, out):
    t0 = time.time()
    S = paint.SnapZ(item['snap'])
    comp = P.compose(S, (0, 0, 1920, 720), 1, per_layer=True)
    A, prem = comp['alpha'], comp['prem']
    notes = [{'key': l['key'], 'note': l['note']} for l in comp['layers'] if l.get('note')]
    layers = [l for l in S.layers if l['target'] == 'panel']
    st = item['state']
    cc = (S.meta.get('probe') or {}).get('cc') or {}
    cc_state = cc.get('state')
    res = TA.audit(A, prem, layers, cc_state, S.meta.get('pixels'), notes)
    checks = res['checks']
    if not st['demo']:
        checks += content_checks(prem, st, cc)
    shown = cc_state in ('window', 'ours') if cc_state else st['msg'] != 'none'
    car = prem + BD.under(shown) * (1.0 - A[..., None])
    car = BD.over(car, 'D' if SC.signals_of(st).get('gear') else 'P')
    base = os.path.join(out, item['rel'])
    save(car, base + '.png', base + '.t.jpg')
    save(prem, base + '.ours.png')
    r = {'id': item['id'], 'name': item['name'], 'set': item['set'], 'rel': item['rel'], 'cc_state': cc_state,
         'severity': cc.get('severity'), 'checks': checks, 'ok': all(c['ok'] for c in checks),
         'layers_drawn': len([l for l in comp['layers'] if l.get('alpha') is not None]), 'render_notes': notes,
         'coverage': round(float(A.mean()), 4), 'render_secs': round(time.time() - t0, 2),
         'files': {'car': item['rel'] + '.png', 'ours': item['rel'] + '.ours.png', 'thumb': item['rel'] + '.t.jpg'}}
    mk = MOCKUP_OF.get(item['id'])
    if mk and os.path.exists(os.path.join(MOCKUP_DIR, mk)):
        m = CP.load(os.path.join(MOCKUP_DIR, mk))
        r['mockup'] = {'file': mk, 'regions': CP.compare(prem, m)}
        CP.side_by_side(prem, m, base + '.cmp.png')
        r['files']['cmp'] = item['rel'] + '.cmp.png'
    np.savez_compressed(os.path.join(item['snap'], 'ours.npz'), alpha=A.astype(np.float16), prem=prem.astype(np.float16)) if item.get('keep') else None
    return r


def worker(inq, outq, out):
    P = paint.Painter()
    while True:
        item = inq.get()
        if item is None:
            break
        try:
            r = paint_one(P, item, out)
        except Exception as e:      # a snapshot that cannot be drawn is reported, not guessed round
            import traceback
            r = {'id': item['id'], 'error': repr(e), 'trace': traceback.format_exc()[-600:]}
        outq.put(r)
    outq.put({'worker_done': True})
