"""P4 / C5: render the centre-window layers from params.json (C5/model.py) into apps/f30_cluster/hud/baked/C5/.

    cd bake/src && $PY -m C5.build          (C6.build renders the bar and the arcs; C6.build --all runs both + QC)
"""
import json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import imageio  # noqa: E402
from C5 import model  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")


def params():
    return json.load(open(os.path.join(HERE, "params.json")))


def tight(img, box, scale, pad=1):
    """Crop a rendered layer to its alpha > 0 bounds (in whole panel px, even for @0.5x), -> img, panel box."""
    a = img[..., 3] > (0.5 / 255.0)
    ys, xs = np.nonzero(a)
    bx, by, bw, bh = box
    s = scale
    x0 = int(np.floor(xs.min() / s)) - pad; x1 = int(np.ceil((xs.max() + 1) / s)) + pad
    y0 = int(np.floor(ys.min() / s)) - pad; y1 = int(np.ceil((ys.max() + 1) / s)) + pad
    if s == 0.5:                                             # keep even panel sizes / positions for @0.5x
        x0 -= x0 % 2; y0 -= y0 % 2; x1 += x1 % 2; y1 += y1 % 2
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(int(bw), x1), min(int(bh), y1)
    crop = img[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)]
    return crop, [bx + x0, by + y0, x1 - x0, y1 - y0]


def render(name, fn, box, scale, P, cluster="C5"):
    img = fn(box, scale, P)
    img, pbox = tight(img, box, scale)
    suffix = "@0.5x" if scale == 0.5 else ""
    rel = f"{cluster}/{name}{suffix}.png"
    imageio.write_png(os.path.join(BAKED, rel), img)
    h, w = img.shape[:2]
    return {"file": rel, "x": pbox[0], "y": pbox[1], "w": pbox[2], "h": pbox[3], "scale": scale,
            "file_w": w, "file_h": h, "bytes_by_8wh": imageio.bytes_by_8wh(w, h)}


def main():
    P = params()
    out = {}
    out["window.base"] = render("window.base.albedo", model.window_base, [600, 60, 720, 560], 0.5, P)
    yh = P["horizon_y"]
    out["window.horizon"] = render("window.horizon.albedo", model.horizon_strip, [680, int(yh) - 8, 560, 16], 1.0, P)
    json.dump(out, open(os.path.join(ROOT, "bake", "work", "C5", "layers.json"), "w"), indent=1)
    for k, v in out.items():
        print(k, v)
    return out


if __name__ == "__main__":
    main()
