"""Package design/g20-spec: batch panel-coordinate crops from the reference photos.

Reads a job list (id, photo, box, scale) and writes one PNG per job with tools/g20spec/zoom.py's
model. Research tool; run from the main checkout, output outside the repo.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/crops.py --out-dir /tmp/crops --jobs jobs.json
"""
import argparse
import json
import os
import sys

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import zoom as Z  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--jobs', required=True, help='JSON list of {id, photo, box:[x0,y0,x1,y1], scale, hjson}')
    ap.add_argument('--hjson', default=None, help='default H.json for jobs that name none')
    a = ap.parse_args()
    jobs = json.load(open(a.jobs))
    os.makedirs(a.out_dir, exist_ok=True)
    cache = {}
    for j in jobs:
        ph = j['photo']
        hj = j.get('hjson', a.hjson)
        if (ph, hj) not in cache:
            cache[(ph, hj)] = Z.model_for(a.root, ph, hj)
        ph = (ph, hj)
        R, e, img, size = cache[ph]
        n = float(j.get('scale', 4))
        out = os.path.join(a.out_dir, j['id'] + '.png')
        cv2.imwrite(out, Z.warp_box(R, e, img, size, j['box'], n))
        print(j['id'], ph[0], j['box'], 'x%g' % n, '->', out)


if __name__ == '__main__':
    main()
