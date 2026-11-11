"""Side-by-side: references vs our merged mini gauges (bake/work/C3/compare.png)."""
import os, sys, json, cv2, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import imageio
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RECT = os.path.join(ROOT, "bake", "work", "rect")
rows = []
for cl, nm in (("C3", "fuel"), ("C4", "oil")):
    m = imageio.read_png(os.path.join(ROOT, "apps/f30_cluster/hud/baked", cl, f"{nm}.static.merged.png"))
    ox, oy = (8, 556) if cl == "C3" else (1768, 556)
    box = [4, 552, 152, 152] if cl == "C3" else [1764, 552, 152, 152]
    ours = np.zeros((152, 152, 3), np.float32)
    a = m[..., 3:4]; ours[oy - box[1]:oy - box[1] + 144, ox - box[0]:ox - box[0] + 144] = m[..., :3] * a
    tiles = []
    for ref in ("17_physical-cluster_full", "04_comfort_whole-cluster_mph", "07_physical-cluster_all-lamps-lit"):
        im = cv2.imread(os.path.join(RECT, f"{ref}.comfort.{cl}.png"))
        tiles.append(cv2.resize(im, (456, 456), interpolation=cv2.INTER_CUBIC))
    o8 = (np.clip(ours, 0, 1) * 255).astype(np.uint8)[..., ::-1]
    tiles.append(cv2.resize(o8, (456, 456), interpolation=cv2.INTER_CUBIC))
    rows.append(np.hstack(tiles))
out = os.path.join(ROOT, "bake/work/C3/compare.png"); cv2.imwrite(out, np.vstack(rows)); print(out)
