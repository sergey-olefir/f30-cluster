"""P6 / C8 Sport: one command regenerates every file, runs the QC and writes the manifest.

    cd bake/src && ./C8-sport/py.sh C8-sport/build.py

Shipped files (apps/f30_cluster/hud/baked/C8-sport/), all drawn here (no reference pixels):
    speedo.sport-band.glow@0.5x.png, tacho.sport-band.glow@0.5x.png     red band, peak alpha 1 (level = opacity)
    sport.bridge.glow@0.5x.png                                           bridge + collar glow between the dials
    sport.wing-{l,r}-{upper,lower}.highlight.png                         the four wing highlights, 1x
The hairlines are procedural (params in params.HAIRLINES); a QC-only raster goes to bake/work/C8-sport/.
"""
import json
import os
import sys

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
sys.path.insert(0, SRC)
sys.path.insert(0, HERE)
import qc  # noqa: E402
from common import geom, imageio  # noqa: E402
import params as P  # noqa: E402
import draw  # noqa: E402

ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
OUT = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked", "C8-sport")
WORK = os.path.join(ROOT, "bake", "work", "C8-sport")
RECT = os.path.join(ROOT, "bake", "work", "rect")
MAN = os.path.join(ROOT, "bake", "manifest", "C8-sport.json")
REPORT_JSON = os.path.join(WORK, "qc_results.json")
REFS = json.load(open(os.path.join(ROOT, "bake", "manifest", "refs.json")))["images"]

OURS = {"C1": geom.G20["C1"]["c"], "C2": geom.G20["C2"]["c"], "R": 335.0}
STEMS = {"03": "03_three-modes_photo_bimmerstop", "02": "02_three-modes_clean-render", "01": "01_three-modes_small"}


def ref_geo(key):
    dc = REFS[STEMS[key] + ".png"]["sections"]["sport"]["window_transform"]["dial_centres_in_panel"]
    return {"C1": tuple(dc[0]), "C2": tuple(dc[1]), "R": 335.0}


def with_opacity(img, k):
    o = img.copy()
    o[..., 3] *= k
    return o


def rel(p):
    return os.path.relpath(p, ROOT)


def save(img, name):
    path = os.path.join(OUT, name)
    imageio.write_png(path, img)
    return path


def face_standin(geo, C, color=(10 / 255, 11 / 255, 12 / 255)):
    """QC-only stand-in for the Comfort dial stack (P1 / P2 were not available): a flat face disc of 03 sport's
    measured face colour inside 0.97 R."""
    cx, cy = geo[C]
    R = geo["R"]
    x0, y0 = int(cx - R), int(cy - R)
    w = h = int(2 * R) + 2
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx + x0 + 0.5 - cx, yy + y0 + 0.5 - cy) / R
    a = np.clip((0.97 - r) * R + 0.5, 0, 1).astype(np.float32)
    return draw._rgba(color, a), x0, y0


def panel_mask(path, geo, kind):
    """ROI masks for the PANEL crops (6WB layout): 'bridge' = between the bezels, |v| < 0.38, away from the car /
    centre window content; 'wings' = the four wing boxes (+4 px)."""
    m = np.zeros((geom.PANEL_H, geom.PANEL_W), np.uint8)
    (lx, ly), (rx, ry) = geo["C1"], geo["C2"]
    R = geo["R"]
    cy = 0.5 * (ly + ry)
    yy, xx = np.mgrid[0:geom.PANEL_H, 0:geom.PANEL_W]
    if kind == "bridge":
        rl = np.hypot(xx - lx, yy - ly) / R
        rr = np.hypot(xx - rx, yy - ry) / R
        v = (yy - cy) / R
        keep = (np.minimum(rl, rr) > 1.01) & (np.abs(v) < 0.38) & (xx > lx) & (xx < rx)
        mid = 0.5 * (lx + rx)
        keep &= np.abs(xx - mid) > 0.30 * R          # the car / door pictogram sits in the middle
        m[keep] = 255
    else:
        # within 10 px of the drawn wing (keeps the bottom bar / bezel out of the box)
        for C in ("C1", "C2"):
            for part in ("upper", "lower"):
                img, x0, y0, w, h = draw.wing(geo, C, part)
                a = (img[..., 3] > 0.02).astype(np.uint8) * 255
                a = cv2.dilate(a, np.ones((21, 21), np.uint8))
                sub = m[y0:y0 + h, x0:x0 + w]
                np.maximum(sub, a[:sub.shape[0], :sub.shape[1]], out=sub)
        rl = np.hypot(xx - lx, yy - ly) / R
        rr = np.hypot(xx - rx, yy - ry) / R
        m[np.minimum(rl, rr) < 1.0] = 0
    cv2.imwrite(path, m)
    return path


def run_qc(ref, layers, cluster, name, rois, angle=None, edges=False):
    r = qc.run(os.path.join(RECT, ref), layers, cluster, name, rois=rois, roi_angle=angle, want_edges=edges,
               out_dir=WORK)
    f = dict(r["fit"])
    f.update({"ref": r["ref"], "roi": r["roi"], "sheet": r["sheet"]})
    m = r["metrics"]
    return {"fit": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()},
            "extra": {k: m.get(k) for k in ("dE2000_p95", "luma_bias", "luma_rmse", "valid_px", "banding")}}


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    files = {}
    # ---------------------------------------------------------------- shipped files, our G20 geometry
    for C, dial in (("C1", "speedo"), ("C2", "tacho")):
        img, x0, y0, w, h = draw.band(OURS, C, 0.5)
        files[dial + ".sport-band"] = (save(img, f"{dial}.sport-band.glow@0.5x.png"), x0, y0, w, h, 0.5)
        hl, hx, hy, hw, hh = draw.hairlines(OURS, C)
        imageio.write_png(os.path.join(WORK, f"{dial}.sport-hairlines.shadow.qc-only.png"), hl)
        files[dial + ".sport-hairlines"] = (os.path.join(WORK, f"{dial}.sport-hairlines.shadow.qc-only.png"), hx, hy, hw, hh, 1.0)
    img, x0, y0, w, h = draw.bridge(OURS, 0.5)
    files["sport.bridge"] = (save(img, "sport.bridge.glow@0.5x.png"), x0, y0, w, h, 0.5)
    for C, sd in (("C1", "l"), ("C2", "r")):
        for part in ("upper", "lower"):
            img, x0, y0, w, h = draw.wing(OURS, C, part)
            files[f"sport.wing-{sd}-{part}"] = (save(img, f"sport.wing-{sd}-{part}.highlight.png"), x0, y0, w, h, 1.0)

    # ---------------------------------------------------------------- QC
    res = {}
    band_roi = {"C1": ("ring:0.45:0.88", "230:260"), "C2": ("ring:0.45:0.88", "280:190")}
    for C, dial in (("C1", "speedo"), ("C2", "tacho")):
        bimg = imageio.read_png(files[dial + ".sport-band"][0])
        _, bx, by, _, _, _ = files[dial + ".sport-band"]
        hl = imageio.read_png(files[dial + ".sport-hairlines"][0])
        _, hx, hy, _, _, _ = files[dial + ".sport-hairlines"]
        face, fx, fy = face_standin(OURS, C)
        roi, ang = band_roi[C]
        for key in ("03", "01", "02"):
            op = P.OPACITY["band"][key]
            ref = f"{STEMS[key]}.sport.{C}"
            b = with_opacity(bimg, op)
            res[f"{dial}.sport-band|{key}|alone"] = run_qc(ref, [(b, bx, by, 0.5)], C, f"{dial}.sport-band.{key}", [roi], ang)
            res[f"{dial}.sport-band|{key}|stack"] = run_qc(
                ref, [(face, fx, fy, 1.0), (b, bx, by, 0.5), (hl, hx, hy, 1.0)], C, f"{dial}.sport-stack.{key}",
                [roi], ang, edges=True)
        # the hairlines' edge error on their own sectors (03 only: the clearest lines)
        if C == "C1":
            b = with_opacity(bimg, P.OPACITY["band"]["03"])
            res[f"{dial}.sport-hairlines|03|stack"] = run_qc(
                f"{STEMS['03']}.sport.{C}", [(face, fx, fy, 1.0), (b, bx, by, 0.5), (hl, hx, hy, 1.0)], C,
                f"{dial}.sport-hairlines.03", ["ring:0.55:0.80"], "300:120", edges=True)
    for key in ("03", "02", "01"):
        g = ref_geo(key)
        ref = f"{STEMS[key]}.sport.PANEL"
        br, bx, by, _, _ = draw.bridge(g, 0.5)
        br = with_opacity(br, P.OPACITY["bridge"][key])
        wings = [draw.wing(g, C, part)[:3] for C in ("C1", "C2") for part in ("upper", "lower")]
        mb = panel_mask(os.path.join(WORK, f"roi_bridge_{key}.png"), g, "bridge")
        mw = panel_mask(os.path.join(WORK, f"roi_wings_{key}.png"), g, "wings")
        res[f"sport.bridge|{key}|alone"] = run_qc(ref, [(br, bx, by, 0.5)], "PANEL", f"sport.bridge.{key}", [f"mask:{mb}"])
        res[f"sport.wings|{key}|alone"] = run_qc(ref, [(w_, x_, y_, 1.0) for w_, x_, y_ in wings], "PANEL",
                                                 f"sport.wings.{key}", [f"mask:{mw}"], edges=True)
        res[f"sport.mid|{key}|stack"] = run_qc(ref, [(br, bx, by, 0.5)] + [(w_, x_, y_, 1.0) for w_, x_, y_ in wings],
                                               "PANEL", f"sport.mid-stack.{key}", [f"mask:{mw}"], edges=True)
    json.dump(res, open(REPORT_JSON, "w"), indent=1)
    write_manifest(files, res)
    for k, v in res.items():
        f = v["fit"]
        print("%-40s ssim %6.3f  dE %6.2f  edge %s" % (k, f["ssim"] or 0, f["dE2000_mean"] or 0, f["edge_px_err"]))


def entry(id_, z, kind, cls, f, sources, evidence, fit=None, params=None, below=(), above=(), cluster="C8"):
    path, x, y, w, h, sc = f if f else (None, None, None, None, None, None)
    e = {"id": id_, "cluster": cluster, "z": z, "kind": kind, "class": cls, "frame": "panel" if f else "dial"}
    if f:
        fw, fh = int(round(w * sc)), int(round(h * sc))
        e.update({"x": x, "y": y, "w": w, "h": h, "scale": sc, "file": os.path.relpath(path, os.path.dirname(OUT)),
                  "bytes_by_8wh": imageio.bytes_by_8wh(fw, fh)})
    else:
        e.update({"file": None, "bytes_by_8wh": 0})
    e.update({"stack_below": list(below), "stack_above": list(above), "sources": sources, "evidence": evidence,
              "light": {"dir_deg": 0, "key": 0.0}})
    if fit:
        e["fit"] = fit
    if params:
        e["params"] = params
    return e


def write_manifest(files, res):
    def fit(k):
        return res[k]["fit"]
    srcs = ["03_three-modes_photo_bimmerstop.png", "02_three-modes_clean-render.png", "01_three-modes_small.png"]
    L = []
    for C, dial in (("C1", "speedo"), ("C2", "tacho")):
        sw = P.BAND["speedo_sweep" if C == "C1" else "tacho_sweep"]
        L.append(entry(f"{dial}.sport-band", 5.2, "glow", "baked", files[dial + ".sport-band"], srcs,
                       "strong" if C == "C1" else "ok", fit(f"{dial}.sport-band|03|alone"),
                       {"r_units": {k: P.BAND[k] for k in ("r_in", "a0", "a1", "r1", "rim0", "rim1", "r_out")},
                        "sweep_cw12": {"start": sw[0], "span": sw[1]},
                        "color": [round(c * 255) for c in P.TINT["default"]],
                        "opacity_by_ref": P.OPACITY["band"],
                        "level_formula": "fin(r) * mix(ramp(r), 1, smoothstep(rim0, rim1, r)), crisp at r_out; "
                                         "ramp = a0 + (a1-a0)*clamp((r-r_in)/(r1-r_in)); fin = clamp((r-r_in)/0.012+0.5)",
                        "radii_source": "03 (photo, C1 sector 280..60 + C2 unlit sectors), PSF sigma 0.012 R; 02 puts the "
                                        "same ramp+rim structure at 0.63-0.99 R (its own proportions); 01 ~0.47-0.88 (weak)",
                        "fit_other_refs": {k: fit(f"{dial}.sport-band|{k}|alone") for k in ("01", "02")},
                        "fit_stack_standin_face": {k: fit(f"{dial}.sport-band|{k}|stack") for k in ("03", "01", "02")},
                        "dynamic_parts": "lit fill OFF->needle x2.9 and red zone from the shift point x2.2 (03): shader, not baked"},
                       below=[f"{dial}.face", f"{dial}.floor-shade"], above=[f"{dial}.sport-hairlines"]))
        hp = dict(P.HAIRLINES)
        hp["angles_cw12"] = hp.pop("speedo_angles" if C == "C1" else "tacho_angles")
        hp.pop("tacho_angles" if C == "C1" else "speedo_angles")
        hp["width_R"] = round(P.HAIRLINES["width_px_at_R335"] / 335.0, 5)
        hp["qc_raster"] = rel(files[dial + ".sport-hairlines"][0])
        if C == "C1":
            hp["fit_stack"] = fit(f"{dial}.sport-hairlines|03|stack")
        L.append(entry(f"{dial}.sport-hairlines", 5.3, "shadow", "procedural", None,
                       ["03_three-modes_photo_bimmerstop.png", "02_three-modes_clean-render.png"],
                       "ok" if C == "C1" else "weak", None, hp, below=[f"{dial}.sport-band"]))
    L.append(entry("sport.bridge", 0.5, "glow", "baked", files["sport.bridge"], srcs, "ok", fit("sport.bridge|03|alone"),
                   {"r_units": {k: P.BRIDGE[k] for k in P.BRIDGE},
                    "color": [round(c * 255) for c in P.TINT["default"]], "opacity_by_ref": P.OPACITY["bridge"],
                    "formula": "alpha = [exp(-(v-v_c)^2/(2 sigma^2)) + collar_amp*exp(-(r_near-1)/collar_len)*win(|v|<collar_v)] "
                               "* (cx_l < x < cx_r) * clamp((r_near - 1) R + 0.5); v = (y - cy)/R, r_near in R of the nearer dial",
                    "refit_to_our_panel": "x-uniform between the bezels, so it spans whatever gap the panel has (6WB 1.09 R, "
                                          "ours 1.27 R); vertical profile and the collar are in R units of the dials",
                    "fit_other_refs": {k: fit(f"sport.bridge|{k}|alone") for k in ("02", "01")},
                    "ref_disagreement": "v_c: 03 +0.12, 01 +0.10, 02 -0.05 R; sigma 0.089 / 0.095 / 0.072 R"},
                   above=["sport.wing-l-upper", "sport.wing-l-lower", "sport.wing-r-upper", "sport.wing-r-lower"]))
    for C, sd in (("C1", "l"), ("C2", "r")):
        for part in ("upper", "lower"):
            wp = {k: P.WING[k] for k in ("v0", "vt", "s", "m", "uc", "b", "u_tip", "width", "level")}
            wp.update({"root_u": round(draw.wing_root_u(), 4),
                       "frame": "dial frame of %s, u = %s(x - cx)/R toward the middle, |v| = %s(y - cy)/R" % (
                           "C1" if C == "C1" else "C2", "+" if C == "C1" else "-", "-" if part == "upper" else "+"),
                       "centreline": "|v| = vt - s(u-1) + m/2 (sqrt((u-uc)^2 + b^2) - (u-uc)); starts at the bezel (r=1), "
                                     "width/level tables along u (width px at R 335)",
                       "refit_to_our_panel": "anchored to its dial (R units): the tip stays 1.13 R from the dial centre, so "
                                             "the gap between the tips grows from 0.83 R (6WB, spacing 3.09 R) to 1.01 R (ours)",
                       "fit_wings_all_refs": {k: fit(f"sport.wings|{k}|alone") for k in ("03", "02", "01")},
                       "fit_mid_stack": {k: fit(f"sport.mid|{k}|stack") for k in ("03", "02", "01")},
                       "ref_disagreement": "02 puts the upper wing at |v| 0.60-0.80, the lower at 0.24-0.40 (asymmetric, "
                                           "its own proportions); 03 is symmetric about the centre line (+0.0025 R)"})
            L.append(entry(f"sport.wing-{sd}-{part}", 0.6, "highlight", "baked", files[f"sport.wing-{sd}-{part}"],
                           ["03_three-modes_photo_bimmerstop.png", "02_three-modes_clean-render.png"], "ok",
                           fit("sport.wings|03|alone"), wp, below=["sport.bridge"]))
    shipped = [e for e in L if e.get("file")]
    total = sum(e["bytes_by_8wh"] for e in shipped)
    wing_ids = [e["id"] for e in shipped if "wing" in e["id"]]
    comp_imgs = [{"file": e["file"], "from_ids": [e["id"]], "x": e["x"], "y": e["y"], "w": e["w"], "h": e["h"],
                  "scale": e["scale"], "bytes_by_8wh": e["bytes_by_8wh"]} for e in shipped]
    man = {
        "cluster": "C8", "package": "P6", "mode": "sport", "R": 335,
        "generator": "cd bake/src && ./C8-sport/py.sh C8-sport/build.py",
        "notes": "Sport-only layers on top of the Comfort dial stack (P1 / P2). Manifest file C8-sport.json; the schema's "
                 "cluster pattern has no sub-mode, so entries say C8. Shared-layer changes for Sport are params "
                 "(sport_shared_layers), not re-bakes. QC refs: 03 sport (primary, good alignment), 01 / 02 (cross-check). "
                 "z: band 5.2 / hairlines 5.3 inside each dial stack (above face / floor-shade, below the inner disc); "
                 "bridge 0.5 and wings 0.6 in the background, below the dials (both are clipped at r = 1 R anyway).",
        "sport_shared_layers": P.SHARED_IN_SPORT,
        "layers": L,
        "composition": {"images": comp_imgs, "layer_count": len(comp_imgs), "bytes_by_8wh_total": total,
                        "proposal": {
                            "as_shipped": "%d images, %d layers, %.2f MiB" % (len(comp_imgs), len(comp_imgs), total / 1048576),
                            "recommended": "3 layers: speedo band, tacho band, bridge (images); hairlines and wings stay "
                                           "procedural in WBDIAL / WBBACK (params here), which are layers the theme "
                                           "already has. Memory %.2f MiB." % (
                                               sum(e["bytes_by_8wh"] for e in shipped if "wing" not in e["id"]) / 1048576),
                            "alternative_wings_baked": "draw one wing image 4x with sx/sy = -1 mirroring (all four are exact "
                                                       "mirror images): +4 layers, +%d bytes; or the 4 files as shipped." % (
                                                           shipped[[e['id'] for e in shipped].index(wing_ids[0])]["bytes_by_8wh"]),
                        }},
        "open_questions": [
            "Level: the three refs disagree by 3x (band peak alpha 0.30 / 0.48 / 0.92 for 03 / 01 / 02). Files are baked at "
            "peak alpha 1; pick the layer opacity (default 0.48 = 01).",
            "Hue: photos give G/R 0.11-0.18 (camera), 02 and the theme accent are purer red; default (236,35,35).",
            "Ticks in Sport: 03 / 01 show none, 02 shows red tick segments. We hide the Comfort ticks (opacity 0).",
            "A red glow at the hub (< 0.2 R) shows in 01 / 02 sport, not in 03; not delivered (P1/P2 hub or a Sport extra?).",
            "Tacho hairline pitch (1000 rpm) is not visible in 03 (numerals, lit fill): weak.",
            "The P1/P2 Comfort stack was not available at build time: the 'stack' QC uses a flat stand-in face of 03's "
            "measured face colour. P9 should re-run QC with the real stack and the sport_shared_layers opacities.",
        ],
    }
    imageio.write_json(MAN, man)


if __name__ == "__main__":
    main()
