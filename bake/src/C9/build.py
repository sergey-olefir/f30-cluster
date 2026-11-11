"""P8 / C9: documentation-only cluster (housing and glass) + the map of BMW's overlays on the G20.
Nothing is shipped: every entry has file null.

    cd bake/src && $PY -m C9.build        (align08 -> overlays -> housing -> bake/manifest/C9.json)
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
sys.path.insert(0, SRC)
from C9 import overlays, housing  # noqa: E402

G20_SRC = ["08_stock_night_warnings-map.jpg", "09_stock_map_day.jpg", "10_grid_over-stock.jpg", "11_our-theme_on-car.jpg"]


def box_entry(id_, z, b, sources, evidence, params, kind="mask", cls="dynamic"):
    x0, y0, x1, y1 = b
    return {"id": id_, "cluster": "C9", "z": z, "kind": kind, "class": cls, "frame": "panel",
            "x": round(x0, 1), "y": round(y0, 1), "w": round(x1 - x0, 1), "h": round(y1 - y0, 1), "scale": 1.0,
            "file": None, "bytes_by_8wh": 0, "sources": sources, "evidence": evidence, "params": params}


def union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def run():
    ov = overlays.run()
    ho = housing.run()
    vis = ov["visible_js"]
    L = []
    # ---------------------------------------------------------------------------------------- housing and glass
    dials = {d["ref"]: d for d in ho["dials"]}
    cres = {k.split(".")[0][:2] + "." + k.split(".")[-1]: {"peak_cw12": v["crescent_peak_cw12"], "span_deg": v["crescent_span_deg"],
            "ridge_L_base_p10": v["ridge_L_min_p10"], "ridge_L_max": v["ridge_L_max"], "ridge_r_R": v["ridge_r_median"],
            "fwhm_R_at_peak": v["ridge_fwhm_at_peak_R"], "quality": v["quality"]} for k, v in dials.items()}
    L.append({"id": "housing.bezel-crescent", "cluster": "C9", "z": 11.5, "kind": "highlight", "class": "dynamic", "frame": "dial",
              "x": -1.0, "y": -1.0, "w": 2.0, "h": 2.0, "scale": 1.0, "file": None, "bytes_by_8wh": 0,
              "sources": ["17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png", "04_comfort_whole-cluster_mph.png",
                          "03_three-modes_photo_bimmerstop.png", "06_comfort_wide_with-wheel.png", "02_three-modes_clean-render.png"],
              "evidence": "ok", "light": {"dir_deg": 0.0, "key": 0.0},
              "params": {"notes": "DOCUMENTATION ONLY, NOT SHIPPED. A brighter arc on the bezel ridge (r 0.985-0.99 R, FWHM ~0.985-1.0 R = 4-6 px at R 335). "
                                  "Its angle is different in every photo (17/07: on the window side, C1 74-90 cw12, C2 272; 04/03: lower left 202-220 / C2 142; "
                                  "06: 28 / 132; 02 render: C1 338 / C2 272) and the two dials of one photo mirror each other: a specular reflection of the "
                                  "room in the glass, not a drawn feature. If a static gloss is wanted, take it from the C1/C2 bezel layer (z 11), not from here.",
                         "ridge_r_R": [0.985, 0.99], "per_ref": cres}})
    zones = ho["panel_zones"]
    L.append({"id": "housing.glass-reflection", "cluster": "C9", "z": 12, "kind": "highlight", "class": "dynamic", "frame": "panel",
              "x": 0, "y": 0, "w": 1920, "h": 720, "scale": 1.0, "file": None, "bytes_by_8wh": 0,
              "sources": ["17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png", "03_three-modes_photo_bimmerstop.png", "04_comfort_whole-cluster_mph.png"],
              "evidence": "weak",
              "params": {"notes": "DOCUMENTATION ONLY, NOT SHIPPED. Veiling glare and room reflections in the cover glass, outside the dials "
                                  "(luma, normalised PANEL crops, each photo's own dial circles masked): 17 lifts the whole surround to a warm grey "
                                  "L 45-47 (p95 83-87; rgb ~32,30,27 in its darker half), 03 lifts the sides and bottom to L 27-36 (daylight on the "
                                  "housing), 04 has a top-band p95 of 19 (the hood above), 06 L 8-11 everywhere, 07 and 02 stay at 0-2. No shape "
                                  "repeats across photos; it depends on the room and the camera, so it is not baked.", "zones_L": zones}})
    L.append({"id": "housing.black-surround", "cluster": "C9", "z": 0.1, "kind": "albedo", "class": "procedural", "frame": "panel",
              "x": 0, "y": 0, "w": 1920, "h": 720, "scale": 1.0, "file": None, "bytes_by_8wh": 0,
              "sources": ["02_three-modes_clean-render.png", "04_comfort_whole-cluster_mph.png", "03_three-modes_photo_bimmerstop.png", "17_physical-cluster_full.png"],
              "evidence": "ok",
              "params": {"notes": "The drawn surround outside the dials is black: far-field median rgb 0,0,0 (02), 0,1-2,3 (04), 3-5 (03, flare). "
                                  "It IS the C10 base colour (bake/manifest/C10.json); the physical housing beyond the TFT (glossy black plastic, "
                                  "L 45-90 in the lit-room photos 17/07) is outside our 1920x720 panel and is not drawn. On the G20 the hood "
                                  "(shared/visible.js HOOD) hides the top instead.", "rgb_255": "see C10 base_rgb_255"}})
    # ---------------------------------------------------------------------------------------- BMW overlays on the G20
    bb = ov["black_box"]
    L.append(box_entry("bmw.black-area", 100, bb["adopted"], G20_SRC[2:], "strong",
                       {"notes": "BMW's opaque black rectangle over the rev dial whenever a custom theme runs (empty; it sits where the stock theme draws "
                                 "its big gear letter, 08/09 x 1491-1546 y 324-400). Drawn ABOVE our layers (it cuts our grid lines in 10).",
                        "measured": bb, "visible_js": vis["BLACK_BOX"], "delta_px_x0y0x1y1": ov["discrepancy_px"]["BLACK_BOX"],
                        "R_units": ov["in_R_units"]["black_box"]}))
    gl = ov["gear_letter"]
    L.append(box_entry("bmw.gear-letter", 101, gl["adopted"], G20_SRC[2:], "strong",
                       {"notes": "BMW's own gear letter in the bottom row at the foot of the rev dial, always drawn over a custom theme (10, 11). "
                                 "Measured glyph box of 'P' (white, ~33 px tall). R/N/D/S/M are wider: keep a margin (visible.js has ~6 px).",
                        "measured": gl, "visible_js": vis["GEAR_P"], "delta_px_x0y0x1y1": ov["discrepancy_px"]["GEAR_P"],
                        "R_units": ov["in_R_units"]["gear_letter"]}))
    bl = ov["belt_lamp"]
    L.append(box_entry("bmw.belt-lamp", 102, bl["adopted"], G20_SRC, "strong",
                       {"notes": "Driver's seat-belt telltale (red), drawn over our theme (11) and over our grid (10).",
                        "measured": bl, "visible_js": vis["BELT"], "delta_px_x0y0x1y1": ov["discrepancy_px"]["BELT"],
                        "R_units": ov["in_R_units"]["belt_lamp"]}))
    tl = ov["telltales"]
    L.append(box_entry("bmw.telltales-left", 103, union([t["x0y0x1y1"] for t in tl["08_left"]]), G20_SRC[:2], "weak",
                       {"notes": "Stock left lamp column (08, night with warnings): brake (red), tyre pressure, ABS, DSC (amber). Position strong "
                                 "(08 rect 1.8 px); whether BMW draws them over a CUSTOM theme is not observed (weak). The green light lamps further "
                                 "left are physical LEDs outside the panel.", "lamps": tl["08_left"]}))
    L.append(box_entry("bmw.telltales-right", 104, union([t["x0y0x1y1"] for t in tl["08_right"]]), G20_SRC[:3], "weak",
                       {"notes": "Stock right column: AUTO H (green text), parking brake (P) (green in 09, amber in 08), steering warning (amber). "
                                 "AUTO H overlaps our rev-dial bezel by ~14 px if it is drawn over a custom theme (not observed: weak).",
                        "lamps": tl["08_right"], "lamps_09": tl["09_right"]}))
    L.append(box_entry("bmw.telltales-bottom", 105, union(tl["08_bottom"]), G20_SRC[:1] + G20_SRC[2:], "ok",
                       {"notes": "Stock bottom-row lamp group (08): rear-seat belts x 503-579, driver belt 593-628, passenger belt + airbag 636-682. "
                                 "Only the driver belt is observed over our theme (11); the others probably behave the same (same BMW layer): ok.",
                        "lamps": tl["08_bottom"]}))
    br = ov["bottom_row"]
    L.append(box_entry("bmw.bottom-row", 106, union(br["08"] + br["09"]), G20_SRC[:2] + G20_SRC[3:], "ok",
                       {"notes": "Stock bottom row text (range, clock, street / check-control, outside temperature). NOT drawn over a custom theme "
                                 "(11 shows only our own text there; in 10 our grid lines run over the temperature, i.e. it is under us). Only the "
                                 "gear letter and the lamps of this row come through.", "groups_08": br["08"], "groups_09": br["09"]}))
    if br.get("08_check_control_panel"):
        L.append(box_entry("bmw.check-control", 107, br["08_check_control_panel"], G20_SRC[:1], "weak",
                           {"notes": "Stock check-control message panel (08: 'ready to drive: press the brake'). Whether it pops up over a custom "
                                     "theme is not observed in 10/11: weak. Keep it in mind for the window bottom (C5/C6) area."}))
    L.append(box_entry("bmw.map", 108, ov["map"]["bbox_08_09"], G20_SRC[:2], "ok",
                       {"notes": "Stock navigation map between the dials (08 night, 09 day): convex hull of the map lines. Not drawn over a custom "
                                 "theme (11, 10 shows it UNDER our transparent grid). Listed so the window (C5) is not taken for map space.",
                        "hull": ov["map"]["hull_08_09"]}))
    man = {"cluster": "C9", "package": "P8", "mode": "all", "generator": "cd bake/src && $PY -m C9.build",
           "notes": "Documentation only; nothing shipped (every file is null). Report: docs/BAKE-C9-overlays.md, bake/report/C9.md. "
                    "Annotated maps: bake/work/C9/overlays_annotated.png (over photo 10, scratch) and overlays_schematic.png.",
           "layers": L, "composition": {"images": [], "layer_count": 0, "bytes_by_8wh_total": 0},
           "open_questions": [
               "shared/visible.js BLACK_BOX right edge is 1597; measured 1610.8 (+13.8 px). Proposal for the owner of shared/: [1420, 320, 1611, 440] (not edited: forbidden path).",
               "Are the stock telltales (left column, right column incl. AUTO H, rear belts / airbag) drawn over a custom theme? Only the driver belt is observed (11). A photo of a custom theme with warnings lit would settle it.",
               "Does the check-control panel (08: x 715-1240, y 601-690) appear over a custom theme?",
               "P0's 08 rectification is degenerate (PANEL crop is a smear); C9 re-derived it from the 09 rect (482 SIFT inliers, 1.8 panel px).",
           ]}
    json.dump(man, open(os.path.join(ROOT, "bake", "manifest", "C9.json"), "w"), indent=1)
    print("C9.json:", len(L), "entries")


if __name__ == "__main__":
    run()
