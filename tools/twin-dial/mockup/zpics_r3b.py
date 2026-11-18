#!/usr/bin/env python3
"""KC (round 3b): "everything on", Z01-Z04, composed from KA's dial / sign / cruise drawing (mockup.py of twin-r3b/ka) and KB's tabs,
pages and bottom row (pages.py of twin-r3b/kb). No new design: only a combination of states no single package draws.

    KC_KA=<KA worktree> KC_KB=<KB worktree> UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow \
        python -I tools/twin-dial/mockup/zpics_r3b.py

Z01  driving at 103 km/h, limit 90, cruise 110, a two-line amber message has just arrived: BMW's panel open through the window,
     tab 2 selected, our card painted, the bottom row gone, the sign stays.
Z02  >= 150 ms later: the same message, the window closed, the bottom row back in one line, the rule amber.
Z03  tab 5 with the map window, over the limit (103 > 90), cruise on.
Z04  an incoming call on tab 4, cruise in standby (grey number and symbol, no green marker), the limit 90 and 103 km/h.
Output: bake/work/twin-dial/mockup/r3b/kc/z/Z0n_*.png and index.json.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
KA = os.environ.get('KC_KA') or os.path.join(ROOT, '..', 'k3-ka')
KB = os.environ.get('KC_KB') or os.path.join(ROOT, '..', 'k3-kb')
os.environ['KB_DIALS'] = os.path.join(KA, 'tools', 'twin-dial', 'mockup', 'mockup.py')
os.environ['KB_LOOK'] = 'r3b_base'
sys.path.insert(0, os.path.join(KA, 'tools', 'twin-dial', 'mockup'))     # pictos_r3b, frame_r3b
sys.path.insert(0, os.path.join(KB, 'tools', 'twin-dial', 'mockup'))     # pictos_r3

spec = importlib.util.spec_from_file_location('pages_kb', os.path.join(KB, 'tools', 'twin-dial', 'mockup', 'pages.py'))
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
M = P.M
import pictos_r3b                                        # noqa: E402  (KA's: the cruise and limiter symbols)
from PIL import Image                                    # noqa: E402

OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'mockup', 'r3b', 'kc', 'z')
ZS = {'limit': None, 'cruise': None, 'sdf': []}
_orig = M.draw_dials


def draw_dials(cv, look=None, speed=87.0, rpm=2.4, gear='D3', *a, **kw):
    _orig(cv, look, speed, rpm, gear, limit=ZS['limit'], cruise=ZS['cruise'], strip='L1', place='C1')
    ZS['sdf'] = list(cv.sdf)                              # KA's readout symbols: queued on the canvas, not carried by KB's base copy
M.draw_dials = draw_dials


def frame(sel, page, limit, cruise, speed=103.0, **kw):
    ZS.update(limit=limit, cruise=cruise)
    P._BASE.clear()
    img, p = P.shot('z', 'Z', 'x', '', [], sel, page, speed=speed, save=False, sign=False, **kw)
    return p


def finish(p):
    out = p.cv.img.resize((P.W, P.H), Image.LANCZOS)
    M.paste_icons(out, p.cv.icons)
    for name, size, cx, cy, color, alpha in p.sdf:
        P.paste_sdf(out, name, size, cx, cy, color, alpha)
    for name, size, cx, cy, color, alpha in ZS['sdf']:
        pictos_r3b.paste_sdf(out, name, size, cx, cy, color, alpha)
    return out


def main():
    P.load_models()
    os.makedirs(OUT, exist_ok=True)
    lim = M.Limit('limit', 90)
    on = M.Cruise('cruise', 'active', 110)
    standby = M.Cruise('cruise', 'standby', 110)
    inc = P.C(t4=dict(icon='td_phone'))
    card = lambda p: P.pg_card(p, 'amber2')
    rows = []

    def add(pid, name, what, p, keys, sec):
        # the sign is drawn last, over the bottom row's right end, window open or not (SPEC-R3 8)
        box = M.draw_sign(p.cv, lim)
        img = finish(p)
        fn = '%s_%s.png' % (pid, name)
        img.save(os.path.join(OUT, fn))
        st = P.spec_status(keys)
        st.update({'speed limit (sign, marker, strip)': 'unseen: declared, no log line (SPEC-R3 8)',
                   'cruise (marker, readout)': 'after probe: displayDriverAssistanceLongitudinal unseen (SPEC-R3 9)'})
        rows.append(dict(id=pid, file=fn, what=what, status=st, spec=sec))
        print('wrote', fn)

    p = frame(2, card, lim, on, warn='amber', window=True)
    add('Z01', 'msg_arrives_window_open', 'driving at 103, limit 90 (sign, red marker, full red strip), cruise 110 (green marker and readout); a two-line amber '
        'message has just arrived: BMW panel open, bottom row gone, tab 2, our card painted', p, ['cc', 'cc_now', 'clock'], 'SPEC-R3 5.4 step 1, 8, 9')
    p = frame(2, card, lim, on, warn='amber', sev_rule='auto')
    add('Z02', 'msg_settled_150ms', '>= 150 ms later: window closed, bottom row back in one line, rule amber; limit and cruise as Z01', p,
        ['cc', 'cc_now', 'clock'], 'SPEC-R3 5.4 step 2, 3.5')
    p = frame(5, P.pg_map, lim, on)
    add('Z03', 'tab5_map_over_limit', 'tab 5: the map window W1 over the drawn stand-in; 103 over a limit of 90, cruise 110', p, ['map', 'road'], 'SPEC-R3 4.5, 8, 9')
    p = frame(4, lambda p: P.pg_phone_call(p, 'incoming', 'contact'), lim, standby, cs=inc)
    add('Z04', 'call_cruise_standby', 'tab 4: an incoming call ("Контакт"); cruise in standby (grey number and symbol, no green marker); limit 90, 103 km/h',
        p, ['call', 'contact_kind'], 'SPEC-R3 4.4, 9')
    json.dump(rows, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
