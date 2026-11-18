#!/usr/bin/env python3
"""Round 3b (KA) changed tools/twin-dial/mockup/mockup.py: every older picture must stay byte-identical. The hashes below
were taken from twin-r3/k1's mockup.py (4d0eae2) before any round-3b change; this test renders the same pictures now.

    UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3b/ka/test_old_pictures.py
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'mockup'))
import mockup as M  # noqa: E402

EXPECTED = {
 "clock": "81926c1a34ee55de",
 "trip": "e0da47ade4133f68",
 "msg": "314d1979fe2db5e3",
 "r3_fixed": "ff0d8e759a6b43e9",
 "band_B": "36484df05b835bc3",
 "red_arc": "f18e95ece7a47f5c",
 "red_both": "4e4db27acc06ce21",
 "num_shadow": "2be2c25c41891727",
 "gear_centre": "e6d8fc206f3bd021",
 "strip_line": "2be2bbb1b2ce296e",
 "needle_shadow": "9e251e319a6edcb4",
 "look_06": "de22c68c54b800e7",
 "look_C_both": "6cd78a2796b005c0",
 "red_08_end": "ebddc40665f0e6eb",
 "red_wedge_rim": "5618ec0b86652d2e",
 "rim_today": "60aadde89410aad1"
}


def h(img):
    return hashlib.sha256(img.tobytes()).hexdigest()[:16]


def main():
    got = {'clock': h(M.render(page='clock')), 'trip': h(M.render(page='trip', speed=112.0, rpm=3.1)),
           'msg': h(M.render(page='clock', message=('Водійські двері відчинено', 'info', 'cc_door')))}
    for n in EXPECTED:
        if n not in got:
            got[n] = h(M.render(look=M.look_named(n), gear='D'))
    bad = [n for n in EXPECTED if got[n] != EXPECTED[n]]
    print('old pictures: %d checked, %d changed %s' % (len(EXPECTED), len(bad), bad or ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
