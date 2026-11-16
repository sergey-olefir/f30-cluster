"""Package ZL: where the bench's backdrop rects (bake/work/overlay/rect/<id>.png, 1920 x 720, the frames the owner
puts under the theme) put BMW's sign: the same ray measurement as sign.py, on the rect itself (identity model).
A rect whose sign sits off the true centre makes ANY round window look lopsided on the bench.
    ... python -I tools/strip/ZL/sign_rects.py 08 09 14 17 39 [60 61 ...: R's new rects once they exist]
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign as S  # noqa: E402
import lmodel as LM  # noqa: E402

RECT = os.path.join(LM.ROOT, 'bake', 'work', 'overlay', 'rect')


def main(ids):
    out = {}
    for k in ids:
        f = os.path.join(RECT, k + '.png')
        im = cv2.imread(f)
        if im is None:
            continue
        lm = LM.LModel(LM.R.Model(np.eye(3), (im.shape[1], im.shape[0]), 0.0))
        S.load = lambda photo, hjson=None, lm=lm, im=im, f=f: (lm, im, {'source': f})
        try:
            o = S.measure(k)
        except Exception as ex:          # no sign in that rect
            print(k, 'no sign:', ex)
            continue
        out[k] = {x: o[x] for x in ('centre_outer', 'r_outer', 'centre_inner', 'r_inner', 'outer_resid_rms', 'rays_used')}
        print(k, out[k], flush=True)
    json.dump(out, open(os.path.join(S.ZD, 'sign_rects.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
