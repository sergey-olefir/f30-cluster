"""QC of the assembled G20 bench simulation (brief section 6): the bench's own screenshots of the simulation in the
states of photos 08, 09 and 14 (tools/g20sim/qc_shots.sh qc) against the rectified photos, per element group:
SSIM on luminance and mean CIEDE2000 (bake/src/qc.py metrics), with review sheets in bake/work/g20sim/E/qc/.

  UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project \
      --with opencv-python-headless --with numpy --with pillow --with scipy python tools/g20sim/qc.py

ROIs and masks reuse package B's (bake/src/G20/structure/qc_struct.py): the structure ROIs, the glare boxes, our
0.7.2 texts in 14. Unlike B's own QC, the pointer zones are NOT masked here: D's pointers and glow are drawn. Every
other package's element is masked out of a group it does not belong to. The map ROI compares a synthetic map with
BMW's real one, so it measures the background and contrast only.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(WT, "bake", "src"))
sys.path.insert(0, os.path.join(WT, "bake", "src", "G20", "structure"))
import lib            # noqa: E402  (package B's helpers: rect loading, the catalogue)
import model          # noqa: E402
import fit_soft as fs  # noqa: E402
import qc_struct as QS  # noqa: E402
import qc as Q        # noqa: E402  (bake/src/qc.py)

E = os.path.join(WT, "bake", "work", "g20sim", "E")
OUT = os.path.join(E, "qc")

# what each photo shows of package C's elements (lit lamps, texts present in that state)
SHOWN = {
    "08": ["tt.brake", "tt.tpms", "tt.abs", "tt.dsc", "tt.auto_h", "tt.parking_brake", "tt.steering",
           "bottom.range", "bottom.clock", "bottom.belt_rear", "bottom.belt_driver", "bottom.airbag", "bottom.cc_info",
           "bottom.temperature", "assist.speed_limit", "assist.cc_panel", "assist.info_tacho",
           "assist.mode_label_centre", "assist.gear_centre", "assist.digital_speed", "assist.rpm_label", "assist.off",
           "map.position_arrow"],
    "09": ["tt.auto_h", "tt.parking_brake", "bottom.range", "bottom.clock", "bottom.street", "bottom.temperature",
           "assist.speed_limit", "assist.mode_label_centre", "assist.gear_centre", "assist.digital_speed",
           "assist.rpm_label", "map.position_arrow"],
    "14": ["tt.auto_h", "tt.parking_brake", "bottom.range", "bottom.clock", "bottom.belt_driver", "bottom.street",
           "bottom.temperature", "assist.speed_limit", "assist.mode_label", "assist.gear", "assist.digital_speed",
           "assist.rpm_label", "assist.cold", "map.position_arrow", "overlay.black_box"],
}
GROUP_OF = {"telltale": "C telltales", "bottom-row": "C bottom row", "assist-message": "C assist/message",
            "overlay": "black box (over)"}
SHOTS = [("08", "night", "qc_08.png"), ("09", "day", "qc_09.png"), ("14", "day", "qc_14_day.png"),
         ("14", "night", "qc_14_night.png")]


def load(path):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if bgr is None or bgr.shape[:2] != (720, 1920):
        raise SystemExit("no 1920x720 screenshot " + path)
    return bgr[..., ::-1].astype(np.float32) / 255.0


def bbox_mask(e, pad=3):
    m = np.zeros((lib.H, lib.W), bool)
    x0, y0, x1, y1 = e["bbox"]
    m[max(0, int(y0) - pad):int(y1) + pad, max(0, int(x0) - pad):int(x1) + pad] = True
    return m


def measure(ref, ours, v, name, tag):
    if v.sum() < 50:
        return None
    ys, xs = np.nonzero(v)
    sl = (slice(max(0, ys.min() - 10), ys.max() + 11), slice(max(0, xs.min() - 10), xs.max() + 11))
    m = Q.metrics(ref[sl].astype(np.float64), ours[sl].astype(np.float64), v[sl], want_edges=False)
    Q.review_sheet(ref[sl].astype(np.float64), ours[sl].astype(np.float64), v[sl], m,
                   os.path.join(OUT, "qc_%s_%s.png" % (tag, name.replace(" ", "_").replace("/", "_").replace("+", "_"))),
                   title="G20 sim %s  %s" % (tag, name))
    return {"ssim": m["ssim"], "dE": m["dE2000_mean"], "bias": m["luma_bias"], "px": m["valid_px"]}


def main():
    os.makedirs(OUT, exist_ok=True)
    els = lib.overlay_elements()
    geo = model.geometry()
    R = QS.rois(geo)
    table = {}
    for photo, look, shot in SHOTS:
        ref = lib.load_rect(photo)
        ours = load(os.path.join(E, shot))
        tag = "%s_%s" % (photo, look)
        # masks: glare, our texts in 14 (B's boxes + bright-in-14-dark-in-ours), never the pointer zones
        bad = fs.glare_mask(photo)
        if photo == "14":
            for x0, y0, x1, y1 in QS.OURS_14:
                bad[y0:y1, x0:x1] = True
            auto = (ref.mean(2) > 0.55) & (ours.mean(2) < 0.35)
            bad |= cv2.dilate(auto.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        cel = np.zeros((lib.H, lib.W), bool)            # every C element / the map, padded
        for e in els.values():
            if e["group"] in ("telltale", "bottom-row", "assist-message", "overlay", "map-nav"):
                cel |= bbox_mask(e, 4)
        mapr = fs.element_mask(ids=("map.region",), pad=2)
        rows = {}
        # B (with D's pointers, glow, band and mini needles drawn over it)
        for name, roi in R.items():
            r = measure(ref, ours, roi & ~bad & ~cel & ~mapr, "B " + name, tag)
            if r:
                rows["B " + name] = r
        bg = ~(fs.structure_regions(geo) | cel | fs.crisp_mask(ref) | mapr) & ~bad
        r = measure(ref, ours, bg, "B background", tag)
        if r:
            rows["B background"] = r
        # D: the pointer zones (glow + bar, as B's fit masked them) and the map
        zone, corridor = fs.zone_mask(photo, ref)
        r = measure(ref, ours, (zone | corridor) & ~bad & ~cel, "D pointer zones", tag)
        if r:
            rows["D pointer zones"] = r
        mp = fs.element_mask(ids=("map.region",), pad=0) & ~bad & ~(cel & ~mapr)
        r = measure(ref, ours, mp, "D map region (synthetic)", tag)
        if r:
            rows["D map region (synthetic)"] = r
        # C per group, each element on its own box, only elements present in that photo
        per = {}
        for k in SHOWN[photo]:
            e = els[k]
            g = GROUP_OF.get(e["group"])
            if not g:
                continue
            v = bbox_mask(e, 3) & ~bad
            r = measure(ref, ours, v, "%s %s" % (g, k), tag)
            if r:
                per.setdefault(g, []).append((k, r))
        for g, lst in per.items():
            n = sum(r["px"] for _, r in lst)
            rows[g] = {"ssim": round(sum(r["ssim"] * r["px"] for _, r in lst) / n, 4),
                       "dE": round(sum(r["dE"] * r["px"] for _, r in lst) / n, 3),
                       "bias": round(sum(r["bias"] * r["px"] for _, r in lst) / n, 2), "px": n,
                       "elements": {k: r for k, r in lst}}
        # the whole panel (everything, our texts and glare masked)
        r = measure(ref, ours, ~bad, "whole panel", tag)
        rows["whole panel"] = r
        table[tag] = rows
        cv2.imwrite(os.path.join(OUT, "ab_%s.png" % tag),
                    (np.vstack([ref, ours, np.clip(np.abs(ref - ours) * 2, 0, 1)]) * 255).astype(np.uint8)[..., ::-1])
    with open(os.path.join(OUT, "qc_table.json"), "w") as fh:
        json.dump(table, fh, indent=1, ensure_ascii=False)
    names = []
    for rows in table.values():
        for k in rows:
            if k not in names:
                names.append(k)
    print("| Group | " + " | ".join(table) + " |")
    print("|---|" + "---|" * len(table))
    for k in names:
        cells = []
        for t in table:
            r = table[t].get(k)
            cells.append("%.3f / %.1f" % (r["ssim"], r["dE"]) if r else "-")
        print("| %s | %s |" % (k, " | ".join(cells)))


if __name__ == "__main__":
    main()
