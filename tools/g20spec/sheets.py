"""Package design/g20-spec: the review sheets that hold reference pixels.

These are the photo crops with the measured geometry drawn on, and the photo-above-candidate font
comparisons. They go to bake/work/g20spec/ because reference/ pixels are third-party and git-ignored
(design/overlay/README.md). The committed, pixel-free version of the font comparison is
tools/g20spec/figures.py -> design/g20-spec/fonts/.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with opencv-python-headless \
        --with numpy python -I tools/g20spec/sheets.py --root <main checkout> --fonts <dir> \
        --hjson-extra bake/work/g20spec/rect/H.json
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import figures as FIG  # noqa: E402
import fontfit as F  # noqa: E402
import zoom as Z  # noqa: E402

G = (0, 220, 0)
C = (255, 200, 0)


def crop(root, photo, box, n, hjson=None):
    R, e, ph, size = Z.model_for(root, photo, hjson)
    img = Z.warp_box(R, e, ph, size, box, n)
    return img


def label(img, text, xy, col=(230, 230, 230), sc=0.45):
    cv2.putText(img, text, xy, cv2.FONT_HERSHEY_SIMPLEX, sc, col, 1, cv2.LINE_AA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--spec-root', default=None, help='where design/g20-spec/measured.json lives')
    ap.add_argument('--hjson-extra', default=None, help='H.json for photos 34/41/42/43')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    spec_root = a.spec_root or a.root
    out = a.out or os.path.join(a.root, 'bake', 'work', 'g20spec')
    os.makedirs(out, exist_ok=True)
    meas = json.load(open(os.path.join(spec_root, 'design', 'g20-spec', 'measured.json')))
    hx = a.hjson_extra

    # 1. bottom row, photo 39, with the measured baselines and boxes
    n = 2
    box = [60, 630, 1900, 720]
    img = crop(a.root, '39', box, n)
    def px(x, y):
        return (int((x - box[0]) * n), int((y - box[1]) * n))
    for y, t in ((698.1, 'value baseline 698.1'), (700.5, 'street baseline 700.5'), (647.0, 'dial bottom line 647')):
        cv2.line(img, px(60, y), px(1900, y), G, 1)
        label(img, t, (6, px(0, y)[1] - 4), G, 0.4)
    for x0, y0, x1, y1, t in ((135.6, 666, 303.1, 699, 'range'), (344.6, 665, 450.1, 698.4, 'clock'),
                              (706, 669, 1215, 709, 'street (centre 960.5)'),
                              (1539.6, 665, 1661.9, 698, 'temperature'),
                              (1223, 657, 1356, 709, 'mode label'), (1395.1, 666.9, 1419.9, 700.1, 'gear')):
        cv2.rectangle(img, px(x0, y0), px(x1, y1), C, 1)
        label(img, t, (px(x0, y0)[0], px(x0, y0)[1] - 5), C, 0.4)
    cv2.imwrite(os.path.join(out, 'bottom-row.png'), img)

    # 2. the sign, with the fitted circle
    s = meas['speed_limit_sign']
    for pid, hj, name in (('34', hx, 'sign-50.png'), ('39', None, 'sign-empty.png')):
        n = 8
        box = [480, 565, 600, 680]
        img = crop(a.root, pid, box, n, hj)
        cx, cy = s['centre']['value']
        c = (int((cx - box[0]) * n), int((cy - box[1]) * n))
        for r, col in ((s['r_outer_px']['value'], G), (s['r_inner_px']['value'], C)):
            cv2.circle(img, c, int(round(r * n)), col, 1)
        cv2.drawMarker(img, c, G, cv2.MARKER_CROSS, 14, 1)
        label(img, 'centre %.1f, %.1f   r_out %.1f  r_in %.1f' % (cx, cy, s['r_outer_px']['value'],
                                                                  s['r_inner_px']['value']), (8, 18), G, 0.5)
        cv2.imwrite(os.path.join(out, name), img)

    # 3. the check-control area
    cc = meas['check_control']
    for pid, hj, name in (('08', None, 'cc-08-two-line.png'), ('42', hx, 'cc-42-two-line.png'),
                          ('43', hx, 'cc-43-one-line.png'), ('17', None, 'cc-17-one-line.png'),
                          ('39', None, 'cc-39-no-message.png')):
        n = 3
        box = [660, 585, 1320, 720]
        img = crop(a.root, pid, box, n, hj)
        def q(x, y):
            return (int((x - box[0]) * n), int((y - box[1]) * n))
        cv2.line(img, q(cc['rail_flat_x'][0], cc['rail_y']['value']),
                 q(cc['rail_flat_x'][1], cc['rail_y']['value']), G, 1)
        cv2.line(img, q(*cc['rail_tip_left']), q(cc['rail_flat_x'][0], cc['rail_y']['value']), G, 1)
        cv2.line(img, q(cc['rail_flat_x'][1], cc['rail_y']['value']), q(*cc['rail_tip_right']), G, 1)
        cv2.rectangle(img, q(712, 633), q(cc['symbol_slot']['right_x'], 685), C, 1)
        for y in cc['two_line_baselines_y']['value'] + [cc['one_line_baseline_y']['value']]:
            cv2.line(img, q(800, y), q(1140, y), (120, 120, 255), 1)
        cv2.line(img, q(cc['text_centre_x']['value'], 612), q(cc['text_centre_x']['value'], 712), (120, 120, 255), 1)
        label(img, '%s: rail y %.1f, symbol slot right %.1f, text centre %.1f'
              % (pid, cc['rail_y']['value'], cc['symbol_slot']['right_x'], cc['text_centre_x']['value']),
              (8, 16), G, 0.5)
        cv2.imwrite(os.path.join(out, name), img)

    # 4. the speedometer scale where the limit sits (nothing is drawn there)
    img = crop(a.root, '09', [80, 250, 420, 660], 2)
    label(img, 'photo 09: limit 50 shown in the sign, no marking on the scale', (10, 20), G, 0.5)
    cv2.imwrite(os.path.join(out, 'speedo-no-marking.png'), img)

    # 5. photo over candidate renders, per run
    dirs = [os.path.join(spec_root, 'tools', 'fonts-src')] + a.fonts
    PH = {'street34': ('34', [700, 664, 1225, 712], hx), 'msg42l1': ('42', [848, 616, 1085, 658], hx),
          'clock': ('39', [340, 660, 455, 703], None), 'range_digits': ('39', [180, 660, 258, 703], None),
          'sign50': ('34', [515, 604, 560, 640], hx)}
    for rid, cands in FIG.SHORTLIST.items():
        if rid not in PH:
            continue
        run = meas['runs'][rid]
        pid, pbox, hj = PH[rid]
        ph = crop(a.root, pid, pbox, 4, hj)
        rows = [('photo %s' % pid, ph)]
        for name, ax in cands:
            path = None
            for d in dirs:
                if os.path.exists(os.path.join(d, FIG.FILES[name])):
                    path = os.path.join(d, FIG.FILES[name])
                    break
            if not path:
                continue
            size = F.size_for(path, ax, run['height_px'], run['height_probe'])
            im, base = F.render(path, ax, size, run['text'])
            k = F.ink_metrics(im)
            sub = im[max(0, k['y0'] - 8):k['y1'] + 8, max(0, k['x0'] - 8):k['x1'] + 8]
            sub = cv2.cvtColor(cv2.resize(sub, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST),
                               cv2.COLOR_GRAY2BGR)
            rows.append(('%s %s %+.1f%%' % (name, (ax or {}).get('wght', ''),
                                            100 * (k['w'] - run['ink_width_px']) / run['ink_width_px']), sub))
        w = max(r.shape[1] for _, r in rows) + 300
        h = sum(r.shape[0] + 16 for _, r in rows) + 20
        sheet = np.zeros((h, w, 3), np.uint8)
        y = 10
        for lab, r in rows:
            sheet[y:y + r.shape[0], 290:290 + r.shape[1]] = r
            label(sheet, lab, (8, y + r.shape[0] // 2 + 4))
            y += r.shape[0] + 16
        cv2.imwrite(os.path.join(out, 'font-%s.png' % rid), sheet)
    print('sheets in', out)


if __name__ == '__main__':
    main()
