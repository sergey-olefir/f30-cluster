"""P9 / integration readiness: one command regenerates every P9 output.

    cd /Users/solefir/projects/f30-cluster/bake/src && ./P9/py.sh -m P9.run

Inputs (read-only): the baked files, the manifests of P1-P8, their 1x procedural previews, P7's build.py (imported).
Outputs (bake/work/P9/, git-ignored, plus bake/manifest/P9-composition.json):
    preview_<mode>.png              1920x720 composed panel per mode (comfort, sport, eco), our layers only
    preview_<mode>__<variant>.png   variants used by the reconciliation (window gain, Sport base, Sport level, ...)
    qc_<name>__<ref>.png            QC review sheets (reference | ours | diff)
    p9_results.json                 every number the report uses (QC, light, levels, overlaps, budget)
    stack_<mode>.json               the exact stack (order, file, position, opacity, gain) of each preview
"""
import json
import os
import sys
import time

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import qc  # noqa: E402
from common import geom, imageio  # noqa: E402
from P9 import budget, layers as Ly, levels, light  # noqa: E402

ROOT = Ly.ROOT
W = os.path.join(ROOT, "bake", "work", "P9")
RECT = os.path.join(ROOT, "bake", "work", "rect")
PANEL = [0, 0, 1920, 720]
GAIN_PHOTOS = ["04_comfort_whole-cluster_mph.comfort", "07_physical-cluster_all-lamps-lit.comfort",
               "06_comfort_wide_with-wheel.comfort", "03_three-modes_photo_bimmerstop.comfort"]


def rel(p):
    return os.path.relpath(p, ROOT) if p else p


def compose(L):
    rgb = qc.compose(Ly.as_qc_layers(L), PANEL, 1)
    return np.clip(rgb, 0, 1)


def save_rgb(path, rgb):
    cv2.imwrite(path, (np.clip(rgb, 0, 1)[..., ::-1] * 255 + 0.5).astype(np.uint8))


def rgba(rgb):
    return np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float32)], -1).astype(np.float32)


def ref_box(ref):
    return json.load(open(os.path.join(RECT, ref + ".json")))["box"]


def qcrun(panel_rgb, ref, cluster, name, rois, angle=None, edges=True, mirror=False, ignore_bits=31):
    """QC our composed panel (RGB) against a rect crop. mirror: flip the panel left-right first (speedo -> rev dial
    position: x -> 1920 - x maps (412, 380) onto (1508, 380))."""
    if not os.path.exists(os.path.join(RECT, ref + ".json")):
        return {"ref": ref, "missing": True}
    img = panel_rgb[:, ::-1] if mirror else panel_rgb
    bx = ref_box(ref)
    crop = rgba(img[bx[1]:bx[1] + bx[3], bx[0]:bx[0] + bx[2]])
    r = qc.run(os.path.join(RECT, ref), [(crop, bx[0], bx[1], 1.0)], cluster, name, rois=rois, roi_angle=angle,
               want_edges=edges, out_dir=W, ignore_bits=ignore_bits)
    m = r["metrics"]
    rnd = lambda v: None if v is None else round(float(v), 3)  # noqa: E731
    return {"ref": ref, "roi": r["roi"], "ssim": rnd(r["fit"]["ssim"]), "dE2000_mean": rnd(r["fit"]["dE2000_mean"]),
            "edge_px_err": rnd(r["fit"]["edge_px_err"]), "luma_bias": rnd(m.get("luma_bias")),
            "valid_px": m.get("valid_px"), "sheet": r.get("sheet"), "mirrored": mirror}


def crop_layer_panel(ref):
    """A rect crop (e.g. ours_bench.comfort.C1) pasted into an empty panel (for the A/B against the current theme)."""
    bx = ref_box(ref)
    img = cv2.imread(os.path.join(RECT, ref + ".png"))[..., ::-1].astype(np.float32) / 255
    out = np.zeros((720, 1920, 3), np.float32)
    out[bx[1]:bx[1] + bx[3], bx[0]:bx[0] + bx[2]] = img
    return out


# --------------------------------------------------------------------------------------------- QC plans
def qc_comfort(P, tag, full=True):
    R = {}
    R["C1|05m|0-0.97"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", f"{tag}.C1-mirrored", ["ring:0:0.97"], mirror=True)
    R["C1|05m|0-0.79"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", f"{tag}.C1-mirrored-079", ["ring:0:0.79"], mirror=True)
    R["C1|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    R["C1|03"] = qcrun(P, "03_three-modes_photo_bimmerstop.comfort.C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    R["C2|05"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    R["C2|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    if not full:
        return R
    R["C1|17"] = qcrun(P, "17_physical-cluster_full.comfort.C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    R["C2|03"] = qcrun(P, "03_three-modes_photo_bimmerstop.comfort.C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    R["C2|17"] = qcrun(P, "17_physical-cluster_full.comfort.C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    R["C1|bezel|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C1", "C1", f"{tag}.C1-bezel", ["ring:0.95:1.02"])
    R["C2|bezel|05"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", f"{tag}.C2-bezel", ["ring:0.95:1.02"], "330:180")
    R["C3|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C3", "C3", f"{tag}.C3", ["ring:0:1.0"])
    R["C4|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C4", "C4", f"{tag}.C4", ["ring:0:1.0"])
    R["C3|17"] = qcrun(P, "17_physical-cluster_full.comfort.C3", "C3", f"{tag}.C3", ["ring:0:1.0"])
    R["C4|17"] = qcrun(P, "17_physical-cluster_full.comfort.C4", "C4", f"{tag}.C4", ["ring:0:1.0"])
    win = ["box:720:79:480:609"]
    R["C5|17"] = qcrun(P, "17_physical-cluster_full.comfort.C5", "C5", f"{tag}.C5", win)
    R["C5|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C5", "C5", f"{tag}.C5", win)
    R["C5|07"] = qcrun(P, "07_physical-cluster_all-lamps-lit.comfort.C5", "C5", f"{tag}.C5", win)
    R["C6range|17"] = qcrun(P, "17_physical-cluster_full.comfort.C1", "C1", f"{tag}.C6-range", ["box:228:596:372:96"])
    R["C6range|07"] = qcrun(P, "07_physical-cluster_all-lamps-lit.comfort.C1", "C1", f"{tag}.C6-range", ["box:228:596:372:96"])
    R["C6ed|17"] = qcrun(P, "17_physical-cluster_full.comfort.C2", "C2", f"{tag}.C6-ed", ["box:1290:580:410:110"])
    return R


def qc_ab():
    """The current theme (bench render, OLD geometry mapped per dial into the G20 frame) on the same refs and ROIs."""
    R = {}
    for cl in ("C1", "C2", "C3", "C4"):
        P = crop_layer_panel(f"ours_bench.comfort.{cl}")
        if cl == "C1":
            R["C1|05m|0-0.97"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", "AB_bench.C1-mirrored", ["ring:0:0.97"], mirror=True)
            R["C1|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C1", "C1", "AB_bench.C1", ["ring:0:0.97"])
            R["C1|03"] = qcrun(P, "03_three-modes_photo_bimmerstop.comfort.C1", "C1", "AB_bench.C1", ["ring:0:0.97"])
        elif cl == "C2":
            R["C2|05"] = qcrun(P, "05_comfort_tach-closeup.comfort.C2", "C2", "AB_bench.C2", ["ring:0:0.97"])
            R["C2|04"] = qcrun(P, "04_comfort_whole-cluster_mph.comfort.C2", "C2", "AB_bench.C2", ["ring:0:0.97"])
        else:
            R[f"{cl}|04"] = qcrun(P, f"04_comfort_whole-cluster_mph.comfort.{cl}", cl, f"AB_bench.{cl}", ["ring:0:1.0"])
    return R


def qc_sport(P, tag):
    R = {}
    s = "03_three-modes_photo_bimmerstop.sport"
    R["C1|03s"] = qcrun(P, s + ".C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    R["C2|03s"] = qcrun(P, s + ".C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    R["C1band|03s"] = qcrun(P, s + ".C1", "C1", f"{tag}.C1-band", ["ring:0.45:0.88"], "230:260", edges=False)
    R["C2band|03s"] = qcrun(P, s + ".C2", "C2", f"{tag}.C2-band", ["ring:0.45:0.88"], "280:190", edges=False)
    R["C1outer|03s"] = qcrun(P, s + ".C1", "C1", f"{tag}.C1-outer", ["ring:0.86:0.97"], "230:260", edges=False)
    for nm in ("bridge", "wings"):
        m = os.path.join(ROOT, "bake", "work", "C8-sport", f"roi_{nm}_03.png")
        if os.path.exists(m):
            R[f"{nm}|03s"] = qcrun(P, s + ".PANEL", "PANEL", f"{tag}.{nm}", ["mask:" + m], edges=(nm == "wings"))
    R["C1|01s"] = qcrun(P, "01_three-modes_small.sport.C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    return R


def qc_eco(P, tag):
    R = {}
    e = "03_three-modes_photo_bimmerstop.eco"
    R["C1|03e"] = qcrun(P, e + ".C1", "C1", f"{tag}.C1", ["ring:0:0.97"])
    R["C2|03e"] = qcrun(P, e + ".C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    for cl, nm in (("C2", "tacho"), ("C1", "speedo")):
        m = os.path.join(ROOT, "bake", "work", "C8-eco", f"roi_stack_{nm}.png")
        if os.path.exists(m):
            R[f"{cl}parts|03e"] = qcrun(P, f"{e}.{cl}", cl, f"{tag}.{cl}-eco-parts", ["mask:" + m])
    R["C2|01e"] = qcrun(P, "01_three-modes_small.eco.C2", "C2", f"{tag}.C2", ["ring:0:0.97"])
    return R


# --------------------------------------------------------------------------------------------- checks
BMW = {"GEAR_P (visible.js)": [1392, 664, 1428, 706], "gear letter (P8 measured)": [1398.4, 667.2, 1421.4, 700.2],
       "BLACK_BOX (visible.js)": [1420, 320, 1597, 440], "black area (P8 measured)": [1419.5, 320.8, 1610.8, 437.9],
       "BELT (visible.js)": [587, 665, 626, 720]}


def overlaps(L):
    """Pixels (alpha > 0.1) of each layer inside each of BMW's overlay boxes."""
    out = {}
    for it in L:
        a = Ly.load(it)
        s = it["s"]
        fw, fh = int(round(a.shape[1] / s)), int(round(a.shape[0] / s))
        if s != 1.0:
            a = imageio.upscale2(a, fw, fh)
        for nm, (x0, y0, x1, y1) in BMW.items():
            X0, Y0 = int(max(x0, it["x"])), int(max(y0, it["y"]))
            X1, Y1 = int(min(x1, it["x"] + fw)), int(min(y1, it["y"] + fh))
            if X1 <= X0 or Y1 <= Y0:
                continue
            sub = a[Y0 - it["y"]:Y1 - it["y"], X0 - it["x"]:X1 - it["x"], 3]
            n = int((sub > 0.1).sum())
            if n:
                ys, xs = np.nonzero(sub > 0.1)
                out.setdefault(nm, []).append({"id": it["id"], "px": n,
                                               "bbox": [int(X0 + xs.min()), int(Y0 + ys.min()), int(X0 + xs.max() + 1), int(Y0 + ys.max() + 1)]})
    return out


def file_bytes(path_rel):
    a = imageio.read_png(os.path.join(Ly.BAKED, path_rel))
    return imageio.bytes_by_8wh(a.shape[1], a.shape[0])


def scene_budget(cur):
    """Assets (or image layers) per mode in the proposed scene, with what they replace."""
    F = file_bytes
    comfort = [
        ("C1/speedo.base.albedo@0.5x.png", "speedo WBDIAL: face gradient, groove, floor shade, hub well"),
        ("C1/speedo.soft-glow.glow@0.5x.png", "speedo WBDIAL: tick / ring glow terms"),
        ("C2/tacho.static.albedo@0.5x.png", "tacho WBDIAL: face, shadows, inner disc, floor, tick spots"),
        ("C3/fuel.static.merged.png", "fuel WBDIAL mini style face/bezel/ticks + fuel_icon widget (P5 pump re-merged)"),
        ("C4/oil.static.merged.png", "oilt WBDIAL mini style + oil_icon widget (own sheet: -1 layer)"),
        ("C5/window.base.albedo@0.5x.png", "WBBACK window"),
        ("C5/window.horizon.albedo.png", "WBBACK horizon"),
        ("C6/infobar.body.albedo@0.5x.png", "WBBACK bottom bar"),
        ("C6/infobar.line.albedo.png", "WBBACK bottom bar edge"),
        ("C6/range-arc.track.albedo.png", "new: range arc (sampled by the speedo shader, fill dynamic)"),
        ("C6/range-arc.segments.mask.png", "new: range arc segment mask"),
        ("C6/ed-arc.track.albedo.png", "new: ED arc"),
        ("C6/ed-arc.segments.mask.png", "new: ED arc segment mask"),
        ("C7/edyn.battery.albedo.png", "new: battery icon on the ED arc"),
        ("C7/bar.range.albedo.png", "range_icon widget (sheet member)"),
    ]
    sport = [("C8-sport/speedo.sport-band.glow@0.5x.png", "WBDIAL sport style band"),
             ("C8-sport/tacho.sport-band.glow@0.5x.png", "WBDIAL sport style band"),
             ("C8-sport/sport.bridge.glow@0.5x.png", "WBBACK sport bridge")]
    eco = [("C8-eco/tacho.eco-static.albedo@0.5x.png", "WBDIAL eff style CHARGE/POWER band + ED arc"),
           ("C8-eco/tacho.eco-glow.glow@0.5x.png", "new: bezel tint"),
           ("C8-eco/speedo.eco-glow.glow@0.5x.png", "new: bezel tint"),
           ("C8-eco/speedo.eco-arc.glow@0.5x.png", "WBDIAL eco style inner arc")]
    rows = {m: [{"file": f, "bytes_by_8wh": F(f), "replaces": r} for f, r in lst]
            for m, lst in (("comfort", comfort), ("sport_extra", sport), ("eco_extra", eco))}
    tot = {k: sum(r["bytes_by_8wh"] for r in v) for k, v in rows.items()}
    c10 = F("C10/panel.background.albedo@0.5x.png")
    sport_bases = F("C1/speedo.base.albedo@0.5x.png") + F("C2/tacho.static.albedo@0.5x.png")
    per_mode = {"comfort": tot["comfort"], "sport": tot["comfort"] + tot["sport_extra"],
                "eco": tot["comfort"] + tot["eco_extra"]}
    cur_px = {m: cur[f"wb_{m}"]["pixel_bytes"] for m in ("comfort", "sport", "eco")}
    res = {"rows": rows, "totals": tot, "per_mode_baked": per_mode,
           "per_mode_baked_mib": {k: budget.mib(v) for k, v in per_mode.items()},
           "per_mode_with_current_theme_mib": {k: budget.mib(v + cur_px[k]) for k, v in per_mode.items()},
           "all_modes_preloaded_baked_mib": budget.mib(tot["comfort"] + tot["sport_extra"] + tot["eco_extra"]),
           "all_modes_preloaded_plus_comfort_theme_mib": budget.mib(tot["comfort"] + tot["sport_extra"] + tot["eco_extra"] + cur_px["comfort"]),
           "C10_as_bitmap_bytes": c10, "C10_at_quarter_bytes": c10 // 4,
           "sport_specific_bases_bytes": sport_bases,
           "worst_case_sport_with_C10_bitmap_and_own_bases_mib": budget.mib(per_mode["sport"] + c10 + sport_bases),
           "budget": {"mode_mib": 8, "total_mib": 16, "per_connection": 8, "layers_total": 32}}
    # layer count: asset route (bind to existing effect layers) vs image-layer route (packages' proposals)
    cl = cur["wb_comfort"]
    res["layers"] = {
        "current_comfort": cl["layers"], "current_per_connection": cl["per_connection"],
        "asset_route": {"comfort": cl["layers"] - 1, "per_connection": [8, 6, 6], "note": "every baked file is an RGBA8 asset sampled by the existing "
                        "WBDIAL / WBBACK / WBSIGN effect layers (0 new layers); oil_icon's own sheet goes (-1)"},
        "image_route": {"new_layers": {"C10": 0, "C1 base + glow": 2, "C2 static": 1, "C3 merged": 1, "C4 merged": 1,
                                       "C5 window + horizon strip": 2, "C6 two arc effect layers": 2, "C7": 0,
                                       "Sport bands + bridge": 3, "Eco static + 3 glows/arc": 4},
                        "comfort": cl["layers"] - 1 + 9, "sport": cur["wb_sport"]["layers"] + 9 + 3,
                        "eco": cur["wb_eco"]["layers"] + 9 + 4}}
    return res


def window_gain(L, g):
    """P4's window layers scaled by g (code values): the proposed level fix (a uniform in the sampling shader)."""
    out = []
    for it in L:
        it = dict(it)
        if it["id"] in ("window.base", "window.horizon", "infobar.line"):
            it["gain"] = np.array([g, g, g])
        out.append(it)
    return out


# --------------------------------------------------------------------------------------------- main
def main():
    t0 = time.time()
    os.makedirs(W, exist_ok=True)
    out = {"generated": time.strftime("%Y-%m-%d %H:%M"), "qc": {}, "stacks": {}}

    # 1. stacks and previews
    comfort = Ly.comfort(merged=True, pict="P5", signs=True)
    comfort_qc = Ly.comfort(merged=True, pict="P5", signs=False)
    comfort_ind = Ly.comfort(merged=False, pict="P5", signs=False)
    comfort_p3 = Ly.comfort(merged=True, pict="P3", signs=False)
    sport, s_info = Ly.sport(merged=False)
    sport03, _ = Ly.sport(merged=False, band_op=0.30, bridge_op=0.28)
    sport_m03, _ = Ly.sport(merged=True, band_op=0.30, bridge_op=0.28)
    eco, e_info = Ly.eco(merged=True)
    eco_ind, _ = Ly.eco(merged=False)
    out["stacks"] = {"sport_info": s_info, "eco_info": e_info}
    P = {}
    for nm, L in (("comfort", comfort), ("sport", sport), ("eco", eco)):
        P[nm] = compose(L)
        save_rgb(os.path.join(W, f"preview_{nm}.png"), P[nm])
        imageio.write_json(os.path.join(W, f"stack_{nm}.json"), Ly.describe(L))
    P["comfort_qc"] = compose(comfort_qc)
    P["comfort_ind"] = compose(comfort_ind)
    P["comfort_p3"] = compose(comfort_p3)
    P["sport03"] = compose(sport03)
    P["sport_m03"] = compose(sport_m03)
    P["eco_ind"] = compose(eco_ind)
    save_rgb(os.path.join(W, "preview_sport__level03.png"), P["sport03"])
    save_rgb(os.path.join(W, "preview_sport__comfort-bases-reused.png"), P["sport_m03"])
    print(f"previews {time.time() - t0:.0f}s", flush=True)

    # 2. levels (window vs faces) and the proposed window gain
    lev = levels.run(P["comfort_qc"])
    rs = [lev["photos"][p]["ratio_window_over_face"] for p in GAIN_PHOTOS if lev["photos"].get(p, {}).get("ratio_window_over_face")]
    lev["gain_photos"] = GAIN_PHOTOS
    lev["target_ratio_real_photos"] = round(float(np.median(rs)), 3)
    g = round(lev["target_ratio_real_photos"] / lev["ours"]["ratio_window_over_face"], 3)
    lev["proposed_window_gain"] = g
    out["levels"] = lev
    P["comfort_gain"] = compose(window_gain(comfort, g))
    save_rgb(os.path.join(W, "preview_comfort__window-gain.png"), P["comfort_gain"])
    lev["ours_after_gain"] = levels.measure_ours(P["comfort_gain"])

    # 3. QC
    Q = out["qc"]
    Q["comfort"] = qc_comfort(P["comfort_qc"], "comfort")
    Q["comfort_individual"] = qc_comfort(P["comfort_ind"], "comfort-individual", full=False)
    Q["comfort_window_gain"] = {k: qcrun(P["comfort_gain"], r, "C5", "comfort-wingain.C5", ["box:720:79:480:609"])
                                for k, r in (("C5|17", "17_physical-cluster_full.comfort.C5"),
                                             ("C5|04", "04_comfort_whole-cluster_mph.comfort.C5"),
                                             ("C5|07", "07_physical-cluster_all-lamps-lit.comfort.C5"))}
    Q["ab_current_theme"] = qc_ab()
    # pictograms P3 vs P5 on the same refs and boxes (each over P3's own face / bezel)
    pict = {}
    for nm, PP in (("P3", P["comfort_p3"]), ("P5", P["comfort_qc"])):
        for ref, cl, box in (("04_comfort_whole-cluster_mph.comfort.C3", "C3", "box:82:562:34:30"),
                             ("17_physical-cluster_full.comfort.C3", "C3", "box:82:562:34:30"),
                             ("04_comfort_whole-cluster_mph.comfort.C4", "C4", "box:1808:564:40:28"),
                             ("17_physical-cluster_full.comfort.C4", "C4", "box:1808:564:40:28"),
                             ("07_physical-cluster_all-lamps-lit.comfort.C3", "C3", "box:82:562:34:30")):
            pict[f"{nm}|{ref.split('_')[0]}|{cl}"] = qcrun(PP, ref, cl, f"pictogram-{nm}.{cl}", [box], ignore_bits=15)
    Q["pictograms"] = pict
    print(f"comfort qc {time.time() - t0:.0f}s", flush=True)
    Q["sport_default"] = qc_sport(P["sport"], "sport")
    Q["sport_level03"] = qc_sport(P["sport03"], "sport-level03")
    Q["sport_comfort_bases"] = qc_sport(P["sport_m03"], "sport-comfortbases")
    P["sport_gain"] = compose(window_gain(sport, g))
    save_rgb(os.path.join(W, "preview_sport__window-gain.png"), P["sport_gain"])
    Q["sport_level03_window_gain"] = qc_sport(compose(window_gain(sport03, g)), "sport-level03-wingain")
    Q["eco"] = qc_eco(P["eco"], "eco")
    P["eco_gain"] = compose(window_gain(eco, g))
    save_rgb(os.path.join(W, "preview_eco__window-gain.png"), P["eco_gain"])
    Q["eco_window_gain"] = qc_eco(P["eco_gain"], "eco-wingain")
    Q["eco_individual"] = qc_eco(P["eco_ind"], "eco-individual")
    Q["eco_no_tint"] = qc_eco(compose(Ly.sort([dict(it, gain=None, recolor=None) for it in eco])), "eco-notint")
    print(f"all qc {time.time() - t0:.0f}s", flush=True)

    # 4. light model, overlaps with BMW's overlays, budget
    out["light"] = light.run()
    out["bmw_overlaps"] = {"comfort": overlaps(comfort), "eco": overlaps([it for it in eco if it["cl"] == "C2"]),
                           "sport": overlaps([it for it in sport if it["id"].startswith("tacho.sport")])}
    cur = {n: budget.current(n) for n in ("wb_comfort", "wb_sport", "wb_eco")}
    out["current_theme"] = cur
    out["scene_budget"] = scene_budget(cur)
    imageio.write_json(os.path.join(W, "p9_results.json"), out)

    # 5. composition manifest (P9's proposal, not applied)
    comp = {"package": "P9", "note": "proposed scene per mode; not wired into the theme. See docs/BAKE-REPORT.md.",
            "previews": {m: f"bake/work/P9/preview_{m}.png" for m in ("comfort", "sport", "eco")},
            "stacks": {m: f"bake/work/P9/stack_{m}.json" for m in ("comfort", "sport", "eco")},
            "budget": out["scene_budget"], "window_gain": g,
            "sport_opacity_default": s_info, "eco_tints": e_info}
    imageio.write_json(os.path.join(ROOT, "bake", "manifest", "P9-composition.json"), comp)
    print(f"done {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
