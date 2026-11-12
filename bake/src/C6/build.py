"""P4 / C6: the bottom info bar (static shapes) and the two bottom arcs, rendered into apps/f30_cluster/hud/baked/C6/.

    cd bake/src && $PY -m C6.build            # C6 only
    cd bake/src && $PY -m C6.build --all      # C5.build + C6.build + QC + manifests (the one regenerate command)

Bar: body (black, @0.5x) and the lit top line (= the floor's front edge, 1x), from C5/params.json, in final panel
values (P10.apply leaves C5 / C6 alone: identity curve). Fixed boxes: C5.build.FIXED.
Arcs (in the dial frame of C1 / C2, cw12 degrees, R units, concentric with the dial, z 5.5):
  range arc under the speedo  : 41 segments, 144.0 .. 216.0 deg; long majors at the ends and 180, medium at the
                                quarters. Track = majors white + minors in the UNLIT colour; mask = minor coverage
                                (a dynamic layer lights minors up to the fill angle in the lit colour).
  ED arc under the tach       : 0 at 196.5, 10 at 169.9, 20 at 143.3 (26.6 deg per 10 l/100km, 14 segments per 10),
                                9 blue segments left of 0 (to 213.6); majors at 0 / 10 / 20 white, 5 / 15 medium.
Numerals, "km", "l/100km", "EfficientDynamics" and the battery icon are live text / C7 icons: not baked.
"""
import json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import imageio  # noqa: E402
from C5 import model, build as c5build  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
R = 335.0
DIAL = {"C1": (412.0, 380.0), "C2": (1508.0, 380.0)}

SEG = {   # radii (R) and widths (px) of the segments, measured on 17 C1 / C2 and 07 C1 (blur-corrected by eye)
    "minor": {"r0": 0.855, "r1": 0.897, "w": 5.4},
    "mid": {"r0": 0.850, "r1": 0.900, "w": 5.6},
    "major": {"r0": 0.834, "r1": 0.905, "w": 5.6},
}
# Arc colours are FINAL panel values: P4's colours (range major 232/232/234, mid 215/214/216, unlit 58/58/62, lit
# 222/220/216; ED mid 214/210/212, red 96/62/68 / 214/128/136, blue 66/76/104 / 150/172/228) put once through P10's
# old C5/C6 'window-fit' curve (P10.levels.window_fit), which P10.apply used to apply to these files. P10's C5/C6
# curve is now the identity, so the mapped values live here and the shipped arcs are unchanged by the C5 redo.
ARCS = {
    "range-arc": {"dial": "C1", "a0": 144.0, "a1": 216.0, "n": 40,
                  "majors": {0: "major", 20: "major", 40: "major", 10: "mid", 30: "mid"},
                  "zones": [[0, 40, "white"]],
                  "colours": {"major": [229.9, 229.9, 231.9], "mid": [198.5, 197.6, 199.4],
                              "white": {"unlit": [16.1, 16.1, 17.7], "lit": [210.5, 208.6, 204.8]}}},
    "ed-arc": {"dial": "C2", "a0": 143.3, "a1": 213.6, "n": 37,
               # index 0 = 20 l/100km (143.3), index 28 = 0 (196.5), 29..37 the blue part left of 0
               "majors": {0: "major", 14: "major", 28: "major", 7: "mid", 21: "mid"},
               "zones": [[0, 28, "red"], [29, 37, "blue"]],
               "colours": {"major": [229.9, 229.9, 231.9], "mid": [194.2, 190.5, 192.4],
                           "red": {"unlit": [38.8, 22.5, 25.4], "lit": [114.5, 66.0, 70.5]},
                           "blue": {"unlit": [25.6, 30.6, 44.5], "lit": [84.0, 97.1, 130.5]}}},
}


def seg_cov(x, y, c, ang, s):
    a = math.radians(ang)
    tx, ty = math.sin(a), -math.cos(a)
    dx, dy = x - c[0], y - c[1]
    along = (dx * tx + dy * ty) / R
    across = np.abs(-dx * ty + dy * tx)
    return np.clip((s["w"] / 2 - across) + 0.5, 0, 1) * np.clip((np.minimum(along - s["r0"], s["r1"] - along)) * R + 0.5, 0, 1)


def arc_layers(name, A, ss=4, state="unlit"):
    c = DIAL[A["dial"]]
    rr = SEG["major"]["r1"] * R + 3
    ang = np.radians(np.linspace(A["a0"] - 2, A["a1"] + 2, 200))
    xs = np.r_[c[0] + rr * np.sin(ang), c[0] + SEG["major"]["r0"] * R * np.sin(ang)]
    ys = np.r_[c[1] - rr * np.cos(ang), c[1] - SEG["major"]["r0"] * R * np.cos(ang)]
    box = [int(xs.min()) - 3, int(ys.min()) - 3, int(xs.max() - xs.min()) + 7, int(min(720, ys.max() + 4) - ys.min()) + 3]
    x, y = model.grid(box, 1.0, ss)
    pitch = (A["a1"] - A["a0"]) / A["n"]
    track_rgb = np.zeros(x.shape + (3,)); track_a = np.zeros(x.shape); mask_a = np.zeros(x.shape)
    zone_of = {}
    for z0, z1, zn in A["zones"]:
        for i in range(z0, z1 + 1):
            zone_of[i] = zn
    for i in range(A["n"] + 1):
        a = A["a0"] + i * pitch
        kind = A["majors"].get(i)
        if kind:
            cov = seg_cov(x, y, c, a, SEG[kind]); col = np.array(A["colours"][kind]) / 255.0
        else:
            cov = seg_cov(x, y, c, a, SEG["minor"]); col = np.array(A["colours"][zone_of[i]][state]) / 255.0
            mask_a = np.maximum(mask_a, cov)
        new = cov > track_a
        track_rgb[new] = col
        track_a = np.maximum(track_a, cov)
    track = np.concatenate([track_rgb, track_a[..., None]], -1).astype(np.float32)
    mask = np.concatenate([np.ones(x.shape + (3,)), mask_a[..., None]], -1).astype(np.float32)
    return model.premul_down(track, ss), model.premul_down(mask, ss), box


def write(rel, img, box, scale):
    img, pbox = c5build.tight(img, box, scale)
    imageio.write_png(os.path.join(BAKED, rel), img)
    h, w = img.shape[:2]
    return {"file": rel, "x": pbox[0], "y": pbox[1], "w": pbox[2], "h": pbox[3], "scale": scale,
            "file_w": w, "file_h": h, "bytes_by_8wh": imageio.bytes_by_8wh(w, h)}


def main():
    P = c5build.params()
    out = {}
    out["infobar.body"] = c5build.render("infobar.body.albedo", model.bar_body, None, 0.5, P, "C6")
    out["infobar.line"] = c5build.render("infobar.line.albedo", model.bar_line, None, 1.0, P, "C6")
    for name, A in ARCS.items():
        tr, mk, box = arc_layers(name, A)
        out[f"{name}.track"] = write(f"C6/{name}.track.albedo.png", tr, box, 1.0)
        out[f"{name}.segments"] = write(f"C6/{name}.segments.mask.png", mk, box, 1.0)
    json.dump(out, open(os.path.join(ROOT, "bake", "work", "C6", "layers.json"), "w"), indent=1)
    for k, v in out.items():
        print(k, v)
    return out


if __name__ == "__main__":
    if "--all" in sys.argv:
        c5build.main()
        main()
        from C6 import qcrun
        qcrun.main()
    else:
        main()
