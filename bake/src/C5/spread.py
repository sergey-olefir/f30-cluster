"""C5 redo: the middle's key values per reference, in final panel values (C5.target), and the model's own.
    cd bake/src && ./P9/py.sh -m C5.spread      -> bake/work/C5/redo/spread.json
Features (our frame, y after C5.target's map): glow peak (rows 449..457, |X| < 60), rows 1..4 edge peaks (max over
+-4 px of the model row, |X| < 30), the dark gap under the horizon (461..468), the walls' peak (y 545..560, X 180..250),
the front line (603..614, |X| < 60) and the bar body (616..640, |X| 90..210, no text)."""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from C5 import model, target  # noqa: E402
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LUMA = model.LUMA


def cl(rgb):
    return 255 * model.l2s(model.s2l(rgb / 255.0) @ LUMA)


def feats(X, Y, img, valid, P):
    ax = np.abs(X - 960)
    out = {}

    def peak(m, name):
        if not m.any():
            out[name] = None; return
        v = img[m]; l = cl(v)
        # rows of the selection: take the brightest row's median colour
        ys = np.unique(np.floor(Y[m]))
        best = None
        for y in ys:
            mm = m & (np.floor(Y) == y)
            c = np.median(img[mm], 0)
            if best is None or cl(c) > cl(best):
                best = c
        out[name] = [round(float(c), 1) for c in best]

    def med(m, name):
        out[name] = [round(float(c), 1) for c in np.median(img[m], 0)] if m.any() else None
    peak(valid & (Y > 449) & (Y < 457.5) & (ax < 60), "glow_peak")
    med(valid & (Y > 461) & (Y < 468) & (ax < 60), "under_horizon")
    for k, yk in enumerate(model.row_ys(P)):
        peak(valid & (np.abs(Y - yk) < 4) & (ax < 30), f"row{k}_edge")
    peak(valid & (Y > 545) & (Y < 560) & (ax > 180) & (ax < 250), "wall_peak")
    peak(valid & (Y > 603) & (Y < 614) & (ax < 60), "front_line")
    med(valid & (Y > 616) & (Y < 640) & (ax > 90) & (ax < 210), "bar_body")
    return out


def main():
    P = json.load(open(os.path.join(HERE, "params.json")))
    res = {}
    for s in target.STEMS:
        r = target.build(s, write=False)
        valid = (r["bits"] & 0x1F) == 0
        res[s] = feats(r["X"], r["Y"], r["panel"], valid, P)
        res[s]["local_floor_raw"] = r["F"].round(1).tolist(); res[s]["bar_floor_raw"] = r["Fb"].round(1).tolist()
    # 02 (the clean render) has its own, shorter car-scene floor: measured in its own frame beside the car
    # (|X| 110..140): glow 428..437, under its horizon 444..447, floor (rows + walls) 540..556, line 556..562, bar 567..585
    r = target.build("02_three-modes_clean-render", write=False)
    ax = np.abs(r["X"] - 960); img = r["panel"]
    def pk(y0, y1):
        best = None
        for y in range(y0, y1):
            m = (ax >= 110) & (ax < 140) & (np.floor(r["Y"]) == y)
            c = np.median(img[m], 0)
            best = c if best is None or cl(c) > cl(best) else best
        return [round(float(v), 1) for v in best]
    def md(y0, y1):
        m = (ax >= 110) & (ax < 140) & (r["Y"] >= y0) & (r["Y"] < y1)
        return [round(float(v), 1) for v in np.median(img[m], 0)]
    res["02_three-modes_clean-render"] = {"glow_peak": pk(428, 437), "under_horizon": md(444, 447),
                                          "row3_edge": pk(540, 556), "wall_peak": pk(540, 556),
                                          "front_line": pk(556, 562), "bar_body": md(567, 585),
                                          "note": "own frame (horizon 442.5, line 559), beside the car, |X| 110..140"}
    ys, xs = np.mgrid[39:708, 680:1240].astype(np.float64) + 0.5
    m = (255 * model.middle_rgb(xs, ys, P))
    res["model"] = feats(xs, ys, m, np.ones(xs.shape, bool), P)
    json.dump(res, open(os.path.join(ROOT, "bake", "work", "C5", "redo", "spread.json"), "w"), indent=1)
    keys = list(res["model"].keys())
    print("%-14s" % "", " ".join("%-15s" % s[:6] for s in res))
    for k in keys:
        print("%-14s" % k, " ".join("%-15s" % ("/".join("%.0f" % c for c in res[s][k]) if res[s].get(k) else "-") for s in res))


if __name__ == "__main__":
    main()
