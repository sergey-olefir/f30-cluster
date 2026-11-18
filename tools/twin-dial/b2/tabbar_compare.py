"""Package B2's evidence: compose the tab bar from the engine's own pixel layers (render_tabbar.js) over an EMULATION of the backdrop
(the ramp, the selected cell's fill law colour x ramp(y) / 0.16, the separators, the rule: written from SPEC-R3 3.1 / 3.2, not the
shader), and measure where each element's ink is against the approved mockup's tab bar (bake/work/twin-dial/mockup/r3/, git-ignored).
    python3 tools/twin-dial/b2/tabbar_compare.py <layers dir> <mockup png> <out png> [tab]
The result is geometry (centres, edges, within 2 px?) - the backdrop's colours here are the emulation's, never the shader's."""
import json, os, sys
import numpy as np
from PIL import Image

d, mock, out = sys.argv[1], sys.argv[2], sys.argv[3]
man = json.load(open(os.path.join(d, 'manifest.json')))
tab = man['tab']
bar = man['bar']
x0, y0, x1, y1 = bar['rect']
seps = bar['seps']
lin = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
enc = lambda l: np.where(l <= 0.0031308, l * 12.92, 1.055 * np.maximum(l, 1e-9) ** (1 / 2.4) - 0.055)
img = np.zeros((720, 1920, 3), np.float64)
ys = np.arange(y0, y1) + 0.5
t = np.clip((ys - y0) / (y1 - y0), 0, 1)
ramp = 0.002 + (0.16 - 0.002) * t                                    # linear light, top to bottom
tint = np.array([0.96, 1.0, 1.08])
for i, y in enumerate(range(y0, y1)):
    img[y, x0:x1, :] = enc(ramp[i] * tint)
cells = [x0] + list(seps) + [x1]
col = {1: (176, 7, 30), 2: (176, 7, 30), 3: (240, 150, 0), 4: (59, 155, 26), 5: (28, 150, 200)}[tab]
cl = lin(np.array(col) / 255.0)
a, b = cells[tab - 1], cells[tab]
for i, y in enumerate(range(y0, y1)):
    img[y, a:b, :] = enc(cl * (ramp[i] / 0.16))
for s in seps:
    img[y0:y1, s - 1:s + 1, :] = 0.0
    img[y0:y1, s + 2:s + 3, :] = 84 / 255.0
img[170:173, x0:x1, :] = 230 / 255.0
rule_sel = enc(cl * 1.0 * 0.85 + lin(np.array([230 / 255.0] * 3)) * 0.15)   # the rule under the selected cell: colour + 0.15 x white
img[170:173, a:b, :] = rule_sel
img = np.clip(img, 0, 1)
ink = {}
for w in man['widgets']:
    px = np.frombuffer(open(os.path.join(d, w['id'] + '.rgba'), 'rb').read(), np.uint8).reshape(w['h'], w['w'], 4).astype(np.float64)
    al = px[:, :, 3:4] / 255.0
    X, Y = w['x'], w['y']
    reg = img[Y:Y + w['h'], X:X + w['w'], :]
    img[Y:Y + w['h'], X:X + w['w'], :] = reg * (1 - al) + (px[:, :, :3] / 255.0) * al
    m = px[:, :, 3] > 100
    if m.any():
        yy, xx = np.where(m)
        ink[w['id']] = [int(xx.min() + X), int(yy.min() + Y), int(xx.max() + X + 1), int(yy.max() + Y + 1)]
res = Image.fromarray((img * 255 + 0.5).astype(np.uint8))
res.save(out)
# the mockup's ink inside the same regions: bright pixels (> 200 in every channel) of the mockup's bar, by region
mk = np.asarray(Image.open(mock).convert('RGB')).astype(int)
bright = (mk.min(axis=2) > 200)
def mbox(r):
    sub = bright[r[1]:r[3], r[0]:r[2]]
    if not sub.any():
        return None
    yy, xx = np.where(sub)
    return [int(xx.min() + r[0]), int(yy.min() + r[1]), int(xx.max() + r[0] + 1), int(yy.max() + r[1] + 1)]
regions = {'tab_range_i': [630, 118, 676, 168], 'tab_range_vu': [676, 118, 778, 168], 'tab_warn_i': [782, 118, 846, 168],
           'tab_media': [850, 118, 1166, 168], 'tab_phone_i': [1170, 118, 1235, 168], 'tab_nav_i': [1239, 118, 1300, 168]}
rows = []
def merge(ids):
    bs = [ink[i] for i in ids if i in ink]
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)] if bs else None
ours = {'tab_range_i': merge(['tab_range_i']), 'tab_range_vu': merge(['tab_range_v', 'tab_range_u']), 'tab_warn_i': merge(['tab_warn_i']),
        'tab_media': merge(['tab_media']), 'tab_phone_i': merge(['tab_phone_i']), 'tab_nav_i': merge(['tab_nav_i'])}
for k, r in regions.items():
    m, o = mbox(r), ours[k]
    if m is None or o is None:
        rows.append({'element': k, 'mockup': m, 'ours': o}); continue
    mc = [(m[0] + m[2]) / 2, (m[1] + m[3]) / 2]; oc = [(o[0] + o[2]) / 2, (o[1] + o[3]) / 2]
    rows.append({'element': k, 'mockup': m, 'ours': o, 'centre_dx': round(oc[0] - mc[0], 1), 'centre_dy': round(oc[1] - mc[1], 1),
                 'size_mockup': [m[2] - m[0], m[3] - m[1]], 'size_ours': [o[2] - o[0], o[3] - o[1]]})
print(json.dumps(rows, indent=1))
