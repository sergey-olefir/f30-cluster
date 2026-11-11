"""QC for baked layers (brief section 8): compose a layer stack over black in panel space, compare it with a
rectified, exposure-normalised reference crop (bake/work/rect/...) on its mask, write a review sheet.

CLI (run from bake/src, see bake/README.md for the full uv command):

  python qc.py --ref ../work/rect/17_physical-cluster_full.comfort.C1 \\
      --layer ../../apps/f30_cluster/hud/baked/C1/speedo.face.albedo.png:44:12 \\
      --layer ../../apps/f30_cluster/hud/baked/C1/speedo.face.shadow@0.5x.png:44:12:0.5 \\
      --cluster C1 --name speedo.face --roi ring:0:0.80 [--roi-angle 200:320] [--edges] [--json out.json]

  --layer FILE:X:Y[:SCALE]   RGBA PNG (straight alpha) placed at panel X, Y; SCALE 0.5 = a @0.5x file (upscaled
                             bilinearly, premultiplied, like the GPU). Bottom to top in the order given.
  --manifest FILE [--ids a,b]  take the layers from a manifest (bake/manifest/<cluster>.json): entries sorted by z,
                             file relative to apps/f30_cluster/hud/baked/; dynamic entries skipped.
  --ref BASE                 rect crop base (no suffix): BASE.png, BASE.mask.png, BASE.json (box). May be @kx.
  --roi ...                  restrict the comparison (all given ROIs are intersected):
                               ring:R0:R1      annulus in R units of --cluster's dial (G20 geometry)
                               box:X:Y:W:H     panel px
                               mask:FILE       L8 PNG, either the crop's size or the full panel (255 = in)
     --roi-angle A0:SPAN     with ring: cw12 degrees (clockwise from 12 o'clock), SPAN clockwise from A0
  --ignore-bits N            mask bits of BASE.maskbits.png to ignore (default 31 = all; e.g. 15 keeps the
                             text pixels in, 23 keeps the needle corridor in).
  --edges                    compute the edge position error (for crisp elements); default on when --crisp.

Importable: compose(), load_ref(), roi_mask(), metrics(), review_sheet(), run().
Output: JSON on stdout: {"fit": {"ssim", "dE2000_mean", "edge_px_err"}, ...extras}; the review sheet goes to
bake/work/<cluster>/qc_<name>.png (reference | ours | diff at 2x, numbers under it).
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import color, geom, imageio  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
WORK = os.path.join(ROOT, "bake", "work")


# ---------------------------------------------------------------------------------------------- loading / composing
def load_ref(base, ignore_bits=31):
    """-> dict(rgb float (h,w,3) 0..1, valid bool (h,w), box [x,y,w,h], scale k, meta)."""
    for suf in (".png", ".json"):
        if not os.path.exists(base + suf):
            raise FileNotFoundError(base + suf)
    meta = json.load(open(base + ".json"))
    bgr = cv2.imread(base + ".png", cv2.IMREAD_COLOR)
    rgb = bgr[..., ::-1].astype(np.float32) / 255.0
    bits_path = base + ".maskbits.png"
    if os.path.exists(bits_path):
        bits = cv2.imread(bits_path, cv2.IMREAD_GRAYSCALE)
        valid = (bits & ignore_bits) == 0
        valid &= (bits & 1) == 0                                   # outside the photo is never valid
    else:
        valid = cv2.imread(base + ".mask.png", cv2.IMREAD_GRAYSCALE) > 0
    return {"rgb": rgb, "valid": valid, "box": meta["box"], "scale": int(meta.get("scale", 1)), "meta": meta}


def compose(layers, box, scale=1):
    """layers: list of (img float RGBA straight (h,w,4) or path, x, y, layer_scale). Composited bottom->top over
    opaque black in panel space; returns RGB float (box h*scale, box w*scale, 3) for the panel box [x, y, w, h]."""
    bx, by, bw, bh = box
    out = np.zeros((bh * scale, bw * scale, 4), np.float32)
    out[..., 3] = 1.0
    for lay in layers:
        img, x, y, ls = lay
        if isinstance(img, str):
            img = imageio.read_png(img)
        h, w = img.shape[:2]
        full_w, full_h = int(round(w / ls)), int(round(h / ls))     # the layer's size in panel px
        tw, th = full_w * scale, full_h * scale
        if (tw, th) != (w, h):
            img = imageio.upscale2(img, tw, th) if tw > w else _down_premul(img, tw, th)
        imageio.over(out, img, int(round((x - bx) * scale)), int(round((y - by) * scale)))
    return out[..., :3]


def _down_premul(img, w, h):
    a = img.copy()
    a[..., :3] *= a[..., 3:4]
    d = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
    al = d[..., 3:4]
    d[..., :3] = np.where(al > 1e-6, d[..., :3] / np.maximum(al, 1e-6), 0)
    return d


def layers_from_manifest(path, ids=None):
    m = json.load(open(path))
    entries = m["layers"] if isinstance(m, dict) and "layers" in m else m
    entries = sorted(entries, key=lambda e: e["z"])
    out = []
    for e in entries:
        if e.get("class") == "dynamic" or not e.get("file"):
            continue
        if ids and e["id"] not in ids:
            continue
        out.append((os.path.join(BAKED, e["file"]), e["x"], e["y"], e.get("scale", 1.0)))
    return out


# ------------------------------------------------------------------------------------------------------------ ROI
def roi_mask(spec, box, scale, cluster=None, angle=None):
    bx, by, bw, bh = box
    H, W = bh * scale, bw * scale
    kind, _, rest = spec.partition(":")
    if kind == "ring":
        r0, r1 = [float(v) for v in rest.split(":")]
        g = geom.G20[cluster]
        cx, cy = (g["c"][0] - bx) * scale, (g["c"][1] - by) * scale
        r, ang = geom.dial_polar_grid(W, H, cx, cy, g["R"] * scale)
        m = (r >= r0) & (r <= r1)
        if angle:
            a0, span = [float(v) for v in angle.split(":")]
            m &= ((ang - a0) % 360.0) <= span
        return m
    if kind == "box":
        x, y, w, h = [float(v) for v in rest.split(":")]
        m = np.zeros((H, W), bool)
        m[max(0, int((y - by) * scale)):max(0, int((y + h - by) * scale)), max(0, int((x - bx) * scale)):max(0, int((x + w - bx) * scale))] = True
        return m
    if kind == "mask":
        a = cv2.imread(rest, cv2.IMREAD_GRAYSCALE)
        if a.shape == (H, W):
            return a > 127
        if a.shape == (geom.PANEL_H, geom.PANEL_W):
            a = a[by:by + bh, bx:bx + bw]
            return cv2.resize(a, (W, H), interpolation=cv2.INTER_NEAREST) > 127
        raise ValueError(f"roi mask {rest}: size {a.shape} is neither the crop's {(H, W)} nor the panel's")
    raise ValueError(spec)


# -------------------------------------------------------------------------------------------------------- metrics
def ssim_map(a, b, sigma=1.5):
    """SSIM (Wang et al. 2004) on 0..255 luma with a Gaussian window; returns the per-pixel map."""
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    g = lambda x: cv2.GaussianBlur(x, (0, 0), sigma)  # noqa: E731
    mu1, mu2 = g(a), g(b)
    s11, s22, s12 = g(a * a) - mu1 ** 2, g(b * b) - mu2 ** 2, g(a * b) - mu1 * mu2
    return ((2 * mu1 * mu2 + C1) * (2 * s12 + C2)) / ((mu1 ** 2 + mu2 ** 2 + C1) * (s11 + s22 + C2))


def edges(l8, lo=20, hi=60, blur=1.0):
    u = np.clip(l8, 0, 255).astype(np.uint8)
    if blur > 0:
        u = cv2.GaussianBlur(u, (0, 0), blur)
    return cv2.Canny(u, lo, hi, L2gradient=True) > 0


def edge_error(ref_l, our_l, valid, scale=1, lo=20, hi=60, cap=10.0):
    """Symmetric chamfer distance (panel px) between Canny edges of the two images inside `valid`."""
    er, eo = edges(ref_l, lo, hi) & valid, edges(our_l, lo, hi) & valid
    if er.sum() < 10 or eo.sum() < 10:
        return None, {"ref_edge_px": int(er.sum()), "our_edge_px": int(eo.sum())}
    dr = cv2.distanceTransform((~er).astype(np.uint8), cv2.DIST_L2, 5)
    do = cv2.distanceTransform((~eo).astype(np.uint8), cv2.DIST_L2, 5)
    o2r = np.minimum(dr[eo], cap).mean() / scale
    r2o = np.minimum(do[er], cap).mean() / scale
    return float(0.5 * (o2r + r2o)), {"ours_to_ref_px": round(float(o2r), 3), "ref_to_ours_px": round(float(r2o), 3),
                                       "ref_edge_px": int(er.sum()), "our_edge_px": int(eo.sum())}


def banding(our_rgb, roi):
    """Terraces in smooth ramps: fraction of smooth-ramp pixels sitting on 8-bit plateaus wider than 6 px, and the
    widest plateau. Smooth ramp = the 9 px-smoothed slope is between 0.02 and 1 LSB/px."""
    l8 = np.round(color.luma8(np.clip(our_rgb, 0, 1) * 255.0)).astype(np.float32)
    sm = cv2.GaussianBlur(l8, (0, 0), 4.0)
    gx, gy = cv2.Sobel(sm, cv2.CV_32F, 1, 0, ksize=3) / 8, cv2.Sobel(sm, cv2.CV_32F, 0, 1, ksize=3) / 8
    slope = np.hypot(gx, gy)
    ramp = roi & (slope > 0.02) & (slope < 1.0)
    if ramp.sum() < 200:
        return {"ramp_px": int(ramp.sum()), "plateau_fraction": None, "flag": False}
    flat = np.ones_like(l8, bool)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            flat &= np.roll(np.roll(l8, dy, 0), dx, 1) == l8
    frac = float((flat & ramp).sum() / ramp.sum())
    return {"ramp_px": int(ramp.sum()), "plateau_fraction": round(frac, 4), "flag": bool(frac > 0.25),
            "note": "plateau = 7x7 constant 8-bit value inside a smooth ramp; dithered ramps score ~0"}


def metrics(ref_rgb, our_rgb, valid, scale=1, want_edges=True, canny=(20, 60)):
    ref8, our8 = ref_rgb * 255.0, np.clip(our_rgb, 0, 1) * 255.0
    rl, ol = color.luma8(ref8).astype(np.float32), color.luma8(our8).astype(np.float32)
    n = int(valid.sum())
    if n == 0:
        raise ValueError("no valid pixels to compare (mask x ROI is empty)")
    sm = ssim_map(rl, ol)
    de = color.delta_e2000(color.rgb8_to_lab(ref8[valid]), color.rgb8_to_lab(our8[valid]))
    out = {"ssim": round(float(sm[valid].mean()), 4), "dE2000_mean": round(float(de.mean()), 3),
           "dE2000_p95": round(float(np.percentile(de, 95)), 3), "luma_bias": round(float((ol - rl)[valid].mean()), 2),
           "luma_rmse": round(float(np.sqrt(((ol - rl)[valid] ** 2).mean())), 2), "valid_px": n}
    if want_edges:
        e, info = edge_error(rl, ol, valid, scale, *canny)
        out["edge_px_err"] = None if e is None else round(e, 3)
        out["edge"] = info
    else:
        out["edge_px_err"] = None
    out["banding"] = banding(our_rgb, valid)
    return out


# --------------------------------------------------------------------------------------------------- review sheet
def review_sheet(ref_rgb, our_rgb, valid, m, path, title="", zoom=2, max_side=1500):
    ys, xs = np.nonzero(valid)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 8
    y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
    y1, x1 = min(valid.shape[0], y1 + pad), min(valid.shape[1], x1 + pad)
    z = zoom
    if max(y1 - y0, x1 - x0) * z > max_side:
        z = max(1, max_side // max(y1 - y0, x1 - x0))

    def prep(rgb, dim_invalid=True):
        a = (np.clip(rgb[y0:y1, x0:x1], 0, 1) * 255).astype(np.uint8)[..., ::-1].copy()
        if dim_invalid:
            inv = ~valid[y0:y1, x0:x1]
            hatch = ((np.indices(inv.shape).sum(0) // 4) % 2 == 0)
            a[inv] = (a[inv] * 0.35).astype(np.uint8)
            a[inv & hatch] = (a[inv & hatch] * 0.5 + np.array([0, 0, 60])).astype(np.uint8)
        return cv2.resize(a, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)

    ref_v, our_v = prep(ref_rgb), prep(our_rgb)
    d = (color.luma8(np.clip(our_rgb, 0, 1) * 255) - color.luma8(ref_rgb * 255))[y0:y1, x0:x1]
    dv = np.zeros(d.shape + (3,), np.uint8)
    k = 4.0
    dv[..., 2] = np.clip(d * k, 0, 255)          # ours brighter: red
    dv[..., 0] = np.clip(-d * k, 0, 255)         # ours darker: blue
    dv[~valid[y0:y1, x0:x1]] = (40, 40, 40)
    dv = cv2.resize(dv, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
    gap = np.full((ref_v.shape[0], 6, 3), 255, np.uint8)
    row = np.hstack([ref_v, gap, our_v, gap, dv])
    lines = [title, "reference | ours | diff (luma x4: red = ours brighter, blue = darker; grey/hatched = masked)",
             "SSIM %.4f   dE2000 mean %.2f  p95 %.2f   edge err %s px   luma bias %+.1f  rmse %.1f   banding %s   valid %d px   zoom %dx" % (
                 m["ssim"], m["dE2000_mean"], m["dE2000_p95"],
                 "%.3f" % m["edge_px_err"] if m.get("edge_px_err") is not None else "n/a",
                 m["luma_bias"], m["luma_rmse"],
                 m["banding"].get("plateau_fraction"), m["valid_px"], z)]
    lh = 20
    text = np.zeros((lh * len(lines) + 8, row.shape[1], 3), np.uint8)
    for i, t in enumerate(lines):
        cv2.putText(text, t, (6, lh * (i + 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    cv2.imwrite(path, np.vstack([row, text]))
    return path


# ------------------------------------------------------------------------------------------------------------ run
def run(ref_base, layers, cluster, name, rois=(), roi_angle=None, ignore_bits=31, want_edges=True,
        canny=(20, 60), sheet=True, out_dir=None):
    ref = load_ref(ref_base, ignore_bits)
    k = ref["scale"]
    ours = compose(layers, ref["box"], k)
    valid = ref["valid"].copy()
    for spec in rois:
        valid &= roi_mask(spec, ref["box"], k, cluster, roi_angle if spec.startswith("ring") else None)
    m = metrics(ref["rgb"], ours, valid, k, want_edges, canny)
    res = {"fit": {"ssim": m["ssim"], "dE2000_mean": m["dE2000_mean"], "edge_px_err": m["edge_px_err"]},
           "metrics": m, "ref": os.path.relpath(ref_base, ROOT), "box": ref["box"], "scale": k,
           "roi": list(rois) + ([f"angle {roi_angle}"] if roi_angle else []), "ignore_bits": ignore_bits,
           "layers": [[(os.path.relpath(l[0], ROOT) if isinstance(l[0], str) else "<array>"), l[1], l[2], l[3]] for l in layers]}
    if sheet:
        od = out_dir or os.path.join(WORK, cluster or "misc")
        p = os.path.join(od, f"qc_{name}__{os.path.basename(ref_base)}.png")
        review_sheet(ref["rgb"], ours, valid, m, p, f"{name}  vs  {os.path.basename(ref_base)}")
        res["sheet"] = os.path.relpath(p, ROOT)
    return res


def _parse_layer(s):
    parts = s.split(":")
    f, x, y = parts[0], float(parts[1]), float(parts[2])
    sc = float(parts[3]) if len(parts) > 3 else 1.0
    return (f, int(round(x)), int(round(y)), sc)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--layer", action="append", default=[])
    ap.add_argument("--manifest")
    ap.add_argument("--ids")
    ap.add_argument("--cluster")
    ap.add_argument("--name", default="stack")
    ap.add_argument("--roi", action="append", default=[])
    ap.add_argument("--roi-angle")
    ap.add_argument("--ignore-bits", type=int, default=31)
    ap.add_argument("--edges", action="store_true")
    ap.add_argument("--crisp", action="store_true")
    ap.add_argument("--canny", default="20,60")
    ap.add_argument("--no-sheet", action="store_true")
    ap.add_argument("--out-dir")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    layers = []
    if a.manifest:
        layers += layers_from_manifest(a.manifest, a.ids.split(",") if a.ids else None)
    layers += [_parse_layer(s) for s in a.layer]
    if not layers:
        ap.error("no layers (--layer or --manifest)")
    res = run(a.ref, layers, a.cluster, a.name, a.roi, a.roi_angle, a.ignore_bits, a.edges or a.crisp,
              tuple(int(v) for v in a.canny.split(",")), not a.no_sheet, a.out_dir)
    s = json.dumps(res, indent=1)
    if a.json:
        with open(a.json, "w") as f:
            f.write(s + "\n")
    print(s)
    return res


if __name__ == "__main__":
    main()
