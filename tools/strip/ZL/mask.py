"""Package ZL: the mask proposal for zone L (x 0-700 of the STRIP), per channel of the brief's 4.4, and a 4x
raster preview of it.

    python3 tools/strip/ZL/mask.py            (numpy + opencv for the preview, as the other ZL tools)

Every number below is measured (design/strip/ZL/atlas.json, docs/strip/ZL-REPORT.md); nothing is photo pixels.
Coordinates continuous panel px. A shape is {id, channel, kind: hole | cover, polygon | circle, feather_in_px,
feather_out_px, reason, evidence, clearance}: alpha of the channel is 1 (opaque) everywhere in the zone except in
its holes; the feather is the width of the 0 -> 1 ramp, centred on the stated edge (in = inside the hole side).
Writes design/strip/ZL/mask_proposal.json and bake/work/strip/zone-L/mask_<channel>_4x.png (+ pub/ZL/).
"""
import json
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MAIN = os.environ.get('F30_MAIN', os.path.expanduser('~/projects/f30-cluster'))
ZONE = [0, 540, 700, 720]

SIGN_C = [538.45, 621.2]     # BMW's sign, outer red edge's centre (photo 60 on our grid + 61-68), +-0.3
SIGN_EDGE = 41.8             # middle of BMW's own black moat: red edge r 40.96 .. rail cut r 42.45

RANGE = [131.75, 663.25, 331.0, 701.5]     # widest: pump + 4 tabular digits (left anchor, hypothesis) + unit, 2 px
CLOCK = [341.5, 663.25, 455.5, 701.5]      # widest: tabular HH:MM, all four cells full, 2 px
# the belt group, every lamp lit (62, 63, 67; 64 for the driver alone), plus 3 px (the SAFETY dilation)
BELT_POLY = [[497.5, 674.75], [587.0, 674.75], [587.0, 661.25], [683.25, 661.25], [683.25, 720.0], [497.5, 720.0]]

SHAPES = [
    {'id': 'assist.speed_limit', 'channel': ['bmw', 'bmw_msg'], 'kind': 'hole',
     'circle': SIGN_C + [SIGN_EDGE], 'feather_in_px': 0.3, 'feather_out_px': 0.3,
     'reason': "BMW's sign shows whole; its own black moat (red edge r 40.96 -> the rail's cut ends r 42.45) "
               "takes the edge, so the rail stubs stay under black and no red is lost on any side",
     'evidence': 'ring r 40.91-41.22 on 61-64, 66, 67 (68 40.34, under-exposed); rail ends r 42.15-42.82 on 60-68; '
                 'centre (538.44, 621.29) on 60 straight off our grid, 538.2-538.7 / 620.8-621.3 on 61, 63, 64, 67, 68',
     'clearance': {'speed readout (assist.speed_foot, covered)': 22.6, 'rear belts': 15.6, 'driver belt': 36.5,
                   'moat either side of the edge': 0.75, 'centre uncertainty': 0.3}},
    {'id': 'bottom.range', 'channel': ['bmw', 'bmw_msg', 'standby'], 'kind': 'hole', 'polygon': None, 'rect': RANGE,
     'corner_r': 3, 'feather_in_px': 0.5, 'feather_out_px': 0.5,
     'reason': 'pump pictogram + digits + unit; hard edge: BMW black on both sides of it',
     'evidence': 'ink [133.75, 665.25, 304.5, 699.5] over 60-68; unit stays at x 262.5-263.75 for every 3-digit '
                 'string; a 4th digit adds one advance (24.4 px) to the right if the field is left-anchored',
     'clearance': {'clock': 37.0, 'speedo foot (covered) above': 11.0, 'fuel mini foot (covered)': 12.0}},
    {'id': 'bottom.clock', 'channel': ['bmw', 'bmw_msg', 'standby'], 'kind': 'hole', 'rect': CLOCK, 'corner_r': 3,
     'feather_in_px': 0.5, 'feather_out_px': 0.5,
     'reason': 'HH:MM in tabular cells; the colon stays at x 392.75-402.75 for every time seen',
     'evidence': 'ink [345.25, 665.25, 453.5, 699.5] over 60-68; cells 24.4 px; first cell from x ~343.9',
     'clearance': {'range (4-digit worst case)': 10.5, 'speed readout (covered) above': 51.0,
                   "speedo's foot curve (covered) above": 10.8}},
    {'id': 'belt_group', 'channel': ['bmw', 'bmw_msg', 'ours', 'standby'], 'kind': 'hole', 'polygon': BELT_POLY,
     'feather_in_px': 0.0, 'feather_out_px': 0.0,
     'reason': 'SAFETY: the whole group, every lamp, plus 3 px; nothing of ours inside, ever, in any state',
     'evidence': 'rear [500.5, 677.75, 580.25, 715.25], driver [590.0, 664.5, 628.75, 715.25], airbag '
                 '[632.75, 664.25, 684.25, 715.5] (union of 62, 63, 64, 67; 66 reads 2-3 px right: its model)',
     'clearance': {"sign's opaque ring": 15.6, "today's CC_TOP foot (must not reach y > 661.25 over x 587-683)": 0}},
]
NOTES = {
    'ours': "all6WB, row healthy: everything in zone L is opaque except the belt group: BMW's range, clock and sign, "
            "the speed readout, the rail and every dial remnant are covered (we draw range, clock, sign ourselves)",
    'bmw': 'allG20, or all6WB fallen back (decision 1.5), and P with the engine off (decision 1.6 + package H: BMW '
           'draws its full row there, so the sign hole stays OPEN - today hud.js closes it)',
    'bmw_msg': 'zone L is the same as bmw (the panel starts in zone C; package ZC owns x >= 690)',
    'standby': "BMW's real standby (65): range, clock, belts; no sign (the rail runs straight through the sign's "
               'seat there, so the sign hole must be shut and the rail covered)',
}


def raster(channel, n=4):
    x0, y0, x1, y1 = ZONE
    W, H = (x1 - x0) * n, (y1 - y0) * n
    xs = x0 + (np.arange(W) + 0.5) / n
    ys = y0 + (np.arange(H) + 0.5) / n
    X, Y = np.meshgrid(xs, ys)
    a = np.ones((H, W), np.float32)
    for s in SHAPES:
        if channel not in s['channel']:
            continue
        if 'circle' in s:
            cx, cy, r = s['circle']
            sd = np.hypot(X - cx, Y - cy) - r                    # > 0 outside the hole
        elif s.get('rect'):
            rx0, ry0, rx1, ry1 = s['rect']
            cr = s.get('corner_r', 0)
            qx = np.maximum(np.maximum(rx0 + cr - X, X - (rx1 - cr)), 0)
            qy = np.maximum(np.maximum(ry0 + cr - Y, Y - (ry1 - cr)), 0)
            inner = np.minimum(np.maximum(np.maximum(rx0 + cr - X, X - (rx1 - cr)), np.maximum(ry0 + cr - Y, Y - (ry1 - cr))), 0)
            sd = np.hypot(qx, qy) + inner - cr
        else:
            import cv2
            m = np.zeros((H, W), np.uint8)
            pts = np.array([[(px - x0) * n * 16, (py - y0) * n * 16] for px, py in s['polygon']], np.int32)
            cv2.fillPoly(m, [pts], 1, cv2.LINE_8, shift=4)
            sd = np.where(m > 0, -1.0, 1.0)
        f = s['feather_in_px'] + s['feather_out_px']
        hole = np.clip(0.5 - sd / f, 0, 1) if f > 0 else (sd <= 0).astype(np.float32)
        a = np.minimum(a, 1 - hole)
    return a


def main():
    out = {'zone': ZONE, 'coords': 'continuous panel px; alpha 1 = opaque', 'shapes': SHAPES, 'channels': NOTES,
           'provisional': 'positions on ZL\'s local models of 60-68 (tools/strip/ZL); R\'s strip models put the sign '
                          '0.4-1.3 px left / 0.3-1.3 px lower - see the report before baking'}
    os.makedirs(os.path.join(REPO, 'design', 'strip', 'ZL'), exist_ok=True)
    json.dump(out, open(os.path.join(REPO, 'design', 'strip', 'ZL', 'mask_proposal.json'), 'w'), indent=1)
    try:
        import cv2
    except ImportError:
        return
    for d in (os.path.join(MAIN, 'bake', 'work', 'strip', 'zone-L'), os.path.join(MAIN, 'bake', 'work', 'strip', 'pub', 'ZL')):
        os.makedirs(d, exist_ok=True)
        for ch in ('ours', 'bmw', 'bmw_msg', 'standby'):
            cv2.imwrite(os.path.join(d, 'mask_%s_4x.png' % ch), (raster(ch) * 255 + 0.5).astype(np.uint8))
        json.dump(out, open(os.path.join(d, 'mask_proposal.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
