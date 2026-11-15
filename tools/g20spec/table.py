"""Package design/g20-spec: run tools/g20spec/measure.py over a list of jobs and print a compact table.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/table.py --root <main> --jobs jobs.json [--hjson <extra H.json>]

Each job: {"label": ..., "photo": "39", "box": [...], "ink": "bright", "scale": 8, "merge": 0,
           "min_area": 1.5, "hjson": "<path>"}.  Prints one line per ink blob, left to right.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--hjson', default=None)
    a = ap.parse_args()
    for j in json.load(open(a.jobs)):
        cmd = [sys.executable, '-I', os.path.join(HERE, 'measure.py'), '--root', a.root,
               '--photo', j['photo'], '--box'] + [str(v) for v in j['box']] + \
              ['--scale', str(j.get('scale', 8)), '--ink', j.get('ink', 'bright'),
               '--what', j.get('what', 'glyphs'), '--min-area', str(j.get('min_area', 1.5)),
               '--merge', str(j.get('merge', 0))]
        hj = j.get('hjson', a.hjson)
        if hj:
            cmd += ['--hjson', hj]
        out = json.loads(subprocess.check_output(cmd))
        print('== %-28s photo %-3s box %s' % (j['label'], j['photo'], j['box']))
        for g in out.get('glyphs', []):
            print('   x %7.2f..%7.2f  w %6.2f   y %7.2f..%7.2f  h %6.2f   gap %6s  adv %6s'
                  % (g['x0'], g['x1'], g['w'], g['y0'], g['y1'], g['h'],
                     g.get('gap_to_prev', '-'), g.get('advance', '-')))
        for k in ('extent', 'stroke', 'colour', 'circle'):
            if k in out:
                v = dict(out[k])
                v.pop('row_profile', None)
                print('   %-7s %s' % (k, json.dumps(v)))


if __name__ == '__main__':
    main()
