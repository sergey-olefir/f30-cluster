"""VT: bake sizes on the G20 panel for every text slot of the Twin Dial, from measured heights in dial units.

For each slot: the measured ink height (figure or cap, in R) times VG's R in panel px gives the target height; the
chosen face is rendered at the slot's axes to find its own height per em ('0' for figures, 'H' for caps); the bake
size is target / (height per em), rounded to an integer (Pillow rounds a float size, docs/strip/T-REPORT.md).
Writes design/twin-dial/vt/typography.json (numbers only) and prints the table.

    python -I tools/twin-dial/vt/sizes.py --fonts <dir> [--layout bake/work/twin-dial/pub/VG/layout.json]
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import fit as F  # noqa: E402

M = json.load(open(os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vt', 'meas.json')))['samples'] \
    if os.path.exists(os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vt', 'meas.json')) else {}


def h_of(ids, kind):
    """median figure/cap height (rectified px at R 400) over the given samples' glyphs of one kind"""
    hs = []
    for i in ids:
        for g in M[i]['glyphs']:
            c = g['ch']
            if (kind == 'fig' and c in '0123456789') or (kind == 'cap' and c in 'ABCDEFGHIJKLMNOPRSTUVWXYZ'):
                if c in '1' and kind == 'fig':
                    continue
                hs.append(g['box'][3] - g['box'][2])
    return float(np.median(hs)) / 400.0 if hs else None


FACES = {   # the choice per role (see docs/twin-dial/VT-REPORT.md): file, wght, wdth
    'display': ('Saira[wdth,wght].ttf', 550, 125),          # scale: box 4.23 % at 500, 5.35 % at 550 with no bloom; stems: 500-600
    'display_bold': ('Saira[wdth,wght].ttf', 550, 125),     # readout: box 3.22 %, d_fill -0.015; stems: 450-550
    'dlabel': ('Saira[wdth,wght].ttf', 550, 125),           # dial labels: box 2.38 % (best box; Play Bold 3.34 %); stems: 450-600
    'text': ('NotoSans[wdth,wght].ttf', 500, 100),          # label: box 3.14 % at 400; stems: 400-550; full car text
}


BLOOM = {'display': 0.79, 'display_bold': 1.38, 'dlabel': 0.37, 'text': 0.01}   # fit.py, e >= 0, the chosen settings


def slots():
    """slot: (role face, wght override, kind, height in R, source)"""
    return [
        ('scale_major', 'display', None, 'fig', h_of(['s100', 's80', 's60', 's180', 's40', 's20'], 'fig'), '02 rect: 6 speedometer numerals'),
        ('scale_minor', 'display', None, 'fig', 0.054, 'VD (02R 05R, 10 numerals); VT 02 "160": 0.046'),
        ('tacho_numerals', 'display', None, 'fig', 0.135, 'VD 04L (05L 0.120; VT 05 "2-6": %.4f)' % h_of(['f2', 'f3', 'f4', 'f5', 'f6'], 'fig')),
        ('rev_strip_numerals', 'display', 450, 'fig', 0.070, 'VD 02L'),
        ('speed_readout', 'display_bold', None, 'fig', h_of(['hub0'], 'fig'), '02 rect hub "0" (05: %.3f, a smaller hub)' % h_of(['fhub0'], 'fig')),
        ('gear', 'display_bold', None, 'cap', h_of(['d1'], 'cap'), '02 rect "D"'),
        ('dial_label', 'dlabel', None, 'cap', h_of(['auto'], 'cap'), '02 rect "AUTO" (MAX %.4f)' % h_of(['max'], 'cap')),
        ('centre_title', 'text', None, 'cap', h_of(['title'], 'cap'), '02 rect "Short-term memory"'),
        ('centre_value', 'text', None, 'fig', h_of(['v00', 'v273', 'v45'], 'fig'), '02 rect "0.0" "27.3" "4.5"'),
        ('centre_body', 'text', None, 'cap', h_of(['reset'], 'cap'), '02 rect "Reset values with OK" (05 "Language" %.4f)' % h_of(['flang'], 'cap')),
        ('centre_small_value', 'text', None, 'fig', h_of(['time'], 'fig'), '02 rect "0:43 h"'),
        ('bottom_row', 'text', None, 'fig', h_of(['v694', 'clock', 'temp'], 'fig'), '02 rect "694" "14:43" "+25.5"'),
        ('tab_text', 'text', None, 'cap', h_of(['radio'], 'cap'), '02 rect "DANCE FM"'),
        ('units_small', 'text', None, 'fig', h_of(['rpm'], 'fig'), '02 rect "1 / min x 1000"'),
        ('message_text', 'text', None, 'cap', 0.10, 'VF message_panel.json M2 / M1 text cap_R 0.1 (one or two lines; BMW\'s own cap 24.6 px)'),
        ('message_counter', 'text', None, 'cap', 0.068, 'VF message_panel.json counter cap_R 0.068'),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--layout', default=os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'VG', 'layout.json'))
    ap.add_argument('--text-wght', type=float, default=None, help='override the text face weight for every text slot')
    a = ap.parse_args()
    L = json.load(open(a.layout))
    Rpx = float(L['R_px'])
    files = glob.glob(os.path.join(ROOT, 'tools', 'fonts-src', '*.ttf'))
    for d in a.fonts:
        files += glob.glob(os.path.join(d, '**', '*.ttf'), recursive=True)
    byname = {os.path.basename(p): p for p in files}
    out = {'_about': 'VT bake sizes for the Twin Dial on the G20 panel. h_R = measured ink height in dial units; target = h_R * R; size = the integer px size to bake (tools/bake_fonts.py) so the face\'s own figure/cap height meets the target; got = that height at the integer size.',
           'R_px': Rpx, 'layout_rev': L.get('rev'), 'slots': {}}
    print('R = %.0f px (VG layout rev %s)' % (Rpx, L.get('rev')))
    print('%-20s %-30s %5s %5s %4s %7s %7s %5s %6s' % ('slot', 'face', 'wght', 'wdth', 'kind', 'h_R', 'target', 'size', 'got'))
    for name, role, wo, kind, hR, src in slots():
        fn, w, d = FACES[role]
        if src.startswith('02 rect'):
            # VT's own heights are half-max ink boxes of a blooming LCD: take off the fitted bloom on both edges
            hR -= 2 * BLOOM[role] / 400.0
            src += ' (less 2 x bloom %.2f px at R 400)' % BLOOM[role]
        if role == 'text' and a.text_wght:
            w = a.text_wght
        elif wo is not None:
            w = wo
        path = byname[fn]
        probe = '0' if kind == 'fig' else 'H'
        per_em = None
        cm = F.cand_meas(path, w, d, probe)
        per_em = (cm['glyphs'][0]['box'][3] - cm['glyphs'][0]['box'][2]) / F.RS
        target = hR * Rpx
        size = int(round(target / per_em))
        got = size * per_em
        out['slots'][name] = {'face': fn, 'wght': w, 'wdth': d, 'kind': kind, 'h_R': round(hR, 4), 'target_px': round(target, 2),
                              'size_px': size, 'got_px': round(got, 2), 'source': src}
        print('%-20s %-30s %5s %5s %4s %7.4f %7.2f %5d %6.2f' % (name, fn[:30], w, d, kind, hR, target, size, got))
    json.dump(out, open(os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'sizes.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
