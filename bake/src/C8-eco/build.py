"""P7 / C8 Eco Pro: draw the Eco Pro parts from params.json, write the baked files, run QC, write the manifest.

    cd bake/src && $PY C8-eco/build.py          (fit first, if the references changed: $PY C8-eco/fit.py)

Our own drawing: analytic radial profiles (fitted by fit.py on the rectified 03 / 01 crops) swept over angle spans.
No reference pixel is copied. Outputs:
    apps/f30_cluster/hud/baked/C8-eco/*.png      the baked layers (straight alpha RGBA, dithered)
    bake/manifest/C8-eco.json                    the manifest (cluster C8, mode eco)
    bake/work/C8-eco/                            QC sheets, re-centred reference crops, previews
"""
import json
import math
import os
import shutil
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
sys.path.insert(0, SRC)
from common import geom, imageio  # noqa: E402
import qc  # noqa: E402

ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
OUT = os.path.join(BAKED, "C8-eco")
WORK = os.path.join(ROOT, "bake", "work", "C8-eco")
RECT = os.path.join(ROOT, "bake", "work", "rect")
MANIFEST = os.path.join(ROOT, "bake", "manifest", "C8-eco.json")
PRM = json.load(open(os.path.join(HERE, "params.json")))
SS = 4
S03, S01 = "03_three-modes_photo_bimmerstop.eco", "01_three-modes_small.eco"


# ------------------------------------------------------------------------------------------------- drawing
def smoothstep(a, b, x):
    t = np.clip((x - a) / max(b - a, 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def grid(box, cl, ss=SS):
    """Supersampled polar grid (r in R units, cw12 deg in -180..180) for a panel box [x, y, w, h]."""
    x0, y0, w, h = box
    g = geom.G20[cl]
    o = (np.arange(ss) + 0.5) / ss
    xs = (x0 + np.arange(w)[:, None] + o[None, :]).ravel()
    ys = (y0 + np.arange(h)[:, None] + o[None, :]).ravel()
    X, Y = np.meshgrid(xs, ys)
    u, v = (X - g["c"][0]) / g["R"], (Y - g["c"][1]) / g["R"]
    return np.hypot(u, v), np.degrees(np.arctan2(u, -v)), u, v


def down(a, ss=SS):
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3))


def in_span(ang, a0, a1):
    """cw12 angles: inside a0 .. a1 going clockwise (a1 may exceed 180 / 360)."""
    return ((ang - a0) % 360.0) <= ((a1 - a0) % 360.0 if (a1 - a0) % 360.0 else 360.0)


def profile(r, p):
    """Per-channel I_c(r) of fit.py's model -> (..., 3) linear-in-code-values intensity 0..1."""
    e, w = p["edge"], p["edge_w"]
    rp = e + w / 2
    rise = smoothstep(e - w / 2, e + w / 2, r)
    fade = 1 - smoothstep(p["fade"][0], p["fade"][1], r)
    out = []
    for P, tau, k in zip(p["P_rgb"], p["tau_rgb"], p.get("k_rgb", [1, 1, 1])):
        out.append(P * rise * np.exp(-(np.maximum(r - rp, 0) / tau) ** k) * fade)
    return np.stack(out, -1)


def to_rgba(I):
    """Emission over black -> straight-alpha RGBA with the same over-black result (alpha = max channel)."""
    I = np.clip(I, 0, 1)
    a = I.max(-1)
    rgb = np.where(a[..., None] > 1e-6, I / np.maximum(a[..., None], 1e-6), 0)
    return np.concatenate([rgb, a[..., None]], -1).astype(np.float32)


HAIR = {"pitch_deg": 5.0, "phase_deg": 0.0, "sd_deg": 0.35, "depth": 0.10, "r_full": 0.845, "r_zero": 0.875}


def hairlines(r, ang, h=HAIR):
    """Dark radial graduation lines across the band's inner half: 1 - depth * gauss(angle to nearest line)."""
    d = (ang - h["phase_deg"] + h["pitch_deg"] / 2) % h["pitch_deg"] - h["pitch_deg"] / 2
    w = 1 - smoothstep(h["r_full"], h["r_zero"], r)
    return 1 - h["depth"] * w * np.exp(-0.5 * (d / h["sd_deg"]) ** 2)


def arc_layer(box, cl, prof, a0, a1, end_aa_deg=0.25, hair=False):
    r, ang, _, _ = grid(box, cl)
    I = profile(r, prof)
    if hair:
        I = I * hairlines(r, ang)[..., None]
    # square ends, anti-aliased by the supersampling (plus a tiny ramp so the end is not stair-stepped)
    rel = (ang - a0) % 360.0
    span = (a1 - a0) % 360.0 or 360.0
    m = np.clip(rel / end_aa_deg + 0.5, 0, 1) * np.clip((span - rel) / end_aa_deg + 0.5, 0, 1) * (rel <= span + 1)
    return to_rgba(down(I * m[..., None]))


def glow_layer(box, cl, g):
    """A soft blue glow on the bezel's window side: gaussian in angle and in radius."""
    r, ang, _, _ = grid(box, cl, ss=1)
    da = (ang - g["centre_deg"] + 180) % 360 - 180
    k = np.exp(-0.5 * (da / g["sd_deg"]) ** 2) * np.exp(-0.5 * ((r - g["r"]) / g["sd_r"]) ** 2)
    out = np.zeros(r.shape + (4,), np.float32)
    out[..., :3] = np.array(g["colour"], np.float32)
    out[..., 3] = g["alpha"] * k
    return out


def marks_layer(box, cl, marks):
    """Crisp procedural marks (for previews and QC only; the theme draws them in the shader)."""
    r, ang, u, v = grid(box, cl)
    cov = np.zeros(r.shape, np.float32)
    col = np.zeros(r.shape + (3,), np.float32)
    for m in marks:
        t = math.radians(m["deg"])
        tx, ty = math.sin(t), -math.cos(t)
        along = u * tx + v * ty
        across = np.abs(-u * ty + v * tx)
        c = ((along >= m["r0"]) & (along <= m["r1"]) & (across <= m["hw"])).astype(np.float32) * m.get("a", 1.0)
        col = col * (1 - c[..., None]) + np.array(m["rgb"], np.float32) * c[..., None]
        cov = c + cov * (1 - c)
    rgba = np.concatenate([down(col * 1.0), down(cov)[..., None]], -1)
    a = rgba[..., 3:4]
    rgba[..., :3] = np.where(a > 1e-6, rgba[..., :3] / np.maximum(a, 1e-6), 0)
    return rgba


def ring_layer(box, cl, rr, fwhm, rgb, a0, a1):
    r, ang, _, _ = grid(box, cl)
    sd = fwhm / 2.3548
    I = np.exp(-0.5 * ((r - rr) / sd) ** 2)[..., None] * np.array(rgb)[None, None, :] * in_span(ang, a0, a1)[..., None]
    return to_rgba(down(I))


def ring_box(cl, r0, r1, a0, a1):
    """Box for a sector r0..r1 over a0..a1 (no centre point)."""
    g = geom.G20[cl]
    R = g["R"]
    span = (a1 - a0) % 360.0 or 360.0
    pts = []
    for rr in (r0, r1):
        for a in np.linspace(a0, a0 + span, 361):
            t = math.radians(a)
            pts.append((rr * math.sin(t), -rr * math.cos(t)))
    pts = np.array(pts)
    x0 = math.floor(g["c"][0] + pts[:, 0].min() * R) - 2
    y0 = math.floor(g["c"][1] + pts[:, 1].min() * R) - 2
    x1 = math.ceil(g["c"][0] + pts[:, 0].max() * R) + 2
    y1 = math.ceil(g["c"][1] + pts[:, 1].max() * R) + 2
    x0, y0 = x0 - x0 % 2, y0 - y0 % 2
    w, h = x1 - x0, y1 - y0
    return [max(0, x0), max(0, y0), w + w % 2, h + h % 2]


# ------------------------------------------------------------------------------------------------- QC helpers
FACE = {}      # stand-in flat face colour per reference (the Comfort face is P1 / P2's layer, not ours)


def run_qc(ref, layers, cl, name, rois, angle=None, edges=True, ignore_bits=31):
    base = FACE.get(os.path.basename(ref))
    if base is not None:
        bx = json.load(open(ref + ".json"))["box"]
        flat = np.zeros((bx[3], bx[2], 4), np.float32)
        flat[..., :3] = base
        flat[..., 3] = 1.0
        layers = [(flat, bx[0], bx[1], 1.0)] + list(layers)
    res = qc.run(ref, layers, cl, name, rois=rois, roi_angle=angle, ignore_bits=ignore_bits, want_edges=edges,
                 out_dir=WORK)
    f = dict(res["fit"])
    f = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in f.items()}
    f.update({"ref": res["ref"], "roi": res["roi"], "sheet": res.get("sheet")})
    f["valid_px"] = res["metrics"].get("valid_px")
    f["luma_bias"] = res["metrics"].get("luma_bias")
    f["banding"] = res["metrics"].get("banding", {}).get("plateau_fraction") if isinstance(res["metrics"].get("banding"), dict) else None
    return f


# ------------------------------------------------------------------------------------------------- main
def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    band, mk = PRM["band"], PRM["marks"]
    a_lo, a_hi = mk["end_lo"], mk["end_hi"]                     # -41.75 .. 129.75
    f_lo, f_hi = mk["zone_lo"], mk["zone_hi"]                   # -31.75 .. 89.5 (the fill in 03 / 01)
    ed = dict(PRM["ed_arc"])
    ed["span_deg_measured"] = ed["span_deg"]
    ed["span_deg"] = [a_lo, a_hi]          # same ends as the band (03 before rectification: -41.0 .. 129.5)
    sp = PRM["speedo_arc"]
    layers, files, arrays = [], {}, {}

    def save(name, img, box, scale):
        fn = f"C8-eco/{name}" + ("@0.5x" if scale == 0.5 else "") + ".png"
        out = imageio.half_res(img) if scale == 0.5 else img
        imageio.write_png(os.path.join(BAKED, fn), out)
        files[name] = (fn, box, scale)
        arrays[name] = (os.path.join(BAKED, fn), box[0], box[1], scale)
        return fn

    # 1. tacho CHARGE / POWER track (grey, the whole span) and the fill (blue; the shader clips it by angle)
    bx = ring_box("C2", 0.70, 0.935, a_lo, a_hi)
    save("tacho.eco-track.albedo", arc_layer(bx, "C2", band["track"], a_lo, a_hi, hair=True), bx, 0.5)
    save("tacho.eco-fill.albedo", arc_layer(bx, "C2", band["fill"], a_lo, a_hi, hair=True), bx, 0.5)
    fill_clip = arc_layer(bx, "C2", band["fill"], f_lo, f_hi, hair=True)  # what the shader shows at the 03 / 01 state (QC only)
    arrays["fill_clip"] = (fill_clip, bx[0], bx[1], 1.0)
    # 2. tacho EfficientDynamics arc (line + glow in one layer)
    bxe = ring_box("C2", 0.44, 0.64, ed["span_deg"][0], ed["span_deg"][1])
    ed_img = arc_layer(bxe, "C2", ed, ed["span_deg"][0], ed["span_deg"][1])
    save("tacho.ed-arc.glow", ed_img, bxe, 0.5)
    arrays["ed_1x"] = (ed_img, bxe[0], bxe[1], 1.0)
    # 2b. composition image: the track and the ED arc share one @0.5x image (the ED arc's box lies inside the band's)
    merged = arc_layer(bx, "C2", band["track"], a_lo, a_hi, hair=True)
    imageio.over(merged, ed_img, bxe[0] - bx[0], bxe[1] - bx[1])
    fn_m = "C8-eco/tacho.eco-static.albedo@0.5x.png"
    imageio.write_png(os.path.join(BAKED, fn_m), imageio.half_res(merged))
    arrays["merged"] = (os.path.join(BAKED, fn_m), bx[0], bx[1], 0.5)
    files["__merged"] = (fn_m, bx, 0.5)
    # 3. speedo Eco speed arc (the inner-disc edge lit blue), full speed sweep; clipped at the Eco speed (dynamic)
    s0, s1 = geom.SPD_START, geom.SPD_START + geom.SPD_SWEEP
    bxs = ring_box("C1", 0.42, 0.62, s0, s1)
    sp_full = arc_layer(bxs, "C1", sp, s0, s1)
    save("speedo.eco-arc.glow", sp_full, bxs, 0.5)
    eco_kmh = 130.0
    s_end = s0 + eco_kmh * geom.SPD_SWEEP / 260.0
    arrays["sp_clip"] = (arc_layer(bxs, "C1", sp, s0, s_end), bxs[0], bxs[1], 1.0)
    # 4. window-side bezel glows (03 numbers; colour = the blue excess hue, peak from 03)
    glows = {}
    for cl, nm in (("C2", "tacho"), ("C1", "speedo")):
        # a tint OF the shared bezel ridge (alpha-over a pale blue): solved on C2 in 03, where the Comfort photo has the
        # same ridge brightness at that angle; C1's Comfort ridge is dark there (reflection), so C1 reuses it mirrored
        g = dict(PRM["glow"][cl])
        c2 = PRM["glow"]["C2"]
        eco, com = np.array(c2["eco_ridge_rgb"]), np.array(c2["comfort_ridge_rgb"])
        a = float((eco[2] - com[2]) / (1.0 - com[2]))                 # blue channel of the tint = 1
        g["alpha"] = round(a, 3)
        g["colour"] = [round(float((eco[i] - (1 - a) * com[i]) / a), 3) for i in range(2)] + [1.0]
        g["r"], g["sd_r"] = 0.99, 0.0075                                # the ridge (P0 0.99 R; 03 Comfort FWHM 0.016 R)
        glows[cl] = g
        gb = ring_box(cl, g["r"] - 3 * g["sd_r"], g["r"] + 3 * g["sd_r"], g["centre_deg"] - 3 * g["sd_deg"], g["centre_deg"] + 3 * g["sd_deg"])
        save(f"{nm}.eco-glow.glow", glow_layer(gb, cl, g), gb, 0.5)
    # 5. procedural marks / ring (previews and QC only)
    W = (0.80, 0.81, 0.82)
    e0 = band["track"]["edge"]
    marks = [dict(deg=a_lo, r0=e0, r1=0.907, hw=0.006, rgb=W), dict(deg=f_lo, r0=e0, r1=0.907, hw=0.006, rgb=W),
             dict(deg=0.0, r0=e0, r1=0.907, hw=0.003, rgb=W, a=0.85), dict(deg=f_hi, r0=e0, r1=0.907, hw=0.006, rgb=W),
             dict(deg=a_hi, r0=e0, r1=0.907, hw=0.006, rgb=W), dict(deg=mk["off"], r0=0.815, r1=0.905, hw=0.006, rgb=(0.72, 0.72, 0.72))]
    bxm = ring_box("C2", 0.78, 0.92, -180, 180)
    arrays["marks"] = (marks_layer(bxm, "C2", marks), bxm[0], bxm[1], 1.0)
    tr = PRM["thin_ring"]
    bxr = ring_box("C2", 0.83, 0.90, -180, 180)
    arrays["thin_ring"] = (ring_layer(bxr, "C2", tr["r"], tr["fwhm"], tr["peak_minus_base_rgb"], a_hi, a_lo + 360), bxr[0], bxr[1], 1.0)

    # ------------------------------------------------------------------ QC
    RC = {k: os.path.join(ROOT, v) for k, v in PRM["ref_rectified_crops"].items()}
    ref_b03, ref_b01 = RC["tacho.band.03"], RC["tacho.band.01"]
    ref_e03, ref_e01 = RC["tacho.ed.03"], RC["tacho.ed.01"]
    ref_s03, ref_s01 = RC["speedo.arc.03"], RC["speedo.arc.01"]
    raw03_C2, raw03_C1 = os.path.join(RECT, S03 + ".C2"), os.path.join(RECT, S03 + ".C1")
    raw01_C2, raw01_C1 = os.path.join(RECT, S01 + ".C2"), os.path.join(RECT, S01 + ".C1")
    A = arrays
    lg = json.load(open(os.path.join(WORK, "fit_log.json")))
    for key, ref in (("band.track.03", ref_b03), ("band.track.01", ref_b01), ("ed.03", ref_e03), ("ed.01", ref_e01),
                     ("speedo_arc.03", ref_s03), ("speedo_arc.01", ref_s01)):
        FACE[os.path.basename(ref)] = np.array(lg[key]["baseline_rgb"], np.float32)
    fits = {}
    span_track = f"{f_hi + 2}:{a_hi - f_hi - 4}"           # the grey zone, off the marks
    span_fill = f"{(f_lo + 2) % 360}:{f_hi - f_lo - 4}"
    fits["track"] = run_qc(ref_b03, [A["tacho.eco-track.albedo"]], "C2", "tacho.eco-track", ["ring:0.80:0.95"], span_track)
    fits["track01"] = run_qc(ref_b01, [A["tacho.eco-track.albedo"]], "C2", "tacho.eco-track", ["ring:0.80:0.95"], span_track)
    fill_at_state = [A["tacho.eco-track.albedo"], A["fill_clip"]]
    fits["fill"] = run_qc(ref_b03, fill_at_state, "C2", "tacho.eco-fill", ["ring:0.80:0.95"], span_fill)
    fits["fill01"] = run_qc(ref_b01, fill_at_state, "C2", "tacho.eco-fill", ["ring:0.80:0.95"], span_fill)
    fits["band_edge"] = run_qc(ref_b03, fill_at_state + [A["marks"]], "C2", "tacho.eco-band-edges", ["ring:0.80:0.86"], f"{a_lo % 360}:{a_hi - a_lo}")
    ed_span = f"{ed['span_deg'][0] % 360}:{ed['span_deg'][1] - ed['span_deg'][0]}"
    fits["ed"] = run_qc(ref_e03, [A["tacho.ed-arc.glow"]], "C2", "tacho.ed-arc", ["ring:0.46:0.62"], ed_span)
    fits["ed_1x"] = run_qc(ref_e03, [A["ed_1x"]], "C2", "tacho.ed-arc-1x", ["ring:0.46:0.62"], ed_span)
    fits["ed01"] = run_qc(ref_e01, [A["tacho.ed-arc.glow"]], "C2", "tacho.ed-arc", ["ring:0.46:0.62"], ed_span)
    fits["sp"] = run_qc(ref_s03, [A["sp_clip"]], "C1", "speedo.eco-arc", ["ring:0.44:0.62"], f"{s0 + 5}:{s_end - s0 - 10}")
    fits["sp01"] = run_qc(ref_s01, [A["sp_clip"]], "C1", "speedo.eco-arc", ["ring:0.44:0.62"], f"{s0 + 5}:{s_end - s0 - 10}")
    fits["sp_off"] = run_qc(ref_s03, [A["sp_clip"]], "C1", "speedo.eco-arc-beyond", ["ring:0.44:0.62"], f"{s_end + 5}:{s1 - s_end - 10}")
    g2, g1 = glows["C2"], glows["C1"]
    # the tint is tested OVER the Comfort photo of the same car (03 comfort, a stand-in for P1/P2's bezel; QC only,
    # never shipped) against the Eco photo: does the tint turn Comfort's ridge into Eco's?
    def comfort_under(cl):
        b = os.path.join(RECT, f"03_three-modes_photo_bimmerstop.comfort.{cl}")
        bx = json.load(open(b + ".json"))["box"]
        im = cv2.imread(b + ".png")[..., ::-1].astype(np.float32) / 255
        return (np.concatenate([im, np.ones(im.shape[:2] + (1,), np.float32)], -1), bx[0], bx[1], 1.0)
    cu2, cu1 = comfort_under("C2"), comfort_under("C1")
    fits["glow2"] = run_qc(raw03_C2, [cu2, A["tacho.eco-glow.glow"]], "C2", "tacho.eco-glow", ["ring:0.975:1.005"], f"{g2['centre_deg'] - 25}:50", edges=False)
    fits["glow2_none"] = run_qc(raw03_C2, [cu2], "C2", "tacho.eco-glow-without", ["ring:0.975:1.005"], f"{g2['centre_deg'] - 25}:50", edges=False)
    fits["glow1"] = run_qc(raw03_C1, [cu1, A["speedo.eco-glow.glow"]], "C1", "speedo.eco-glow", ["ring:0.975:1.005"], f"{g1['centre_deg'] - 25}:50", edges=False)
    fits["glow1_none"] = run_qc(raw03_C1, [cu1], "C1", "speedo.eco-glow-without", ["ring:0.975:1.005"], f"{g1['centre_deg'] - 25}:50", edges=False)
    # marks: edge error in narrow sectors round each mark
    for nmk, deg in (("end_lo", a_lo), ("zone_lo", f_lo), ("zone_hi", f_hi), ("end_hi", a_hi), ("off", mk["off"])):
        fits["mark_" + nmk] = run_qc(ref_b03, fill_at_state + [A["marks"]], "C2", f"tacho.eco-mark-{nmk}", ["ring:0.80:0.93"], f"{(deg - 4) % 360}:8")
    fits["ring"] = run_qc(ref_b03, [A["thin_ring"]], "C2", "tacho.eco-ring", ["ring:0.83:0.89"], f"{a_hi + 10}:{(a_lo + 360) - a_hi - 20}")
    # composed Eco stack (our parts only, over black) against the whole dial
    def sector_mask(cl, secs, name):
        g = geom.G20[cl]
        yy, xx = np.mgrid[0:geom.PANEL_H, 0:geom.PANEL_W]
        u, v = (xx + 0.5 - g["c"][0]) / g["R"], (yy + 0.5 - g["c"][1]) / g["R"]
        r, ang = np.hypot(u, v), np.degrees(np.arctan2(u, -v)) % 360
        m = np.zeros(r.shape, bool)
        for r0, r1, a0, a1 in secs:
            m |= (r >= r0) & (r <= r1) & (((ang - a0) % 360) <= ((a1 - a0) % 360 or 360))
        p = os.path.join(WORK, f"roi_{name}.png")
        cv2.imwrite(p, (m * 255).astype(np.uint8))
        return "mask:" + p
    roi2 = sector_mask("C2", [(0.80, 0.95, a_lo, a_hi), (0.48, 0.62, a_lo, a_hi), (0.80, 0.87, a_hi, a_lo),
                              (0.93, 1.06, g2["centre_deg"] - 30, g2["centre_deg"] + 30)], "stack_tacho")
    roi1 = sector_mask("C1", [(0.44, 0.62, s0, s1), (0.93, 1.06, g1["centre_deg"] - 30, g1["centre_deg"] + 30)], "stack_speedo")
    stack2 = [A["tacho.eco-glow.glow"], A["thin_ring"], A["tacho.eco-track.albedo"], A["fill_clip"], A["marks"], A["tacho.ed-arc.glow"]]
    fits["stack2"] = run_qc(ref_b03, stack2, "C2", "stack-tacho", [roi2], edges=True)
    stack2m = [A["tacho.eco-glow.glow"], A["thin_ring"], A["merged"], A["fill_clip"], A["marks"]]
    fits["stack2_merged"] = run_qc(ref_b03, stack2m, "C2", "stack-tacho-merged", [roi2], edges=True)
    fits["stack2_01"] = run_qc(ref_b01, stack2, "C2", "stack-tacho", [roi2], edges=True)
    stack1 = [A["speedo.eco-glow.glow"], A["sp_clip"]]
    fits["stack1"] = run_qc(ref_s03, stack1, "C1", "stack-speedo", [roi1], edges=True)
    json.dump(fits, open(os.path.join(WORK, "qc_all.json"), "w"), indent=1, default=float)

    # preview images over black (panel space crops)
    for nm, lst, cl in (("preview_tacho", stack2, "C2"), ("preview_speedo", stack1, "C1")):
        box = geom.crop_box(cl, 1.08)
        rgb = qc.compose(lst, list(box), 1)
        cv2.imwrite(os.path.join(WORK, nm + ".png"), (np.clip(rgb, 0, 1)[..., ::-1] * 255).astype(np.uint8))

    write_manifest(files, fits, glows, marks, a_lo, a_hi, f_lo, f_hi, s0, s1, s_end, eco_kmh)
    for k, v in fits.items():
        print(f"{k:12s} ssim {v['ssim']}  dE {v['dE2000_mean']}  edge {v['edge_px_err']}  px {v['valid_px']}  bias {v['luma_bias']}")


def fitpick(f):
    return {k: f[k] for k in ("ssim", "dE2000_mean", "edge_px_err", "ref", "roi", "sheet")}


def write_manifest(files, fits, glows, marks, a_lo, a_hi, f_lo, f_hi, s0, s1, s_end, eco_kmh):
    band, ed, sp, tr = PRM["band"], PRM["ed_arc"], PRM["speedo_arc"], PRM["thin_ring"]
    off = PRM["centre_offsets_R"]

    def baked(id_, name, z, kind, src, ev, fit, params, below=(), above=()):
        fn, box, sc = files[name]
        e = imageio.manifest_entry(id=id_, cluster="C8", z=z, kind=kind, **{"class": "baked"}, frame="panel",
                                   x=box[0], y=box[1], w=box[2], h=box[3], scale=sc, file=fn)
        e.update(stack_below=list(below), stack_above=list(above), sources=src, evidence=ev,
                 light={"dir_deg": 0, "key": 0.0}, fit=fitpick(fit), params=params)
        return e

    def proc(id_, z, kind, cls, src, ev, params, box=None, fit=None, below=(), above=()):
        e = {"id": id_, "cluster": "C8", "z": z, "kind": kind, "class": cls, "frame": "panel" if box else "dial",
             "file": None, "bytes_by_8wh": 0, "stack_below": list(below), "stack_above": list(above), "sources": src,
             "evidence": ev, "params": params}
        if box:
            e.update(x=box[0], y=box[1], w=box[2], h=box[3])
        if fit:
            e["fit"] = fitpick(fit)
        return e

    src = ["03_three-modes_photo_bimmerstop.png", "01_three-modes_small.png"]
    src2 = src + ["02_three-modes_clean-render.png"]
    L = []
    for cl, nm, side, cc in (("C2", "tacho", "lower left of the rev dial", PRM["glow"]["C2"]),
                             ("C1", "speedo", "right of the speed dial", PRM["glow"]["C1"])):
        g = glows[cl]
        L.append(baked(f"{nm}.eco-glow", f"{nm}.eco-glow.glow", 11.5, "glow", src2, "ok", fits["glow2" if cl == "C2" else "glow1"],
                       {"what": f"the Eco blue on the bezel ridge on the window side ({side}): a TINT of the shared bezel layer, "
                                "alpha-over a pale blue, so the Comfort bezel is not re-baked",
                        "model": "rgba = (colour, alpha * exp(-da^2 / 2 sd_deg^2) * exp(-(r - r0)^2 / 2 sd_r^2))",
                        "centre_deg": g["centre_deg"], "sd_deg": g["sd_deg"], "r0": g["r"], "sd_r": g["sd_r"],
                        "colour": g["colour"], "alpha": g["alpha"],
                        "solved_from": "03 C2 at 267.5 deg: Eco ridge " + str(PRM["glow"]["C2"]["eco_ridge_rgb"]) + " vs Comfort ridge "
                                       + str(PRM["glow"]["C2"]["comfort_ridge_rgb"]) + " (same car, same angle)",
                        "fit_without_tint": {k: fits[("glow2" if cl == "C2" else "glow1") + "_none"][k] for k in ("ssim", "dE2000_mean")},
                        "cross_check_01": "01 puts it at %.1f deg, sd %.1f; 01 and 02 show a much stronger, wider blue (02: the whole bezel and a halo outside). Strength is a parameter: alpha %.2f (03) up to ~0.8 (01 / 02, weak)" % (PRM["glow01"][cl]["centre_deg"], PRM["glow01"][cl]["sd_deg"], g["alpha"]),
                        "z_note": "directly above the bezel gloss (P1/P2 z 11)"},
                       below=[f"{nm}.bezel"]))
    L.append(proc("tacho.eco-ring", 5.05, "albedo", "procedural", src, "weak",
                  {"what": "a thin dim track ring that closes the CHARGE/POWER band round the bottom",
                   "r": tr["r"], "fwhm": tr["fwhm"], "rgb_over_black": tr["peak_minus_base_rgb"],
                   "span_deg": [a_hi, a_lo + 360], "profile": "gaussian across r"}, fit=fits["ring"]))
    trk = dict(band["track"])
    trk.update(span_deg=[a_lo, a_hi], model="I_c = P_c*smoothstep(edge-w/2, edge+w/2, r)*exp(-((r-peak_r)+/tau_c)^k_c)*(1-smoothstep(fade0, fade1, r)); "
               "rgba = (I/max(I), max(I)); square ends", recentred_by_R=off["tacho.band.03"],
               radii_from="03 (primary, circle rms 0.42 px), 01 (edge 0.7955, 0.01 R inside); 02 not used: its band is not concentric in our frame (circle fit rms 6 px, centre off by 0.2 R)",
               cross_check_01=band["track"] if False else "see bake/work/C8-eco/fit_log.json band.track.01")
    L.append(baked("tacho.eco-track", "tacho.eco-track.albedo", 5.1, "albedo", src, "ok", fits["track"], trk,
                   below=["tacho.face"], above=["tacho.eco-fill"]))
    fl = dict(band["fill"])
    fl.update(span_deg=[a_lo, a_hi], clip="dynamic: the shader shows this layer only between clip_deg[0] and clip_deg[1] (cw12)",
              clip_deg_in_refs=[f_lo, f_hi], clip_note="03 and 01 both show the blue fill from -31.75 to 89.5 deg and grey outside; 02 shows white from -48 to ~100 deg: which signal drives the bounds is not in the evidence",
              model=trk["model"], recentred_by_R=off["tacho.band.03"])
    L.append(baked("tacho.eco-fill", "tacho.eco-fill.albedo", 5.2, "albedo", src2, "ok", fits["fill"], fl,
                   below=["tacho.eco-track"], above=["tacho.eco-marks"]))
    L.append(proc("tacho.eco-fill-clip", 5.21, "mask", "dynamic", src2, "weak",
                  {"what": "the angular clip of tacho.eco-fill (the fill is dynamic, the layer is static)",
                   "default_deg": [f_lo, f_hi], "range_deg": [a_lo, a_hi], "edge_aa_deg": 0.25,
                   "glsl": "float rel = mod(a - clip0 + 720.0, 360.0); show = rel <= clip1 - clip0"}))
    L.append(proc("tacho.eco-marks", 5.3, "albedo", "procedural", src2, "ok",
                  {"what": "white radial marks: band ends, fill-zone bounds, the CHARGE|POWER split, the OFF park mark",
                   "marks": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()} for m in marks],
                   "units": "deg cw12, r0/r1/hw (half width) in R; rgb 0..1; 'a' = opacity",
                   "split_note": "the 0 deg split is hidden by the needle in 03; width and length from 02 (weak)",
                   "measured_deg_03": PRM["marks"], "measured_deg_01": {"end_lo": -40.5, "zone_lo": -35.5, "zone_hi": 89.0, "end_hi": 129.75, "off": -128.75}},
                  fit=fits["mark_end_hi"]))
    L.append(proc("tacho.eco-hairlines", 5.31, "albedo", "procedural", ["03_three-modes_photo_bimmerstop.png", "02_three-modes_clean-render.png"], "ok",
                  {"what": "dark radial graduation lines across the band's inner half; BAKED into tacho.eco-track / tacho.eco-fill "
                           "(numbers kept here so a shader can redraw them)",
                   **HAIR, "measured": "03 (rectified): 5.0 deg pitch, autocorrelation 0.77-0.78 at r 0.85 in both zones, dark at "
                                       "multiples of 5 deg (phase -0.3 deg), about 10 % darker at r 0.84, gone by r 0.875; the band's marks sit on the same 5 deg grid. "
                                       "02 shows much finer hairlines (~1 deg) on the grey zone: render variant, not used."}))
    edp = dict(ed)
    edp.update(span_deg=[a_lo, a_hi], span_deg_measured_rectified_03=ed["span_deg"],
               model=trk["model"], recentred_by_R=off["tacho.ed.03"],
               radii_from="03 peak r 0.504 (circle rms 0.50 px), 01 0.5095 (rms 0.62 px), 02 0.505 (rms 3.8 px, not concentric). This is the inner-disc edge (P0: ~0.49) lit blue.",
               span_note="drawn over the band's end-mark angles: 03 before rectification read -41.0 .. 129.5 deg; the threshold read on the rectified crop (upper end 159.75) catches the ticks below the arc and is not used",
               ticks="faint radial ticks on its outer side in 02 / 03 (weak): see tacho.ed-ticks",
               resolution="@0.5x: see fit; a 1x variant scored " + json.dumps({k: fits['ed_1x'][k] for k in ('ssim', 'dE2000_mean', 'edge_px_err')}))
    L.append(baked("tacho.ed-arc", "tacho.ed-arc.glow", 6.1, "glow", src, "strong", fits["ed"], edp,
                   below=["tacho.face"], above=["tacho.hub"]))
    L.append(proc("tacho.ed-ticks", 6.11, "albedo", "procedural", ["02_three-modes_clean-render.png", "03_three-modes_photo_bimmerstop.png"], "weak",
                  {"what": "faint radial ticks just outside the EfficientDynamics arc, on its right half",
                   "r0": 0.515, "r1": 0.56, "span_deg": [40, 125], "pitch_deg": 3.2, "hw": 0.0015, "rgb": [0.35, 0.5, 0.8], "opacity": 0.35,
                   "note": "pitch assumed equal to the rev minor pitch; not measurable"}))
    spp = dict(sp)
    spp.update(model=trk["model"], span_deg=[s0, s1], recentred_by_R=off["speedo.arc.03"],
               radii_from="03 peak r 0.495 (circle rms 0.41 px), 01 0.4915; the Comfort disc edge in 03 sits at 0.488 R (grey). 02 puts it at ~0.43 R (its proportions differ)")
    L.append(baked("speedo.eco-arc", "speedo.eco-arc.glow", 6.1, "glow", src2, "strong", fits["sp"], spp,
                   below=["speedo.inner-disc"], above=["speedo.hub"]))
    L.append(proc("speedo.eco-arc-clip", 6.11, "mask", "dynamic", src, "ok",
                  {"what": "the Eco speed arc is lit from 0 km/h up to the Eco Pro speed (a setting): clip the layer at it",
                   "from_deg": s0, "to_deg_default": s_end, "default_kmh": eco_kmh, "deg_per_kmh": geom.SPD_SWEEP / 260.0,
                   "measured_end_deg": {"03": "about 5 (fades out 355..10)", "01": 10.0},
                   "beyond": "past the end the disc edge is dark in 03 / 01 (02 shows blue radial ticks there instead: render variant)"},
                  fit=fits["sp_off"]))
    tints = json.load(open(os.path.join(WORK, "fit_log.json")))["tints_03"]
    L.append(proc("eco.tint-shared", 0.5, "albedo", "procedural", ["03_three-modes_photo_bimmerstop.png"], "ok",
                  {"what": "Eco Pro colours of the SHARED Comfort layers, as parameters (no re-bake). Same photo (03), same rings, Eco vs Comfort; 0..1 sRGB code values after P0's exposure step",
                   "measured_03": tints,
                   "proposed": {
                       "face_gain_rgb": [0.55, 0.60, 0.80],
                       "groove_rim_rgb": tints["groove_rim_C1"]["eco"],
                       "inner_disc_edge": "replaced by speedo.eco-arc / tacho.ed-arc (lit blue); the grey Comfort edge stays under them",
                       "hub_ring_rgb": tints["hub_ring_C1"]["eco"],
                       "needle": "white / pale blue blade (03: L ~230 core, blue fringe); the red tube of Comfort is not used",
                       "ticks_gain": 0.61,
                       "speed_numerals": "0..40 white, 60.. blue-grey (03: about 0.45, 0.58, 0.70)",
                       "bezel": "unchanged (03: eco 0.54 / comfort 0.44 at C2 and 0.84 / 0.93 at C1, i.e. reflection noise, no tint)"},
                   "notes": "face levels: Eco face is darker AND bluer than Comfort in the same photo (C2 0.024,0.028,0.035 vs 0.071,0.071,0.078). The rev dial has no tick scale in Eco (the band replaces it)."}))
    # live text boxes (not baked)
    def tbox(cl, r0, r1, a0, a1):
        b = ring_box(cl, r0, r1, a0, a1)
        return [b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4]
    for tid, (r0, r1, a0, a1, txt, note) in {
        "tacho.text-charge": (0.745, 0.792, -29.5, -9.8, "CHARGE", "03: r 0.752-0.795, -29.2..-9.8; 01: -29.8..-3.1"),
        "tacho.text-power": (0.741, 0.792, 6.1, 24.0, "POWER", "03: r 0.741-0.794, 6.1..23.7; 01: 4.3..22.1"),
        "tacho.text-effdyn": (0.400, 0.476, -31.0, 74.0, "EfficientDynamics", "01: r 0.401-0.484, -31.2..74.0; 03 the same but cut by the needle"),
    }.items():
        L.append(proc(tid, 7.0, "albedo", "dynamic", src, "ok",
                      {"text": txt, "type": "live text, set on an arc (glyphs upright to the radius, baseline toward the centre)",
                       "baseline_r": r0, "cap_top_r": r1, "cap_height_R": round(r1 - r0, 3), "from_deg": a0, "to_deg": a1,
                       "dial": "C2", "measured": note, "colour": "white, about 0.9" if "effdyn" not in tid else "pale blue-grey (03: about 0.55, 0.62, 0.75)"},
                      box=tbox("C2", r0, r1, a0, a1)))
    imgs = [e for e in L if e.get("file")]
    total = sum(e["bytes_by_8wh"] for e in imgs)
    fm, bm, sm = files["__merged"]
    comp = {"images": [{"file": fm, "from_ids": ["tacho.eco-track", "tacho.ed-arc"], "x": bm[0], "y": bm[1], "w": bm[2], "h": bm[3],
                        "scale": sm, "bytes_by_8wh": imageio.bytes_by_8wh(bm[2] // 2, bm[3] // 2)}] + [
        {"file": e["file"], "from_ids": [e["id"]], "x": e["x"], "y": e["y"], "w": e["w"], "h": e["h"], "scale": e["scale"], "bytes_by_8wh": e["bytes_by_8wh"]}
        for e in imgs if e["id"] not in ("tacho.eco-fill", "tacho.eco-track", "tacho.ed-arc")],
        "layer_count": 0, "bytes_by_8wh_total": 0, "merged_fit": fitpick(fits["stack2_merged"]),
        "note": "tacho.eco-fill is drawn by the effect shader from its params over the static image (or, as a fallback, by sampling tacho.eco-fill.albedo@0.5x: +1 image, +" + str(next(e["bytes_by_8wh"] for e in imgs if e["id"] == "tacho.eco-fill")) + " B). The glows sit above P1/P2's bezel, so they cannot merge into the face-level image."}
    comp_total = sum(i["bytes_by_8wh"] for i in comp["images"])
    comp["layer_count"] = len(comp["images"])
    comp["bytes_by_8wh_total"] = comp_total
    m = {"cluster": "C8", "package": "P7", "mode": "eco", "R": 335,
         "generator": "cd bake/src && $PY C8-eco/fit.py && $PY C8-eco/build.py",
         "notes": ("Eco Pro parts only, on top of the Comfort dial stack (C1 / C2 of P1 / P2). All files: " + str(len(imgs)) +
                   f" images, {total} B by w*h*8. Proposed composition: the fill is drawn by the band shader from the fill "
                   "parameters (same profile model as the track), so tacho.eco-fill.albedo is a fallback, not loaded. "
                   "Merge further when P9 composes: speedo.eco-glow + speedo.eco-arc could share one @0.5x image only if the "
                   "box (r 0.42 .. 1.06) is accepted; they are kept apart (two small boxes beat one big one)."),
         "layers": L, "composition": comp,
         "open_questions": [
             "Which signal drives the CHARGE/POWER fill bounds (03 / 01: blue -31.75..89.5 deg, grey outside; 02: white -48..~100)? Treat as dynamic clip until known.",
             "Eco speed arc end: tied to the Eco Pro speed setting (130 km/h assumed -> 0 deg on our 1 deg/kmh scale); verify on the car.",
             "Curved live text (CHARGE, POWER, EfficientDynamics follow the arc): can the text widget draw on an arc, or should these be pre-rotated per glyph?",
             "02's Eco dial is not concentric with its bezel in our frame (render perspective); all radii come from 03 (+01).",
             "The face features in 03 / 01 sit 0.012-0.048 R off the bezel centre (parallax of the recessed face); QC used re-centred crops (bake/work/C8-eco/rect/*.rc-*).",
             "The hairlines and the ED ticks are weak (pitch not measurable).",
         ]}
    imageio.write_json(MANIFEST, m)


if __name__ == "__main__":
    main()
