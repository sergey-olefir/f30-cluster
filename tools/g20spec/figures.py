"""Package design/g20-spec: the committed comparison figures (no photo pixels).

For each measured text run it renders the shortlisted free faces at the size that matches the photo's
cap (or figure) height, and draws the photo's measured ink box around each one, so the width error is
visible without putting any reference pixels in the repo. The photo-vs-render sheets, which do hold
reference pixels, are made by tools/g20spec/sheets.py into bake/work/g20spec/ (git-ignored).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with opencv-python-headless \
        --with numpy python -I tools/g20spec/figures.py --fonts <dir> --out design/g20-spec/fonts
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fontfit as F  # noqa: E402

SHORTLIST = {
    'street34': [('Roboto', {'wdth': 100, 'wght': 350}), ('Roboto 87.5w', {'wdth': 87.5, 'wght': 350}),
                 ('IBMPlexSans', {'wdth': 100, 'wght': 350}), ('PTSans', None),
                 ('NotoSansDisplay', {'wdth': 100, 'wght': 350}), ('OpenSans', {'wdth': 100, 'wght': 350})],
    'msg42l1': [('Roboto', {'wdth': 100, 'wght': 700}), ('Roboto 87.5w', {'wdth': 87.5, 'wght': 700}),
                ('NotoSansDisplay', {'wdth': 100, 'wght': 600}), ('IBMPlexSans', {'wdth': 100, 'wght': 600}),
                ('OpenSans', {'wdth': 100, 'wght': 700}), ('PTSans', None)],
    'clock': [('Roboto', {'wdth': 100, 'wght': 500}), ('Roboto 87.5w', {'wdth': 87.5, 'wght': 500}),
              ('NotoSansDisplay', {'wdth': 100, 'wght': 500}), ('NotoSans', {'wdth': 100, 'wght': 450}),
              ('PTSans', None), ('FiraSans', None)],
    'range_digits': [('Roboto', {'wdth': 100, 'wght': 500}), ('NotoSans', {'wdth': 100, 'wght': 450}),
                     ('NotoSansDisplay', {'wdth': 100, 'wght': 450}), ('PTSans', None), ('FiraSans', None)],
    'sign50': [('Roboto', {'wdth': 100, 'wght': 400}), ('NotoSansDisplay', {'wdth': 100, 'wght': 400}),
               ('PTSans', None), ('FiraSans', None)],
}
FILES = {c[0]: c[1] for c in [(n, f) for n, f, _ in F.DEFAULT_CANDIDATES]}
SCALE = 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.abspath(os.path.join(HERE, '..', '..')))
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    meas = json.load(open(os.path.join(a.root, 'design', 'g20-spec', 'measured.json')))
    dirs = [os.path.join(a.root, 'tools', 'fonts-src')] + a.fonts
    os.makedirs(a.out, exist_ok=True)

    def find(fn):
        for d in dirs:
            if os.path.exists(os.path.join(d, fn)):
                return os.path.join(d, fn)
        return None

    for rid, cands in SHORTLIST.items():
        run = meas['runs'][rid]
        tgt_w = run['ink_width_px']
        rows = []
        for name, ax in cands:
            path = find(FILES[name])
            if path is None:
                continue
            size = F.size_for(path, ax, run['height_px'], run['height_probe'])
            img, base = F.render(path, ax, size, run['text'])
            k = F.ink_metrics(img)
            if not k:
                continue
            pad = 10
            sub = img[max(0, k['y0'] - pad):k['y1'] + pad, max(0, k['x0'] - pad):k['x0'] + int(tgt_w) + 3 * pad]
            sub = cv2.cvtColor(sub, cv2.COLOR_GRAY2BGR)
            sub = cv2.resize(sub, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_NEAREST)
            # the photo's measured ink box, from the first ink column and the baseline
            x0 = pad * SCALE
            y0 = (k['y0'] - max(0, k['y0'] - pad)) * SCALE
            cv2.rectangle(sub, (x0, y0), (x0 + int(tgt_w * SCALE), y0 + int(run['height_px'] * SCALE)),
                          (0, 220, 0), 1)
            rows.append(('%s %s  %+.1f%%' % (name, (ax or {}).get('wght', ''),
                                             100 * (k['w'] - tgt_w) / tgt_w), sub))
        if not rows:
            continue
        w = max(r.shape[1] for _, r in rows) + 330
        h = sum(r.shape[0] + 18 for _, r in rows) + 50
        out = np.zeros((h, w, 3), np.uint8)
        cv2.putText(out, '%s  "%s"   %s height %.2f px, photo ink width %.2f px  (green: the photo box)'
                    % (rid, run['text'], run.get('height_kind', 'cap'), run['height_px'], tgt_w),
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (180, 180, 180), 1, cv2.LINE_AA)
        y = 40
        for label, r in rows:
            out[y:y + r.shape[0], 320:320 + r.shape[1]] = r
            cv2.putText(out, label, (10, y + r.shape[0] // 2 + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        (200, 200, 200), 1, cv2.LINE_AA)
            y += r.shape[0] + 18
        p = os.path.join(a.out, rid + '.png')
        cv2.imwrite(p, out)
        print('wrote', p)


if __name__ == '__main__':
    main()
