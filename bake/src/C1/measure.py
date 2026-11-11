"""Measurement helpers for P1 (C1 speed dial): radial / angular profiles of the rectified reference crops.
Run from bake/src:  $PY -m C1.measure profile <ref base> [a0 span] [r0 r1 step] [stat]
Writes nothing shipped; prints numbers used to fit bake/src/C1/params.py."""
import json, os, sys
import cv2
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa

RECT = os.path.join(os.path.dirname(__file__), "..", "..", "work", "rect")


def load(base, ignore_bits=31):
    p = base if os.path.isabs(base) else os.path.join(RECT, base)
    meta = json.load(open(p + ".json"))
    rgb = cv2.imread(p + ".png")[..., ::-1].astype(np.float32)
    bits = cv2.imread(p + ".maskbits.png", cv2.IMREAD_GRAYSCALE)
    valid = ((bits & ignore_bits) == 0) & ((bits & 1) == 0)
    k = int(meta.get("scale", 1))
    box = meta["box"]
    cl = meta["cluster"]
    c = geom.G20[cl]["c"]; R = geom.G20[cl]["R"]
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    px = box[0] + (xx + 0.5) / k; py = box[1] + (yy + 0.5) / k
    u = (px - c[0]) / R; v = (py - c[1]) / R
    if cl == "C2":           # mirror the rev dial into the speedo's handedness
        u = -u
    r = np.hypot(u, v); ang = np.degrees(np.arctan2(u, -v)) % 360
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return dict(rgb=rgb, luma=luma, valid=valid, r=r, ang=ang, u=u, v=v, k=k, box=box, R=R)


def sector(d, a0, span):
    return ((d["ang"] - a0) % 360) <= span


def profile(d, r0, r1, step, a0=0, span=360, stat="median", rgb=False, extra=None):
    m = d["valid"] & sector(d, a0, span)
    if extra is not None:
        m &= extra
    out = []
    for rr in np.arange(r0, r1 + 1e-9, step):
        s = m & (d["r"] >= rr - step / 2) & (d["r"] < rr + step / 2)
        if s.sum() < 3:
            out.append((rr, None, 0)); continue
        src = d["rgb"][s] if rgb else d["luma"][s]
        f = {"median": lambda a: np.median(a, axis=0), "mean": lambda a: a.mean(axis=0),
             "p10": lambda a: np.percentile(a, 10, axis=0), "p90": lambda a: np.percentile(a, 90, axis=0),
             "max": lambda a: a.max(axis=0)}[stat]
        out.append((rr, f(src), int(s.sum())))
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "profile":
        base = sys.argv[2]
        a0, span = (float(sys.argv[3]), float(sys.argv[4])) if len(sys.argv) > 4 else (0, 360)
        r0, r1, st = (float(x) for x in sys.argv[5:8]) if len(sys.argv) > 7 else (0, 1.05, 0.01)
        stat = sys.argv[8] if len(sys.argv) > 8 else "median"
        ib = int(sys.argv[9]) if len(sys.argv) > 9 else 31
        d = load(base, ib)
        for rr, val, n in profile(d, r0, r1, st, a0, span, stat, rgb=True):
            print(f"{rr:6.3f} {n:6d} " + ("-" if val is None else " ".join(f"{x:6.1f}" for x in val)))
