"""Light direction from the bezel tube: per angle, the ridge peak brightness and the radial position of the
highlight across the tube (centroid offset from the tube centre). First harmonics -> direction (math degrees,
in the SPEEDO's frame; C2 crops are mirrored, so a mirrored math angle a maps back to 180-a in the rev dial)."""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from C1.polar import unwrap


def harmonic(ang_cw12, val):
    ok = np.isfinite(val)
    a = np.radians(90.0 - ang_cw12[ok])          # math angle
    v = val[ok]
    if len(v) < 8:
        return None
    c, s, m = np.mean(v * np.cos(a)) * 2, np.mean(v * np.sin(a)) * 2, np.mean(v)
    return float(np.degrees(np.arctan2(s, c)) % 360), float(np.hypot(c, s) / max(abs(m), 1e-6)), float(m)


def measure(base, r_lo=0.965, r_hi=1.02, rim=(0.795, 0.83)):
    out, A, Rr = unwrap(base, 0, 360, 0.70, 1.03, 2.0, 0.001)
    L = out[..., :3].mean(axis=2)
    sel = (Rr >= r_lo) & (Rr <= r_hi)
    Lb = L[sel]; rb = Rr[sel]
    pk = Lb.max(axis=0)
    w = np.clip(Lb - 0.5 * pk[None], 0, None)
    cen = (w * rb[:, None]).sum(0) / np.maximum(w.sum(0), 1e-6)
    valid = (L[(Rr > 0.97) & (Rr < 1.01)] > 0).all(axis=0) & (pk > 15)
    pk = np.where(valid, pk, np.nan); cen = np.where(valid, cen, np.nan)
    rs = (Rr >= rim[0]) & (Rr <= rim[1]); rimv = np.where(valid, np.percentile(L[rs], 30, axis=0), np.nan)
    off = cen - np.nanmedian(cen)
    return {"ridge_brightness": harmonic(A, pk), "highlight_offset": harmonic(A, off),
            "groove_rim": harmonic(A, rimv), "ridge_r_median": float(np.nanmedian(cen)),
            "coverage_deg": int(np.isfinite(pk).sum() * 2),
            "brightness_by_angle": {int(a): (None if not np.isfinite(p) else round(float(p))) for a, p in zip(A[::5], pk[::5])}}


if __name__ == "__main__":
    res = {b: measure(b) for b in sys.argv[1:]}
    print(json.dumps(res, indent=1))
