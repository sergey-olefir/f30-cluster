"""C9 housing and glass, documentation only: bezel crescent, glass reflections, black surround, measured on the
P0 rect crops (panel px, dial-to-dial, exposure-normalised). Writes bake/work/C9/housing.json + polar sheets.
    cd bake/src && $PY -m C9.housing
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
sys.path.insert(0, SRC)
from common import geom  # noqa: E402

RECT = os.path.join(ROOT, "bake", "work", "rect")
WORK = os.path.join(ROOT, "bake", "work", "C9")
REFS = [("17_physical-cluster_full", "comfort"), ("07_physical-cluster_all-lamps-lit", "comfort"),
        ("04_comfort_whole-cluster_mph", "comfort"), ("03_three-modes_photo_bimmerstop", "comfort"),
        ("06_comfort_wide_with-wheel", "comfort"), ("02_three-modes_clean-render", "comfort")]
RS = np.round(np.arange(0.90, 1.2001, 0.0025), 4)
TH = np.arange(0, 360, 2.0)


def polar(L, M, cx, cy, Rpx):
    rr, tt = np.meshgrid(RS, np.radians(TH), indexing="ij")
    x = cx + rr * Rpx * np.sin(tt)
    y = cy - rr * Rpx * np.cos(tt)
    P = cv2.remap(L, x.astype(np.float32), y.astype(np.float32), cv2.INTER_LINEAR, borderValue=-1)
    Q = cv2.remap(M, x.astype(np.float32), y.astype(np.float32), cv2.INTER_NEAREST, borderValue=0)
    P[Q == 0] = np.nan
    return P   # [r, theta]


def dial(stem, mode, cl):
    base = os.path.join(RECT, f"{stem}.{mode}.{cl}")
    if not os.path.exists(base + ".png"):
        return None
    a = cv2.imread(base + ".png").astype(np.float32)
    bits = cv2.imread(base + ".maskbits.png", cv2.IMREAD_GRAYSCALE)
    M = ((bits & (1 | 4 | 8)) == 0).astype(np.uint8)   # keep glare (bit 2): glare IS the subject here
    meta = json.load(open(base + ".json"))
    x0, y0 = meta["box"][:2]
    L = cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = geom.G20[cl]
    cx, cy, Rpx = g["c"][0] - x0 - 0.5, g["c"][1] - y0 - 0.5, g["R"]
    P = polar(L, M, cx, cy, Rpx)
    with np.errstate(all="ignore"):
        band = P[(RS >= 0.94) & (RS <= 1.03)]
        ridge_val = np.nanmax(band, axis=0)
        ridge_r = RS[(RS >= 0.94) & (RS <= 1.03)][np.nanargmax(np.nan_to_num(band, nan=-1), axis=0)]
        surround = np.nanmedian(P[(RS >= 1.06) & (RS <= 1.18)], axis=0)
    ok = ~np.isnan(ridge_val) & ~np.isnan(surround)
    if ok.sum() < 20:
        return None
    rv = np.where(ok, ridge_val, np.nan)
    # smooth over angle (circular, 5 bins = 10 deg)
    k = np.ones(5) / 5
    rvs = np.convolve(np.r_[rv[-2:], rv, rv[:2]], k, mode="valid")
    lo, hi = np.nanpercentile(rvs, 10), np.nanmax(rvs)
    thr = lo + 0.5 * (hi - lo)
    on = rvs > thr
    pk = float(TH[int(np.nanargmax(rvs))])
    # crescent span: the contiguous run of 'on' that contains the peak
    i0 = int(np.nanargmax(rvs)); n = len(TH); a_ = i0; b_ = i0
    while on[(a_ - 1) % n] and (i0 - a_) < n: a_ -= 1
    while on[(b_ + 1) % n] and (b_ - i0) < n: b_ += 1
    span = (b_ - a_ + 1) * 2.0
    # radial profile at the peak and opposite (mean over +-10 deg)
    def prof(ang):
        idx = [(int(round(ang / 2)) + d) % n for d in range(-5, 6)]
        with np.errstate(all="ignore"):
            return np.nanmean(P[:, idx], axis=1)
    pp, po = prof(pk), prof((pk + 180) % 360)
    def fwhm(p):
        if np.all(np.isnan(p)): return None
        sel = (RS >= 0.92) & (RS <= 1.08); q = p[sel]; r = RS[sel]
        base_ = np.nanmin(q); top = np.nanmax(q); h = base_ + 0.5 * (top - base_)
        above = r[q > h]
        return [round(float(above.min()), 4), round(float(above.max()), 4), round(float(r[np.nanargmax(q)]), 4)] if len(above) else None
    return {"ref": f"{stem}.{mode}.{cl}", "quality": meta.get("quality"),
            "ridge_r_median": round(float(np.nanmedian(ridge_r[ok])), 4),
            "ridge_L_min_p10": round(float(lo), 1), "ridge_L_max": round(float(hi), 1),
            "crescent_peak_cw12": pk, "crescent_span_deg": span,
            "crescent_from_to_cw12": [float(TH[a_ % n]), float(TH[b_ % n])],
            "ridge_fwhm_at_peak_R": fwhm(pp), "ridge_fwhm_opposite_R": fwhm(po),
            "surround_L_median_1.06_1.18R": round(float(np.nanmedian(surround[ok])), 1),
            "surround_L_p90": round(float(np.nanpercentile(surround[ok], 90)), 1),
            "ridge_L_by_30deg": {int(t): (None if np.isnan(v) else round(float(v), 1)) for t, v in zip(TH[::15], rvs[::15])},
            "radial_profile_at_peak": {str(r): round(float(v), 1) for r, v in zip(RS[::4], pp[::4]) if not np.isnan(v)},
            "radial_profile_opposite": {str(r): round(float(v), 1) for r, v in zip(RS[::4], po[::4]) if not np.isnan(v)}}, P


def panel_zones(stem, mode):
    base = os.path.join(RECT, f"{stem}.{mode}.PANEL")
    if not os.path.exists(base + ".png"):
        return None
    a = cv2.imread(base + ".png")
    bits = cv2.imread(base + ".maskbits.png", cv2.IMREAD_GRAYSCALE)
    L = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # the reference's own dial circles in its PANEL crop (6WB dial spacing differs from ours)
    from C10.refgeom import outside_mask
    m, _ = outside_mask(stem, mode, big=1.06, mini=1.10)
    inside = ~m
    yy = np.mgrid[0:720, 0:1920][0]
    ok = (bits & 1) == 0
    zones = {"top_band_y0-60": (yy < 60), "upper_corners_y60-300": (yy >= 60) & (yy < 300),
             "between_dial_and_mini_y300-560": (yy >= 300) & (yy < 560), "bottom_y560-720": (yy >= 560)}
    out = {}
    for k, z in zones.items():
        m = z & ok & ~inside
        if m.sum() < 500:
            continue
        v = L[m]
        out[k] = {"L_p05": round(float(np.percentile(v, 5)), 1), "L_median": round(float(np.median(v)), 1),
                  "L_p95": round(float(np.percentile(v, 95)), 1), "px": int(m.sum())}
    bgr = a[~inside & ok & (L < np.percentile(L[~inside & ok], 50))].reshape(-1, 3)
    out["dark_half_mean_rgb"] = [round(float(v), 1) for v in bgr.mean(0)[::-1]] if len(bgr) else None
    return out


def run():
    os.makedirs(WORK, exist_ok=True)
    res = {"dials": [], "panel_zones": {}}
    sheets = []
    for stem, mode in REFS:
        for cl in ("C1", "C2"):
            r = dial(stem, mode, cl)
            if r is None:
                continue
            d, P = r
            res["dials"].append(d)
            img = np.nan_to_num(P, nan=0).clip(0, 255).astype(np.uint8)
            img = cv2.resize(img, (720, len(RS) * 2), interpolation=cv2.INTER_NEAREST)
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            j = int(np.argmin(np.abs(RS - 1.0))) * 2
            cv2.line(img, (0, j), (719, j), (0, 160, 255), 1)
            cv2.putText(img, f"{stem[:2]} {cl}  r 0.90 (top) .. 1.20 R, theta cw12 0..360", (5, 14), 0, 0.45, (0, 255, 255), 1)
            sheets.append(img)
        z = panel_zones(stem, mode)
        if z:
            res["panel_zones"][stem[:2]] = z
    cv2.imwrite(os.path.join(WORK, "housing_polar.png"), np.vstack(sheets))
    json.dump(res, open(os.path.join(WORK, "housing.json"), "w"), indent=1)
    for d in res["dials"]:
        print(d["ref"], d["quality"], "ridge r", d["ridge_r_median"], "L", d["ridge_L_min_p10"], "-", d["ridge_L_max"],
              "peak", d["crescent_peak_cw12"], "span", d["crescent_span_deg"], d["crescent_from_to_cw12"],
              "fwhm pk", d["ridge_fwhm_at_peak_R"], "opp", d["ridge_fwhm_opposite_R"], "surr", d["surround_L_median_1.06_1.18R"], d["surround_L_p90"])
    for k, v in res["panel_zones"].items():
        print(k, v)
    return res


if __name__ == "__main__":
    run()
