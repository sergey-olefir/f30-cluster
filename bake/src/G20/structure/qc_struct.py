"""QC of package B: compose the layers per photo state, compare with the rects on per-group ROIs (with and
without the pointer-glow zones), write review sheets (scratch) and docs-ready tables (JSON).

Composition: our layers bottom to top over black; map.region gets a flat neutral stand-in (the photo's median map
background) and is excluded from every ROI, so the stand-in never counts. Everything that is not package B's
(C's lamps/texts/labels/sign/cc panel, D's needles and the minis' needles) is masked by its bbox / corridor.
"""
import os

import cv2
import numpy as np

import lib
import model
import fit_soft as fs
import qc as Q          # bake/src/qc.py (metrics, review_sheet)

PHOTOS = {"08": {"look": "night", "state": "stock", "engine_on": False, "cc": True},
          "09": {"look": "day", "state": "stock", "engine_on": True, "cc": False},
          "14": {"look": "day", "state": "connected", "engine_on": True, "cc": False}}
# the 0.7.2 texts of ours in 14 (CONTRACT): masked as boxes (plus an automatic 'bright in 14, dark in ours' mask)
OURS_14 = [(370, 120, 670, 560), (1240, 110, 1620, 350), (1430, 225, 1590, 260), (1250, 445, 1350, 475),
           (1280, 520, 1350, 550), (735, 595, 1145, 672), (380, 565, 470, 595), (85, 580, 125, 615),
           (1790, 585, 1830, 610), (1835, 630, 1910, 662)]


def state_layers(layers, look, photo):
    st = PHOTOS[photo]
    out = []
    for e, img, _ in layers[look]:
        if e["state"] not in ("any", st["state"]):
            continue
        if e.get("cond") == "engine_on" and not st["engine_on"]:
            continue
        if e.get("cond") == "no_cc_message" and st["cc"]:
            continue
        out.append((e, img))
    return sorted(out, key=lambda t: t[0]["z"])


def clip_fill(e, img, needle, mini):
    """Clip a mini fill to the half-plane of the photographed needle line that holds the scale's empty end (the
    bottom end of the lower frame piece) -- what the bench must do live."""
    out = img.copy()
    if needle is None:          # no needle found above the empty end: nothing of the fill is visible
        out[..., 3] = 0
        return out
    J = lib.read_json(os.path.join(lib.PARAMS, "minis.json"))
    lo = np.array(J["frame_lo"] if mini == "fuel" else J["oil_frame_lo"])
    ref_pt = lo[int(0.9 * (len(lo) - 1))]
    x, y = e["x"], e["y"]
    h, w = img.shape[:2]
    Yg, Xg = np.mgrid[y:y + h, x:x + w] + 0.5
    a, b = np.array(needle[0]), np.array(needle[1])
    ab = (b - a) / np.linalg.norm(b - a)
    side = (Xg - a[0]) * (-ab[1]) + (Yg - a[1]) * ab[0]
    s_ref = (ref_pt[0] - a[0]) * (-ab[1]) + (ref_pt[1] - a[1]) * ab[0]
    out[..., 3] *= np.clip(0.5 + np.sign(s_ref) * side, 0, 1)
    return out


def compose(layers, look, photo, ref, needles_minis):
    L = []
    for e, img in state_layers(layers, look, photo):
        if "clip" in e:
            mini = e["clip"]["by"].split("_")[0]
            img = clip_fill(e, img, needles_minis[mini], mini)
        L.append(dict(rgba=img, x=e["x"], y=e["y"], scale=e["scale"], composite=e["composite"]))
        if e["z"] == 0:          # the map's stand-in goes right above the background (z 10)
            x0, y0, x1, y1 = [int(v) for v in lib.overlay_elements()["map.region"]["bbox"]]
            sub = ref[y0:y1, x0:x1].reshape(-1, 3)
            m = np.median(sub, 0)
            stand = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
            stand[..., :3] = m
            stand[..., 3] = 1
            L.append(dict(rgba=stand, x=x0, y=y0))
    return lib.compose(L)


def rois(geo):
    H, W = lib.H, lib.W
    R = {}
    for dial in ("speedo", "tacho"):
        D = model.Dial(geo, dial)
        x0, y0, x1, y1 = D.box
        band = (((D.inside > 0.5) | (D.distF < 10)) & (D.wing < 0.5) & (D.dB > -3) & (D.dB < 75) & (D.Y < 655))
        face = cv2.dilate((D.wing > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        for name, m in (("%s frame+band" % dial, band), ("%s face" % dial, face)):
            full = np.zeros((H, W), bool)
            full[y0:y1, x0:x1] = m
            R[name] = full
    els = lib.overlay_elements()

    def bbox(k, pad=4):
        m = np.zeros((H, W), bool)
        x0, y0, x1, y1 = els[k]["bbox"]
        m[max(0, int(y0) - pad):int(y1) + pad, max(0, int(x0) - pad):int(x1) + pad] = True
        return m
    R["rev band"] = bbox("structure.rev_band")
    R["info lines"] = np.zeros((H, W), bool)
    R["info lines"][405:424, 362:702] = True
    R["info lines"][405:424, 1217:1557] = True
    dials = R["speedo frame+band"] | R["tacho frame+band"]
    R["fuel mini"] = bbox("structure.fuel_mini") & ~dials
    R["oil mini"] = bbox("structure.oil_mini") & ~dials
    bl = np.zeros((H, W), bool)
    bl[637:657, 300:700] = True
    bl[637:657, 1219:1620] = True
    bl[600:657, 695:762] = True
    bl[600:657, 1157:1224] = True
    R["bottom lines"] = bl
    return R


def masks(photo, im, ours):
    m = fs.element_mask(pad=4)                 # every non-structure element (C's, D's map) by bbox
    z, corridor = fs.zone_mask(photo, im)
    m |= corridor
    J = lib.read_json(os.path.join(lib.PARAMS, "minis.json"))
    nd = J["needles_08" if photo == "08" else "needles_09"]
    if photo == "14":
        nd = {k: J["needles_09"][k] for k in nd}          # 14: idle-like, measured below
        import minis
        nd = {"fuel": minis.needle_line(im, "fuel"), "oil": minis.needle_line(im, "oil")}
    m = m.astype(np.uint8)
    for k, seg in nd.items():
        if seg is not None:
            a, b = seg
            cv2.line(m, tuple(int(v) for v in a), tuple(int(v) for v in b), 1, 14)
    m = m.astype(bool)
    m |= fs.glare_mask(photo)
    if photo == "14":
        for x0, y0, x1, y1 in OURS_14:
            m[y0:y1, x0:x1] = True
        lr, lo = im.mean(2), ours.mean(2)
        auto = (lr > 0.55) & (lo < 0.35)
        m |= cv2.dilate(auto.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        m |= fs.element_mask(ids=("overlay.black_box",), pad=6)
    return m, z, nd


def run(layers, out_dir=None):
    out_dir = out_dir or lib.SCRATCH
    geo = model.geometry()
    R = rois(geo)
    table = {}
    for photo, st in PHOTOS.items():
        ref = lib.load_rect(photo)
        looks = [st["look"]] + (["night"] if photo == "14" else [])
        for look in looks:
            J = lib.read_json(os.path.join(lib.PARAMS, "minis.json"))
            nd0 = J["needles_08" if photo == "08" else "needles_09"]
            if photo == "14":
                import minis
                nd0 = {"fuel": minis.needle_line(ref, "fuel"), "oil": minis.needle_line(ref, "oil")}
            ours = compose(layers, look, photo, ref, nd0)
            bad, zone, _ = masks(photo, ref, ours)
            # background ROI: the fit's background pixels
            bgv = ~(fs.structure_regions(geo) | fs.element_mask() | fs.crisp_mask(ref) | fs.element_mask(ids=("map.region",), pad=12))
            mapr = fs.element_mask(ids=("map.region",), pad=2)
            rr = dict(R)
            rr["background"] = bgv
            key = "%s/%s" % (photo, look)
            table[key] = {}
            cv2.imwrite(os.path.join(out_dir, "qc_full_%s_%s.png" % (photo, look)),
                        (np.vstack([ref, np.clip(ours, 0, 1)]) * 255).astype(np.uint8)[..., ::-1])
            for name, roi in rr.items():
                v_all = roi & ~bad & ~mapr
                v_zone = v_all & ~zone
                row = {}
                for tag, v in (("masked", v_zone), ("unmasked", v_all)):
                    if v.sum() < 50:
                        continue
                    ys, xs = np.nonzero(v)
                    sl = (slice(max(0, ys.min() - 10), ys.max() + 11), slice(max(0, xs.min() - 10), xs.max() + 11))
                    m = Q.metrics(ref[sl].astype(np.float64), ours[sl].astype(np.float64), v[sl], want_edges=False)
                    row[tag] = {"ssim": m["ssim"], "dE": m["dE2000_mean"], "dE95": m["dE2000_p95"],
                                "bias": m["luma_bias"], "px": m["valid_px"]}
                    if tag == "masked" and name != "background":
                        Q.review_sheet(ref[sl].astype(np.float64), ours[sl].astype(np.float64), v[sl], m,
                                       os.path.join(out_dir, "qc_%s_%s_%s.png" % (photo, look, name.replace(" ", "_").replace("+", "_"))),
                                       title="%s %s look=%s  %s (pointer zone masked)" % ("B structure", photo, look, name))
                table[key][name] = row
    lib.write_json(os.path.join(out_dir, "qc_table.json"), table)
    print_table(table)
    geo_chk = geometry_check(layers)
    lib.write_json(os.path.join(out_dir, "geometry_check.json"), geo_chk)
    for k, v in geo_chk.items():
        print("  geom %-28s ours %s g20 %s diff %s" % (k, v["ours"], v["g20"], v["diff"]))
    return table


def geometry_check(layers, look="night"):
    """bbox (alpha >= 0.5, panel px, exclusive right/bottom) of our rendered elements vs g20_comfort.json."""
    els = lib.overlay_elements()
    groups = {"structure.speedo": ["structure.speedo.frame", "structure.speedo_numerals", "structure.speedo_scale_label"],
              "structure.tacho": ["structure.tacho.frame", "structure.tacho_numerals"],
              "structure.rev_band": ["structure.rev_band"],
              "structure.speedo_info_line": ["structure.speedo_info_line"],
              "structure.tacho_info_line": ["structure.tacho_info_line"],
              "structure.fuel_mini": ["structure.fuel_mini.fill", "structure.fuel_mini"],
              "structure.oil_mini": ["structure.oil_mini.fill", "structure.oil_mini"]}
    out = {}
    for el, ids in groups.items():
        m = np.zeros((lib.H, lib.W), bool)
        for e, img, _ in layers[look]:
            base = e["id"].rsplit(".", 1)[0]
            if base in ids:
                ys, xs = np.nonzero(img[..., 3] >= 0.5)
                m[e["y"] + ys, e["x"] + xs] = True
        ys, xs = np.nonzero(m)
        ours = [int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)]
        ref = [int(round(v)) for v in els[el]["bbox"]]
        out[el] = {"ours": ours, "g20": ref, "diff": [o - r for o, r in zip(ours, ref)]}
    return out


def print_table(table):
    for key, rows in table.items():
        print("==", key)
        for name, row in rows.items():
            s = "  %-18s" % name
            for tag in ("masked", "unmasked"):
                if tag in row:
                    r = row[tag]
                    s += "  %s SSIM %.3f dE %5.2f bias %+5.1f (%d px)" % (tag[0], r["ssim"], r["dE"], r["bias"], r["px"])
            print(s)
