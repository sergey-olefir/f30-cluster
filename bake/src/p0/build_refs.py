"""Merge the P0 alignment results into bake/manifest/refs.json (and print the quality table).

    cd bake/src && uv run ... python -m p0.build_refs
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
DBG = os.path.join(ROOT, "bake", "work", "p0")
OUT = os.path.join(ROOT, "bake", "manifest", "refs.json")

# visual checks of the fit overlays (bake/work/p0/fit_<stem>.png) done by eye during P0
VISUAL = {
    ("17_physical-cluster_full.png", "comfort"): "all four bezels sit on the fitted ellipses; C3/C4 rings partly hidden by the big dials but well fitted",
    ("04_comfort_whole-cluster_mph.png", "comfort"): "C1/C2 ellipses (ratio ~0.965, mild perspective) on the bezels all round; minis ok",
    ("07_physical-cluster_all-lamps-lit.png", "comfort"): "C1/C2 on the bezel; bezel ridge weak at the bottom (lit housing); C2 auto-rated poor only for ray count, visually ok",
    ("02_three-modes_clean-render.png", "comfort"): "on the bezels; roll -1.2 deg from the dial-centre line (render may be slightly rotated; floor check below)",
    ("05_comfort_tach-closeup.png", "comfort"): "bezel fitted all round except the cut bottom; roll from the inner-disc floor edge",
    ("12_speedo_signs_overspeed-wedge.png", "comfort"): "clean full bezel circle",
    ("13_ticks_closeup.png", "comfort"): "33 deg arc only; radius set from the minor-tick pitch (3.2 deg, measured on 05 and 17), roll from the 6000 rpm tick",
    ("14_inner-rings_closeup.png", "comfort"): "the 0.51 R disc edge arc only: scale assumes that edge is at 0.51 R (theme value, matches 17 within ~2%); roll unknown (0)",
    ("15_hub-needle_closeup.png", "comfort"): "hub ring circle only: scale assumes the ring at 0.135 R (theme value); rotation meaningless for a ring",
}

NAMING = {
    "pattern": "bake/work/rect/<image stem>.<mode>.<cluster>[@<k>x].<suffix>",
    "image stem": "reference file name without extension (e.g. 17_physical-cluster_full); 'ours_bench' for reference/ours/ref_comfort_bench_1920x720.png",
    "mode": "comfort | sport | eco (6WB mode panel of the image) | g20 (photos of the G20 panel, already in panel frame)",
    "cluster": "C1 speedo, C2 tacho, C3 fuel mini, C4 oil mini (box = centre +- 1.08 R, clipped to the panel); "
               "C5 window (box x 680-1240, y 39-708); PANEL full 1920x720. C6 (bottom arcs) lives inside the C1/C2 crops, "
               "the info bar inside C5.",
    "suffixes": {
        ".png": "RGB, rectified into panel px at 1x and exposure-normalised (see the section's exposure); pixels outside the photo are 0",
        ".raw.png": "same geometry, NOT exposure-normalised (6WB images only)",
        ".mask.png": "L8: 255 = usable, 0 = any mask bit set",
        ".maskbits.png": "L8 bit field: 1 outside the photo, 2 glare, 4 watermark / UI chrome, 8 occlusion (needle + its shadow corridor, wheel), 16 live text (numerals, captions; approximate)",
        ".json": "sidecar: image, mode, cluster, box [x, y, w, h] in panel px, A_photo_to_panel (2x3) or H_panel_to_photo (3x3), exposure, quality",
        "@<k>x": "close-ups only (13, 15, 17 C3): k x supersampled crop of the photo footprint; pixel (i, j) = panel (box.x + (i+0.5)/k, box.y + (j+0.5)/k)",
    },
    "frame": "Every crop pixel (i, j) is panel (box.x + i + 0.5, box.y + j + 0.5). Dial frame: (u, v) R units = ((x - cx)/R, (y - cy)/R), y down; angles cw12 = degrees clockwise from 12 o'clock.",
}


def circ_mean(dirs, w):
    x = sum(wi * math.cos(math.radians(d)) for d, wi in zip(dirs, w))
    y = sum(wi * math.sin(math.radians(d)) for d, wi in zip(dirs, w))
    return (math.degrees(math.atan2(y, x)) + 360) % 360, math.hypot(x, y) / max(sum(w), 1e-9)


def main():
    a6 = json.load(open(os.path.join(DBG, "align_6wb.json")))
    ag = json.load(open(os.path.join(DBG, "align_g20.json")))
    seeds = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "seeds.json")))["images"]
    table = []
    for fname, rec in a6.items():
        if seeds.get(fname, {}).get("skipped"):
            rec["skipped"] = seeds[fname]["skipped"]
        for mode, s in rec["sections"].items():
            s["visual_check"] = VISUAL.get((fname, mode))
            dirs, w = [], []
            for cl, d in s["dials"].items():
                if d.get("light") and cl in ("C1", "C2") and not d["partial"]:
                    dirs.append(d["light"]["dir_deg_math"])
                    w.append(min(d["light"]["rel_amplitude"], 2.0))
                table.append([fname, mode, cl, d["quality"], d["residual_rms_panel_px"], d["inlier_rays"],
                              d["ellipse_ratio"], d["panel_px_per_photo_px"], s["roll_deg"]])
            if dirs:
                m, coh = circ_mean(dirs, w)
                spread = max(abs(((x - m + 180) % 360) - 180) for x in dirs)
                s["apparent_light"] = {
                    "dir_deg_math": round(m, 1), "per_dial": dirs, "max_deviation_deg": round(spread, 1),
                    "confidence": "weak" if spread > 45 or max(w) < 0.2 else "ok",
                    "method": "first harmonic of the bezel ridge brightness vs angle (math deg: 0 right, 90 up, 135 upper left)",
                    "caveat": "the bezel gloss is drawn by the display, but photo glare and the lit housing also modulate it; treat as evidence, not truth"}
    refs = {
        "_doc": "P0 alignment of every reference to our panel frame (brief section 5). Produced by bake/src/p0/{align,g20,build_refs}.py. "
                "Per image -> sections (mode panels) -> dials: fitted photo ellipse, A_photo_to_panel (2x3, photo px -> panel px), "
                "residual (rms of the bezel ridge points about the ellipse, in PANEL px), quality, light, needle angle; "
                "per section: roll, exposure fit, outputs (rect crop bases).",
        "panel": {"w": 1920, "h": 720, "dials": geom.G20, "window": geom.WINDOW, "old_geometry": geom.OLD},
        "mapping_rule": "dial-to-dial: the photo dial's bezel OUTER edge (half-max outside the bright ridge) -> our R; the bezel "
                        "ridge therefore lands at ridge_radius_in_R (~0.99 R). Camera roll from the line through both dial "
                        "centres (else the inner-disc floor edge, else 0). Perspective handled per dial by the ellipse->circle "
                        "affine; the window (C5) / PANEL uses the mean of both dials' affines centred on the dial-pair midpoint.",
        "quality_rule": "good: rms <= 1.5 panel px, inliers in >= 7 of 8 octants, >= 150 rays; ok: rms <= 2.5, >= 5 octants, >= 40 rays; "
                        "poor: otherwise; partial: close-up fitted on an arc / an inner feature (scale rests on an assumption, see visual_check).",
        "naming": NAMING,
        "masks": {"glare": "auto: saturated blobs thicker than 2.5% of the dial radius (+ hand polygons in seeds.json)",
                  "watermark": "hand polygons in seeds.json (KIES logo in 04/05/06, BIMMERSTOP, the '<' button and carousel dots in 03)",
                  "occlusion": "needle corridor: from -0.42 R (tail) to 1.0 R, 0.12 R wide, at needle_cw12_deg (auto: red-ness ray for Comfort, overrides.json for Sport/Eco)",
                  "text": "auto: small bright top-hat blobs centred in 0.18-0.80 R (numerals, captions, READY/OFF, P) - approximate; bottom-arc labels are included, arc ticks beyond 0.80 R are not"},
        "measurements": {
            "rpm_minor_tick_pitch_deg": {"05": 3.2, "17": 3.2, "theme": 3.21, "note": "median spacing of minor ticks at 0.875 R"},
            "rpm_major_ticks_cw12_05": {"1k": 280.6, "2k": 312.9, "3k": 344.8, "4k": 17.8, "5k": 50.8, "6k": 82.4, "7k": 114.0,
                                        "theme": "RPM_START 250.5 + 32.1 k -> 282.6 .. 115.2: 6WB (05) sits ~1.3 deg earlier (roll uncertainty ~1 deg)"},
            "floor_edge_dy_R": "inner-disc floor edge below the centre: 17 C1 0.242, 17 C2 0.245, 05 0.257, 07 0.221/0.260, 03 0.254 (theme 0.26)",
        },
        "images": {},
    }
    for fname, rec in a6.items():
        refs["images"][fname] = rec
    for fname, rec in ag.items():
        refs["images"][fname] = rec
    refs["summary_table"] = {"columns": ["image", "mode", "cluster", "quality", "rms_panel_px", "inlier_rays", "ellipse_ratio",
                                         "panel_px_per_photo_px", "roll_deg"], "rows": table}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(refs, f, indent=1)
    for r in table:
        print("%-38s %-8s %-3s %-8s %5.2f %4d %.3f %.3f %6.2f" % tuple(r))


if __name__ == "__main__":
    main()
