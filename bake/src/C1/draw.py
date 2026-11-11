"""P1 / C1 speed dial: procedural drawing of every static layer (numbers in C1/params.py, R units, cw12 degrees).

Every function returns a float32 RGBA straight-alpha image (h, w, 4), sRGB-encoded, for the panel box P.BOX at 1x.
Crisp shapes are evaluated on an ss x ss supersampled grid with analytic 1-sample-wide edges, then box-filtered;
soft shapes are evaluated at pixel centres. The same formulas port 1:1 to GLSL (see params / report).
"""
import math
import numpy as np

from C1 import params as P

SS = 4


class Grid:
    """Dial-frame coordinates of a w x h canvas: u, v in R units (y down), r, cw12 angle, plus px per R unit."""

    def __init__(self, ss=1, box=P.BOX, centre=P.CENTRE, R=P.R_PX):
        x0, y0, w, h = box
        self.w, self.h, self.ss, self.R = w, h, ss, R
        o = (np.arange(ss) + 0.5) / ss
        xs = (np.arange(w)[:, None] + o[None, :]).ravel() + x0
        ys = (np.arange(h)[:, None] + o[None, :]).ravel() + y0
        X, Y = np.meshgrid(xs, ys)
        self.u = ((X - centre[0]) / R).astype(np.float32)
        self.v = ((Y - centre[1]) / R).astype(np.float32)
        self.r = np.hypot(self.u, self.v)
        self.a = (np.degrees(np.arctan2(self.u, -self.v)) % 360.0).astype(np.float32)
        self.px = 1.0 / R                      # one panel px in R units

    def down(self, img):
        s = self.ss
        if s == 1:
            return img.astype(np.float32)
        if img.ndim == 2:
            return img.reshape(self.h, s, self.w, s).mean(axis=(1, 3)).astype(np.float32)
        return img.reshape(self.h, s, self.w, s, img.shape[2]).mean(axis=(1, 3)).astype(np.float32)


def c255(rgb):
    return np.asarray(rgb, np.float32) / 255.0


def lit(g):
    """0..1, 1 on the side of the dial that faces the drawn key light (math deg, y up)."""
    a = math.radians(P.LIGHT["key_dir_deg"])
    lx, ly = math.cos(a), -math.sin(a)            # y down
    rr = np.maximum(g.r, 1e-6)
    return 0.5 + 0.5 * (g.u / rr * lx + g.v / rr * ly)


def band(x, lo, hi, px):
    """Anti-aliased 1 inside [lo, hi] (edge width one pixel `px`)."""
    return np.clip((x - lo) / px + 0.5, 0, 1) * np.clip((hi - x) / px + 0.5, 0, 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def tube(x, c, w, px):
    """Coverage of a line of full width w centred on c (R units), AA edges."""
    return np.clip((w * 0.5 - np.abs(x - c)) / px + 0.5, 0, 1)


def rgba(rgb, a):
    out = np.empty(a.shape + (4,), np.float32)
    rgb = np.asarray(rgb, np.float32)
    out[..., :3] = rgb if rgb.ndim == 1 else rgb
    out[..., 3] = np.clip(a, 0, 1)
    return out


def above_floor(g):
    return g.v < P.FLOOR["dy"]


def open_arc_cov(g, r):
    """1 on the part of a circle of radius r that lies above the floor line (the 6WB discs are open at the bottom)."""
    return np.clip((P.FLOOR["dy"] - g.v) / g.px + 0.5, 0, 1)


# ------------------------------------------------------------------------------------------------- soft (baked) layers
def face_albedo(g):
    """z1: the face, the disc's fill (above the floor) and the floor's fill (below it). Opaque out to the bezel."""
    F, D, FL = P.FACE, P.DISC, P.FLOOR
    col = np.broadcast_to(c255(F["rgb"]), g.r.shape + (3,)).copy()
    col += c255(F["lift_rgb"]) * np.clip(1 - g.r / 0.8, 0, 1)[..., None]
    t = smooth(D["fill_from"], D["r"], g.r)[..., None]
    disc = c255(D["fill_rgb"]) * (1 - t) + c255(D["fill_edge_rgb"]) * t
    ind = ((g.r < D["r"]) & above_floor(g))[..., None]
    col = np.where(ind, disc, col)
    # below the floor line: the floor's own fill, fading out radially (no hard circle: the disc is open there)
    fb = ((1 - smooth(FL["below_r0"], FL["below_r1"], g.r)) * ~above_floor(g))[..., None]
    col = col * (1 - fb) + c255(FL["below_rgb"]) * fb
    a = np.clip((1.0 - g.r) / g.px + 0.5, 0, 1)
    return rgba(col, a)


def groove_albedo(g):
    """z3: the recessed tick track: dark floor, the inner rim's light spilling down its slope, the outer wall."""
    G = P.GROOVE
    t = smooth(G["r_in"], G["spill_to"], g.r)[..., None]
    col = c255(G["spill_rgb"]) * (1 - t) + c255(G["floor_rgb"]) * t
    w = smooth(G["wall_r0"] - 0.006, G["wall_r0"] + 0.004, g.r) * (1 - smooth(G["wall_r1"] - 0.004, G["wall_r1"] + 0.004, g.r))
    col = col * (1 - w[..., None]) + c255(G["wall_rgb"]) * w[..., None]
    a = np.clip((g.r - G["r_in"]) / g.px + 0.5, 0, 1) * np.clip((0.995 - g.r) / g.px + 0.5, 0, 1)
    return rgba(col, a)


def face_shadow(g):
    """z2: AO inside the bezel wall, a weak shadow just outside the inner disc's edge."""
    S, D = P.FACE_SHADOW, P.DISC
    a = S["a"] * np.exp(-np.maximum(S["r_wall"] - g.r, 0) / S["scale"]) * (g.r < 1.0)
    a = np.maximum(a, S["disc_a"] * np.exp(-np.maximum(g.r - D["r"], 0) / S["disc_scale"]) * (g.r > D["r"])
                   * above_floor(g) * (1 - lit(g) * 0.5))
    return rgba((0, 0, 0), a)


def floor_shade(g):
    """z2.5: the face below the horizon line is darker across the face, out to ~0.7 R."""
    S = P.FLOOR_SHADE
    a = S["a"] * smooth(S["dy"], S["dy"] + S["ramp"], g.v) * (1 - smooth(S["r_out"] - S["r_feather"], S["r_out"] + S["r_feather"], g.r))
    return rgba((0, 0, 0), a)


def hub_well(g):
    """z9: a weak dark vignette around the hub (the red ring and its glow are dynamic)."""
    H = P.HUB_WELL
    a = H["a"] * (1 - smooth(H["r_core"], H["r_out"], g.r))
    return rgba((0, 0, 0), a)


def _tick_index(g):
    S = P.SCALE
    step = S["minor_kmh"] * S["deg_per_kmh"]
    rel = (g.a - S["start"]) % 360.0
    n = S["vmax"] // S["minor_kmh"]
    k = np.clip(np.floor(rel / step + 0.5), 0, n)
    inscale = rel <= S["vmax"] * S["deg_per_kmh"] + step * 0.5
    kmh = k * S["minor_kmh"]
    kind = np.where(kmh % S["major_kmh"] == 0, 0, np.where(kmh % S["mid_kmh"] == 0, 1, 2))
    ta = np.radians(S["start"] + k * step)
    along = g.u * np.sin(ta) - g.v * np.cos(ta)
    across = np.abs(g.u * np.cos(ta) + g.v * np.sin(ta))
    return kind, along, across, inscale


def soft_glow(g):
    """z8.5 glow: the light spots past the major / mid ticks, the ticks' halo, the tube halos of the disc edge and the
    inner ring, the floor lip's glow over the disc."""
    T, H, D, Rg, FL = P.TICK_SPOT, P.TICK_HALO, P.DISC, P.RING, P.FLOOR
    kind, along, across, ins = _tick_index(g)
    amp = np.where(kind == 0, T["a_major"], np.where(kind == 1, T["a_mid"], 0.0)) * ins
    spot = amp * np.exp(-0.5 * ((along - T["r"]) / T["sigma_r"]) ** 2 - 0.5 * (across / T["sigma_t"]) ** 2)
    col_spot = c255(T["rgb"])
    # halo around every tick
    hw = np.where(kind == 0, P.TICKS["major"]["w_out"], np.where(kind == 1, P.TICKS["mid"]["w_out"], P.TICKS["minor"]["w_out"]))
    rin = np.where(kind == 0, P.TICKS["major"]["r_in"], np.where(kind == 1, P.TICKS["mid"]["r_in"], P.TICKS["minor"]["r_in"]))
    dd = np.maximum(across - hw, 0) + np.maximum(rin - along, 0) + np.maximum(along - P.TICKS["major"]["r_out"], 0)
    halo = H["a"] * np.exp(-dd / H["scale"]) * ins * np.where(kind == 2, 0.5, 1.0)
    # tube halos (disc edge, inner ring), above the floor only
    up = open_arc_cov(g, 0)
    lt = 0.4 + 0.6 * lit(g)
    dh = D["halo_a"] * np.exp(-np.abs(g.r - D["r"]) / D["halo_scale"]) * up * lt
    rh = Rg["halo_a"] * np.exp(-np.abs(g.r - Rg["r"]) / Rg["halo_scale"]) * up * lt
    # the floor lip's glow over the disc, rising toward the floor line
    fg = FL["glow_a"] * np.clip(g.v / FL["dy"], 0, 1) ** FL["glow_pow"] * (g.r < D["r"] - 0.004) * up
    parts = [(spot, col_spot), (halo, c255(P.TICKS["major"]["rgb"])), (dh, c255(D["halo_rgb"]) * 3.0),
             (rh, c255(D["halo_rgb"]) * 3.0), (fg, c255(FL["glow_rgb"]) * 2.0)]
    # combine as one straight-alpha glow: alpha = 1 - prod(1 - a_i), colour = alpha-weighted mean
    A = np.zeros(g.r.shape, np.float32); C = np.zeros(g.r.shape + (3,), np.float32)
    for a, col in parts:
        a = np.clip(a, 0, 1).astype(np.float32)
        C = C * (1 - a[..., None]) + np.clip(col, 0, 1) * a[..., None]   # premultiplied over
        A = A * (1 - a) + a
    rgb = np.where(A[..., None] > 1e-6, C / np.maximum(A[..., None], 1e-6), 0)
    return rgba(rgb, A)


# --------------------------------------------------------------------------------------- crisp (procedural) layers
def groove_rims(g):
    """z3.1 highlight: the lit inner rim of the tick groove (brighter on the key-light side)."""
    G, L = P.GROOVE, P.LIGHT
    m = (1 - L["rim_mod"]) + 2 * L["rim_mod"] * lit(g)
    cov = tube(g.r, G["r_in"], G["rim_w"], g.px)
    return rgba(np.clip(c255(G["rim_rgb"]) * m[..., None], 0, 1), cov)


def ticks(g):
    """z5 albedo: the wedge ticks with the cool fringe at the outer end."""
    kind, along, across, ins = _tick_index(g)
    out = np.zeros(g.r.shape + (4,), np.float32)
    for ki, name in enumerate(["major", "mid", "minor"]):
        T = P.TICKS[name]
        t = np.clip((along - T["r_in"]) / (T["r_out"] - T["r_in"]), 0, 1)
        hw = T["w_in"] + (T["w_out"] - T["w_in"]) * t
        cov = (np.clip((hw - across) / g.px + 0.5, 0, 1) * np.clip((along - T["r_in"]) / g.px + 0.5, 0, 1)
               * np.clip((T["r_out"] - along) / g.px + 0.5, 0, 1)) * (kind == ki) * ins
        mixk = P.FRINGE["mix_" + name] * smooth(P.FRINGE["from_t"], 1.0, t)
        col = c255(T["rgb"])[None] * (1 - mixk[..., None]) + c255(P.FRINGE["rgb"])[None] * mixk[..., None]
        sel = cov > 0
        out[sel, :3] = col[sel]
        out[sel, 3] = np.maximum(out[sel, 3], cov[sel] * T["a"])
    return out


def inner_disc(g):
    """z6: the disc's lit edge, an arc open at the bottom (ends on the floor line)."""
    D, L = P.DISC, P.LIGHT
    m = (1 - L["rim_mod"]) + 2 * L["rim_mod"] * lit(g)
    cov = tube(g.r, D["r"], D["edge_w"], g.px) * open_arc_cov(g, D["r"])
    return rgba(np.clip(c255(D["edge_rgb"]) * m[..., None], 0, 1), cov)


def inner_ring(g):
    """z7: the thin inner ring (tube), open at the bottom."""
    Rg, L = P.RING, P.LIGHT
    m = (1 - L["rim_mod"]) + 2 * L["rim_mod"] * lit(g)
    cov = tube(g.r, Rg["r"], Rg["w"], g.px) * open_arc_cov(g, Rg["r"])
    return rgba(np.clip(c255(Rg["rgb"]) * m[..., None], 0, 1), cov)


def floor_edge(g):
    """z8: the floor's lit lip, a horizontal line 0.245 R below the centre, inside the disc only."""
    FL, D = P.FLOOR, P.DISC
    cov = tube(g.v, FL["dy"] - FL["lip_w"] * 0.5, FL["lip_w"], g.px) * np.clip((D["r"] - g.r) / g.px + 0.5, 0, 1)
    return rgba(c255(FL["lip_rgb"]), cov)


def bezel_gain(a):
    B = P.BEZEL
    gsum = np.full(np.shape(a), B["base"], np.float32)
    for c, s, k in B["lobes"]:
        d = (a - c + 180.0) % 360.0 - 180.0
        gsum = gsum + k * np.exp(-0.5 * (d / s) ** 2)
    return np.clip(gsum, 0, 1.2)


def bezel(g):
    """z11 highlight: the bezel tube: a dark inner wall, the bright ridge (two-lobed gloss), a soft outer fade.
    Opaque from the wall to the ridge, so it covers the face; transparent outside R."""
    B, I = P.BEZEL, P.BEZEL_INNER_RIM
    gain = bezel_gain(g.a)
    ridge = np.exp(-0.5 * ((g.r - B["r"]) / B["sigma"]) ** 2) * gain
    d = (g.a - I["centre"] + 180.0) % 360.0 - 180.0
    rim = I["a"] * np.exp(-0.5 * ((g.r - I["r"]) / I["sigma"]) ** 2) * np.exp(-0.5 * (d / I["span_sigma"]) ** 2)
    lum = np.clip(ridge + rim, 0, 1)
    col = c255(B["rgb"])
    # straight alpha: inside the ridge the tube is opaque-dark (colour = lum * rgb); outside it fades to transparent
    a_in = smooth(B["inner_dark"][0], B["inner_dark"][1], g.r) * (g.r <= B["r"])
    a_out = np.clip(np.exp(-0.5 * ((g.r - B["r"]) / B["sigma"]) ** 2) * gain / np.maximum(gain, 1e-3), 0, 1) * (g.r > B["r"])
    a = np.maximum(a_in, a_out)
    a = np.maximum(a, lum)
    rgb = np.where(a[..., None] > 1e-6, col * (lum / np.maximum(a, 1e-6))[..., None], 0)
    return rgba(np.clip(rgb, 0, 1), a)


SOFT = {  # id -> (fn, z, kind)
    "speedo.face": (face_albedo, 1, "albedo"),
    "speedo.face-shadow": (face_shadow, 2, "shadow"),
    "speedo.floor-shade": (floor_shade, 2.5, "shadow"),
    "speedo.tick-groove": (groove_albedo, 3, "albedo"),
    "speedo.soft-glow": (soft_glow, 8.5, "glow"),
    "speedo.hub-well": (hub_well, 9, "shadow"),
}
CRISP = {
    "speedo.tick-groove-rim": (groove_rims, 3.1, "highlight"),
    "speedo.ticks": (ticks, 5, "albedo"),
    "speedo.inner-disc": (inner_disc, 6, "albedo"),
    "speedo.inner-ring": (inner_ring, 7, "albedo"),
    "speedo.floor": (floor_edge, 8, "albedo"),
    "speedo.bezel": (bezel, 11, "highlight"),
}


def render_all(ss=SS):
    """-> dict id -> RGBA float (h, w, 4) at 1x over P.BOX."""
    out = {}
    g1 = Grid(1)
    for k, (fn, z, kind) in SOFT.items():
        out[k] = fn(g1)
    gs = Grid(ss)
    for k, (fn, z, kind) in CRISP.items():
        img = fn(gs)
        pm = img.copy(); pm[..., :3] *= pm[..., 3:4]
        pm = gs.down(pm)
        a = pm[..., 3:4]
        pm[..., :3] = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0)
        out[k] = pm
    return out
