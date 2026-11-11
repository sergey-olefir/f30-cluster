"""Fit the Sport band's radial level profile to 03 (C1 + C2 unlit sectors): ramp + rim + crisp outer edge, compared
after a Gaussian PSF (the photo's blur). Prints the best params; params.py holds the adopted numbers."""
import sys, os, json, itertools, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
def prof(stem, C, sectors):
    rgb = cv2.imread(W + stem + ".sport.%s.png" % C)[..., ::-1].astype(float)
    bits = cv2.imread(W + stem + ".sport.%s.maskbits.png" % C, 0)
    box = json.load(open(W + stem + ".sport.%s.json" % C))["box"]
    g = geom.G20[C]
    r, ang = geom.dial_polar_grid(box[2], box[3], g["c"][0] - box[0], g["c"][1] - box[1], 335)
    ok = (bits & 31) == 0
    sec = np.zeros_like(ok)
    for a0, sp in sectors:
        sec |= ((ang - a0) % 360) <= sp
    rs = np.arange(0.40, 0.95, 0.005)
    out = []
    for r0 in rs:
        m = ok & sec & (r >= r0) & (r < r0 + 0.005)
        out.append(np.median(rgb[m], axis=0) if m.sum() > 10 else [np.nan] * 3)
    return rs + 0.0025, np.array(out)
def model(r, p):
    r_in, a0, a1, r1, rim0, rim1, r_out = p
    fin = np.clip((r - r_in) / 0.012 + 0.5, 0, 1)
    ramp = a0 + (a1 - a0) * np.clip((r - r_in) / (r1 - r_in), 0, 1)
    t = np.clip((r - rim0) / max(rim1 - rim0, 1e-3), 0, 1); t = t * t * (3 - 2 * t)
    lev = ramp + (1 - ramp) * t
    return lev * fin * (r <= r_out)
def blur(y, r, sig):
    if sig <= 0: return y
    dr = r[1] - r[0]; k = np.arange(-40, 41) * dr; g = np.exp(-k * k / (2 * sig * sig)); g /= g.sum()
    return np.convolve(np.pad(y, 40, mode="edge"), g, mode="same")[40:-40]
if __name__ == "__main__":
    stem = sys.argv[1] if len(sys.argv) > 1 else "03_three-modes_photo_bimmerstop"
    r, a = prof(stem, "C1", [(280, 140)])
    r2, b = prof(stem, "C2", [(280, 60), (20, 60)]) if stem.startswith("03") else prof(stem, "C2", [(280, 140)])
    y = np.nanmean(np.stack([a[:, 0], b[:, 0]]), axis=0)
    face = np.nanmedian(y[(r > 0.40) & (r < 0.46)]); outside = np.nanmedian(y[(r > 0.89) & (r < 0.94)])
    ok = ~np.isnan(y)
    best = None
    grid = dict(r_in=[0.47, 0.49, 0.51], a0=[0.02, 0.06], a1=[0.45, 0.52, 0.58, 0.65], r1=[0.74, 0.765, 0.79],
                rim0=[0.74, 0.76, 0.78], rim1=[0.79, 0.80, 0.815], r_out=[0.845, 0.85, 0.855, 0.86, 0.87])
    for vals in itertools.product(*grid.values()):
        p = vals
        if p[4] >= p[5]: continue
        m = model(r, p)
        for sig in (0.004, 0.008, 0.012):
            mb = blur(m, r, sig)
            # best gain for this shape
            A = np.vstack([mb[ok], np.ones(ok.sum())]).T
            sol, res, *_ = np.linalg.lstsq(A, y[ok], rcond=None)
            e = np.mean((A @ sol - y[ok]) ** 2)
            if best is None or e < best[0]:
                best = (e, p, sig, sol)
    e, p, sig, sol = best
    print(stem, "rms %.2f" % np.sqrt(e), "params", dict(zip(grid.keys(), p)), "psf_sigma_R %.3f" % sig,
          "peak (code values above floor) %.1f floor %.1f" % tuple(sol), "face %.1f outside %.1f" % (face, outside))
    ch = np.nanmean(np.stack([a, b]), axis=0)
    pk = (r > 0.79) & (r < 0.83)
    print("  peak rgb", np.nanmean(ch[pk], axis=0).round(1), " face rgb", np.nanmean(ch[(r > 0.40) & (r < 0.46)], axis=0).round(1))
