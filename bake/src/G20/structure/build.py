"""Package B: the static bake of the stock G20 Comfort dials for the bench simulation.

  python build.py            render every layer from params/ -> bench/g20/structure/*.png + manifest.part.json,
                             then QC (if the git-ignored rects are on this machine)
  python build.py --measure  first re-measure everything on the rects (geometry, crisp line work, numerals,
                             minis, soft-layer tables for night=08 and day=09), then render and QC
  python build.py --no-qc    render only

Run from anywhere with the project's uv command (see docs/G20SIM-B-structure.md).
"""
import argparse
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import lib  # noqa: E402
import model  # noqa: E402
import render as R  # noqa: E402
import render_soft as rs  # noqa: E402
import minis  # noqa: E402
from common import imageio  # noqa: E402

LOOKS = ("night", "day")
LOOK_SRC = {"night": "08", "day": "09"}


def entry(id, element, file, x, y, z, kind, look, scale=1, composite="source-over", state="any", cond=None,
          evidence="strong", sources=None, notes="", **extra):
    e = {"id": id, "element": element, "file": "structure/" + file, "x": int(x), "y": int(y), "scale": scale,
         "z": z, "kind": kind, "layer": "under", "state": state, "look": look, "lamp": None, "lit": None,
         "composite": composite, "opacity": 1.0, "evidence": evidence, "sources": sources or [LOOK_SRC[look]],
         "notes": notes}
    if cond:
        e["cond"] = cond
    e.update(extra)
    return e


def build_layers(look):
    """-> list of (manifest entry, rgba image, dither)."""
    geo = model.geometry()
    C = R.P_crisp()
    P = rs.load_soft(look)
    src = LOOK_SRC[look]
    out = []
    bg = rs.bg_layer(P, scale=2)
    out.append((entry("structure.bg.%s" % look, "panel.background", "bg.%s.png" % look, 0, 0, 0, "albedo", look,
                      scale=2, evidence="strong",
                      notes="Opaque panel background: a smooth node-grid surface (40 px nodes, membrane-regularised) "
                            "fitted to the photo's background pixels outside every element; half resolution."),
                bg, True))
    v, vx, vy = rs.veil_layer(P, scale=2)
    out.append((entry("structure.map_veil.%s" % look, "map.region", "map_veil.%s.png" % look, vx, vy, 20, "albedo",
                      look, scale=2, evidence="weak",
                      notes="Semi-transparent dark veil over map.region where the dial faces overlap the map (left "
                            "and right ends). Alpha = 1 - road contrast(x) / plateau, fitted as two logistic ramps "
                            "%s. Only the roads' attenuation is in it; the map's own darker background fade at its "
                            "ends is NOT (D's map). Drop or tune it when calibrating with D's map."
                            % np.round(P["veil"], 2).tolist()), v, True))
    for dial in ("speedo", "tacho"):
        ly, D = rs.dial_layers(P, geo, dial)
        g, gx, gy = R.crop(*ly["glow"])
        out.append((entry("structure.%s.glow.%s" % (dial, look), "structure.%s" % dial, "%s.glow.%s.png" % (dial, look),
                          gx, gy, 22, "glow", look, composite="lighter", evidence="strong",
                          notes="Red-orange band glow between the band line and the frame, added over the background: "
                                "a profile table RGB(s along the band, distance from it) fitted to the photo minus "
                                "the background. Pointer-glow zone (distance < 100 px to the needle, y > 415) "
                                "masked and continued from the neighbours along the band (weak there)."), g, True))
        w, wx, wy = R.crop(*ly["wing"])
        out.append((entry("structure.%s.wing.%s" % (dial, look), "structure.%s" % dial, "%s.wing.%s.png" % (dial, look),
                          wx, wy, 24, "albedo", look, evidence="strong",
                          notes="Opaque grey 'wing' face between the band line and the inner edge E, with E's bevel. "
                                "Colour tables RGB(s, depth) along the band and along E. The lower part (y > 415) is "
                                "under the pointer glow in every photo: continued from above (weak)."), w, True))
        f, fx, fy, info = R.frame_layer(geo, C, dial, look)
        out.append((entry("structure.%s.frame.%s" % (dial, look), "structure.%s" % dial, "%s.frame.%s.png" % (dial, look),
                          fx, fy, 30, "albedo", look, evidence="strong",
                          notes="White scale frame (measured cross-profile, incl. its soft outer halo), the bottom "
                                "frame line, the end hooks and %d major + %d minor ticks (capsules from intensity "
                                "moments of each tick on 08 and 09; class sizes major %.1fx%.1f, minor %.1fx%.1f px)."
                                % (info["n"][0], info["n"][1], *info["major"], *info["minor"])), f, False))
        ce, cx, cy = R.curved_end_layer(geo, C, dial, look)
        out.append((entry("structure.%s.bottom_end.%s" % (dial, look), "structure.%s" % dial,
                          "%s.bottom_end.%s.png" % (dial, look), cx, cy, 31, "albedo", look, cond="no_cc_message",
                          evidence="medium", sources=["09", "14"],
                          notes="Curved end of the bottom frame line next to the check-control area (traced on 09). "
                                "Seen in 09 and 14 (no check-control message); in 08 the check-control panel sits "
                                "there and the end is not visible: draw it only while ccMessage is null."), ce, False))
        il, ix, iy = R.info_line_layer(C, dial, look)
        out.append((entry("structure.%s_info_line.%s" % (dial, look), "structure.%s_info_line" % dial,
                          "%s.info_line.%s.png" % (dial, look), ix, iy, 33, "albedo", look,
                          state="any" if dial == "speedo" else "stock",
                          evidence="strong" if dial == "speedo" else "medium",
                          sources=["08", "09", "14"] if dial == "speedo" else ["08", "09"],
                          notes="Two parallelogram segments (slanted cut ends) measured on 08/09; the second segment "
                                "(%s) is outside g20_comfort.json's bbox (re-measurement)."
                                % ("x 616-694" if dial == "speedo" else "x 1224-1302")
                                + ("" if dial == "speedo" else " Gone while a theme is connected (14).")), il, False))
    rb, rx, ry = R.rev_band_layer(C, look)
    out.append((entry("structure.rev_band.%s" % look, "structure.rev_band", "rev_band.%s.png" % look, rx, ry, 32,
                      "albedo", look, evidence="strong", sources=["08", "09", "14"],
                      notes="Four red segments under the tacho frame between 6 and 7 (edges fitted per column, "
                            "separators from the red profile's minima)."), rb, False))
    nums, N = R.numeral_layers(look)
    groups = {}
    for it, img, ax, ay in nums:
        if it["dial"] == "tacho" and it["text"] == "0":
            key = "tacho_zero"
        elif it["dial"] == "speedo" and it["text"] in ("0", "km/h"):
            key = "speedo_scale_label"
        else:
            key = "%s_numerals" % it["dial"]
        groups.setdefault(key, []).append((it, img, ax, ay))
    for key, items in groups.items():
        x0 = min(ax for _, _, ax, _ in items)
        y0 = min(ay for _, _, _, ay in items)
        x1 = max(ax + img.shape[1] for _, img, ax, _ in items)
        y1 = max(ay + img.shape[0] for _, img, _, ay in items)
        L = [dict(rgba=img, x=ax - x0, y=ay - y0) for _, img, ax, ay in items]
        acc = np.zeros((y1 - y0, x1 - x0, 4), np.float32)
        for l in L:
            h, w = l["rgba"].shape[:2]
            sl = acc[l["y"]:l["y"] + h, l["x"]:l["x"] + w]
            a = l["rgba"][..., 3:4]
            sl[..., :3] = l["rgba"][..., :3] * a + sl[..., :3] * (1 - a) if False else np.where(a > sl[..., 3:4], l["rgba"][..., :3], sl[..., :3])
            sl[..., 3:4] = np.maximum(sl[..., 3:4], a)
        dial = "speedo" if key.startswith("speedo") else "tacho"
        texts = " ".join(it["text"] for it, _, _, _ in items)
        extra = {}
        cond = "engine_on" if key == "tacho_zero" else None
        el = "structure.%s" % dial
        notes = ("Numerals '%s' in %s (package C's FONT.json) wght %d, stretched to each measured ink box "
                 "(width fitted per numeral), ink-box IoU %.2f-%.2f." % (texts, N["family"], N["fit"]["digits"]["wght"],
                 min(it["iou"] for it, _, _, _ in items), max(it["iou"] for it, _, _, _ in items)))
        if key == "tacho_zero":
            notes += " Shown only while the engine runs (09/14 show '0'; 08, engine off, shows C's 'OFF' there)."
        if key == "speedo_scale_label":
            notes += " The speedo's scale label '0 km/h' at the scale start."
        out.append((entry("structure.%s.%s" % (key, look), el, "%s.%s.png" % (key.replace("_", "."), look), x0, y0,
                          40, "font", look, cond=cond, evidence="strong",
                          sources=["09", "14"] if key == "tacho_zero" else ["08", "09", "14"], notes=notes), acc, False))
    for e, img, dither in minis.layers(look):
        out.append((e, img, dither))
    return out


def write_all(layers_by_look):
    os.makedirs(lib.OUT, exist_ok=True)
    for f in os.listdir(lib.OUT):
        if f.endswith(".png"):
            os.remove(os.path.join(lib.OUT, f))
    entries = []
    total = 0
    for look, layers in layers_by_look.items():
        for e, img, dither in layers:
            p = os.path.join(lib.WT, "bench", "g20", e["file"])
            imageio.write_png(p, img, dither=dither, seed=hash(e["id"]) & 0xffff)
            e["w"], e["h"] = int(img.shape[1]), int(img.shape[0])
            e["bytes"] = os.path.getsize(p)
            total += e["bytes"]
            entries.append(e)
    entries.sort(key=lambda e: (e["z"], e["id"]))
    man = {"package": "B", "about": "Static bake of the stock G20 Comfort dials (docs/G20SIM-B-structure.md). "
                                    "Regenerate: bake/src/G20/structure/build.py. x, y = panel px of the image's "
                                    "top-left; scale = panel px per image px. 'cond' (B's own flags): "
                                    "engine_on = draw only while rpm > 0; no_cc_message = draw only while "
                                    "ccMessage is null. 'clip' (minis' fills): the fill is drawn only on the "
                                    "empty-end side of the mini needle (see notes).",
           "entries": entries, "total_bytes": total}
    lib.write_json(os.path.join(lib.OUT, "manifest.part.json"), man)
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", action="store_true")
    ap.add_argument("--no-qc", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    have_photos = lib.load_rect("08") is not None
    if a.measure:
        if not have_photos:
            sys.exit("--measure needs the rects in %s" % lib.RECT)
        import measure_geom, measure_crisp, numerals, fit_soft  # noqa: E401
        geo, _ = measure_geom.measure()
        lib.write_json(os.path.join(lib.PARAMS, "geometry.json"), geo)
        measure_crisp.measure()
        numerals.fit()
        minis.measure()
        fit_soft.fit("08", "night")
        fit_soft.fit("09", "day")
        print("measured in %.1fs" % (time.time() - t0))
    layers = {look: build_layers(look) for look in LOOKS}
    man = write_all(layers)
    print("wrote %d files, %.2f MB, in %.1fs" % (len(man["entries"]), man["total_bytes"] / 1e6, time.time() - t0))
    if have_photos and not a.no_qc:
        import qc_struct
        qc_struct.run(layers)
        print("QC done in %.1fs" % (time.time() - t0))


if __name__ == "__main__":
    main()
