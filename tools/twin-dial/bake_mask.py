#!/usr/bin/env python3
"""Twin Dial fallback-window mask (package R2-A2, SPEC §8.4, §13.3).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/bake_mask.py
        [--out DIR] [--no-record] [--preview DIR]

The window through which BMW's own message panel shows: zc.panel dilated by 3 px = design/twin-dial/vf/message_panel.json
fallback_window.polygon_px (already dilated; not dilated again), rasterised with the strip mask's own shape code
(tools/strip/bake_mask.py shape_cover(): a hard edge = the pixel's exact area coverage, 8 x 8 samples), then cut to the box
[694, 592, 1230, 704] = 536 x 112 px. Writes apps/twin_dial/hud/scene/panel_mask.json (R8 scene texture, bilinear).

POLARITY (the contract with tdback): byte 255 = INSIDE the window (BMW's panel shows through: our layer is see-through),
0 = outside (ours). This is "coverage", the opposite of the strip mask's "msg" lane (a multiplier, 1 - coverage). One px of the
texture = one panel px; the texture's top-left px is panel (694, 592). Outside the box the window is closed.

Checks printed (and asserted by tools/twin-dial/test_bake.py): the plate rectangle [694.5, 592, 1230, 720] covers every
window px with its margin; the window clears BMW's belt group [497, 660, 688, 720], the gear gap [1380, 660, 1460, 720],
the stored-message marker [1240, 588, 1288, 630] and the side-lamp holes.
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np                                     # noqa: E402

import _bakecommon as bc                               # noqa: E402

BOX = (694, 592, 1230, 704)                            # panel px; 536 x 112
PLATE = (694.5, 592.0, 1230.0, 720.0)                  # SPEC §8.1: our plate, opaque black
KEEP_OUTS = {'belt_group': (497, 660, 688, 720), 'gear_gap': (1380, 660, 1460, 720), 'stored_message_marker': (1240, 588, 1288, 630)}
MIN_PLATE_MARGIN = 1.5                                 # px; SPEC §8.1: the plate covers BMW's panel outline with >= 1.5 px


def _strip_bake_mask():
    spec = importlib.util.spec_from_file_location('strip_bake_mask', os.path.join(bc.ROOT, 'tools', 'strip', 'bake_mask.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def window_polygon():
    j = json.load(open(os.path.join(bc.ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json')))
    return [[float(x), float(y)] for x, y in j['fallback_window']['polygon_px']]


def rasterise():
    """-> uint8 array (112, 536): coverage of the window polygon, 255 = inside."""
    sm = _strip_bake_mask()
    cov = sm.shape_cover({'polygon': window_polygon(), 'feather_in_px': 0, 'feather_out_px': 0})   # (180, 1920), rows from y 540
    x0, y0, x1, y1 = BOX
    box = cov[y0 - sm.Y0:y1 - sm.Y0, x0 - sm.X0:x1 - sm.X0]
    return np.round(np.clip(box, 0, 1) * 255).astype(np.uint8)


def checks(a):
    """-> dict of the numbers; raises SystemExit on a violation."""
    ys, xs = np.nonzero(a)
    bb = [BOX[0] + int(xs.min()), BOX[1] + int(ys.min()), BOX[0] + int(xs.max()) + 1, BOX[1] + int(ys.max()) + 1]
    poly = np.array(window_polygon())
    margin = {'left': float(poly[:, 0].min() - PLATE[0]), 'top': float(poly[:, 1].min() - PLATE[1]),
              'right': float(PLATE[2] - poly[:, 0].max()), 'bottom': float(PLATE[3] - poly[:, 1].max())}
    out = {'window_bbox_px': bb, 'plate_margin_px': {k: round(v, 3) for k, v in margin.items()}}
    if min(margin.values()) < MIN_PLATE_MARGIN:
        raise SystemExit('the plate does not cover the window with %.1f px: %r' % (MIN_PLATE_MARGIN, margin))
    if bb[0] < PLATE[0] or bb[1] < PLATE[1] or bb[2] > PLATE[2] or bb[3] > PLATE[3]:
        raise SystemExit('window pixels %r outside the plate %r' % (bb, PLATE))
    clear = {}
    for k, (x0, y0, x1, y1) in KEEP_OUTS.items():
        inter = not (bb[2] <= x0 or bb[0] >= x1 or bb[3] <= y0 or bb[1] >= y1)
        clear[k] = {'rect': [x0, y0, x1, y1], 'intersects': inter,
                    'gap_px': round(max(x0 - bb[2], bb[0] - x1, y0 - bb[3], bb[1] - y1), 2)}
        if inter:
            raise SystemExit('the fallback window touches %s %r' % (k, (x0, y0, x1, y1)))
    lay = json.load(open(os.path.join(bc.ROOT, 'design', 'twin-dial', 'vg', 'layout.json')))
    holes = lay['keep_outs']['telltales_holes']['rects_plus_3px']
    hit = [r for r in holes if not (bb[2] <= r[0] or bb[0] >= r[2] or bb[3] <= r[1] or bb[1] >= r[3])]
    clear['side_lamp_holes_intersected'] = hit
    if hit:
        raise SystemExit('the fallback window touches side-lamp holes %r' % hit)
    out['keep_outs'] = clear
    out['area_px'] = round(float(a.astype(np.float64).sum() / 255.0), 1)
    return out


def bake(out_dir, record=True):
    a = rasterise()
    ck = checks(a)
    h, w = a.shape
    entry = {'kind': 'panel_mask', 'rect': list(BOX), 'atlas': [w, h], 'polarity': 'coverage: 255 = the car\'s own message panel shows through (window open)',
             'plate': list(PLATE), 'source': 'design/twin-dial/vf/message_panel.json fallback_window.polygon_px'}
    path = os.path.join(out_dir, 'panel_mask.json')
    sha = bc.r8_scene(path, w, h, a.tobytes(), 'bilinear', dict(entry, tex='panel_mask'),
                      'package R2-A2: the fallback window (zc.panel dilated 3 px) as coverage, 255 = window; tools/twin-dial/bake_mask.py')
    if record and os.path.abspath(out_dir) == os.path.abspath(bc.SCENE):
        bc.record('panel_mask', {'file': 'apps/twin_dial/hud/scene/panel_mask.json', 'w': w, 'h': h, 'format': 'r8', 'sha256_r8': sha,
                                 'rect_panel': list(BOX), 'polarity': 'coverage (255 = window)',
                                 'inputs': ['design/twin-dial/vf/message_panel.json', 'tools/strip/bake_mask.py (shape_cover)',
                                            'tools/twin-dial/bake_mask.py'],
                                 'pixel_memory_MiB_counted_twice': round(w * h * 2 / 1048576.0, 3)})
    return a, ck


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=bc.SCENE)
    ap.add_argument('--no-record', action='store_true')
    ap.add_argument('--preview')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    m, ck = bake(a.out, not a.no_record)
    print('panel_mask: %d x %d R8 at panel (%d, %d), %.3f MiB as an asset (counted twice)' % (m.shape[1], m.shape[0], BOX[0], BOX[1],
                                                                                              m.size * 2 / 1048576.0))
    print(json.dumps(ck))
    if a.preview:
        from PIL import Image
        os.makedirs(a.preview, exist_ok=True)
        Image.fromarray(m).save(os.path.join(a.preview, 'panel_mask.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
