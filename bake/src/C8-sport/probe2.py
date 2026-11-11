import sys, os, json, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
def load(base):
    m = json.load(open(W+base+".json")); rgb = cv2.imread(W+base+".png")[..., ::-1].astype(float)
    bits = cv2.imread(W+base+".maskbits.png", 0)
    return rgb, bits, m["box"]
img, C, r0, r1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
a0, a1, step = float(sys.argv[5]), float(sys.argv[6]), float(sys.argv[7])
rgb, bits, box = load(f"{img}.sport.{C}")
g = geom.G20[C]; cx, cy = g["c"][0]-box[0], g["c"][1]-box[1]
r, ang = geom.dial_polar_grid(box[2], box[3], cx, cy, 335)
ok = (bits & 1) == 0
m0 = ok & (r >= r0) & (r < r1)
out=[]
a = a0
while a < a1:
    m = m0 & (((ang - a) % 360) < step)
    if m.sum() > 0:
        out.append("%.1f:%d" % (a % 360, np.mean(rgb[m][:,0])))
    a += step
print(" ".join(out))
