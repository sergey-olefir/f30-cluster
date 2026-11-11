import sys, os, json, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
def load(base):
    m = json.load(open(W+base+".json")); rgb = cv2.imread(W+base+".png")[..., ::-1].astype(float)
    bits = cv2.imread(W+base+".maskbits.png", 0)
    return rgb, bits, m["box"]
for img in sys.argv[2:]:
  for C in ["C1", "C2"]:
    rgb, bits, box = load(f"{img}.{sys.argv[1]}.{C}")
    g = geom.G20[C]; cx, cy = g["c"][0]-box[0], g["c"][1]-box[1]
    r, ang = geom.dial_polar_grid(box[2], box[3], cx, cy, 335)
    ok = (bits & 31) == 0
    # sector: upper (cw12 300..60) avoiding text -> use 30..60 and 300..330 too noisy; take whole upper
    sec = ((ang > 300) | (ang < 60)) & ok
    print(img, C)
    rows=[]
    for r0 in np.arange(0.0, 1.10, 0.02):
        m = sec & (r >= r0) & (r < r0+0.02)
        if m.sum() < 20: continue
        c = np.median(rgb[m], axis=0)
        rows.append("%.2f:%3d,%3d,%3d" % (r0+0.01, *c))
    print("  " + " ".join(rows))
