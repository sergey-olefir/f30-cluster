"""Package M (brief M.3, second half): a shaped hole and a feather, measured off the baked bytes.

Reads a baked strip mask (apps/f30_cluster/hud/scene/<name>.json, from tools/strip/bake_mask.py and
design/strip/M/demo_shapes.json), samples each lane exactly as WBBACK does (the texel at floor(p - box) + origin),
and measures, without trusting the bake:
  * the round hole: a circle fitted to the lane's 0.5 contour (row and column crossings, linear between pixel
    centres): centre, radius, rms and worst residual, and the left/right and top/bottom radii (any lopsidedness);
  * the soft edge: the lane's profile across that hole's rim, against the declared ramp;
  * the panel: where the msg lane's 0.5 contour crosses each column under the arc, against the polygon pushed out by
    half its feather;
  * the belt group: the largest value of every cover lane over it (must be 0).

    uv run ... python -I tools/strip/M/demo_check.py [name | path.json] [shapes.json]
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


def load(name):
    j = json.load(open(name if name.endswith('.json') else os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene', name + '.json')))
    a = np.frombuffer(base64.b64decode(j['r8']), np.uint8).reshape(j['h'], j['w']).astype(np.float64) / 255.0
    return a, j['mask']


def lane_image(atlas, m, lane):
    """The lane over its box, panel px [y, x] from the box's corner (as the shader reads it)."""
    box = m['hole'] if lane == 'msg' else m['cover']
    ax, ay = m['lanes'][lane]
    return atlas[ay:ay + box[3] - box[1], ax:ax + box[2] - box[0]], box


def crossings(img, box, level=0.5):
    """Sub-pixel points where img crosses level between neighbouring pixel centres (rows and columns), panel px."""
    pts = []
    v = img - level
    for axis in (0, 1):
        a = v if axis == 1 else v.T
        s = np.sign(a)
        i, j = np.nonzero(s[:, :-1] * s[:, 1:] < 0)
        t = a[i, j] / (a[i, j] - a[i, j + 1])
        if axis == 1:
            xs, ys = box[0] + j + 0.5 + t, box[1] + i + 0.5
        else:
            xs, ys = box[0] + i + 0.5, box[1] + j + 0.5 + t
        pts += list(zip(xs, ys))
    return np.asarray(pts)


def fit_circle(p):
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    b = (p ** 2).sum(1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = np.sqrt(c + cx * cx + cy * cy)
    res = np.hypot(p[:, 0] - cx, p[:, 1] - cy) - r
    return cx, cy, r, res


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'strip_mask_demo'
    shapes = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'design', 'strip', 'M', 'demo_shapes.json')))['shapes']
    by = {s['id']: s for s in shapes}
    atlas, m = load(name)
    out = {'mask': os.path.basename(name), 'atlas': m['atlas']}
    # the round hole (bmw lane), only where the lane box holds it (above the box's top the dial's own window decides)
    img, box = lane_image(atlas, m, 'bmw')
    sg = by['demo.sign']
    cx0, cy0, r0 = sg['circle']
    fo = sg.get('feather_out_px', 0)
    p = crossings(img, box)
    near = np.abs(np.hypot(p[:, 0] - cx0, p[:, 1] - cy0) - (r0 + fo / 2.0)) < 4
    bl = by['demo.belts']['rect']                      # the belt group's hole cuts the sign's foot: off the fit
    p = p[near & (p[:, 1] > box[1] + 1) & ~((p[:, 1] > bl[1] - 3) & (p[:, 0] > bl[0] - 3))]
    cx, cy, r, res = fit_circle(p)
    def rad(sel):
        q = p[sel]
        return float(np.hypot(q[:, 0] - cx, q[:, 1] - cy).mean()) if len(q) else None
    ang = np.degrees(np.arctan2(p[:, 1] - cy, p[:, 0] - cx))
    out['sign_hole'] = {
        'declared': {'centre': [cx0, cy0], 'r_half_coverage': r0 + fo / 2.0},
        'fitted': {'centre': [round(cx, 3), round(cy, 3)], 'r': round(r, 3)},
        'contour_points': int(len(p)), 'rms_residual_px': round(float(np.sqrt((res ** 2).mean())), 3),
        'max_residual_px': round(float(np.abs(res).max()), 3),
        'r_left_lower(135..225 deg)': round(rad((ang > 135) | (ang < -135)), 3),
        'r_right_lower(-45..45 deg)': round(rad(np.abs(ang) < 45), 3),
        'r_bottom(45..135 deg)': round(rad((ang > 45) & (ang < 135)), 3),
    }
    # its profile across the rim, straight down (90 deg) and down-left / down-right (135, 45): lane at the pixel centre
    prof = {}
    for deg in (20, 160):                              # clear of the belt group (from ~57 deg down)
        row = []
        for d in np.arange(-1.0, 3.01, 0.5):
            rr = r0 + d
            x = cx0 + rr * np.cos(np.radians(deg)); y = cy0 + rr * np.sin(np.radians(deg))
            i, j = int(np.floor(y)) - box[1], int(np.floor(x)) - box[0]
            # the declared ramp at that pixel's centre
            dc = np.hypot(np.floor(x) + 0.5 - cx0, np.floor(y) + 0.5 - cy0) - r0
            want = float(np.clip(dc / fo, 0, 1)) if fo else float(dc > 0)
            row.append([round(float(d), 1), round(float(img[i, j]), 3), round(want, 3)])
        prof[str(deg)] = row
    out['sign_rim_profile [r - r_hole, lane, declared at the px centre]'] = prof
    # the panel's arc (msg lane): the 0.5 contour per column against the polygon pushed out by half its feather
    img, hbox = lane_image(atlas, m, 'msg')
    pol = np.asarray(by['demo.panel']['polygon'], float)
    top = pol[2:13]                                    # the arc's vertices
    devs = []
    for x in range(760, 1171, 10):
        col = img[:, x - hbox[0]]
        k = np.nonzero((col[:-1] > 0.5) & (col[1:] <= 0.5))[0]
        if not len(k):
            continue
        k = k[0]
        t = (col[k] - 0.5) / (col[k] - col[k + 1])
        y = hbox[1] + k + 0.5 + t
        yp = np.interp(x + 0.5, top[:, 0], top[:, 1])
        devs.append(y - (yp - 1.5))                    # feather_out 3 on the arc: half coverage 1.5 px outside
    devs = np.asarray(devs)
    out['panel_arc'] = {'columns': int(len(devs)), 'mean_dev_px': round(float(devs.mean()), 3),
                        'max_abs_dev_px': round(float(np.abs(devs).max()), 3)}
    # the belt group: every cover lane 0 over it
    bx = by['demo.belts']['rect']
    worst = {}
    for lane in ('ours', 'bmw', 'standby'):
        img, box = lane_image(atlas, m, lane)
        sub = img[bx[1] - box[1]:bx[3] - box[1], bx[0] - box[0]:bx[2] - box[0]]
        worst[lane] = float(sub.max())
    out['belt_group_max_cover'] = worst
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
