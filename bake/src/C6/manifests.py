"""P4: write bake/manifest/C5.json and C6.json from the rendered layers, the QC results and the parameters."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GEN = ("cd bake/src && UV_CACHE_DIR=../work/.uvcache uv run -q --no-project --with opencv-python-headless "
       "--with numpy --with pillow python -m C6.build --all   (refs/fit once before: -m C5.refs; --with scipy -m C5.fit)")
S17, S04, S07, S02, S12 = ("17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png",
                           "07_physical-cluster_all-lamps-lit.png", "02_three-modes_clean-render.png",
                           "12_speedo_signs_overspeed-wedge.png")


def entry(id_, cl, z, kind, klass, L, sources, evidence, fit, params, below=(), above=()):
    e = {"id": id_, "cluster": cl, "z": z, "kind": kind, "class": klass, "frame": "panel",
         "x": L["x"], "y": L["y"], "w": L["w"], "h": L["h"], "scale": L["scale"], "file": L["file"],
         "bytes_by_8wh": L["bytes_by_8wh"], "stack_below": list(below), "stack_above": list(above),
         "sources": sources, "evidence": evidence, "light": {"dir_deg": 90, "key": 1.0}, "fit": fit, "params": params}
    return e


def write(c5, c6, q):
    P = json.load(open(os.path.join(ROOT, "bake", "src", "C5", "params.json")))
    win_params = {k: P[k] for k in P if k not in ("palette",)}
    win_params["palette_rgb_of_luma"] = P["palette"]
    win_params["notes"] = ("panel px, X = x - 960 (mirror-symmetric). Window outline: top y=top_y, top edge |X|<=top_half_w "
                           "(our box 720..1200), 45 deg chamfers continuing until they pass under the dials, clipped "
                           "outside r = dial_clip_R*R of both dials. Light model: the window is emissive (no key light).")
    L5 = [
        entry("window.base", "C5", 0, "albedo", "baked", c5["window.base"], [S17, S04, S07], "ok",
              q["stack17"] | {"parts": {k: q[k] for k in ("window.bg", "window.top", "window.sky", "window.floor")}},
              win_params, above=["window.horizon"]),
        entry("window.horizon", "C5", 1, "albedo", "baked", c5["window.horizon"], [S17, S04], "strong",
              q["window.horizon"], {k: P[k] for k in ("horizon_y", "horizon_w", "horizon_L", "lip_a", "lip_d", "lip_s")},
              below=["window.base"]),
    ]
    comp5 = {"images": [{"file": c5["window.base"]["file"], "from_ids": ["window.base"], "x": c5["window.base"]["x"],
                         "y": c5["window.base"]["y"], "w": 302, "h": 268, "scale": 0.5,
                         "bytes_by_8wh": c5["window.base"]["bytes_by_8wh"]},
                        {"file": c5["window.horizon"]["file"], "from_ids": ["window.horizon"],
                         "x": c5["window.horizon"]["x"], "y": c5["window.horizon"]["y"],
                         "w": c5["window.horizon"]["w"], "h": c5["window.horizon"]["h"], "scale": 1.0,
                         "bytes_by_8wh": c5["window.horizon"]["bytes_by_8wh"]}],
             "layer_count": 2,
             "bytes_by_8wh_total": c5["window.base"]["bytes_by_8wh"] + c5["window.horizon"]["bytes_by_8wh"]}
    m5 = {"cluster": "C5", "package": "P4", "mode": "comfort", "R": 335, "generator": GEN, "layers": L5,
          "composition": comp5,
          "open_questions": [
              "Window top corners: our box (top edge x 720..1200) is kept; the 45 deg chamfers then continue OUTSIDE the box "
              "(to x ~657 / 1263 at y ~150) until they pass under the dials, as in 04 (no vertical side visible). The 6WB "
              "itself puts the chamfer start 0.84 R from the dial centre, which would be x 694 / 1226 with our spacing.",
              "Levels: fitted to 17 (window bg luma ~55 top -> 45 at the horizon). P0 flags 17 as hazy on the dial faces, "
              "but its bottom bar reads luma 2-3 next to the bright floor, so the window levels look real; 04 / 07 are "
              "darker (bg ~25-30). Compare with the face level P1/P2 chose; window.base can be scaled as one image.",
              "17 top edge sits at y 76 (04: 79); the box's 79 is used.",
              "The floor's side walls continue a little below the front line into the bar's top corners in 17 (x ~690-720 / "
              "1200-1230, y 610-640); not drawn (weak, partly glare-masked).",
          ],
          "notes": "References stretched into our frame by C5.refs (x about 960 by k = our half gap / 6WB half gap: 17 1.123, "
                   "04 1.158, 07 1.074; y unchanged). Bits: 8 dials, 4 telltales, 16 bar text."}
    # C6
    bar_p = {k: P[k] for k in ("front_y", "bar_rgb", "bar_fade0", "bar_fade1", "line_rgb", "line_w", "line_glow",
                               "line_glow_d", "line_glow_s", "line_x0", "line_x1", "line_floor")}
    from C6.build import ARCS, SEG
    L6 = [
        entry("infobar.body", "C6", 0.5, "albedo", "baked", c6["infobar.body"], [S17, S03 := "03_three-modes_photo_bimmerstop.png"],
              "ok", q["infobar.body"], bar_p, below=["window.base"], above=["infobar.line"]),
        entry("infobar.line", "C6", 1.5, "albedo", "baked", c6["infobar.line"], [S17], "strong", q["infobar.line"], bar_p,
              below=["infobar.body"]),
    ]
    for name, A in ARCS.items():
        dial = "speedo" if A["dial"] == "C1" else "tacho"
        fits = {k: q[k] for k in q if k.startswith(name + ".full")}
        best = fits[f"{name}.full.17"]
        p = {"dial": A["dial"], "frame": "dial (R units, cw12 deg), concentric", "a0": A["a0"], "a1": A["a1"],
             "segments": A["n"] + 1, "pitch_deg": round((A["a1"] - A["a0"]) / A["n"], 4), "majors": A["majors"],
             "zones": A["zones"], "colours": A["colours"], "seg": SEG,
             "notes": "fill is dynamic: light minor segments with the zone's 'lit' colour up to the fill angle using the "
                      "segments mask (alpha = coverage); fit = full-fill preview (track + all minors lit) vs the photo"}
        srcs = [S17, S07, S12] if A["dial"] == "C1" else [S17, S07, S02]
        L6.append(entry(f"{dial}.{name}.track", "C6", 5.5, "albedo", "baked", c6[f"{name}.track"], srcs, "ok",
                        best | {"all": fits}, p, above=[f"{dial}.{name}.segments"]))
        L6.append(entry(f"{dial}.{name}.segments", "C6", 5.6, "mask", "baked", c6[f"{name}.segments"], srcs, "ok",
                        best, {"use": "coverage of the minor segments for the dynamic fill layer"},
                        below=[f"{dial}.{name}.track"]))
        L6.append({"id": f"{dial}.{name}.fill", "cluster": "C6", "z": 5.7, "kind": "albedo", "class": "dynamic", "frame": "dial",
                   "file": None, "bytes_by_8wh": 0, "sources": srcs, "evidence": "weak" if A["dial"] == "C1" else "ok",
                   "params": {"drive": "fuel range (km)" if A["dial"] == "C1" else "consumption l/100km (0..20, blue part = recuperation)",
                              "lit_colours": {z: v["lit"] for z, v in A["colours"].items() if isinstance(v, dict)},
                              "unlit_evidence": "weak: 17 / 07 show every segment lit; the unlit colour is our choice (12 shows dim segments in its orange variant)"}})
    ids = {k: (("speedo." if k.startswith("range") else "tacho.") + k if "arc" in k else k) for k in c6}
    imgs = [{"file": c6[k]["file"], "from_ids": [ids[k]], "x": c6[k]["x"], "y": c6[k]["y"], "w": c6[k]["w"], "h": c6[k]["h"],
             "scale": c6[k]["scale"], "bytes_by_8wh": c6[k]["bytes_by_8wh"]} for k in c6]
    comp6 = {"images": imgs, "layer_count": len(imgs), "bytes_by_8wh_total": sum(i["bytes_by_8wh"] for i in imgs)}
    m6 = {"cluster": "C6", "package": "P4", "mode": "comfort", "R": 335, "generator": GEN, "layers": L6, "composition": comp6,
          "open_questions": [
              "BMW's gear letter (x 1392-1428, y 664-706) covers the ED arc around its '0' major (196.5 deg -> x ~1412-1430, "
              "y ~650-672): the 0 tick and 1-2 blue segments are hidden on the G20. Shift the ED arc or accept.",
              "Arc centres: in 17 both arcs look shifted ~0.03-0.05 R toward the window (parallax / rectification at the dial "
              "bottoms); 07 C1 is concentric within 0.011 R. Drawn concentric.",
              "Range arc: 17 has long ticks at the ends + 180 and brighter quarter ticks; 07 has long quarter ticks. 17 used.",
              "Unlit segment colours are not visible in 17 / 07 (all lit): weak.",
              "The range arc's 0-250 numerals, 'km', 'l/100km', 'EfficientDynamics', the battery icon and the bar's texts / "
              "fuel pump / warning triangle are live text or C7 icons: not baked.",
              "Merge proposal: the two arcs' track + segments could be one RGBA data texture each (R = minor coverage, "
              "G = major coverage, B = zone) sampled by the fill shader, halving their memory.",
          ]}
    for name, m in (("C5", m5), ("C6", m6)):
        json.dump(m, open(os.path.join(ROOT, "bake", "manifest", f"{name}.json"), "w"), indent=1)
    print("manifests written", comp5["bytes_by_8wh_total"], comp6["bytes_by_8wh_total"])
