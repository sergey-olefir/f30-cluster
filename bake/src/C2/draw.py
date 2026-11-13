"""P2 / C2 rev dial: the drawing. Every element is a function (canvas) -> float32 RGBA straight alpha, (h, w, 4).

A canvas is a panel box (x0, y0, w, h) sampled k px per panel px, with the dial centre / R of the G20 COMFORT rev
dial (common.geom.G20["C2"]). Crisp elements are supersampled (ss per axis, box filter); soft ones are not.
All shapes in R units (params.py), angles cw12 degrees. Our own drawing: no reference pixels are used here.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa: E402
from C2 import params as P  # noqa: E402

CX, CY = geom.G20["C2"]["c"]
RPX = geom.G20["C2"]["R"]


class Canvas:
    def __init__(self, x0, y0, w, h, k=1):
        self.x0, self.y0, self.w, self.h, self.k = x0, y0, w, h, k

    def grid(self, ss=1):
        """-> u, v (R units, y down), r, ang (cw12 deg) at ss x ss subsamples per canvas px."""
        o = (np.arange(ss) + 0.5) / ss
        xs = (np.arange(self.w)[:, None] + o[None, :]).ravel() / self.k + self.x0
        ys = (np.arange(self.h)[:, None] + o[None, :]).ravel() / self.k + self.y0
        X, Y = np.meshgrid(xs, ys)
        u, v = (X - CX) / RPX, (Y - CY) / RPX
        r = np.hypot(u, v)
        ang = np.degrees(np.arctan2(u, -v)) % 360.0
        return u, v, r, ang

    def down(self, a, ss):
        if ss == 1:
            return a.astype(np.float32)
        h, w = a.shape[0] // ss, a.shape[1] // ss
        return a.reshape(h, ss, w, ss, *a.shape[2:]).mean(axis=(1, 3)).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def angdiff(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def lobe(ang, t, k):
    return np.exp(k * (np.cos(np.radians(ang - t)) - 1.0))


def rgba_from(rgb_img, alpha):
    out = np.empty(alpha.shape + (4,), np.float32)
    out[..., :3] = rgb_img
    out[..., 3] = np.clip(alpha, 0, 1)
    return out


def emissive(rgb, amount, ss_cov=None):
    """A light of colour rgb (0..1) added over a near-black base as straight-alpha 'over': alpha = amount (<=1)."""
    a = np.clip(amount, 0, 1)
    img = np.empty(a.shape + (4,), np.float32)
    img[..., :3] = np.asarray(rgb, np.float32)
    img[..., 3] = a
    return img


def premul_sum(*layers):
    """Composite several RGBA (straight) layers with 'over' in order -> one straight RGBA layer."""
    out = np.zeros_like(layers[0])
    for s in layers:
        sa = s[..., 3:4]
        da = out[..., 3:4]
        oa = sa + da * (1 - sa)
        out[..., :3] = np.where(oa > 1e-6, (s[..., :3] * sa + out[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6), 0)
        out[..., 3:4] = oa
    return out


# ------------------------------------------------------------------------------------------------------- the scale
def tick_list():
    """[(angle cw12, kind)] for 0..max rpm every minor step; kind major / half / minor / end; red-zone minors dropped."""
    S, Rd = P.SCALE, P.RED
    out = []
    n = S["max_rpm"] // S["minor_rpm"]
    for i in range(n + 1):
        rpm = i * S["minor_rpm"]
        a = (S["rpm0_cw12"] + S["deg_per_1000"] * rpm / 1000.0) % 360.0
        if rpm % S["major_rpm"] == 0:
            kind = "major"
        elif rpm % S["half_rpm"] == 0:
            kind = "half"
        else:
            kind = "minor"
        if rpm == S["max_rpm"]:
            kind = "end"
        if Rd["minors_hidden"] and kind == "minor" and rpm > Rd["start_rpm"]:
            continue
        out.append((a, kind, rpm))
    return out


def rpm_angle(rpm):
    return (P.SCALE["rpm0_cw12"] + P.SCALE["deg_per_1000"] * rpm / 1000.0) % 360.0


# ------------------------------------------------------------------------------------------------------- z 1 face
def face(cv):
    F = P.FACE
    u, v, r, ang = cv.grid(2)
    rgb = np.zeros(r.shape + (3,), np.float64) + np.asarray(F["base"])
    lit = np.clip(np.cos(np.radians(ang - F["lit_dir_cw12"])), 0, 1) ** F["lit_pow"]
    rgb += lit[..., None] * np.asarray(F["lit_add"])
    dv = F["horizon_v"] - v
    hz = np.where(dv >= 0, np.exp(-dv / F["horizon_h"]), np.exp(dv / 0.01)) * np.exp(-(u / F["horizon_u_fall"]) ** 2)
    rgb += hz[..., None] * np.asarray(F["horizon_add"])
    a = (r <= F["r_out"]).astype(np.float64)
    return cv.down(rgba_from(rgb, a), 2)


# ------------------------------------------------------------------------------------------------------- z 2 / 2.5
def face_shadow(cv):
    S = P.FACE_SHADOW
    u, v, r, ang = cv.grid(1)
    a = S["a_max"] * smoothstep(S["r0"], S["r1"], r) * (r <= P.FACE["r_out"])
    return rgba_from(np.zeros(r.shape + (3,)), a)


def floor_shade(cv):
    S = P.FLOOR_SHADE
    u, v, r, ang = cv.grid(1)
    t = np.clip((v - S["v_line"]) / (S["v_deep"] - S["v_line"]), 0, 1)
    a = S["a_line"] + (S["a_deep"] - S["a_line"]) * smoothstep(0, 1, t)
    a *= smoothstep(S["v_line"] - S["edge_soft"], S["v_line"] + S["edge_soft"], v)
    a *= 1 - smoothstep(S["r_out"] - S["r_soft"], S["r_out"], r)
    return rgba_from(np.zeros(r.shape + (3,)), a)


# ------------------------------------------------------------------------------------------------------- z 3 groove
def groove(cv, ss=4):
    G = P.GROOVE
    u, v, r, ang = cv.grid(ss)
    Ld = G["lip_L"]
    Lth = Ld["base"] + Ld["a_narrow"] * lobe(ang, Ld["dir_cw12"], Ld["k_narrow"]) + Ld["a_wide"] * lobe(ang, Ld["dir_cw12"], Ld["k_wide"])
    amp = (Lth - Ld["base"]) / 255.0
    prof = smoothstep(G["r_lip"] - 2 * G["lip_rise"], G["r_lip"], r) * np.where(
        r < G["r_lip"], 1.0, np.exp(-(r - G["r_lip"]) / G["lip_decay"]))
    a = amp * prof * 1.15
    a += G["outer_rim_L"] / 255.0 * np.exp(-((r - G["r_outer_rim"]) / G["outer_rim_w"]) ** 2)
    a *= (r < 0.95)
    return cv.down(emissive(G["color"], a), ss)


# ------------------------------------------------------------------------------------------------------- z 4 red zone
def red_zone(cv, start_rpm=None, ss=4):
    Rd = P.RED
    start_rpm = Rd["start_rpm"] if start_rpm is None else start_rpm
    u, v, r, ang = cv.grid(ss)
    a0, a1 = rpm_angle(start_rpm) + Rd["pad_deg"], rpm_angle(Rd["end_rpm"]) - Rd["pad_deg"]
    rel = (ang - a0) % 360.0
    span = (a1 - a0) % 360.0
    inside = rel <= span
    t = np.clip(rel / max(span, 1e-6), 0, 1)
    for g in Rd["gap_rpm"]:
        if start_rpm < g < Rd["end_rpm"]:
            inside &= np.abs(angdiff(ang, rpm_angle(g))) > Rd["gap_deg"] / 2
    band = inside & (r >= Rd["band_r"][0]) & (r <= Rd["band_r"][1])
    fill = inside & (r >= Rd["fill_r"][0]) & (r < Rd["band_r"][0])
    rgb = np.zeros(r.shape + (3,))
    rgb[...] = Rd["band_rgb"]
    fr = Rd["fill_R"][0] + (Rd["fill_R"][1] - Rd["fill_R"][0]) * t
    fill_rgb = np.stack([fr, fr * 0.08, fr * 0.07], -1)
    rgb = np.where(fill[..., None], fill_rgb, rgb)
    a = band.astype(np.float64) + fill.astype(np.float64)
    acc = np.concatenate([rgb * a[..., None], a[..., None]], -1)
    return finish(cv, acc, ss)


def _unpremul(img):
    out = np.asarray(img, np.float32).copy()
    al = out[..., 3:4]
    out[..., :3] = np.where(al > 1e-6, out[..., :3] / np.maximum(al, 1e-6), 0)
    return out


def finish(cv, img, ss):
    """downsample a premultiplied supersampled RGBA and return straight alpha."""
    return _unpremul(cv.down(np.asarray(img), ss))


# ------------------------------------------------------------------------------------------------------- z 5 ticks
def _local(cv, ss, ang, r0, r1, pad=0.02):
    """indices of a canvas sub-box around a radial segment (for speed): returns sub-canvas or None."""
    a = math.radians(ang)
    pts = [(CX + math.sin(a) * rr * RPX, CY - math.cos(a) * rr * RPX) for rr in (r0, r1)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    m = pad * RPX
    bx0, bx1 = min(xs) - m, max(xs) + m
    by0, by1 = min(ys) - m, max(ys) + m
    i0 = max(0, int(math.floor((bx0 - cv.x0) * cv.k)))
    i1 = min(cv.w, int(math.ceil((bx1 - cv.x0) * cv.k)))
    j0 = max(0, int(math.floor((by0 - cv.y0) * cv.k)))
    j1 = min(cv.h, int(math.ceil((by1 - cv.y0) * cv.k)))
    if i1 <= i0 or j1 <= j0:
        return None
    return i0, i1, j0, j1, Canvas(cv.x0 + i0 / cv.k, cv.y0 + j0 / cv.k, i1 - i0, j1 - j0, cv.k)


def _wedge_cov(sub, ss, ang, r_in, r_out, hw_in, hw_out):
    u, v, r, _ = sub.grid(ss)
    a = math.radians(ang)
    tx, ty = math.sin(a), -math.cos(a)
    along = u * tx + v * ty
    across = np.abs(u * -ty + v * tx)
    t = np.clip((along - r_in) / (r_out - r_in), 0, 1)
    hw = hw_in + (hw_out - hw_in) * t
    cov = (along >= r_in) & (along <= r_out) & (across <= hw)
    return cov.astype(np.float64), along


def ticks(cv, ss=4, red_start=None):
    T = P.TICKS
    acc = np.zeros((cv.h, cv.w, 4), np.float64)                  # premultiplied
    fr = T["fringe"]
    for ang, kind, rpm in tick_list():
        if red_start is not None and kind == "minor" and rpm > red_start and P.RED["minors_hidden"]:
            continue
        d = T["major"] if kind in ("major", "end") else T[kind]
        loc = _local(cv, ss, ang, d["r_in"], T["r_out"])
        if loc is None:
            continue
        i0, i1, j0, j1, sub = loc
        cov, along = _wedge_cov(sub, ss, ang, d["r_in"], T["r_out"], d["hw_in"], d["hw_out"])
        f = fr["k"] * smoothstep(fr["r0"], fr["r1"], along)
        col = (1 - f)[..., None] * np.asarray(T["color"]) * d["level"] * P.W + f[..., None] * np.asarray(fr["rgb"])
        tile = np.concatenate([col * cov[..., None], cov[..., None]], -1)
        tile = sub.down(tile, ss)
        dst = acc[j0:j1, i0:i1]
        sa = tile[..., 3:4]
        dst[..., :3] = tile[..., :3] + dst[..., :3] * (1 - sa)
        dst[..., 3:4] = sa + dst[..., 3:4] * (1 - sa)
    return _unpremul(acc)


def spots(cv):
    S, T = P.SPOTS, P.TICKS
    u, v, r, ang = cv.grid(1)
    a = np.zeros(r.shape)
    for t_ang, kind, rpm in tick_list():
        lvl = {"major": S["level_major"], "end": S["level_major"], "half": S["level_half"], "minor": S["level_minor"]}[kind]
        if lvl <= 0:
            continue
        rad = math.radians(t_ang)
        cx, cy = math.sin(rad) * (T["r_out"] + S["dr"]), -math.cos(rad) * (T["r_out"] + S["dr"])
        du, dv = u - cx, v - cy
        al = du * math.sin(rad) + dv * -math.cos(rad)
        ac = du * math.cos(rad) + dv * math.sin(rad)
        g = lvl * np.exp(-0.5 * ((al / S["s_along"]) ** 2 + (ac / S["s_across"]) ** 2))
        a = np.maximum(a, g)
    a *= r < 0.955
    return emissive(S["rgb"], a).astype(np.float32)


# ------------------------------------------------------------------------------------------------------- z 5.7 OFF
def off_arc(cv, ss=4):
    O = P.OFF
    u, v, r, ang = cv.grid(ss)
    a_end = rpm_angle(0)
    span = (a_end - O["arc_from_cw12"]) % 360.0
    rel = (ang - O["arc_from_cw12"]) % 360.0
    t = np.clip(rel / span, 0, 1)                                   # 0 at the OFF end, 1 at READY
    inside = rel <= span
    hw = O["hw_at_off"] + (O["hw_at_ready"] - O["hw_at_off"]) * t
    cov = inside & (np.abs(r - O["arc_r"]) <= hw)
    lvl = O["level_at_off"] + (O["level_at_ready"] - O["level_at_off"]) * t
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = (lvl * P.W)[..., None] * cov[..., None]
    acc[..., 3] = cov
    # the OFF mark: a major-like bar
    rad = math.radians(O["mark_cw12"])
    tx, ty = math.sin(rad), -math.cos(rad)
    along = u * tx + v * ty
    across = np.abs(u * -ty + v * tx)
    mk = (along >= O["mark_r"][0]) & (along <= O["mark_r"][1]) & (across <= O["mark_hw"])
    acc[..., :3] = np.where(mk[..., None], P.W, acc[..., :3])
    acc[..., 3] = np.maximum(acc[..., 3], mk)
    return finish(cv, acc, ss)


# ------------------------------------------------------------------------------------------------------- z 6 / 7 disc, ring
def _floor_cut(v, soft=0.004):
    return 1 - smoothstep(P.FLOOR["v_line"] - soft, P.FLOOR["v_line"] + soft, v)


def inner_disc(cv):
    D = P.DISC
    u, v, r, ang = cv.grid(2)
    rgb = np.zeros(r.shape + (3,)) + np.asarray(P.FACE["base"]) + np.asarray(D["fill_add"])
    lit = np.clip(np.cos(np.radians(ang - P.FACE["lit_dir_cw12"])), 0, 1) ** P.FACE["lit_pow"]
    rgb += lit[..., None] * np.asarray(P.FACE["lit_add"])
    rgb += smoothstep(D["ramp_r"][0], D["ramp_r"][1], r)[..., None] * np.asarray(D["ramp_add"])
    F = P.FACE
    dv = F["horizon_v"] - v
    hz = np.where(dv >= 0, np.exp(-dv / F["horizon_h"]), 0) * np.exp(-(u / F["horizon_u_fall"]) ** 2)
    rgb += hz[..., None] * np.asarray(F["horizon_add"])
    a = (r <= D["r_edge"]) * _floor_cut(v, 0.0)
    return cv.down(rgba_from(rgb, a.astype(np.float64)), 2)


def disc_rim(cv, ss=4):
    D = P.DISC
    u, v, r, ang = cv.grid(ss)
    lit = D["rim_lit"][0] + (D["rim_lit"][1] - D["rim_lit"][0]) * lobe(ang, 315.0, 1.5)
    cut = _floor_cut(v, 0.006)
    cov = (np.abs(r - D["r_edge"]) <= D["rim_hw"]) * cut
    halo = np.exp(-np.abs(r - D["r_edge"]) / D["halo_decay"]) * cut * 0.0
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = (np.asarray(D["rim_rgb"]) * lit[..., None]) * cov[..., None]
    acc[..., 3] = cov
    out = finish(cv, acc, ss)
    # the soft halo outside the rim as a light (straight alpha over)
    h = cv.down(np.exp(-np.maximum(r - D["r_edge"], 0) / D["halo_decay"]) * (r > D["r_edge"]) * cut, ss)
    hal = emissive((0.6, 0.66, 0.75), h * 0.03)
    return premul_sum(hal, out)


def inner_ring(cv, ss=4):
    G = P.RING
    u, v, r, ang = cv.grid(ss)
    lit = G["lit"][0] + (G["lit"][1] - G["lit"][0]) * lobe(ang, 315.0, 1.5)
    cov = (np.abs(r - G["r"]) <= G["hw"]) * _floor_cut(v, 0.004)
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = (np.asarray(G["rgb"]) * lit[..., None]) * cov[..., None]
    acc[..., 3] = cov
    return finish(cv, acc, ss)


# ------------------------------------------------------------------------------------------------------- z 8 floor
def floor(cv):
    Fl = P.FLOOR
    u, v, r, ang = cv.grid(2)
    t = np.clip((v - Fl["v_line"]) / (Fl["v_bot"] - Fl["v_line"]), 0, 1)
    rgb = (1 - t)[..., None] * np.asarray(Fl["below_top"]) + t[..., None] * np.asarray(Fl["below_bot"])
    a = (r <= P.DISC["r_edge"] + 0.004) * (v >= Fl["v_line"])
    return cv.down(rgba_from(rgb, a.astype(np.float64)), 2)


def floor_edge(cv, ss=4):
    Fl = P.FLOOR
    u, v, r, ang = cv.grid(ss)
    cov = (np.abs(v - Fl["v_line"]) <= Fl["edge_hw"]) & (r <= P.DISC["r_edge"])
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = np.asarray(Fl["edge_rgb"]) * cov[..., None]
    acc[..., 3] = cov
    return finish(cv, acc, ss)


# ------------------------------------------------------------------------------------------------------- z 8.5 P box
def pbox_geom(u, v):
    """signed-ish inside test and edge distances for the P box (R units)."""
    B = P.PBOX
    # the shoulders: lines from (+-top_hw, top_v) down-out at shoulder_deg below the horizontal, to the bottom arc
    ax = np.abs(u)
    p0 = np.array([B["top_hw"], B["top_v"]])
    t = math.radians(B["shoulder_deg"])
    d = np.array([math.cos(t), math.sin(t)])                       # down-out along the shoulder (v is down)
    n = np.array([d[1], -d[0]])                                     # outward normal (to +u side)
    side = (ax - p0[0]) * n[0] + (v - p0[1]) * n[1]                 # > 0 outside the side
    top = B["top_v"] - v                                            # > 0 above the top
    bot = np.hypot(u, v) - B["bot_r"]                               # > 0 below the bottom arc
    return side, top, bot, n


def pbox(cv, ss=4):
    B = P.PBOX
    u, v, r, ang = cv.grid(ss)
    side, top, bot, n = pbox_geom(u, v)
    # rounded top corners: offset-rounding of the convex top/side intersection
    cr = B["corner_r"]
    dt, ds = top + cr, side + cr
    corner = np.where((dt > 0) & (ds > 0), np.hypot(dt, ds) - cr, np.maximum(dt, ds) - cr)
    inside = (corner <= 0) & (bot <= 0)
    t = np.clip((v - B["top_v"]) / (B["bot_r"] - B["top_v"]), 0, 1)
    fill = (1 - t)[..., None] * np.asarray(B["fill_top"]) + t[..., None] * np.asarray(B["fill_bot"])
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = fill * inside[..., None]
    acc[..., 3] = inside
    rim = np.asarray(B["rim_rgb"]) * P.W
    # top rim (and the corner arcs + sides at the side level)
    tr = B["top_rim"]
    edge_ts = np.abs(corner) <= tr["hw"]
    lvl_top = tr["floor"] + (tr["peak"] - tr["floor"]) * np.exp(-((u - tr["u0"]) / tr["s"]) ** 2)
    on_top = edge_ts & (v < B["top_v"] + cr) & (bot <= 0)
    on_side = edge_ts & (v >= B["top_v"] + cr) & (bot <= 0)
    lvl = np.where(on_top, lvl_top, 0.0) + np.where(on_side, B["side_rim"]["level"], 0.0)
    # bottom rim: the arc, brightest in the middle
    br = B["bot_rim"]
    dang = np.abs(angdiff(ang, 180.0))
    blvl = br["floor"] + (br["peak"] - br["floor"]) * (1 - smoothstep(br["flat_deg"], br["flat_deg"] + br["fade_deg"], dang))
    in_span = dang <= B["bot_half_deg"]
    on_bot = (np.abs(bot) <= br["hw"]) & in_span
    lvl = np.where(on_bot, blvl, lvl)
    cov = (lvl > 0).astype(np.float64)
    col = rim * np.maximum(lvl, 0)[..., None]
    a_rim = cov
    acc[..., :3] = acc[..., :3] * (1 - a_rim[..., None]) + col * a_rim[..., None]
    acc[..., 3] = np.maximum(acc[..., 3], a_rim)
    # soft glow under the bottom rim
    g = br["glow"] * np.exp(-np.maximum(bot, 0) / br["glow_decay"]) * (bot > br["hw"]) * in_span * blvl
    ga = np.clip(g, 0, 1)
    acc[..., :3] = acc[..., :3] * (1 - ga[..., None]) + np.asarray((0.55, 0.7, 0.95)) * ga[..., None]
    acc[..., 3] = acc[..., 3] + ga * (1 - acc[..., 3])
    return finish(cv, acc, ss)


# ------------------------------------------------------------------------------------------------------- z 9 hub
def hub_well(cv):
    H = P.HUB
    u, v, r, ang = cv.grid(1)
    a = H["well_a"] * (1 - smoothstep(H["well_r"][0], H["well_r"][1], r))
    return rgba_from(np.zeros(r.shape + (3,)), a)


def hub_ring(cv, ss=4):
    H = P.HUB
    u, v, r, ang = cv.grid(ss)
    cov = np.abs(r - H["ring_r"]) <= H["ring_hw"]
    acc = np.zeros(r.shape + (4,))
    acc[..., :3] = np.asarray(H["ring_rgb"]) * cov[..., None]
    acc[..., 3] = cov
    ring = finish(cv, acc, ss)
    gl = cv.down(H["ring_glow"] * np.exp(-np.abs(r - H["ring_r"]) / H["ring_glow_decay"]) * (r < H["ring_r"] + 0.06), ss)
    return premul_sum(emissive(H["ring_rgb"], gl), ring)


# ------------------------------------------------------------------------------------------------------- z 11 bezel
def bezel_gain(ang):
    g = P.BEZEL["gloss"]
    return np.clip((g["b"] + g["a1"] * lobe(ang, g["t1"], g["k1"]) + g["a2"] * lobe(ang, g["t2"], g["k2"])
                    + g.get("a3", 0.0) * lobe(ang, g.get("t3", 0.0), g.get("k3", 1.0))) / 235.0, 0, 1)


def bezel(cv, ss=4):
    Bz = P.BEZEL
    u, v, r, ang = cv.grid(ss)
    G = bezel_gain(ang)
    s = np.where(r < Bz["ridge_r"], Bz["s_in"], Bz["s_out"])
    ridge = np.exp(-((r - Bz["ridge_r"]) / s) ** 2)
    b0, b1, b2, b3 = Bz["band"]
    band = Bz["band_level"] * smoothstep(b0, b1, r) * (1 - smoothstep(b2, b3, r))
    lvl = np.maximum(ridge, band) * G * P.W / P.W
    # the dark gap just inside the bezel (black, opaque-ish), then the lit parts
    g0, g1 = P.GROOVE["gap_r"]
    gap = 0.85 * smoothstep(g0 - 0.004, g0, r) * (1 - smoothstep(g1, g1 + 0.004, r))
    acc = np.zeros(r.shape + (4,))
    a = np.clip(lvl, 0, 1)
    col = np.asarray(Bz["rgb"]) * P.W
    acc[..., :3] = col * a[..., None]
    acc[..., 3] = a
    # gap under the light: over() of light onto black-gap
    ga = gap * (1 - a)
    acc[..., 3] = acc[..., 3] + ga
    acc *= (r < 1.03)[..., None]
    return finish(cv, acc, ss)
