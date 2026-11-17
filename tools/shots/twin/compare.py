"""tools/shots/twin: a rendered state against the mockup (the owner-approved look, tools/twin-dial/mockup/mockup.py).

    python -I tools/shots/twin/compare.py <ours.png> <mockup.png> [--out <side-by-side.png>]

Both pictures are 1920 x 720 and sit on black (ours: our layers over black, no BMW parts). Per region of the panel:

  mae / rmse     mean absolute / root-mean-square difference of the brightest channel, 0..1
  diff           the share of the region's pixels that differ by more than 0.12
  ink ref / new  the share of pixels brighter than 0.25 in the mockup / in ours; ratio = new / ref
  d centroid     how far the centre of mass of the ink moved (px), and the same for the ink's bounding box edges
  rec2 / prec2   geometry at 2 px: the share of the mockup's ink within 2 px of our ink (recall), and of our ink within
                 2 px of the mockup's (precision). 1.0 / 1.0 is a drawing in the same place to 2 px
  colour dE      the mean colour of the ink in each, and the distance between them (0..255)

The mockup is a mock-up: its hub texts, fuel and coolant fill and media text are fixed values, so the scene fed for the
comparison is the mockup's own (scenes.py BASE). The side-by-side image is ours | mockup | difference (mockup-only ink red, ours-only cyan,
both white) at half size. numpy and Pillow only.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

REGIONS = {
    'tacho': (70, 90, 690, 660), 'speedo': (1230, 90, 1850, 660), 'tab bar': (618, 127, 1302, 173),
    'centre': (729, 173, 1191, 613), 'bottom row / plate': (629, 590, 1291, 720),
}
THR = 0.25


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255.0


def _dilate(mask, r):
    im = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.MaxFilter(2 * r + 1))) > 127


def region_metrics(a, b, box):
    """a: ours, b: mockup (H x W x 3 float). -> dict of numbers for the box (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    A, B = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
    la, lb = A.max(axis=2), B.max(axis=2)
    d = np.abs(la - lb)
    ia, ib = la > THR, lb > THR
    out = {'mae': round(float(d.mean()), 4), 'rmse': round(float(np.sqrt((d ** 2).mean())), 4), 'diff': round(float((d > 0.12).mean()), 4),
           'ink_ref': round(float(ib.mean()), 4), 'ink_new': round(float(ia.mean()), 4)}
    out['ink_ratio'] = round(out['ink_new'] / out['ink_ref'], 3) if out['ink_ref'] > 0 else None

    def cen(m):
        ys, xs = np.nonzero(m)
        return (xs.mean(), ys.mean(), xs.min(), xs.max(), ys.min(), ys.max()) if len(xs) else None
    ca, cb = cen(ia), cen(ib)
    if ca and cb:
        out['d_centroid'] = [round(ca[0] - cb[0], 2), round(ca[1] - cb[1], 2)]
        out['d_bbox'] = [int(ca[2] - cb[2]), int(ca[3] - cb[3]), int(ca[4] - cb[4]), int(ca[5] - cb[5])]
    else:
        out['d_centroid'] = out['d_bbox'] = None
    if ia.any() and ib.any():
        out['rec2'] = round(float((ib & _dilate(ia, 2)).sum() / ib.sum()), 3)
        out['prec2'] = round(float((ia & _dilate(ib, 2)).sum() / ia.sum()), 3)
        ma, mb = A[ia].mean(axis=0) * 255, B[ib].mean(axis=0) * 255
        out['colour_dE'] = round(float(np.linalg.norm(ma - mb)), 1)
    else:
        out['rec2'] = out['prec2'] = out['colour_dE'] = None
    return out


def compare(ours, mock, regions=None):
    """-> {region: metrics, 'whole': metrics}."""
    res = {k: region_metrics(ours, mock, v) for k, v in (regions or REGIONS).items()}
    res['whole'] = region_metrics(ours, mock, (0, 0, 1920, 720))
    return res


def side_by_side(ours, mock, path):
    la, lb = ours.max(axis=2), mock.max(axis=2)
    diff = np.stack([lb, la, la], axis=2)
    both = (la > THR) & (lb > THR)
    diff[both] = 1.0
    row = np.concatenate([ours, mock, diff], axis=1)
    im = Image.fromarray(np.round(np.clip(row, 0, 1) * 255).astype(np.uint8))
    im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    im.save(path)


def table(res):
    """The numbers as a markdown table."""
    cols = ['mae', 'diff', 'ink_ref', 'ink_new', 'ink_ratio', 'd_centroid', 'rec2', 'prec2', 'colour_dE']
    lines = ['| region | ' + ' | '.join(cols) + ' |', '|---|' + '---|' * len(cols)]
    for k, m in res.items():
        lines.append('| %s | %s |' % (k, ' | '.join('-' if m.get(c) is None else str(m[c]) for c in cols)))
    return '\n'.join(lines)


if __name__ == '__main__':
    a, b = load(sys.argv[1]), load(sys.argv[2])
    r = compare(a, b)
    print(table(r))
    if '--out' in sys.argv:
        side_by_side(a, b, sys.argv[sys.argv.index('--out') + 1])
