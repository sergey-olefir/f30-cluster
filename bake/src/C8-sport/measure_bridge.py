import json, numpy as np, cv2
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
REFS = json.load(open("/Users/solefir/projects/f30-cluster/bake/manifest/refs.json"))["images"]
R = 335.0
for stem in ("03_three-modes_photo_bimmerstop", "01_three-modes_small", "02_three-modes_clean-render"):
    rgb = cv2.imread(W + stem + ".sport.PANEL.png")[..., ::-1].astype(float)
    bits = cv2.imread(W + stem + ".sport.PANEL.maskbits.png", 0)
    (lx, ly), (rx, ry) = REFS[stem + ".png"]["sections"]["sport"]["window_transform"]["dial_centres_in_panel"]
    print(stem)
    for v in (-0.40, -0.25, -0.10, 0.0, 0.12, 0.25, 0.35, 0.45):
        y = int(ly + v * R)
        row = []
        for u in np.arange(0.96, 1.56, 0.04):
            x = int(lx + u * R)
            blk = rgb[y - 3:y + 4, x - 2:x + 3]
            m = (bits[y - 3:y + 4, x - 2:x + 3] & 7) == 0
            row.append("%.2f:%s" % (u, ",".join(str(int(t)) for t in np.median(blk[m], axis=0)) if m.any() else "-"))
        print("  v=%.2f " % v, " ".join(row))
